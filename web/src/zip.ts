// Reads a game ZIP without loading it into memory (docs/briefs/126-zip-reader.md):
// openZip lists the central directory; entryStream reads one entry's local
// header and streams its bytes, verifying size and CRC-32. Pure logic: no DOM
// beyond Blob and DecompressionStream, runs in Node and in the browser.

import { ImportError } from "./import-error";

export interface ZipEntry {
  path: string; // "/" separated, UTF-8, as stored
  size: number; // uncompressed bytes
  compressedSize: number;
  method: 0 | 8; // stored | deflate
  crc32: number; // unsigned
  isDirectory: boolean; // path ends with "/"
  offset: number; // of the local header (internal; opaque to callers)
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EXTRA_ID = 0x0001;

const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIZE = 56;
const LOCAL_HEADER_SIZE = 30;
const MAX_COMMENT = 0xffff;
const CHUNK_SIZE = 1024 * 1024;

export const CRC32_INIT = 0xffffffff;

// Slice-by-8 CRC-32 (the polynomial used by ZIP): table[0] is the classic byte
// table and table[n] is table[n - 1] shifted one more byte, so eight input
// bytes are consumed per iteration. Roughly four times the byte-at-a-time
// loop, with the same result.
const CRC_TABLES: Uint32Array[] = (() => {
  const tables: Uint32Array[] = [new Uint32Array(256)];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tables[0][n] = c >>> 0;
  }
  for (let n = 1; n < 8; n++) {
    const previous = tables[n - 1];
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      table[i] = (previous[i] >>> 8) ^ tables[0][previous[i] & 0xff];
    }
    tables.push(table);
  }
  return tables;
})();

const decoder = new TextDecoder();

// Running CRC over the previous state (start at CRC32_INIT); finish with
// crc32Value.
export function crc32Update(crc: number, data: Uint8Array): number {
  let value = crc >>> 0;
  let i = 0;
  const length = data.length;
  if (length >= 8 && data.byteOffset % 4 === 0) {
    const words = length >>> 2;
    const view = new Uint32Array(data.buffer, data.byteOffset, words);
    const pairs = words - (words % 2);
    const [t0, t1, t2, t3, t4, t5, t6, t7] = CRC_TABLES;
    for (let word = 0; word < pairs; word += 2) {
      const a = (view[word] ^ value) >>> 0;
      const b = view[word + 1];
      value =
        t7[a & 0xff] ^
        t6[(a >>> 8) & 0xff] ^
        t5[(a >>> 16) & 0xff] ^
        t4[a >>> 24] ^
        t3[b & 0xff] ^
        t2[(b >>> 8) & 0xff] ^
        t1[(b >>> 16) & 0xff] ^
        t0[b >>> 24];
    }
    i = pairs << 2;
  }
  const table = CRC_TABLES[0];
  for (; i < length; i++) value = table[(value ^ data[i]) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

export function crc32Value(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(view: DataView, at: number): number {
  return view.getUint16(at, true);
}

function u32(view: DataView, at: number): number {
  return view.getUint32(at, true);
}

function u64(view: DataView, at: number): number {
  return view.getUint32(at, true) + view.getUint32(at + 4, true) * 0x1_0000_0000;
}

function fail(code: ImportError["code"], file?: string): ImportError {
  return new ImportError(code, file === undefined ? undefined : { file });
}

async function readRange(
  blob: Blob,
  start: number,
  length: number,
  file?: string,
): Promise<Uint8Array> {
  if (start < 0 || length < 0 || start + length > blob.size) {
    throw fail("truncated", file);
  }
  if (length === 0) return new Uint8Array(0);
  const bytes = new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
  if (bytes.length !== length) throw fail("truncated", file);
  return bytes;
}

interface EocdLocation {
  bytes: Uint8Array;
  start: number;
  at: number;
}

// The end-of-central-directory record sits at the end of the blob, possibly
// followed by a comment of up to 64 KiB. Read the last 22 bytes first; only a
// ZIP with a comment needs the wider tail.
async function findEocd(blob: Blob): Promise<EocdLocation> {
  if (blob.size < EOCD_SIZE) throw fail("not-a-zip");
  const tailStart = blob.size - EOCD_SIZE;
  const tail = await readRange(blob, tailStart, EOCD_SIZE);
  const tailView = viewOf(tail);
  if (
    u32(tailView, 0) === EOCD_SIGNATURE &&
    tailStart + EOCD_SIZE + u16(tailView, 20) === blob.size
  ) {
    return { bytes: tail, start: tailStart, at: 0 };
  }

  const span = Math.min(blob.size, EOCD_SIZE + MAX_COMMENT);
  const start = blob.size - span;
  const bytes = await readRange(blob, start, span);
  const view = viewOf(bytes);
  for (let at = bytes.length - EOCD_SIZE; at >= 0; at--) {
    if (u32(view, at) !== EOCD_SIGNATURE) continue;
    if (start + at + EOCD_SIZE + u16(view, at + 20) === blob.size) {
      return { bytes, start, at };
    }
  }
  throw fail("not-a-zip");
}

function findZip64Extra(
  view: DataView,
  extraStart: number,
  extraLength: number,
): { start: number; end: number } | undefined {
  let at = extraStart;
  const end = extraStart + extraLength;
  while (at + 4 <= end) {
    const id = u16(view, at);
    const length = u16(view, at + 2);
    const next = at + 4 + length;
    if (next > end) return undefined;
    if (id === ZIP64_EXTRA_ID) return { start: at + 4, end: next };
    at = next;
  }
  return undefined;
}

interface CentralDirectory {
  entries: ZipEntry[];
}

function parseCentralDirectory(bytes: Uint8Array, entryCount: number): CentralDirectory {
  const view = viewOf(bytes);
  const entries: ZipEntry[] = [];
  let at = 0;

  for (let index = 0; index < entryCount; index++) {
    if (at + 46 > bytes.length) throw fail("truncated");
    if (u32(view, at) !== CENTRAL_HEADER_SIGNATURE) throw fail("truncated");

    const flags = u16(view, at + 8);
    const method = u16(view, at + 10);
    const crc32 = u32(view, at + 16);
    let compressedSize = u32(view, at + 20);
    let size = u32(view, at + 24);
    const nameLength = u16(view, at + 28);
    const extraLength = u16(view, at + 30);
    const commentLength = u16(view, at + 32);
    let diskStart = u16(view, at + 34);
    let offset = u32(view, at + 42);

    const recordEnd = at + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > bytes.length) throw fail("truncated");

    const nameStart = at + 46;
    const extraStart = nameStart + nameLength;
    if (size === 0xffffffff || compressedSize === 0xffffffff || offset === 0xffffffff || diskStart === 0xffff) {
      const extra = findZip64Extra(view, extraStart, extraLength);
      if (extra === undefined) throw fail("truncated");
      let field = extra.start;
      if (size === 0xffffffff) {
        if (field + 8 > extra.end) throw fail("truncated");
        size = u64(view, field);
        field += 8;
      }
      if (compressedSize === 0xffffffff) {
        if (field + 8 > extra.end) throw fail("truncated");
        compressedSize = u64(view, field);
        field += 8;
      }
      if (offset === 0xffffffff) {
        if (field + 8 > extra.end) throw fail("truncated");
        offset = u64(view, field);
        field += 8;
      }
      if (diskStart === 0xffff) {
        if (field + 4 > extra.end) throw fail("truncated");
        diskStart = u32(view, field);
      }
    }

    const path = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));

    if ((flags & 0x0001) !== 0) throw fail("encrypted", path);
    if (method !== 0 && method !== 8) throw fail("unsupported-method", path);
    if (diskStart !== 0) throw fail("multi-disk", path);
    if (isUnsafePath(path)) throw fail("unsafe-path", path);

    entries.push({
      path,
      size,
      compressedSize,
      method: method as 0 | 8,
      crc32,
      isDirectory: path.endsWith("/"),
      offset,
    });
    at = recordEnd;
  }

  return { entries };
}

function isUnsafePath(path: string): boolean {
  if (path.startsWith("/")) return true;
  if (path.includes("\\") || path.includes("\u0000")) return true;
  if (/^[A-Za-z]:/.test(path)) return true;
  return path.split("/").includes("..");
}

export async function openZip(blob: Blob): Promise<ZipEntry[]> {
  const location = await findEocd(blob);
  const view = viewOf(location.bytes);
  const at = location.at;
  const eocdOffset = location.start + at;

  const disk = u16(view, at + 4);
  const centralDisk = u16(view, at + 6);
  let entryCount = u16(view, at + 10);
  let centralSize = u32(view, at + 12);
  let centralOffset = u32(view, at + 16);

  const zip64 =
    entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff;

  if (zip64) {
    if (eocdOffset < ZIP64_LOCATOR_SIZE) throw fail("truncated");
    const locator = await readRange(
      blob,
      eocdOffset - ZIP64_LOCATOR_SIZE,
      ZIP64_LOCATOR_SIZE,
    );
    const locatorView = viewOf(locator);
    if (u32(locatorView, 0) !== ZIP64_LOCATOR_SIGNATURE) throw fail("truncated");
    if (u32(locatorView, 4) !== 0) throw fail("multi-disk");
    const recordOffset = u64(locatorView, 8);
    const record = await readRange(blob, recordOffset, ZIP64_EOCD_SIZE);
    const recordView = viewOf(record);
    if (u32(recordView, 0) !== ZIP64_EOCD_SIGNATURE) throw fail("truncated");
    if (u32(recordView, 16) !== 0 || u32(recordView, 20) !== 0) throw fail("multi-disk");
    entryCount = u64(recordView, 32);
    centralSize = u64(recordView, 40);
    centralOffset = u64(recordView, 48);
  } else if (disk !== 0 || centralDisk !== 0) {
    throw fail("multi-disk");
  }

  if (centralOffset + centralSize > blob.size) throw fail("truncated");
  const centralBytes = await readRange(blob, centralOffset, centralSize);
  return parseCentralDirectory(centralBytes, entryCount).entries;
}

function chunkStream(
  blob: Blob,
  start: number,
  length: number,
  file: string,
): ReadableStream<Uint8Array> {
  let at = start;
  const end = start + length;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (reader === null) {
          if (at >= end) {
            controller.close();
            return;
          }
          // The test contract keeps every blob.slice at 1 MiB or less.
          const size = Math.min(CHUNK_SIZE, end - at);
          const part = blob.slice(at, at + size);
          if (part.size !== size) throw fail("truncated", file);
          at += size;
          reader = part.stream().getReader();
        }
        const result = await reader.read();
        if (result.done) {
          reader = null;
          continue;
        }
        controller.enqueue(result.value);
        return;
      }
    },
    cancel(reason) {
      if (reader === null) return;
      const active = reader;
      reader = null;
      return active.cancel(reason);
    },
  });
}

interface DataRange {
  start: number;
  length: number;
}

// Validates the local header and returns the entry's raw (compressed) data
// range. Shared by the streaming reader and the import fast path.
async function localDataRange(blob: Blob, entry: ZipEntry): Promise<DataRange> {
  if (entry.method !== 0 && entry.method !== 8) {
    throw fail("unsupported-method", entry.path);
  }
  if (entry.offset + LOCAL_HEADER_SIZE > blob.size) {
    throw fail("truncated", entry.path);
  }
  const header = await readRange(blob, entry.offset, LOCAL_HEADER_SIZE, entry.path);
  const view = viewOf(header);
  if (u32(view, 0) !== LOCAL_HEADER_SIGNATURE) throw fail("truncated", entry.path);
  if ((u16(view, 6) & 0x0001) !== 0) throw fail("encrypted", entry.path);
  const nameLength = u16(view, 26);
  const extraLength = u16(view, 28);
  const start = entry.offset + LOCAL_HEADER_SIZE + nameLength + extraLength;
  if (start + entry.compressedSize > blob.size) throw fail("truncated", entry.path);
  return { start, length: entry.compressedSize };
}

// The entry's raw bytes as one blob, for callers that can stream or copy them
// without inflating: writing a sub-blob to OPFS lets the browser copy it
// natively instead of through a JS chunk loop.
export async function entryDataBlob(blob: Blob, entry: ZipEntry): Promise<Blob> {
  const range = await localDataRange(blob, entry);
  return blob.slice(range.start, range.start + range.length);
}

// Reads the local header and the data together in one slice, for small
// entries: one blob read instead of two. The slice over-reads by the largest
// possible name and extra fields, so callers must keep it to small entries.
const MAX_HEADER_FIELDS = LOCAL_HEADER_SIZE + 0xffff + 0xffff;

// The same local-header parse against a span that was read once for a group
// of consecutive small entries; `spanStart` is the blob offset of span[0].
export function smallEntryWithin(
  span: Uint8Array,
  spanStart: number,
  entry: ZipEntry,
): Uint8Array {
  const at = entry.offset - spanStart;
  if (at < 0 || at + LOCAL_HEADER_SIZE > span.length) throw fail("truncated", entry.path);
  const view = viewOf(span);
  if (u32(view, at) !== LOCAL_HEADER_SIGNATURE) throw fail("truncated", entry.path);
  if ((u16(view, at + 6) & 0x0001) !== 0) throw fail("encrypted", entry.path);
  const start = at + LOCAL_HEADER_SIZE + u16(view, at + 26) + u16(view, at + 28);
  if (start + entry.compressedSize > span.length) throw fail("truncated", entry.path);
  return span.subarray(start, start + entry.compressedSize);
}

export async function readSmallEntry(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.offset + LOCAL_HEADER_SIZE > blob.size) throw fail("truncated", entry.path);
  const length = Math.min(blob.size - entry.offset, MAX_HEADER_FIELDS + entry.compressedSize);
  const bytes = await readRange(blob, entry.offset, length, entry.path);
  const view = viewOf(bytes);
  if (u32(view, 0) !== LOCAL_HEADER_SIGNATURE) throw fail("truncated", entry.path);
  if ((u16(view, 6) & 0x0001) !== 0) throw fail("encrypted", entry.path);
  const nameLength = u16(view, 26);
  const extraLength = u16(view, 28);
  const start = LOCAL_HEADER_SIZE + nameLength + extraLength;
  if (start + entry.compressedSize > bytes.length) throw fail("truncated", entry.path);
  return bytes.subarray(start, start + entry.compressedSize);
}

// Small deflated entries go through one DecompressionStream and one collected
// buffer instead of the generic three-stream pipeline, with the same size and
// CRC check and the same truncated/bad-crc errors.
export async function readSmallInflated(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  const range = await localDataRange(blob, entry);
  let bytes: Uint8Array;
  try {
    const inflated = blob
      .slice(range.start, range.start + range.length)
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    bytes = new Uint8Array(await new Response(inflated).arrayBuffer());
  } catch (error) {
    throw normalizeError(error, entry.path);
  }
  if (
    bytes.length !== entry.size ||
    crc32Value(crc32Update(CRC32_INIT, bytes)) !== entry.crc32
  ) {
    throw fail("bad-crc", entry.path);
  }
  return bytes;
}

async function openEntryReader(
  blob: Blob,
  entry: ZipEntry,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const range = await localDataRange(blob, entry);
  let source = chunkStream(blob, range.start, range.length, entry.path);
  if (entry.method === 8) {
    source = source.pipeThrough(new DecompressionStream("deflate-raw"));
  }
  return source.getReader();
}

function normalizeError(error: unknown, path: string): ImportError {
  if (error instanceof ImportError) return error;
  return new ImportError("truncated", { file: path }, error);
}

export function entryStream(blob: Blob, entry: ZipEntry): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let crc = CRC32_INIT;
  let total = 0;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        if (reader === null) reader = await openEntryReader(blob, entry);
        const result = await reader.read();
        if (result.done) {
          finished = true;
          const actual = crc32Value(crc);
          if (total !== entry.size || actual !== entry.crc32) {
            throw fail("bad-crc", entry.path);
          }
          controller.close();
          reader.releaseLock();
          reader = null;
          return;
        }
        const value = result.value;
        crc = crc32Update(crc, value);
        total += value.length;
        controller.enqueue(value);
      } catch (error) {
        finished = true;
        controller.error(normalizeError(error, entry.path));
        if (reader !== null) {
          const active = reader;
          reader = null;
          active.cancel().catch(() => undefined);
        }
      }
    },
    cancel(reason) {
      if (reader === null) return;
      const active = reader;
      reader = null;
      return active.cancel(reason);
    },
  });
}
