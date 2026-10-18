import { test, expect } from "@playwright/test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBig } from "./helpers/big";

// Contract of scripts/lib/big-archive.mjs (docs/briefs/150-big-rewrite.md).
//
// Node-side tests: every archive is synthetic and lives in a temporary
// directory. Memory is measured in-process with process.memoryUsage().rss,
// never with ps.

const MIB = 1024 * 1024;
const TOOL_URL = new URL("../scripts/lib/big-archive.mjs", import.meta.url).href;

interface Entry {
  name: string;
  offset: number;
  size: number;
}

interface Directory {
  entries: Entry[];
  headerSize: number;
  tail: Buffer;
}

interface Options {
  select?: (entry: Entry) => boolean;
  transform?: (entry: Entry, data: Buffer) => Buffer | null;
}

interface RewriteResult {
  replaced: number;
  savedBytes: number;
}

interface BigArchive {
  readBigDirectory(path: string): Promise<Directory>;
  rewriteBig(srcPath: string, dstPath: string, options: Options): Promise<RewriteResult>;
}

// Loaded from inside each test so a missing module fails every test with the
// module-not-found error, not just the file.
let loaded: Promise<BigArchive> | undefined;
function bigArchive(): Promise<BigArchive> {
  loaded ??= import(TOOL_URL) as Promise<BigArchive>;
  return loaded;
}

const tempRoots: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "zhwp-big-archive-"));
  tempRoots.push(dir);
  return dir;
}

test.afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function sample(length: number, seed = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 37 + seed) & 0xff;
  return out;
}

function put(dir: string, name: string, bytes: Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

function bytes(path: string): Buffer {
  return readFileSync(path);
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

function u32(bytesAt: Buffer | Uint8Array, offset: number, littleEndian: boolean): number {
  return new DataView(bytesAt.buffer, bytesAt.byteOffset, bytesAt.byteLength).getUint32(
    offset,
    littleEndian,
  );
}

function setU32(bytesAt: Uint8Array, offset: number, value: number, littleEndian: boolean): void {
  new DataView(bytesAt.buffer, bytesAt.byteOffset, bytesAt.byteLength).setUint32(
    offset,
    value,
    littleEndian,
  );
}

interface Record {
  offset: number;
  size: number;
  nameAt: number;
}

// Walks the entry table of a valid BIGF archive.
function records(archive: Uint8Array): Record[] {
  const count = u32(archive, 8, false);
  const out: Record[] = [];
  let at = 16;
  for (let i = 0; i < count; i++) {
    let end = at + 8;
    while (archive[end] !== 0) end++;
    out.push({ offset: u32(archive, at, false), size: u32(archive, at + 4, false), nameAt: at + 8 });
    at = end + 1;
  }
  return out;
}

// Adds extra bytes after the last entry record, as real archives sometimes
// carry. Offsets and the archive size move with the data.
function withTail(base: Uint8Array, tail: Uint8Array): Uint8Array {
  const headerSize = u32(base, 12, false);
  const out = new Uint8Array(base.length + tail.length);
  out.set(base.subarray(0, headerSize), 0);
  out.set(tail, headerSize);
  out.set(base.subarray(headerSize), headerSize + tail.length);
  setU32(out, 4, out.length, true);
  setU32(out, 12, headerSize + tail.length, false);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // Record positions are unchanged; only the data offsets they hold move.
  let at = 16;
  for (const record of records(base)) {
    view.setUint32(at, record.offset + tail.length, false);
    let end = at + 8;
    while (base[end] !== 0) end++;
    at = end + 1;
  }
  return out;
}

function headerSizeOf(entries: { path: string; data: Uint8Array | string }[]): number {
  return (
    16 +
    entries.reduce(
      (sum, entry) => sum + 8 + Buffer.byteLength(entry.path, "latin1") + 1,
      0,
    )
  );
}

async function expectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected an Error with code ${code}`).toBeInstanceOf(Error);
  expect((caught as Error & { code?: string }).code, `error code ${code}`).toBe(code);
}

test("1: readBigDirectory lists every name, offset and size in order with an empty tail", async () => {
  const root = scratch();
  const entries = [
    { path: "Data/INI/First.ini", data: "alpha" },
    { path: "Data/cafX.wav", data: sample(17, 1) },
    { path: "Data/Audio/empty.bin", data: new Uint8Array(0) },
  ];
  const source = buildBig(entries);
  const fields = records(source);
  // One name carries the latin1 byte 0xe9, as many archive names do.
  const marker = source.indexOf(0x58, fields[1].nameAt);
  expect(marker, "the placeholder byte is inside the second name").toBeLessThan(
    source.indexOf(0, fields[1].nameAt),
  );
  source[marker] = 0xe9;
  const names = ["Data/INI/First.ini", "Data/caf\xe9.wav", "Data/Audio/empty.bin"];

  const src = put(root, "source.big", source);
  const { readBigDirectory } = await bigArchive();
  const directory = await readBigDirectory(src);

  const headerSize = headerSizeOf(entries);
  expect(directory.headerSize).toBe(headerSize);
  expect(Buffer.isBuffer(directory.tail), "tail is a Buffer").toBe(true);
  expect(directory.tail.length, "empty tail").toBe(0);
  expect(directory.entries.map((entry) => entry.name)).toEqual(names);

  const sizes = entries.map((entry) => entry.data.length);
  const offsets: number[] = [];
  let offset = headerSize;
  for (const size of sizes) {
    offsets.push(offset);
    offset += size;
  }
  expect(directory.entries.map((entry) => entry.offset)).toEqual(offsets);
  expect(directory.entries.map((entry) => entry.size)).toEqual(sizes);
});

test("2: a hand-built tail after the entry table is reported and preserved by rewriteBig", async () => {
  const root = scratch();
  const entries = [
    { path: "Data/Small.txt", data: "small payload" },
    { path: "Data/Bigger.bin", data: sample(29, 2) },
  ];
  const base = buildBig(entries);
  const baseHeader = u32(base, 12, false);
  const baseOffsets = records(base).map((record) => record.offset);
  const tail = new Uint8Array([0x00, 0x7f, 0xde, 0xad, 0xbe, 0xef, 0x99]);
  const source = withTail(base, tail);

  const src = put(root, "tail.big", source);
  const { readBigDirectory, rewriteBig } = await bigArchive();
  const directory = await readBigDirectory(src);

  expect(directory.headerSize).toBe(baseHeader + tail.length);
  expect(Array.from(directory.tail)).toEqual(Array.from(tail));
  expect(directory.entries.map((entry) => entry.offset)).toEqual(
    baseOffsets.map((offset) => offset + tail.length),
  );

  const dst = join(root, "tail-out.big");
  const result = await rewriteBig(src, dst, {
    select: () => false,
    transform: () => {
      throw new Error("transform must not run for unselected entries");
    },
  });
  expect(result.replaced).toBe(0);

  const output = await readBigDirectory(dst);
  expect(Array.from(output.tail)).toEqual(Array.from(tail));
  expect(output.headerSize).toBe(baseHeader + tail.length);
  expect(output.entries.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.path));
  const raw = bytes(dst);
  expect(Array.from(raw.subarray(output.headerSize - tail.length, output.headerSize))).toEqual(
    Array.from(tail),
  );
});

test("3: transform returning null for every selected entry produces a byte-identical file", async () => {
  const root = scratch();
  const source = buildBig([
    { path: "Data/One.ini", data: "one" },
    { path: "Data/Two.bin", data: sample(64, 3) },
    { path: "Data/Three.wav", data: sample(9, 4) },
  ]);
  const src = put(root, "source.big", source);
  const dst = join(root, "output.big");

  const { rewriteBig } = await bigArchive();
  await rewriteBig(src, dst, { select: () => true, transform: () => null });

  expect(same(bytes(dst), bytes(src)), "output bytes equal source bytes").toBe(true);
});

test("4: replacing one entry longer and another shorter rewrites sizes, contiguous offsets and untouched entries", async () => {
  const root = scratch();
  const entries = [
    { path: "Data/Alpha.ini", data: sample(10, 5) },
    { path: "Data/VoiceLong.wav", data: sample(100, 6) },
    { path: "Data/VoiceShort.wav", data: sample(30, 7) },
    { path: "Data/Omega.bin", data: sample(40, 8) },
  ];
  const longer = sample(200, 9);
  const shorter = sample(5, 10);
  const source = buildBig(entries);
  const src = put(root, "source.big", source);
  const dst = join(root, "output.big");

  const { readBigDirectory, rewriteBig } = await bigArchive();
  const result = await rewriteBig(src, dst, {
    select: (entry) => entry.name.endsWith("VoiceLong.wav") || entry.name.endsWith("VoiceShort.wav"),
    transform: (entry) =>
      entry.name.endsWith("VoiceLong.wav")
        ? Buffer.from(longer)
        : entry.name.endsWith("VoiceShort.wav")
          ? Buffer.from(shorter)
          : null,
  });
  expect(result.replaced).toBe(2);

  const output = await readBigDirectory(dst);
  const headerSize = headerSizeOf(entries);
  expect(output.headerSize).toBe(headerSize);
  expect(output.entries.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.path));
  expect(output.entries.map((entry) => entry.size)).toEqual([10, 200, 5, 40]);

  const expectedOffsets: number[] = [];
  let offset = headerSize;
  for (const size of [10, 200, 5, 40]) {
    expectedOffsets.push(offset);
    offset += size;
  }
  expect(output.entries.map((entry) => entry.offset)).toEqual(expectedOffsets);

  const raw = bytes(dst);
  expect(u32(raw, 4, true), "archive size field equals the file length").toBe(raw.length);
  expect(Array.from(raw.subarray(expectedOffsets[0], expectedOffsets[0] + 10))).toEqual(
    Array.from(entries[0].data as Uint8Array),
  );
  expect(Array.from(raw.subarray(expectedOffsets[1], expectedOffsets[1] + 200))).toEqual(
    Array.from(longer),
  );
  expect(Array.from(raw.subarray(expectedOffsets[2], expectedOffsets[2] + 5))).toEqual(
    Array.from(shorter),
  );
  expect(Array.from(raw.subarray(expectedOffsets[3], expectedOffsets[3] + 40))).toEqual(
    Array.from(entries[3].data as Uint8Array),
  );
});

test("5: select runs for every entry, transform only for selected entries, and select false copies the source", async () => {
  const root = scratch();
  const entries = [
    { path: "Data/First.bin", data: sample(13, 11) },
    { path: "Data/Second.bin", data: sample(21, 12) },
    { path: "Data/Third.bin", data: sample(34, 13) },
  ];
  const names = entries.map((entry) => entry.path);
  const source = buildBig(entries);
  const src = put(root, "source.big", source);
  const dst = join(root, "all-false.big");

  const { rewriteBig } = await bigArchive();
  const selectCalls: string[] = [];
  const transformCalls: string[] = [];
  const result = await rewriteBig(src, dst, {
    select: (entry) => {
      selectCalls.push(entry.name);
      return false;
    },
    transform: (entry) => {
      transformCalls.push(entry.name);
      return null;
    },
  });

  expect(selectCalls).toEqual(names);
  expect(transformCalls).toEqual([]);
  expect(result.replaced).toBe(0);
  expect(result.savedBytes).toBe(0);
  expect(same(bytes(dst), bytes(src)), "output equals the source").toBe(true);

  const onlySecond: string[] = [];
  const transformed: string[] = [];
  const second = await rewriteBig(src, join(root, "one-selected.big"), {
    select: (entry) => {
      onlySecond.push(entry.name);
      return entry.name === names[1];
    },
    transform: (entry) => {
      transformed.push(entry.name);
      return null;
    },
  });
  expect(onlySecond).toEqual(names);
  expect(transformed).toEqual([names[1]]);
  expect(second.replaced).toBe(0);
});

test("6: replaced and savedBytes report the old-minus-new total, negative when the entries grow", async () => {
  const root = scratch();
  const entries = [
    { path: "Data/Grow.bin", data: sample(10, 14) },
    { path: "Data/Shrink.bin", data: sample(20, 15) },
    { path: "Data/Keep.bin", data: sample(30, 16) },
  ];
  const names = entries.map((entry) => entry.path);
  const source = buildBig(entries);
  const src = put(root, "source.big", source);

  const { rewriteBig } = await bigArchive();
  const grown = await rewriteBig(src, join(root, "grown.big"), {
    select: () => true,
    transform: (entry) =>
      entry.name === names[0]
        ? Buffer.alloc(50, 0xaa)
        : entry.name === names[1]
          ? Buffer.alloc(5, 0xbb)
          : null,
  });
  expect(grown.replaced).toBe(2);
  expect(grown.savedBytes, "(10 + 20) - (50 + 5)").toBe(-25);

  const shrunk = await rewriteBig(src, join(root, "shrunk.big"), {
    select: (entry) => entry.name === names[0] || entry.name === names[1],
    transform: (entry) => Buffer.alloc(entry.name === names[0] ? 2 : 4, 0xcc),
  });
  expect(shrunk.replaced).toBe(2);
  expect(shrunk.savedBytes, "(10 + 20) - (2 + 4)").toBe(24);
});

test("7: a wrong magic and a file shorter than 16 bytes fail with code not-big", async () => {
  const root = scratch();
  const wrongMagic = Buffer.alloc(32);
  wrongMagic.write("BIGX", 0, "latin1");
  wrongMagic.writeUInt32LE(32, 4);
  wrongMagic.writeUInt32BE(0, 8);
  wrongMagic.writeUInt32BE(16, 12);
  const short = Buffer.from([0x42, 0x49, 0x47, 0x46, 0, 0, 0, 0, 0, 0]);

  const { readBigDirectory, rewriteBig } = await bigArchive();
  for (const [label, contents] of [
    ["wrong magic", wrongMagic],
    ["short file", short],
  ] as const) {
    const src = put(root, `${label.replace(/ /g, "-")}.big`, contents);
    await expectCode(() => readBigDirectory(src), "not-big");
    const dst = join(root, `${label.replace(/ /g, "-")}-out.big`);
    await expectCode(() => rewriteBig(src, dst, { select: () => false }), "not-big");
    expect(existsSync(dst), `${label}: no destination left`).toBe(false);
  }
});

test("8: an archive cut inside its data or its entry table fails with code truncated and leaves no destination", async () => {
  const root = scratch();
  const entries = [
    { path: "Data/First.bin", data: sample(40, 17) },
    { path: "Data/Second.bin", data: sample(50, 18) },
    { path: "Data/Third.bin", data: sample(60, 19) },
  ];
  const source = buildBig(entries);
  const headerSize = u32(source, 12, false);

  const cutData = source.slice(0, source.length - 7);
  const cutTable = source.slice(0, headerSize - 5);
  const { readBigDirectory, rewriteBig } = await bigArchive();

  for (const [label, contents] of [
    ["cut data", cutData],
    ["cut entry table", cutTable],
  ] as const) {
    const src = put(root, `${label.replace(/ /g, "-")}.big`, contents);
    await expectCode(() => readBigDirectory(src), "truncated");
    const dst = join(root, `${label.replace(/ /g, "-")}-out.big`);
    await expectCode(() => rewriteBig(src, dst, { select: () => false }), "truncated");
    expect(existsSync(dst), `${label}: no destination left behind`).toBe(false);
  }
});

test("9: an entry offset inside the header, or a header smaller than the entry table, fails with code bad-header", async () => {
  const root = scratch();
  const source = buildBig([
    { path: "Data/First.bin", data: sample(12, 20) },
    { path: "Data/Second.bin", data: sample(18, 21) },
  ]);

  const insideHeader = source.slice();
  setU32(insideHeader, 16, 12, false);

  const tinyHeader = source.slice();
  setU32(tinyHeader, 12, 16, false);

  const { readBigDirectory, rewriteBig } = await bigArchive();
  for (const [label, contents] of [
    ["offset inside header", insideHeader],
    ["header smaller than table", tinyHeader],
  ] as const) {
    const src = put(root, `${label.replace(/ /g, "-")}.big`, contents);
    await expectCode(() => readBigDirectory(src), "bad-header");
    const dst = join(root, `${label.replace(/ /g, "-")}-out.big`);
    await expectCode(() => rewriteBig(src, dst, { select: () => false }), "bad-header");
    expect(existsSync(dst), `${label}: no destination left`).toBe(false);
  }
});

// Writes a valid BIGF header and a sparse data area, so the 120 MB archive is
// never held in memory just to create it.
function writeSparseArchive(path: string, names: string[], entrySize: number): void {
  const pathBytes = names.map((name) => Buffer.from(name, "latin1"));
  const headerSize = 16 + pathBytes.reduce((sum, name) => sum + 8 + name.length + 1, 0);
  const total = headerSize + names.length * entrySize;

  const header = Buffer.alloc(headerSize);
  header.write("BIGF", 0, "latin1");
  header.writeUInt32LE(total, 4);
  header.writeUInt32BE(names.length, 8);
  header.writeUInt32BE(headerSize, 12);
  let at = 16;
  let dataAt = headerSize;
  for (const name of pathBytes) {
    header.writeUInt32BE(dataAt, at);
    header.writeUInt32BE(entrySize, at + 4);
    name.copy(header, at + 8);
    at += 8 + name.length + 1;
    dataAt += entrySize;
  }

  writeFileSync(path, header);
  truncateSync(path, total);
}

test("10: rewriting a 120 MB archive with a few 1 MB entries selected keeps RSS growth under 150 MB", async () => {
  const root = scratch();
  const count = 120;
  const names = Array.from(
    { length: count },
    (_, i) => `Data/Audio/big-${String(i).padStart(3, "0")}.bin`,
  );
  const src = join(root, "large.big");
  const dst = join(root, "large-out.big");
  writeSparseArchive(src, names, MIB);

  const { readBigDirectory, rewriteBig } = await bigArchive();
  const baseline = process.memoryUsage().rss;
  let peak = baseline;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 5);

  let result: RewriteResult;
  try {
    result = await rewriteBig(src, dst, {
      select: (entry) => /big-00[0-3]\.bin$/.test(entry.name),
      transform: (_entry, data) => Buffer.from(data),
    });
  } finally {
    clearInterval(timer);
  }
  peak = Math.max(peak, process.memoryUsage().rss);
  const growth = peak - baseline;

  expect(result.replaced).toBe(4);
  expect(
    growth,
    `RSS grew ${(growth / MIB).toFixed(1)} MiB (${(baseline / MIB).toFixed(1)} -> ${(peak / MIB).toFixed(1)} MiB)`,
  ).toBeLessThan(150 * MIB);

  const output = await readBigDirectory(dst);
  expect(output.entries.length).toBe(count);
  expect(output.entries.map((entry) => entry.name)).toEqual(names);
  expect(output.entries.every((entry) => entry.size === MIB)).toBe(true);
});

test("11: the source keeps the same bytes and modification time after a successful and a failed rewrite", async () => {
  const root = scratch();
  const source = buildBig([
    { path: "Data/First.ini", data: "first" },
    { path: "Data/Second.bin", data: sample(31, 22) },
  ]);
  const src = put(root, "source.big", source);
  const before = readFileSync(src);
  const beforeStat = statSync(src, { bigint: true });

  const { rewriteBig } = await bigArchive();
  await rewriteBig(src, join(root, "success.big"), {
    select: (entry) => entry.name.endsWith("Second.bin"),
    transform: () => Buffer.from(sample(77, 23)),
  });

  const afterSuccess = statSync(src, { bigint: true });
  expect(afterSuccess.mtimeNs, "source mtime after success").toBe(beforeStat.mtimeNs);
  expect(afterSuccess.size, "source size after success").toBe(beforeStat.size);
  expect(same(bytes(src), before), "source bytes after success").toBe(true);

  const truncated = put(root, "truncated.big", source.slice(0, source.length - 4));
  const truncatedBefore = readFileSync(truncated);
  const truncatedStat = statSync(truncated, { bigint: true });
  await expectCode(
    () => rewriteBig(truncated, join(root, "failure.big"), { select: () => false }),
    "truncated",
  );

  const afterFailure = statSync(truncated, { bigint: true });
  expect(afterFailure.mtimeNs, "source mtime after failure").toBe(truncatedStat.mtimeNs);
  expect(afterFailure.size, "source size after failure").toBe(truncatedStat.size);
  expect(same(bytes(truncated), truncatedBefore), "source bytes after failure").toBe(true);
});
