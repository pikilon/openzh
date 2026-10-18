import { test, expect } from "@playwright/test";
import { ImportError } from "../src/import-error";
import type { ZipEntry } from "../src/zip";
import { buildZip, corrupt, crc32, deflateRaw, inspectZip } from "./helpers/zip";

// Pure logic: runs in Node, no browser needed.

type ZipModule = typeof import("../src/zip");
let api: ZipModule;

test.beforeEach(async () => {
  api = await import("../src/zip");
});

const encoder = new TextEncoder();

class RecordingBlob extends Blob {
  readonly slices: { start: number; end: number }[] = [];
  readonly fullReads: string[] = [];

  constructor(parts: BlobPart[]) {
    super(parts);
  }

  override slice(start?: number, end?: number, contentType?: string): Blob {
    this.slices.push({ start: start ?? 0, end: end ?? this.size });
    return super.slice(start, end, contentType);
  }

  override arrayBuffer(): Promise<ArrayBuffer> {
    this.fullReads.push("arrayBuffer");
    return super.arrayBuffer();
  }

  override text(): Promise<string> {
    this.fullReads.push("text");
    return super.text();
  }

  override stream(): ReadableStream<Uint8Array> {
    this.fullReads.push("stream");
    return super.stream();
  }
}

function requestedLength(slice: { start: number; end: number }, size: number): number {
  const start = Math.min(Math.max(slice.start, 0), size);
  const end = Math.min(Math.max(slice.end, 0), size);
  return Math.max(0, end - start);
}

function listed(entries: ZipEntry[]) {
  return entries.map((entry) => ({
    path: entry.path,
    size: entry.size,
    compressedSize: entry.compressedSize,
    method: entry.method,
    crc32: entry.crc32,
    isDirectory: entry.isDirectory,
  }));
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

function asImportError(error: unknown): ImportError {
  expect(error).toBeInstanceOf(ImportError);
  return error as ImportError;
}

function expectImportError(error: unknown, code: string): ImportError {
  const typed = asImportError(error);
  expect(typed.name).toBe("ImportError");
  expect(typed.code).toBe(code);
  return typed;
}

async function streamFailure(make: () => ReadableStream<Uint8Array>): Promise<unknown> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = make();
  } catch (error) {
    return error;
  }
  try {
    await collect(stream);
  } catch (error) {
    return error;
  }
  throw new Error("expected the entry stream to fail");
}

function sample(length: number, seed = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

test("1: openZip lists path, size, compressedSize, method and crc32 in archive order", async () => {
  const stored = encoder.encode("stored bytes");
  const deflated = encoder.encode("deflated payload ".repeat(200));
  const zip = await buildZip([
    { path: "a/stored.bin", data: stored, method: "store" },
    { path: "b/deflated.txt", data: deflated, method: "deflate" },
    { path: "c/", data: new Uint8Array(0), method: "store" },
  ]);

  const entries = await api.openZip(new Blob([zip]));
  expect(entries.map((entry) => entry.path)).toEqual([
    "a/stored.bin",
    "b/deflated.txt",
    "c/",
  ]);
  expect(listed(entries)).toEqual([
    {
      path: "a/stored.bin",
      size: stored.length,
      compressedSize: stored.length,
      method: 0,
      crc32: crc32(stored),
      isDirectory: false,
    },
    {
      path: "b/deflated.txt",
      size: deflated.length,
      compressedSize: (await deflateRaw(deflated)).length,
      method: 8,
      crc32: crc32(deflated),
      isDirectory: false,
    },
    {
      path: "c/",
      size: 0,
      compressedSize: 0,
      method: 0,
      crc32: 0,
      isDirectory: true,
    },
  ]);
  expect(entries.every((entry) => Number.isInteger(entry.offset) && entry.offset >= 0)).toBe(
    true,
  );
});

test("2: a forced ZIP64 archive lists the same entries as the plain one", async () => {
  const fixture = [
    { path: "one.bin", data: sample(300, 1), method: "store" as const },
    { path: "two.txt", data: "compress me ".repeat(100), method: "deflate" as const },
    { path: "folder/", data: new Uint8Array(0), method: "store" as const },
  ];
  const plain = await buildZip(fixture);
  const zip64 = await buildZip(fixture, { zip64: true });
  expect(inspectZip(zip64).zip64).toBe(true);

  const plainEntries = await api.openZip(new Blob([plain]));
  const zip64Entries = await api.openZip(new Blob([zip64]));
  expect(listed(zip64Entries)).toEqual(listed(plainEntries));
  expect(zip64Entries.map((entry) => entry.path)).toEqual([
    "one.bin",
    "two.txt",
    "folder/",
  ]);
});

test("3: openZip reads only the tail and the central directory, never entry data", async () => {
  const payload = sample(512 * 1024, 7);
  const zip = await buildZip([
    { path: "large.bin", data: payload, method: "store" },
    { path: "small.txt", data: "small", method: "store" },
  ]);
  const info = inspectZip(zip);
  const blob = new RecordingBlob([zip]);

  const entries = await api.openZip(blob);
  expect(entries).toHaveLength(2);
  expect(blob.fullReads).toEqual([]);
  expect(blob.slices.length).toBeGreaterThan(0);

  for (const slice of blob.slices) {
    for (const entry of info.entries) {
      const overlaps = slice.start < entry.dataEnd && slice.end > entry.dataStart;
      expect(
        overlaps,
        `slice ${slice.start}..${slice.end} overlaps the data of ${entry.path}`,
      ).toBe(false);
    }
  }
});

test("4: entryStream yields the exact bytes of stored, deflated, empty and data-descriptor entries", async () => {
  const cases = [
    { path: "stored.bin", data: sample(4099, 3), method: "store" as const },
    {
      path: "deflated.txt",
      data: encoder.encode("deflated entry bytes ".repeat(500)),
      method: "deflate" as const,
    },
    { path: "empty.bin", data: new Uint8Array(0), method: "store" as const },
    {
      path: "descriptor.txt",
      data: encoder.encode("written with a data descriptor ".repeat(200)),
      method: "deflate" as const,
      dataDescriptor: true,
    },
  ];
  const zip = await buildZip(cases);
  const info = inspectZip(zip);
  expect(info.entries[3].flags & 0x0008).toBe(0x0008);

  const blob = new Blob([zip]);
  const entries = await api.openZip(blob);
  for (const expected of cases) {
    const entry = entries.find((candidate) => candidate.path === expected.path);
    expect(entry, expected.path).toBeDefined();
    const out = await collect(api.entryStream(blob, entry as ZipEntry));
    expect(Array.from(out), expected.path).toEqual(Array.from(expected.data));
  }
});

test("5: a 64 MiB stored entry streams through slices of at most 1 MiB", async () => {
  const size = 64 * 1024 * 1024;
  const data = new Uint8Array(size);
  const zip = await buildZip([{ path: "huge.bin", data, method: "store" }]);
  const blob = new RecordingBlob([zip]);

  const entries = await api.openZip(blob);
  expect(entries).toHaveLength(1);
  expect(blob.fullReads).toEqual([]);

  const reader = api.entryStream(blob, entries[0]).getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    expect(value.length, "streamed chunk").toBeLessThanOrEqual(1024 * 1024);
  }
  expect(total).toBe(size);

  const dataStart = inspectZip(zip).entries[0].dataStart;
  const dataEnd = dataStart + size;
  const dataSlices = blob.slices.filter(
    (slice) => slice.end > dataStart && slice.start < dataEnd,
  );
  expect(dataSlices.length).toBeGreaterThanOrEqual(64);
  for (const slice of blob.slices) {
    expect(requestedLength(slice, blob.size), "blob.slice size").toBeLessThanOrEqual(
      1024 * 1024,
    );
  }
});

test("6: blobs that are not ZIPs or shorter than 22 bytes fail openZip with not-a-zip", async () => {
  const notZip = new Blob([encoder.encode("this is not a zip file, only plain bytes")]);
  const tooShort = new Blob([encoder.encode("PK")]);
  for (const [label, blob] of [
    ["plain bytes", notZip],
    ["shorter than an EOCD", tooShort],
  ] as const) {
    const error = await rejectionOf(api.openZip(blob));
    expectImportError(error, "not-a-zip");
    expect((error as Error).message, label).toBeTruthy();
  }
});

test("7: a cut central directory fails openZip; a cut entry fails its stream, both truncated", async () => {
  const zip = await buildZip([
    { path: "big.bin", data: sample(256 * 1024, 11), method: "store" },
    { path: "small.txt", data: "small", method: "store" },
  ]);

  const cutDirectory = corrupt.cutCentralDirectory(zip);
  const directoryError = await rejectionOf(api.openZip(new Blob([cutDirectory])));
  expectImportError(directoryError, "truncated");

  const cutEntry = corrupt.cutEntryData(zip, 0);
  const cutBlob = new Blob([cutEntry]);
  const entries = await api.openZip(cutBlob);
  const entryError = await streamFailure(() => api.entryStream(cutBlob, entries[0]));
  expectImportError(entryError, "truncated");
});

test("8: a flipped data byte and a wrong stored size fail the stream with bad-crc", async () => {
  const data = sample(2000, 13);
  const zip = await buildZip([{ path: "data.bin", data, method: "store" }]);

  const flippedBlob = new Blob([corrupt.flipDataByte(zip, 0, 17)]);
  const [flippedEntry] = await api.openZip(flippedBlob);
  const crcError = await streamFailure(() => api.entryStream(flippedBlob, flippedEntry));
  expectImportError(crcError, "bad-crc");

  const wrongSizeBlob = new Blob([corrupt.size(zip, data.length + 1, 0)]);
  const [wrongSizeEntry] = await api.openZip(wrongSizeBlob);
  expect(wrongSizeEntry.size).toBe(data.length + 1);
  const sizeError = await streamFailure(() =>
    api.entryStream(wrongSizeBlob, wrongSizeEntry),
  );
  expectImportError(sizeError, "bad-crc");
});

test("9: encrypted entries, method 12 and a non-zero disk number fail openZip", async () => {
  const zip = await buildZip([{ path: "secret.txt", data: "classified", method: "store" }]);
  const cases = [
    { label: "encrypted", blob: new Blob([corrupt.encrypt(zip)]), code: "encrypted" },
    { label: "bzip2", blob: new Blob([corrupt.method(zip, 12)]), code: "unsupported-method" },
    { label: "multi-disk", blob: new Blob([corrupt.diskNumber(zip, 1)]), code: "multi-disk" },
  ];
  for (const expected of cases) {
    const error = await rejectionOf(api.openZip(expected.blob));
    expectImportError(error, expected.code);
  }
});

test("10: absolute, parent, backslash and NUL paths fail openZip with unsafe-path and detail.file", async () => {
  const paths = ["/etc/x", "a/../b", "a\\b", "a\0b", "a/../b/"];
  for (const path of paths) {
    const zip = await buildZip([
      {
        path,
        data: path.endsWith("/") ? new Uint8Array(0) : encoder.encode("payload"),
        method: "store",
      },
    ]);
    const error = await rejectionOf(api.openZip(new Blob([zip])));
    const typed = expectImportError(error, "unsafe-path");
    expect(typed.detail.file, path).toBe(path);
  }
});

test("11: non-ASCII UTF-8 entry names round-trip", async () => {
  const names = ["café/日本語.txt", "emoji-📁/naïve.bin"];
  const zip = await buildZip(
    names.map((path, index) => ({ path, data: `payload ${index}`, method: "store" as const })),
  );
  const blob = new Blob([zip]);
  const entries = await api.openZip(blob);
  expect(entries.map((entry) => entry.path)).toEqual(names);
  for (let index = 0; index < entries.length; index++) {
    const out = await collect(api.entryStream(blob, entries[index]));
    expect(Array.from(out), names[index]).toEqual(
      Array.from(encoder.encode(`payload ${index}`)),
    );
  }
});

test("contract: test-api re-exports openZip and entryStream", async () => {
  const testApi = await import("../src/test-api");
  expect(testApi.openZip).toBe(api.openZip);
  expect(testApi.entryStream).toBe(api.entryStream);
});
