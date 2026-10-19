// Writes the saved games ZIP (docs/briefs/190-export-saves.md). A plain
// stored-only ZIP writer: the saves are a few MB at most, so compression would
// add a runtime dependency for no useful gain. Pure data: no DOM beyond Blob,
// runs in Node like the reader in src/zip.ts.

import { CRC32_INIT, crc32Update, crc32Value } from "./zip";

export interface ZipWriteEntry {
  // "/" separated, relative to the archive root.
  path: string;
  data: Uint8Array;
  // Milliseconds since the epoch, used for the DOS date/time. Defaults to now.
  mtime?: number;
}

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;
const UTF8_FLAG = 0x0800;

const encoder = new TextEncoder();

function fail(message: string): Error {
  return new Error(`zip-write: ${message}`);
}

// A path must stay inside the archive and name a file, not a directory.
function validatePath(path: string): void {
  if (path.length === 0) throw fail("empty entry path");
  if (path.startsWith("/")) throw fail(`absolute entry path: ${path}`);
  if (path.endsWith("/")) throw fail(`directory entry path: ${path}`);
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw fail(`entry path leaves the archive root: ${path}`);
  }
}

// DOS stores 1980..2107, two-second resolution and local time.
function dosDateTime(mtime: number | undefined): { time: number; date: number } {
  let when = new Date(mtime ?? Date.now());
  if (Number.isNaN(when.getTime())) when = new Date();
  const year = Math.min(2107, Math.max(1980, when.getFullYear()));
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  return { time, date };
}

interface PreparedEntry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  time: number;
  date: number;
  offset: number;
}

export function buildZip(entries: readonly ZipWriteEntry[]): Blob {
  if (entries.length > MAX_ENTRIES) throw fail(`too many entries: ${entries.length}`);

  const seen = new Set<string>();
  const prepared: PreparedEntry[] = [];
  let localBytes = 0;
  for (const entry of entries) {
    validatePath(entry.path);
    if (seen.has(entry.path)) throw fail(`duplicate entry path: ${entry.path}`);
    seen.add(entry.path);

    const name = encoder.encode(entry.path);
    const data = entry.data;
    const { time, date } = dosDateTime(entry.mtime);
    const offset = localBytes;
    localBytes += LOCAL_HEADER_SIZE + name.length + data.length;
    if (localBytes > MAX_BYTES) throw fail("archive is larger than 4 GiB");
    prepared.push({
      name,
      data,
      crc: crc32Value(crc32Update(CRC32_INIT, data)),
      time,
      date,
      offset,
    });
  }

  let centralBytes = 0;
  for (const entry of prepared) centralBytes += CENTRAL_HEADER_SIZE + entry.name.length;
  const total = localBytes + centralBytes + EOCD_SIZE;
  if (total > MAX_BYTES) throw fail("archive is larger than 4 GiB");

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  let at = 0;
  for (const entry of prepared) {
    view.setUint32(at, 0x04034b50, true); // local file header
    view.setUint16(at + 4, 20, true); // version needed to extract
    view.setUint16(at + 6, UTF8_FLAG, true);
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, entry.time, true);
    view.setUint16(at + 12, entry.date, true);
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, entry.name.length, true);
    view.setUint16(at + 28, 0, true); // no extra field
    out.set(entry.name, at + LOCAL_HEADER_SIZE);
    out.set(entry.data, at + LOCAL_HEADER_SIZE + entry.name.length);
    at += LOCAL_HEADER_SIZE + entry.name.length + entry.data.length;
  }

  const centralOffset = at;
  for (const entry of prepared) {
    view.setUint32(at, 0x02014b50, true); // central directory header
    view.setUint16(at + 4, 20, true); // version made by
    view.setUint16(at + 6, 20, true); // version needed
    view.setUint16(at + 8, UTF8_FLAG, true);
    view.setUint16(at + 10, 0, true); // stored
    view.setUint16(at + 12, entry.time, true);
    view.setUint16(at + 14, entry.date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint16(at + 30, 0, true); // extra length
    view.setUint16(at + 32, 0, true); // comment length
    view.setUint16(at + 34, 0, true); // disk number start
    view.setUint16(at + 36, 0, true); // internal attributes
    view.setUint32(at + 38, 0, true); // external attributes
    view.setUint32(at + 42, entry.offset, true);
    out.set(entry.name, at + CENTRAL_HEADER_SIZE);
    at += CENTRAL_HEADER_SIZE + entry.name.length;
  }

  const centralSize = at - centralOffset;
  view.setUint32(at, 0x06054b50, true); // end of central directory
  view.setUint16(at + 4, 0, true); // this disk
  view.setUint16(at + 6, 0, true); // disk with the central directory
  view.setUint16(at + 8, prepared.length, true);
  view.setUint16(at + 10, prepared.length, true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralOffset, true);
  view.setUint16(at + 20, 0, true); // no comment

  return new Blob([out], { type: "application/zip" });
}
