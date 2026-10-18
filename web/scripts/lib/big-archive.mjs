// Reads and rewrites BIGF archives (docs/briefs/150-big-rewrite.md).
//
// Layout: "BIGF", u32 LE archive size, u32 BE entry count, u32 BE header size,
// then per entry a u32 BE offset, a u32 BE size and a NUL-terminated latin1
// path; the entry data follows the header. A header may carry extra bytes
// after the last record (the `tail`); they are kept verbatim.
//
// The source is read entry by entry with positioned reads, so only one
// selected entry is held in memory at a time and the destination is written
// sequentially.
import { open, unlink } from "node:fs/promises";

const MAGIC = "BIGF";
const FIXED_HEADER = 16;
const NAME_CHUNK = 4096;
const COPY_CHUNK = 1024 * 1024;

function archiveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readExact(handle, buffer, position, length = buffer.length) {
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
    if (bytesRead === 0) throw archiveError("truncated", "unexpected end of file");
    done += bytesRead;
  }
}

async function writeAll(handle, buffer, position) {
  let done = 0;
  while (done < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      done,
      buffer.length - done,
      position + done,
    );
    if (bytesWritten === 0) throw archiveError("truncated", "write made no progress");
    done += bytesWritten;
  }
}

// Reads a NUL-terminated name, refusing to look for it past the header (a
// bad header) or past the end of the file (a truncated table).
async function readName(handle, start, headerSize, fileSize) {
  const limit = Math.min(headerSize, fileSize);
  const parts = [];
  let position = start;
  while (position < limit) {
    const length = Math.min(NAME_CHUNK, limit - position);
    const chunk = Buffer.allocUnsafe(length);
    await readExact(handle, chunk, position, length);
    const end = chunk.indexOf(0);
    if (end !== -1) {
      parts.push(chunk.subarray(0, end));
      return Buffer.concat(parts).toString("latin1");
    }
    parts.push(chunk);
    position += length;
  }
  if (fileSize <= headerSize) {
    throw archiveError("truncated", "entry table runs past the end of the file");
  }
  throw archiveError("bad-header", "entry table runs past the header");
}

async function parseBig(path) {
  const handle = await open(path, "r");
  try {
    const { size: fileSize } = await handle.stat();
    if (fileSize < FIXED_HEADER) {
      throw archiveError("not-big", "file is shorter than a BIGF header");
    }

    const fixed = Buffer.alloc(FIXED_HEADER);
    await readExact(handle, fixed, 0, FIXED_HEADER);
    if (fixed.toString("latin1", 0, 4) !== MAGIC) {
      throw archiveError("not-big", "magic is not BIGF");
    }

    const count = fixed.readUInt32BE(8);
    const headerSize = fixed.readUInt32BE(12);

    const entries = [];
    const records = [];
    let position = FIXED_HEADER;
    for (let i = 0; i < count; i++) {
      if (position + 8 > fileSize) {
        throw archiveError("truncated", "entry table runs past the end of the file");
      }
      if (position + 8 > headerSize) {
        throw archiveError("bad-header", "entry table runs past the header");
      }

      const record = Buffer.alloc(8);
      await readExact(handle, record, position, 8);
      const offset = record.readUInt32BE(0);
      const size = record.readUInt32BE(4);
      const nameStart = position + 8;
      const name = await readName(handle, nameStart, headerSize, fileSize);

      entries.push({ name, offset, size });
      records.push(position);
      position = nameStart + Buffer.byteLength(name, "latin1") + 1;
    }

    if (headerSize > fileSize) {
      throw archiveError("truncated", "header runs past the end of the file");
    }
    if (position > headerSize) {
      throw archiveError("bad-header", "entry table runs past the header");
    }

    for (const entry of entries) {
      if (entry.offset < headerSize) {
        throw archiveError("bad-header", "entry offset lies inside the header");
      }
      if (entry.offset + entry.size > fileSize) {
        throw archiveError("truncated", "entry data runs past the end of the file");
      }
    }

    const tail = Buffer.alloc(headerSize - position);
    if (tail.length > 0) await readExact(handle, tail, position, tail.length);

    return { entries, headerSize, tail, records };
  } finally {
    await handle.close();
  }
}

async function copyRegion(source, destination, sourcePosition, destinationPosition, length, buffer) {
  let left = length;
  while (left > 0) {
    const chunkLength = Math.min(left, buffer.length);
    await readExact(source, buffer, sourcePosition, chunkLength);
    await writeAll(destination, buffer.subarray(0, chunkLength), destinationPosition);
    sourcePosition += chunkLength;
    destinationPosition += chunkLength;
    left -= chunkLength;
  }
}

export async function readBigDirectory(path) {
  const { entries, headerSize, tail } = await parseBig(path);
  return { entries, headerSize, tail };
}

export async function rewriteBig(srcPath, dstPath, options = {}) {
  const { select = () => false, transform } = options;
  const directory = await parseBig(srcPath);

  const source = await open(srcPath, "r");
  let destination;
  try {
    destination = await open(dstPath, "w");

    // The header keeps its size, names and tail; only offsets, sizes and the
    // archive size change, so start from the source bytes and patch records.
    const header = Buffer.alloc(directory.headerSize);
    if (header.length > 0) await readExact(source, header, 0, header.length);

    const copyBuffer = Buffer.allocUnsafe(COPY_CHUNK);
    let dataOffset = directory.headerSize;
    let replaced = 0;
    let savedBytes = 0;

    for (let i = 0; i < directory.entries.length; i++) {
      const entry = directory.entries[i];
      let replacement = null;

      if (select(entry)) {
        const data = Buffer.alloc(entry.size);
        if (entry.size > 0) await readExact(source, data, entry.offset, entry.size);
        const transformed = typeof transform === "function" ? transform(entry, data) : null;
        if (transformed !== null && transformed !== undefined) {
          replacement = Buffer.isBuffer(transformed) ? transformed : Buffer.from(transformed);
          replaced += 1;
          savedBytes += entry.size - replacement.length;
        }
      }

      const record = directory.records[i];
      header.writeUInt32BE(dataOffset, record);
      header.writeUInt32BE(replacement === null ? entry.size : replacement.length, record + 4);

      if (replacement !== null) {
        if (replacement.length > 0) await writeAll(destination, replacement, dataOffset);
        dataOffset += replacement.length;
      } else {
        await copyRegion(source, destination, entry.offset, dataOffset, entry.size, copyBuffer);
        dataOffset += entry.size;
      }
    }

    header.writeUInt32LE(dataOffset, 4);
    if (header.length > 0) await writeAll(destination, header, 0);

    return { replaced, savedBytes };
  } catch (error) {
    if (destination) {
      try {
        await destination.close();
      } catch {
        // Already closed; the destination is removed below either way.
      }
      destination = undefined;
    }
    try {
      await unlink(dstPath);
    } catch {
      // Nothing was created.
    }
    throw error;
  } finally {
    if (destination) await destination.close();
    await source.close();
  }
}
