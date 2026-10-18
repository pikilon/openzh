import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBig } from "./helpers/big";
import { crc32 } from "./helpers/zip";
import { entryStream, openZip, type ZipEntry } from "../src/zip";

// Contract of scripts/make-game-zip.mjs --no-videos and --recode-audio
// (docs/briefs/151-make-game-zip-options.md).
//
// Node-side tests: the tool is spawned as a child process against synthetic
// source folders created in a temporary directory. No real game data is used
// and nothing is written inside the repository.

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(TESTS_DIR, "..");
const SCRIPT = join(WEB_ROOT, "scripts", "make-game-zip.mjs");

const SAMPLE_RATE = 22050;

interface RunResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

const tempRoots: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "zhwp-make-game-zip-options-"));
  tempRoots.push(dir);
  return dir;
}

test.afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function report(result: RunResult): string {
  return `exit ${result.status} signal ${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function envWithoutGameDir(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.ZHWP_GAME_DIR;
  return env;
}

function run(args: string[]): Promise<RunResult> {
  const child = spawn(process.execPath, [SCRIPT, ...args], {
    cwd: WEB_ROOT,
    env: envWithoutGameDir(),
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise<RunResult>((resolveDone, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolveDone({ status, signal, stdout, stderr });
    });
  });
}

function writeSource(dir: string, files: Record<string, Uint8Array | string>): string {
  for (const [relative, data] of Object.entries(files)) {
    const target = join(dir, ...relative.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return dir;
}

function sample(length: number, seed = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 37 + seed) & 0xff;
  return out;
}

// A synthetic BIG archive; without --recode-audio the tool never parses it.
function bigArchive(name: string): Uint8Array {
  return buildBig([{ path: `data/${name}`, data: `synthetic bytes of ${name}` }]);
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

interface OpenedZip {
  blob: Blob;
  entries: ZipEntry[];
}

async function readZip(path: string): Promise<OpenedZip> {
  const blob = new Blob([readFileSync(path)]);
  return { blob, entries: await openZip(blob) };
}

function entryAt(entries: ZipEntry[], path: string): ZipEntry {
  const entry = entries.find((candidate) => candidate.path === path);
  expect(entry, `entry ${path}`).toBeDefined();
  return entry as ZipEntry;
}

// Asserts the archive lists exactly the expected paths and that every entry is
// stored with the source bytes and CRC.
async function expectArchiveMatches(
  opened: OpenedZip,
  expected: Map<string, Uint8Array>,
  label: string,
): Promise<void> {
  const paths = opened.entries.map((entry) => entry.path).sort();
  expect(paths, `${label} paths`).toEqual([...expected.keys()].sort());
  for (const [path, data] of expected) {
    const entry = entryAt(opened.entries, path);
    expect(entry.method, `${label} ${path} method`).toBe(0);
    expect(entry.size, `${label} ${path} size`).toBe(data.length);
    expect(entry.crc32, `${label} ${path} crc`).toBe(crc32(data));
    const bytes = await collect(entryStream(opened.blob, entry));
    expect(Array.from(bytes), `${label} ${path} bytes`).toEqual(Array.from(data));
  }
}

async function entryBytes(opened: OpenedZip, path: string): Promise<Uint8Array> {
  return collect(entryStream(opened.blob, entryAt(opened.entries, path)));
}

function linesOf(result: RunResult): string[] {
  return `${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter((line) => line !== "");
}

function matchingLines(result: RunResult, pattern: RegExp): string[] {
  return linesOf(result).filter((line) => pattern.test(line));
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array, label: string): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  expect(Buffer.compare(Buffer.from(actual), Buffer.from(expected)), `${label} bytes`).toBe(0);
}

// Files and folders that must never survive a run.
function leftovers(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === ".recode-tmp") found.push(relative);
        else walk(join(dir, entry.name), relative);
      } else if (entry.name.endsWith(".partial")) {
        found.push(relative);
      }
    }
  };
  walk(root, "");
  return found;
}

// --- Synthetic WAV files -----------------------------------------------------

function u32le(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function wavChunk(id: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32LE(data.length, 4);
  const padding = data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, data, padding]);
}

function wavFile(chunks: [string, Buffer][]): Buffer {
  const body = Buffer.concat(chunks.map(([id, data]) => wavChunk(id, data)));
  return Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    u32le(body.length),
    Buffer.from("WAVE", "ascii"),
    body,
  ]);
}

function wavFmt(options: { tag?: number; channels?: number; bits?: number } = {}): Buffer {
  const { tag = 1, channels = 1, bits = 16 } = options;
  const blockAlign = (channels * bits) / 8;
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(tag, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(SAMPLE_RATE, 4);
  fmt.writeUInt32LE(SAMPLE_RATE * blockAlign, 8);
  fmt.writeUInt16LE(blockAlign, 12);
  fmt.writeUInt16LE(bits, 14);
  return fmt;
}

// Mono 16-bit PCM, long enough that IMA ADPCM is much smaller than the input.
function pcm16Wav(frames: number, seed = 1): Buffer {
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const tone = 12000 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    const value = Math.round(tone) + (((i * seed) % 9) - 4);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2);
  }
  return wavFile([
    ["fmt ", wavFmt()],
    ["data", data],
  ]);
}

// A file that already declares format tag 17 (IMA ADPCM); not eligible.
function adpcmWav(): Buffer {
  return wavFile([
    ["fmt ", wavFmt({ tag: 17 })],
    ["data", sample(512, 13)],
  ]);
}

// 8-bit PCM; not eligible for the 16-bit encoder.
function pcm8Wav(): Buffer {
  return wavFile([
    ["fmt ", wavFmt({ bits: 8 })],
    ["data", Buffer.alloc(400, 0x80)],
  ]);
}

interface ParsedWav {
  chunkIds: string[];
  tag: number;
  fact: number | undefined;
  data: Buffer;
}

function parseWav(bytes: Uint8Array): ParsedWav {
  const wav = Buffer.from(bytes);
  expect(wav.toString("ascii", 0, 4), "RIFF").toBe("RIFF");
  expect(wav.toString("ascii", 8, 12), "WAVE").toBe("WAVE");
  const chunkIds: string[] = [];
  let fmt: Buffer | undefined;
  let fact: number | undefined;
  let data: Buffer | undefined;
  let at = 12;
  while (at + 8 <= wav.length) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const start = at + 8;
    expect(start + size, `${id} chunk fits`).toBeLessThanOrEqual(wav.length);
    chunkIds.push(id);
    if (id === "fmt ") fmt = wav.subarray(start, start + size);
    else if (id === "fact" && size >= 4) fact = wav.readUInt32LE(start);
    else if (id === "data") data = wav.subarray(start, start + size);
    at = start + size + (size & 1);
  }
  expect(fmt, "fmt chunk").toBeDefined();
  expect(data, "data chunk").toBeDefined();
  return { chunkIds, tag: fmt!.readUInt16LE(0), fact, data: data! };
}

// --- Synthetic BIG archives --------------------------------------------------

interface BigEntry {
  name: string;
  offset: number;
  size: number;
}

interface ParsedBig {
  headerSize: number;
  entries: BigEntry[];
}

function parseBigArchive(bytes: Uint8Array): ParsedBig {
  const archive = Buffer.from(bytes);
  expect(archive.toString("latin1", 0, 4), "BIGF magic").toBe("BIGF");
  expect(archive.readUInt32LE(4), "archive size field").toBe(archive.length);
  const count = archive.readUInt32BE(8);
  const headerSize = archive.readUInt32BE(12);
  expect(headerSize, "header fits").toBeLessThanOrEqual(archive.length);
  const entries: BigEntry[] = [];
  let at = 16;
  for (let i = 0; i < count; i++) {
    const offset = archive.readUInt32BE(at);
    const size = archive.readUInt32BE(at + 4);
    let end = at + 8;
    while (end < headerSize && archive[end] !== 0) end++;
    expect(end, `entry ${i} name is NUL-terminated before the data`).toBeLessThan(headerSize);
    entries.push({ name: archive.toString("latin1", at + 8, end), offset, size });
    at = end + 1;
  }
  return { headerSize, entries };
}

function bigEntryBytes(archive: Uint8Array, entry: BigEntry): Uint8Array {
  expect(entry.offset + entry.size, `entry ${entry.name} data fits`).toBeLessThanOrEqual(
    archive.length,
  );
  return archive.subarray(entry.offset, entry.offset + entry.size);
}

// A speech archive holding a PCM WAV plus other entries, in a fixed order.
function speechBig(frames: number): Uint8Array {
  return buildBig([
    { path: "data/voice/pcm.wav", data: pcm16Wav(frames) },
    { path: "data/voice/already-adpcm.wav", data: adpcmWav() },
    { path: "data/voice/notes.txt", data: new TextEncoder().encode("synthetic notes\n") },
    { path: "data/voice/eight-bit.wav", data: pcm8Wav() },
  ]);
}

// --- Tests -------------------------------------------------------------------

test("1: without the new flags every source file, including .bik videos and speech*.big archives, is packed with identical bytes", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const speech = speechBig(8192);
  const expected = new Map<string, Uint8Array>([
    ["Movies/intro.bik", sample(1024, 1)],
    ["Movies/OUTRO.BIK", sample(2048, 2)],
    ["Zero Hour/Movies/zh.Bik", sample(512, 3)],
    ["SpeechEnglish.big", speech],
    ["Data/regular.bin", sample(4099, 4)],
    ["readme.txt", new TextEncoder().encode("no flags means the whole folder\n")],
  ]);
  writeSource(src, Object.fromEntries(expected));

  const result = await run(["--src", src, "--out", out]);
  expect(result.status, report(result)).toBe(0);
  expect(readdirSync(out), "one finished archive and no partial file").toEqual(["game.zip"]);

  const opened = await readZip(join(out, "game.zip"));
  await expectArchiveMatches(opened, expected, "game.zip");
  expect(matchingLines(result, /skipped videos:/i), "no skipped-videos line without the flag").toEqual(
    [],
  );
  expect(matchingLines(result, /recoded audio:/i), "no recoded-audio line without the flag").toEqual(
    [],
  );
});

test("2: --no-videos skips .bik entries in any case, keeps every other file identical, and prints the skipped count and bytes once", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const videos: Record<string, Uint8Array> = {
    "intro.bik": sample(1000, 1),
    "Movies/OUTRO.BIK": sample(2000, 2),
    "Zero Hour/Movies/zh.Bik": sample(3000, 3),
  };
  const speech = speechBig(4096);
  const expected = new Map<string, Uint8Array>([
    ["intro.bik", videos["intro.bik"]],
    ["Movies/OUTRO.BIK", videos["Movies/OUTRO.BIK"]],
    ["Zero Hour/Movies/zh.Bik", videos["Zero Hour/Movies/zh.Bik"]],
    ["SpeechEnglish.big", speech],
    ["Data/regular.bin", sample(4099, 4)],
    ["readme.txt", new TextEncoder().encode("videos are optional\n")],
  ]);
  writeSource(src, Object.fromEntries(expected));

  const result = await run(["--src", src, "--out", out, "--no-videos"]);
  expect(result.status, report(result)).toBe(0);
  expect(readdirSync(out), "one finished archive and no partial file").toEqual(["game.zip"]);

  const opened = await readZip(join(out, "game.zip"));
  const withoutVideos = new Map(
    [...expected].filter(([path]) => !path.toLowerCase().endsWith(".bik")),
  );
  await expectArchiveMatches(opened, withoutVideos, "game.zip --no-videos");
  expect(
    opened.entries.filter((entry) => entry.path.toLowerCase().endsWith(".bik")),
    "no .bik entry in any case",
  ).toEqual([]);

  const skippedLines = matchingLines(result, /skipped videos:/i);
  expect(skippedLines, `one skipped-videos line: ${report(result)}`).toHaveLength(1);
  const skipped = skippedLines[0].match(/skipped videos:\s*(\d+)\s+files,\s*(\d+)\s+bytes/i);
  expect(skipped, `skipped-videos line format: ${skippedLines[0]}`).not.toBeNull();
  expect(Number(skipped![1]), "skipped file count").toBe(3);
  expect(Number(skipped![2]), "skipped byte count").toBe(
    1000 + 2000 + 3000,
  );

  // The per-ZIP summary line keeps reporting what the archive holds.
  const summaryLines = matchingLines(result, / (\d+) files (\d+) bytes$/);
  expect(summaryLines, `one per-ZIP summary line: ${report(result)}`).toHaveLength(1);
  const summary = summaryLines[0].match(/ (\d+) files (\d+) bytes$/);
  expect(Number(summary![1]), "packed file count").toBe(opened.entries.length);
  expect(Number(summary![2]), "packed byte count").toBe(
    opened.entries.reduce((total, entry) => total + entry.size, 0),
  );
});

test("3: --recode-audio recodes a PCM 16-bit WAV inside SpeechEnglish.big and keeps the ADPCM, 8-bit and .txt entries byte-identical", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const frames = 8192;
  const original = speechBig(frames);
  writeSource(src, {
    "SpeechEnglish.big": original,
    "keep.bin": sample(700, 7),
  });

  const result = await run(["--src", src, "--out", out, "--recode-audio"]);
  expect(result.status, report(result)).toBe(0);

  const opened = await readZip(join(out, "game.zip"));
  const recoded = await entryBytes(opened, "SpeechEnglish.big");
  expectSameBytes(await entryBytes(opened, "keep.bin"), sample(700, 7), "keep.bin");

  const before = parseBigArchive(original);
  const after = parseBigArchive(recoded);
  expect(after.entries.map((entry) => entry.name), "entry names and order").toEqual(
    before.entries.map((entry) => entry.name),
  );

  const pcmEntry = after.entries[0];
  expect(pcmEntry.name, "the first entry is the PCM WAV").toBe("data/voice/pcm.wav");
  const pcm = parseWav(bigEntryBytes(recoded, pcmEntry));
  expect(pcm.tag, "recoded WAVE format tag").toBe(0x0011);
  expect(pcm.fact, "recoded fact frame count").toBe(frames);
  expect(pcm.data.length, "recoded data chunk").toBeGreaterThan(0);

  for (let i = 1; i < before.entries.length; i++) {
    const label = before.entries[i].name;
    expectSameBytes(
      bigEntryBytes(recoded, after.entries[i]),
      bigEntryBytes(original, before.entries[i]),
      label,
    );
  }
});

test("4: --recode-audio keeps the original bytes of a 1-frame WAV that would not be smaller", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const oneFrame = pcm16Wav(1);
  const archive = buildBig([
    { path: "data/one-frame.wav", data: oneFrame },
    { path: "data/notes.txt", data: new TextEncoder().encode("still here\n") },
  ]);
  writeSource(src, {
    "SpeechEnglish.big": archive,
  });

  const result = await run(["--src", src, "--out", out, "--recode-audio"]);
  expect(result.status, report(result)).toBe(0);

  const opened = await readZip(join(out, "game.zip"));
  const recoded = await entryBytes(opened, "SpeechEnglish.big");
  const before = parseBigArchive(archive);
  const after = parseBigArchive(recoded);
  expect(after.entries.map((entry) => entry.name), "entry names and order").toEqual(
    before.entries.map((entry) => entry.name),
  );
  expectSameBytes(
    bigEntryBytes(recoded, after.entries[0]),
    bigEntryBytes(archive, before.entries[0]),
    "1-frame WAV",
  );
  expectSameBytes(oneFrame, bigEntryBytes(recoded, after.entries[0]), "1-frame WAV source bytes");
  expectSameBytes(
    bigEntryBytes(recoded, after.entries[1]),
    bigEntryBytes(archive, before.entries[1]),
    "notes.txt",
  );
});

test("5: --recode-audio leaves .big archives whose names do not start with speech or audio byte-identical", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const notSpeech = buildBig([
    { path: "data/voice/pcm.wav", data: pcm16Wav(4096) },
    { path: "data/readme.txt", data: new TextEncoder().encode("not a speech archive\n") },
  ]);
  const notAudio = buildBig([
    { path: "data/voice/pcm.wav", data: pcm16Wav(4096) },
    { path: "data/readme.txt", data: new TextEncoder().encode("not an audio archive\n") },
  ]);
  const almostAudio = buildBig([{ path: "data/voice/pcm.wav", data: pcm16Wav(2048) }]);
  writeSource(src, {
    "INI.big": notSpeech,
    "Data/NotAudio.big": notAudio,
    "MyAudio.big": almostAudio,
    "keep.txt": new TextEncoder().encode("untouched\n"),
  });

  const result = await run(["--src", src, "--out", out, "--recode-audio"]);
  expect(result.status, report(result)).toBe(0);

  const opened = await readZip(join(out, "game.zip"));
  expectSameBytes(await entryBytes(opened, "INI.big"), notSpeech, "INI.big");
  expectSameBytes(await entryBytes(opened, "Data/NotAudio.big"), notAudio, "Data/NotAudio.big");
  expectSameBytes(await entryBytes(opened, "MyAudio.big"), almostAudio, "MyAudio.big");
  expectSameBytes(
    await entryBytes(opened, "keep.txt"),
    new TextEncoder().encode("untouched\n"),
    "keep.txt",
  );
});

test("6: the ZIP entry names, order and paths are the same with and without the flags, and the recoded archive changes size", async () => {
  const root = scratch();
  const src = join(root, "game");
  const outDefault = join(root, "out-default");
  const outRecode = join(root, "out-recode");
  const outBoth = join(root, "out-both");
  for (const out of [outDefault, outRecode, outBoth]) mkdirSync(out);

  const speech = speechBig(8192);
  writeSource(src, {
    "SpeechEnglish.big": speech,
    "Movies/intro.bik": sample(1000, 1),
    "Movies/OUTRO.BIK": sample(2000, 2),
    "nested/deep/keep.bin": sample(300, 3),
    "notes.txt": new TextEncoder().encode("paths do not move\n"),
  });

  const plain = await run(["--src", src, "--out", outDefault]);
  expect(plain.status, report(plain)).toBe(0);
  const recode = await run(["--src", src, "--out", outRecode, "--recode-audio"]);
  expect(recode.status, report(recode)).toBe(0);
  const both = await run([
    "--src",
    src,
    "--out",
    outBoth,
    "--no-videos",
    "--recode-audio",
  ]);
  expect(both.status, report(both)).toBe(0);

  const plainZip = await readZip(join(outDefault, "game.zip"));
  const recodeZip = await readZip(join(outRecode, "game.zip"));
  const bothZip = await readZip(join(outBoth, "game.zip"));

  const plainPaths = plainZip.entries.map((entry) => entry.path);
  expect(recodeZip.entries.map((entry) => entry.path), "--recode-audio paths").toEqual(plainPaths);
  expect(bothZip.entries.map((entry) => entry.path), "both flags paths").toEqual(
    plainPaths.filter((path) => !path.toLowerCase().endsWith(".bik")),
  );

  const plainSize = entryAt(plainZip.entries, "SpeechEnglish.big").size;
  const recodeSize = entryAt(recodeZip.entries, "SpeechEnglish.big").size;
  expect(recodeSize, "the recoded archive size differs from the original").not.toBe(plainSize);
  expect(
    Buffer.from(await entryBytes(recodeZip, "SpeechEnglish.big")).length,
    "the packed recoded archive is complete",
  ).toBe(recodeSize);
  expect(readFileSync(join(outRecode, "game.zip")).length, "the recoded ZIP size differs").not.toBe(
    readFileSync(join(outDefault, "game.zip")).length,
  );
});

test("7: --recode-audio reports the recoded WAV count, archive count and saved bytes, matching the archive size difference", async () => {
  const root = scratch();
  const src = join(root, "game");
  const outDefault = join(root, "out-default");
  const outRecode = join(root, "out-recode");
  for (const out of [outDefault, outRecode]) mkdirSync(out);

  // One eligible WAV per archive, so the reported count is unambiguous.
  const speech = buildBig([
    { path: "data/voice/pcm.wav", data: pcm16Wav(8192) },
    { path: "data/voice/notes.txt", data: new TextEncoder().encode("speech pack\n") },
  ]);
  const audio = buildBig([
    { path: "data/voice/pcm.wav", data: pcm16Wav(4096) },
    { path: "data/voice/notes.txt", data: new TextEncoder().encode("audio pack\n") },
  ]);
  const untouched = buildBig([{ path: "data/voice/pcm.wav", data: pcm16Wav(2048) }]);
  writeSource(src, {
    "SpeechEnglish.big": speech,
    "AudioEnglish.big": audio,
    "INI.big": untouched,
    "readme.txt": new TextEncoder().encode("summary math\n"),
  });

  const plain = await run(["--src", src, "--out", outDefault]);
  expect(plain.status, report(plain)).toBe(0);
  const recode = await run(["--src", src, "--out", outRecode, "--recode-audio"]);
  expect(recode.status, report(recode)).toBe(0);

  const plainZip = await readZip(join(outDefault, "game.zip"));
  const recodeZip = await readZip(join(outRecode, "game.zip"));
  const savedInArchives =
    entryAt(plainZip.entries, "SpeechEnglish.big").size +
    entryAt(plainZip.entries, "AudioEnglish.big").size -
    entryAt(recodeZip.entries, "SpeechEnglish.big").size -
    entryAt(recodeZip.entries, "AudioEnglish.big").size;
  expect(savedInArchives, "the recoded archives are smaller").toBeGreaterThan(0);

  const recodeLines = matchingLines(recode, /recoded audio:/i);
  expect(recodeLines, `one recoded-audio line: ${report(recode)}`).toHaveLength(1);
  const summary = recodeLines[0].match(
    /recoded audio:\s*(\d+)\s+wav\s+in\s+(\d+)\s+archives?,\s+saved\s+(\d+)\s+bytes/i,
  );
  expect(summary, `recoded-audio line format: ${recodeLines[0]}`).not.toBeNull();
  expect(Number(summary![1]), "recoded WAV count").toBe(2);
  expect(Number(summary![2]), "rebuilt archive count").toBe(2);
  expect(Number(summary![3]), "saved bytes").toBe(savedInArchives);
  expect(
    Number(summary![3]),
    "saved bytes match the difference in total archive sizes",
  ).toBe(
    readFileSync(join(outDefault, "game.zip")).length -
      readFileSync(join(outRecode, "game.zip")).length,
  );
  expect(entryAt(recodeZip.entries, "INI.big").size, "non-speech archives stay untouched").toBe(
    entryAt(plainZip.entries, "INI.big").size,
  );
});

test("8: a successful run leaves no .recode-tmp folder and no .partial file in --out", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  writeSource(src, {
    "SpeechEnglish.big": speechBig(8192),
    "AudioEnglish.big": buildBig([
      { path: "data/voice/pcm.wav", data: pcm16Wav(4096) },
    ]),
    "Movies/intro.bik": sample(1000, 1),
    "keep.bin": sample(500, 2),
  });

  const result = await run([
    "--src",
    src,
    "--out",
    out,
    "--recode-audio",
    "--no-videos",
  ]);
  expect(result.status, report(result)).toBe(0);
  expect(readdirSync(out).sort(), "only the finished ZIP remains").toEqual(["game.zip"]);
  expect(leftovers(out), "no .recode-tmp folder or .partial file").toEqual([]);
  expect(existsSync(join(out, ".recode-tmp")), ".recode-tmp is absent").toBe(false);
});

test("9: a truncated speech*.big exits 4 naming the archive and leaves no ZIP, .partial or .recode-tmp", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const valid = speechBig(4096);
  const truncated = valid.subarray(0, valid.length - 1);
  writeSource(src, {
    "Data/SpeechEnglish.big": truncated,
    "keep.bin": sample(500, 3),
  });

  const result = await run(["--src", src, "--out", out, "--recode-audio"]);
  expect(result.status, report(result)).toBe(4);
  expect(
    `${result.stdout}\n${result.stderr}`,
    `the error names the corrupt archive: ${report(result)}`,
  ).toContain("SpeechEnglish.big");
  expect(readdirSync(out), "the failed run wrote nothing").toEqual([]);
  expect(leftovers(out), "no .recode-tmp folder or .partial file").toEqual([]);
  expect(existsSync(join(out, ".recode-tmp")), ".recode-tmp is absent").toBe(false);
});

test("10: --no-videos --recode-audio --split writes zero-hour.zip and generals.zip, each readable with valid CRCs and its REQUIRED archives", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const generalsSpeech = speechBig(4096);
  const zeroHourSpeech = speechBig(2048);
  const generals = new Map<string, Uint8Array>([
    ["INI.big", bigArchive("INI.big")],
    ["W3D.big", bigArchive("W3D.big")],
    ["SpeechEnglish.big", generalsSpeech],
    ["Movies/intro.bik", sample(1000, 1)],
    ["Data/generals.bin", sample(700, 2)],
  ]);
  const zeroHour = new Map<string, Uint8Array>([
    ["Zero Hour/INIZH.big", bigArchive("INIZH.big")],
    ["Zero Hour/W3DZH.big", bigArchive("W3DZH.big")],
    ["Zero Hour/SpeechZH.big", zeroHourSpeech],
    ["Zero Hour/Movies/credits.BIK", sample(512, 3)],
    ["Zero Hour/Data/zh.bin", sample(900, 4)],
  ]);
  writeSource(src, Object.fromEntries([...generals, ...zeroHour]));

  const result = await run([
    "--src",
    src,
    "--out",
    out,
    "--split",
    "--no-videos",
    "--recode-audio",
  ]);
  expect(result.status, report(result)).toBe(0);
  expect(readdirSync(out).sort(), "both ZIPs and nothing else").toEqual([
    "generals.zip",
    "zero-hour.zip",
  ]);
  expect(leftovers(out), "no .recode-tmp folder or .partial file").toEqual([]);

  for (const [name, expected, required, speechName, originalSpeech] of [
    [
      "zero-hour.zip",
      zeroHour,
      ["Zero Hour/INIZH.big", "Zero Hour/W3DZH.big"],
      "Zero Hour/SpeechZH.big",
      zeroHourSpeech,
    ],
    [
      "generals.zip",
      generals,
      ["INI.big", "W3D.big"],
      "SpeechEnglish.big",
      generalsSpeech,
    ],
  ] as const) {
    const opened = await readZip(join(out, name));
    for (const requiredPath of required) {
      expect(
        opened.entries.some((entry) => entry.path === requiredPath),
        `${name} holds ${requiredPath}`,
      ).toBe(true);
    }
    expect(
      opened.entries.filter((entry) => entry.path.toLowerCase().endsWith(".bik")),
      `${name} holds no videos`,
    ).toEqual([]);
    // The speech archive is recoded: check every other entry byte for byte,
    // then the recoded archive itself below.
    const recoded = await entryBytes(opened, speechName);
    const expectedWithRecoded = new Map(
      [...expected].filter(([path]) => !path.toLowerCase().endsWith(".bik")),
    );
    expectedWithRecoded.set(speechName, recoded);
    await expectArchiveMatches(opened, expectedWithRecoded, name);

    // Every entry streams with a valid CRC.
    for (const entry of opened.entries) {
      const bytes = await collect(entryStream(opened.blob, entry));
      expect(crc32(bytes), `${name} ${entry.path} crc`).toBe(entry.crc32);
    }

    const speechEntry = entryAt(opened.entries, speechName);
    expect(speechEntry.size, `${name} recodes ${speechName}`).not.toBe(originalSpeech.length);
    const parsed = parseBigArchive(recoded);
    const recodedWav = parseWav(bigEntryBytes(recoded, parsed.entries[0]));
    expect(recodedWav.tag, `${name} ${speechName} format tag`).toBe(0x0011);
  }
});

test("11: the source folder keeps the same files, sizes and modification times after successful and failed runs", async () => {
  interface SourceFile {
    path: string;
    size: number;
    mtimeMs: number;
  }

  function snapshot(dir: string): SourceFile[] {
    const files: SourceFile[] = [];
    const walk = (current: string, prefix: string): void => {
      const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );
      for (const entry of entries) {
        const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        const absolute = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(absolute, relative);
        } else if (entry.isFile()) {
          const stats = statSync(absolute);
          files.push({ path: relative, size: stats.size, mtimeMs: stats.mtimeMs });
        }
      }
    };
    walk(dir, "");
    return files;
  }

  const successRoot = scratch();
  const successSrc = join(successRoot, "game");
  const successOut = join(successRoot, "out");
  mkdirSync(successOut);
  writeSource(successSrc, {
    "INI.big": bigArchive("INI.big"),
    "W3D.big": bigArchive("W3D.big"),
    "SpeechEnglish.big": speechBig(4096),
    "Movies/intro.bik": sample(1000, 1),
    "Zero Hour/INIZH.big": bigArchive("INIZH.big"),
    "Zero Hour/W3DZH.big": bigArchive("W3DZH.big"),
    "Zero Hour/SpeechZH.big": speechBig(2048),
    "Zero Hour/Movies/credits.BIK": sample(512, 2),
  });
  const successBefore = snapshot(successSrc);
  const successRun = await run([
    "--src",
    successSrc,
    "--out",
    successOut,
    "--split",
    "--no-videos",
    "--recode-audio",
  ]);
  expect(successRun.status, report(successRun)).toBe(0);
  expect(snapshot(successSrc), "source after a successful run").toEqual(successBefore);

  const failureRoot = scratch();
  const failureSrc = join(failureRoot, "game");
  const failureOut = join(failureRoot, "out");
  mkdirSync(failureOut);
  const valid = speechBig(2048);
  writeSource(failureSrc, {
    "SpeechEnglish.big": valid.subarray(0, valid.length - 1),
    "keep.bin": sample(400, 5),
  });
  const failureBefore = snapshot(failureSrc);
  const failureRun = await run([
    "--src",
    failureSrc,
    "--out",
    failureOut,
    "--recode-audio",
  ]);
  expect(failureRun.status, report(failureRun)).toBe(4);
  expect(snapshot(failureSrc), "source after a failed run").toEqual(failureBefore);
});
