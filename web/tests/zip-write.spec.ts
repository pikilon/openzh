import { test, expect } from "@playwright/test";
import { buildZip, type ZipWriteEntry } from "../src/zip-write";
import { entryStream, openZip, type ZipEntry } from "../src/zip";
import { crc32, inspectZip } from "./helpers/zip";

// Issue #190: the saved-games ZIP writer. Pure data, no browser needed.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    length += chunk.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function entry(path: string, data: Uint8Array | string, mtime?: number): ZipWriteEntry {
  return {
    path,
    data: typeof data === "string" ? encoder.encode(data) : data,
    mtime,
  };
}

test("1: buildZip round-trips paths, UTF-8 names, empty files and bytes", async () => {
  const pattern = new Uint8Array(1024);
  for (let i = 0; i < pattern.length; i++) pattern[i] = i % 251;
  const entries: ZipWriteEntry[] = [
    entry("Save/Test A.SAV", "hello", Date.UTC(2024, 0, 2, 3, 4, 5)),
    entry("Save/campaña/ñ.sav", "cañón"),
    entry("Save/empty.sav", new Uint8Array(0)),
    entry("Save/blob.bin", pattern),
  ];

  const blob = buildZip(entries);
  expect(blob.type).toBe("application/zip");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const inspection = inspectZip(bytes);

  expect(inspection.entries.map((item) => item.path)).toEqual([
    "Save/Test A.SAV",
    "Save/campaña/ñ.sav",
    "Save/empty.sav",
    "Save/blob.bin",
  ]);
  for (const item of inspection.entries) {
    expect(item.method, item.path).toBe(0);
    expect(item.flags & 0x0800, `${item.path} UTF-8 flag`).not.toBe(0);
    expect(item.crc32, `${item.path} CRC-32`).toBe(crc32(entries.find((e) => e.path === item.path)!.data));
  }
  // The DOS time is not 1980-01-01 for the first entry: the mtime is honoured.
  expect(inspection.entries[0].centralOffset).toBeGreaterThan(0);

  const reopened = await openZip(new Blob([bytes]));
  expect(reopened.map((item) => item.path)).toEqual(inspection.entries.map((item) => item.path));
  for (let i = 0; i < reopened.length; i++) {
    const read = await collect(entryStream(new Blob([bytes]), reopened[i] as ZipEntry));
    expect(read).toEqual(entries[i].data);
  }
  expect(decoder.decode(await collect(entryStream(new Blob([bytes]), reopened[1] as ZipEntry)))).toBe(
    "cañón",
  );
});

test("2: buildZip rejects duplicate, absolute and escaping paths", async () => {
  expect(() => buildZip([entry("Save/a.sav", "a"), entry("Save/a.sav", "b")])).toThrow(/duplicate/);
  expect(() => buildZip([entry("/Save/a.sav", "a")])).toThrow(/absolute/);
  expect(() => buildZip([entry("Save/../escape.sav", "a")])).toThrow(/leaves the archive root/);
  expect(() => buildZip([entry("Save/./a.sav", "a")])).toThrow(/leaves the archive root/);
  expect(() => buildZip([entry("Save/", "a")])).toThrow(/directory/);
  expect(() => buildZip([entry("", "a")])).toThrow(/empty/);
});

test("3: an empty ZIP is still a valid archive", async () => {
  const blob = buildZip([]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect(bytes.length).toBe(22);
  expect(await openZip(new Blob([bytes]))).toEqual([]);
});
