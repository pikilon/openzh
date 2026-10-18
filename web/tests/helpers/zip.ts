// Builds synthetic ZIP archives for the tests of src/zip.ts, and corrupts them
// on purpose. Pure data: no DOM beyond Blob, TextEncoder, CompressionStream and
// Response, so it runs in Node like the code under test.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const compressed = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

export interface BuildZipEntry {
  path: string;
  data: Uint8Array | string;
  method?: "store" | "deflate";
  dataDescriptor?: boolean;
}

export interface BuildZipOptions {
  zip64?: boolean;
}

interface PreparedEntry {
  name: Uint8Array;
  data: Uint8Array;
  compressed: Uint8Array;
  method: number;
  crc: number;
  dataDescriptor: boolean;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function setU64(view: DataView, at: number, value: number): void {
  view.setUint32(at, value >>> 0, true);
  view.setUint32(at + 4, Math.floor(value / 0x1_0000_0000), true);
}

function getU64(view: DataView, at: number): number {
  return view.getUint32(at, true) + view.getUint32(at + 4, true) * 0x1_0000_0000;
}

export async function buildZip(
  entries: BuildZipEntry[],
  options: BuildZipOptions = {},
): Promise<Uint8Array> {
  const zip64 = options.zip64 === true;
  const prepared: PreparedEntry[] = [];
  for (const entry of entries) {
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const method = entry.method ?? "store";
    prepared.push({
      name: encoder.encode(entry.path),
      data,
      compressed: method === "deflate" ? await deflateRaw(data) : data,
      method: method === "deflate" ? 8 : 0,
      crc: crc32(data),
      dataDescriptor: entry.dataDescriptor === true,
    });
  }

  const localExtra = zip64 ? 20 : 0;
  const centralExtra = zip64 ? 28 : 0;
  let localTotal = 0;
  for (const entry of prepared) {
    localTotal += 30 + entry.name.length + localExtra + entry.compressed.length;
    if (entry.dataDescriptor) localTotal += zip64 ? 24 : 16;
  }
  let centralTotal = 0;
  for (const entry of prepared) centralTotal += 46 + entry.name.length + centralExtra;
  const trailer = zip64 ? 56 + 20 + 22 : 22;

  const out = new Uint8Array(localTotal + centralTotal + trailer);
  const view = viewOf(out);

  let at = 0;
  const localOffsets: number[] = [];
  for (const entry of prepared) {
    localOffsets.push(at);
    const flags = 0x0800 | (entry.dataDescriptor ? 0x0008 : 0);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, zip64 ? 45 : 20, true);
    view.setUint16(at + 6, flags, true);
    view.setUint16(at + 8, entry.method, true);
    view.setUint16(at + 10, 0, true); // modification time
    view.setUint16(at + 12, 0x21, true); // 1980-01-01
    view.setUint32(at + 14, entry.dataDescriptor ? 0 : entry.crc, true);
    view.setUint32(
      at + 18,
      entry.dataDescriptor ? 0 : zip64 ? 0xffffffff : entry.compressed.length,
      true,
    );
    view.setUint32(
      at + 22,
      entry.dataDescriptor ? 0 : zip64 ? 0xffffffff : entry.data.length,
      true,
    );
    view.setUint16(at + 26, entry.name.length, true);
    view.setUint16(at + 28, localExtra, true);
    out.set(entry.name, at + 30);
    let next = at + 30 + entry.name.length;
    if (zip64) {
      view.setUint16(next, 0x0001, true);
      view.setUint16(next + 2, 16, true);
      setU64(view, next + 4, entry.dataDescriptor ? 0 : entry.data.length);
      setU64(view, next + 12, entry.dataDescriptor ? 0 : entry.compressed.length);
      next += localExtra;
    }
    out.set(entry.compressed, next);
    next += entry.compressed.length;
    if (entry.dataDescriptor) {
      view.setUint32(next, 0x08074b50, true);
      view.setUint32(next + 4, entry.crc, true);
      if (zip64) {
        setU64(view, next + 8, entry.compressed.length);
        setU64(view, next + 16, entry.data.length);
        next += 24;
      } else {
        view.setUint32(next + 8, entry.compressed.length, true);
        view.setUint32(next + 12, entry.data.length, true);
        next += 16;
      }
    }
    at = next;
  }

  const centralDirectoryOffset = at;
  for (let i = 0; i < prepared.length; i++) {
    const entry = prepared[i];
    const flags = 0x0800 | (entry.dataDescriptor ? 0x0008 : 0);
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, zip64 ? 45 : 20, true);
    view.setUint16(at + 6, zip64 ? 45 : 20, true);
    view.setUint16(at + 8, flags, true);
    view.setUint16(at + 10, entry.method, true);
    view.setUint16(at + 12, 0, true);
    view.setUint16(at + 14, 0x21, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, zip64 ? 0xffffffff : entry.compressed.length, true);
    view.setUint32(at + 24, zip64 ? 0xffffffff : entry.data.length, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint16(at + 30, centralExtra, true);
    view.setUint16(at + 32, 0, true); // comment length
    view.setUint16(at + 34, 0, true); // disk number start
    view.setUint16(at + 36, 0, true); // internal attributes
    const isDirectory =
      entry.name.length > 0 && entry.name[entry.name.length - 1] === 0x2f;
    view.setUint32(at + 38, isDirectory ? 0x10 : 0, true);
    view.setUint32(at + 42, zip64 ? 0xffffffff : localOffsets[i], true);
    out.set(entry.name, at + 46);
    let next = at + 46 + entry.name.length;
    if (zip64) {
      view.setUint16(next, 0x0001, true);
      view.setUint16(next + 2, 24, true);
      setU64(view, next + 4, entry.data.length);
      setU64(view, next + 12, entry.compressed.length);
      setU64(view, next + 20, localOffsets[i]);
      next += centralExtra;
    }
    at = next;
  }
  const centralDirectorySize = at - centralDirectoryOffset;

  if (!zip64) {
    view.setUint32(at, 0x06054b50, true);
    view.setUint16(at + 4, 0, true);
    view.setUint16(at + 6, 0, true);
    view.setUint16(at + 8, prepared.length, true);
    view.setUint16(at + 10, prepared.length, true);
    view.setUint32(at + 12, centralDirectorySize, true);
    view.setUint32(at + 16, centralDirectoryOffset, true);
    view.setUint16(at + 20, 0, true);
    at += 22;
    if (at !== out.length) throw new Error(`ZIP layout mismatch: ${at} of ${out.length}`);
    return out;
  }

  const zip64RecordOffset = at;
  view.setUint32(at, 0x06064b50, true);
  setU64(view, at + 4, 44);
  view.setUint16(at + 12, 45, true);
  view.setUint16(at + 14, 45, true);
  view.setUint32(at + 16, 0, true);
  view.setUint32(at + 20, 0, true);
  setU64(view, at + 24, prepared.length);
  setU64(view, at + 32, prepared.length);
  setU64(view, at + 40, centralDirectorySize);
  setU64(view, at + 48, centralDirectoryOffset);
  at += 56;
  view.setUint32(at, 0x07064b50, true);
  view.setUint32(at + 4, 0, true);
  setU64(view, at + 8, zip64RecordOffset);
  view.setUint32(at + 16, 1, true);
  at += 20;
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, 0xffff, true);
  view.setUint16(at + 10, 0xffff, true);
  view.setUint32(at + 12, 0xffffffff, true);
  view.setUint32(at + 16, 0xffffffff, true);
  view.setUint16(at + 20, 0, true);
  at += 22;
  if (at !== out.length) throw new Error(`ZIP layout mismatch: ${at} of ${out.length}`);
  return out;
}

export interface InspectedEntry {
  path: string;
  size: number;
  compressedSize: number;
  method: number;
  flags: number;
  crc32: number;
  isDirectory: boolean;
  localOffset: number;
  dataStart: number;
  dataEnd: number;
  centralOffset: number;
  centralEnd: number;
  diskStart: number;
}

export interface ZipInspection {
  zip64: boolean;
  eocdOffset: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  entries: InspectedEntry[];
}

function findEocd(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let at = view.byteLength - 22; at >= earliest; at--) {
    if (view.getUint32(at, true) !== 0x06054b50) continue;
    if (at + 22 + view.getUint16(at + 20, true) === view.byteLength) return at;
  }
  throw new Error("end of central directory not found");
}

export function inspectZip(zip: Uint8Array): ZipInspection {
  const view = viewOf(zip);
  const eocdOffset = findEocd(view);
  let entryCount = view.getUint16(eocdOffset + 10, true);
  let centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  let centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  let zip64 = false;

  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    zip64 = true;
    const locatorAt = eocdOffset - 20;
    if (locatorAt < 0 || view.getUint32(locatorAt, true) !== 0x07064b50) {
      throw new Error("ZIP64 locator not found");
    }
    const recordAt = getU64(view, locatorAt + 8);
    if (view.getUint32(recordAt, true) !== 0x06064b50) {
      throw new Error("ZIP64 end of central directory not found");
    }
    entryCount = getU64(view, recordAt + 32);
    centralDirectorySize = getU64(view, recordAt + 40);
    centralDirectoryOffset = getU64(view, recordAt + 48);
  }

  const entries: InspectedEntry[] = [];
  let at = centralDirectoryOffset;
  for (let i = 0; i < entryCount; i++) {
    if (at + 46 > zip.length) throw new Error("central directory truncated");
    if (view.getUint32(at, true) !== 0x02014b50) {
      throw new Error(`bad central directory signature at ${at}`);
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const centralCrc = view.getUint32(at + 16, true);
    let compressedSize = view.getUint32(at + 20, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let diskStart = view.getUint16(at + 34, true);
    let localOffset = view.getUint32(at + 42, true);
    const centralEnd = at + 46 + nameLength + extraLength + commentLength;
    if (centralEnd > zip.length) throw new Error("central directory entry truncated");

    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff || diskStart === 0xffff) {
      let extraAt = at + 46 + nameLength;
      const extraEnd = extraAt + extraLength;
      while (extraAt + 4 <= extraEnd) {
        const id = view.getUint16(extraAt, true);
        const length = view.getUint16(extraAt + 2, true);
        if (id === 0x0001) {
          let field = extraAt + 4;
          const fieldEnd = field + length;
          if (size === 0xffffffff && field + 8 <= fieldEnd) {
            size = getU64(view, field);
            field += 8;
          }
          if (compressedSize === 0xffffffff && field + 8 <= fieldEnd) {
            compressedSize = getU64(view, field);
            field += 8;
          }
          if (localOffset === 0xffffffff && field + 8 <= fieldEnd) {
            localOffset = getU64(view, field);
            field += 8;
          }
          if (diskStart === 0xffff && field + 4 <= fieldEnd) {
            diskStart = view.getUint32(field, true);
          }
          break;
        }
        extraAt += 4 + length;
      }
    }

    if (localOffset + 30 > zip.length) throw new Error("local header runs past the end");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const path = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    entries.push({
      path,
      size,
      compressedSize,
      method,
      flags,
      crc32: centralCrc,
      isDirectory: path.endsWith("/"),
      localOffset,
      dataStart,
      dataEnd: dataStart + compressedSize,
      centralOffset: at,
      centralEnd,
      diskStart,
    });
    at = centralEnd;
  }

  return {
    zip64,
    eocdOffset,
    centralDirectoryOffset,
    centralDirectorySize,
    entries,
  };
}

function setFlags(zip: Uint8Array, index: number, update: (flags: number) => number): Uint8Array {
  const out = zip.slice();
  const info = inspectZip(out);
  const entry = info.entries[index];
  const view = viewOf(out);
  const flags = update(view.getUint16(entry.centralOffset + 8, true));
  view.setUint16(entry.centralOffset + 8, flags, true);
  view.setUint16(entry.localOffset + 6, flags, true);
  return out;
}

function setMethod(zip: Uint8Array, method: number, index: number): Uint8Array {
  const out = zip.slice();
  const info = inspectZip(out);
  const entry = info.entries[index];
  const view = viewOf(out);
  view.setUint16(entry.centralOffset + 10, method, true);
  view.setUint16(entry.localOffset + 8, method, true);
  return out;
}

function setDiskNumber(zip: Uint8Array, disk: number): Uint8Array {
  const out = zip.slice();
  const info = inspectZip(out);
  const view = viewOf(out);
  for (const entry of info.entries) view.setUint16(entry.centralOffset + 34, disk, true);
  view.setUint16(info.eocdOffset + 4, disk, true);
  view.setUint16(info.eocdOffset + 6, disk, true);
  if (info.zip64) {
    const locatorAt = info.eocdOffset - 20;
    const recordAt = getU64(view, locatorAt + 8);
    view.setUint32(recordAt + 16, disk, true);
    view.setUint32(recordAt + 20, disk, true);
    view.setUint32(locatorAt + 4, disk, true);
  }
  return out;
}

function setSize(zip: Uint8Array, size: number, index: number): Uint8Array {
  const out = zip.slice();
  const info = inspectZip(out);
  const entry = info.entries[index];
  const view = viewOf(out);
  const header = entry.centralOffset;
  if (view.getUint32(header + 24, true) !== 0xffffffff) {
    view.setUint32(header + 24, size, true);
    return out;
  }
  const nameLength = view.getUint16(header + 28, true);
  const extraLength = view.getUint16(header + 30, true);
  let at = header + 46 + nameLength;
  const end = at + extraLength;
  while (at + 4 <= end) {
    const id = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (id === 0x0001) {
      setU64(view, at + 4, size);
      return out;
    }
    at += 4 + length;
  }
  throw new Error("ZIP64 extra field not found");
}

function flipDataByte(zip: Uint8Array, index: number, offset: number): Uint8Array {
  const out = zip.slice();
  const info = inspectZip(out);
  const entry = info.entries[index];
  const at = entry.dataStart + offset;
  if (at < entry.dataStart || at >= entry.dataEnd) throw new Error("byte outside the entry data");
  out[at] ^= 0xff;
  return out;
}

function cutCentralDirectory(zip: Uint8Array): Uint8Array {
  const info = inspectZip(zip);
  if (info.zip64) throw new Error("cutCentralDirectory supports non-ZIP64 fixtures only");
  const cutAt = info.centralDirectoryOffset + Math.floor(info.centralDirectorySize / 2);
  if (cutAt >= info.eocdOffset) throw new Error("central directory too small to cut");
  const tail = zip.slice(info.eocdOffset);
  const out = new Uint8Array(cutAt + tail.length);
  out.set(zip.subarray(0, cutAt));
  out.set(tail, cutAt);
  // The EOCD still points at the original offset and size, so the central
  // directory now runs past the end of the blob.
  return out;
}

function cutEntryData(zip: Uint8Array, index: number): Uint8Array {
  const info = inspectZip(zip);
  const entry = info.entries[index];
  if (entry.compressedSize < 2) throw new Error("entry too small to cut");
  const cutAt = entry.dataStart + Math.floor(entry.compressedSize / 2);
  const tail = zip.slice(info.centralDirectoryOffset);
  const out = new Uint8Array(cutAt + tail.length);
  out.set(zip.subarray(0, cutAt));
  out.set(tail, cutAt);
  const view = viewOf(out);
  if (info.zip64) {
    const oldLocator = info.eocdOffset - 20;
    const oldRecord = getU64(viewOf(zip), oldLocator + 8);
    const newRecord = cutAt + (oldRecord - info.centralDirectoryOffset);
    const newLocator = cutAt + (oldLocator - info.centralDirectoryOffset);
    setU64(view, newRecord + 48, cutAt);
    setU64(view, newLocator + 8, newRecord);
  } else {
    const newEocd = cutAt + (info.eocdOffset - info.centralDirectoryOffset);
    view.setUint32(newEocd + 16, cutAt, true);
  }
  if (entry.dataStart + entry.compressedSize <= out.length) {
    throw new Error("entry data still fits; use a larger entry");
  }
  return out;
}

export const corrupt = {
  encrypt(zip: Uint8Array, index = 0): Uint8Array {
    return setFlags(zip, index, (flags) => flags | 0x0001);
  },
  method(zip: Uint8Array, method: number, index = 0): Uint8Array {
    return setMethod(zip, method, index);
  },
  diskNumber(zip: Uint8Array, disk = 1): Uint8Array {
    return setDiskNumber(zip, disk);
  },
  size(zip: Uint8Array, size: number, index = 0): Uint8Array {
    return setSize(zip, size, index);
  },
  flipDataByte(zip: Uint8Array, index = 0, offset = 0): Uint8Array {
    return flipDataByte(zip, index, offset);
  },
  cutCentralDirectory,
  cutEntryData,
};
