import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
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

// Contract of scripts/make-game-zip.mjs --voices-mp3
// (docs/briefs/180-voices-mp3.md).
//
// Node-side tests: the tool is spawned as a child process against synthetic
// source folders created in a temporary directory. WAVs, TGAs, BIG archives
// and MP3s are generated here with ffmpeg. No real game data is used and
// nothing is written inside the repository.
//
// Criterion 13 (the existing make-game-zip, make-game-zip-options and
// make-game-zip-gfx-music specs still pass) is covered by the brief's check
// command, which runs them beside this file.

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(TESTS_DIR, "..");
const SCRIPT = join(WEB_ROOT, "scripts", "make-game-zip.mjs");

const SAMPLE_RATE = 22050;
const MP3_SAMPLE_RATE = 44100;
const VOICES_KBPS = 48;
const MUSIC_KBPS = 128;
const BITRATE_TOLERANCE = 3000;
const MUSIC_BITRATE_TOLERANCE = 2000;
const FRAME_TOLERANCE = 2300;
const MIN_SNR_DB = 15;

const FFMPEG_AVAILABLE =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

interface RunResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

const tempRoots: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "zhwp-make-game-zip-voices-"));
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

function run(
  args: string[],
  env: Record<string, string | undefined> = envWithoutGameDir(),
): Promise<RunResult> {
  const child = spawn(process.execPath, [SCRIPT, ...args], {
    cwd: WEB_ROOT,
    env,
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

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function runFfmpeg(args: string[], label: string): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], {
    encoding: "utf8",
  });
  expect(result.status, `${label}: ffmpeg failed: ${result.stderr}`).toBe(0);
}

function makePcm16Wav(
  path: string,
  options: { sampleRate?: number; channels?: number; seconds?: number } = {},
): string {
  const { sampleRate = SAMPLE_RATE, channels = 1, seconds = 3 } = options;
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${sampleRate}:duration=${seconds}`,
      "-ac",
      String(channels),
      "-c:a",
      "pcm_s16le",
      path,
    ],
    `generate ${path}`,
  );
  return path;
}

// A tone plus broadband noise, so an MP3 made from the original WAV and one
// made from an IMA ADPCM recode can be compared with a signal-to-noise ratio.
function makeToneNoiseWav(path: string, options: { seconds?: number } = {}): string {
  const { seconds = 2 } = options;
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${SAMPLE_RATE}:duration=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=color=white:sample_rate=${SAMPLE_RATE}:duration=${seconds}:amplitude=0.05`,
      "-filter_complex",
      "[0:a][1:a]amix=inputs=2:duration=first[a]",
      "-map",
      "[a]",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      path,
    ],
    `generate ${path}`,
  );
  return path;
}

function makeAdpcmWav(path: string, options: { seconds?: number } = {}): string {
  const { seconds = 3 } = options;
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${SAMPLE_RATE}:duration=${seconds}`,
      "-ac",
      "1",
      "-c:a",
      "adpcm_ima_wav",
      path,
    ],
    `generate ${path}`,
  );
  return path;
}

function makePcm8Wav(path: string): string {
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${SAMPLE_RATE}:duration=1`,
      "-ac",
      "1",
      "-c:a",
      "pcm_u8",
      path,
    ],
    `generate ${path}`,
  );
  return path;
}

function makeOneFrameWav(path: string): string {
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${SAMPLE_RATE}:duration=1`,
      "-af",
      "atrim=end_sample=1",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      path,
    ],
    `generate ${path}`,
  );
  return path;
}

function makeMp3(
  path: string,
  options: { kbps: number; channels: 1 | 2; seconds?: number },
): string {
  const { kbps, channels, seconds = 2 } = options;
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${MP3_SAMPLE_RATE}:duration=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=color=white:sample_rate=${MP3_SAMPLE_RATE}:duration=${seconds}:amplitude=0.02`,
      "-filter_complex",
      "[0:a][1:a]amix=inputs=2:duration=first[a]",
      "-map",
      "[a]",
      "-ac",
      String(channels),
      "-c:a",
      "libmp3lame",
      "-b:a",
      `${kbps}k`,
      path,
    ],
    `generate ${path}`,
  );
  return path;
}

interface ProbedStream {
  codec_name?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
  duration?: string;
}

function probe(path: string): ProbedStream {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,bit_rate,channels,sample_rate,duration",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, `ffprobe failed for ${path}: ${result.stderr}`).toBe(0);
  const info = JSON.parse(String(result.stdout)) as { streams?: ProbedStream[] };
  const stream = info.streams?.[0];
  expect(stream, `ffprobe reported an audio stream for ${path}`).toBeDefined();
  return stream as ProbedStream;
}

function decodeMono(path: string): Int16Array {
  const rawPath = `${path}.s16le`;
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-v",
      "error",
      "-y",
      "-i",
      path,
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ac",
      "1",
      rawPath,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, `ffmpeg decode failed for ${path}: ${result.stderr}`).toBe(0);
  const raw = readFileSync(rawPath);
  const samples = new Int16Array(Math.floor(raw.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = raw.readInt16LE(i * 2);
  return samples;
}

// --- Synthetic TGA files -----------------------------------------------------

const TGA_HEADER_BYTES = 18;
const IMAGE_TYPE_RLE = 10;

interface TgaHeader {
  idLength: number;
  width: number;
  height: number;
  imageType: number;
  pixelDepth: number;
}

function makePixels(
  width: number,
  height: number,
  pixelDepth: number,
  colorAt: (x: number, y: number) => readonly number[],
): Buffer {
  const bytesPerPixel = Math.ceil(pixelDepth / 8);
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colorAt(x, y);
      const offset = (y * width + x) * bytesPerPixel;
      for (let channel = 0; channel < bytesPerPixel; channel++) {
        pixels[offset + channel] = color[channel] ?? 0;
      }
    }
  }
  return pixels;
}

function buildTga(width: number, height: number, pixels: Buffer): Buffer {
  const header = Buffer.alloc(TGA_HEADER_BYTES);
  header.writeUInt8(0, 0);
  header.writeUInt8(0, 1);
  header.writeUInt8(2, 2);
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header.writeUInt8(24, 16);
  header.writeUInt8(0x20, 17);
  return Buffer.concat([header, pixels]);
}

function bgr(red: number, green: number, blue: number): readonly number[] {
  return [blue, green, red];
}

// 64x64 with large flat areas, so RLE must shrink it.
const FLAT_PIXELS = makePixels(64, 64, 24, (x, y) => {
  if (x < 24 && y < 24) return bgr(220, 30, 40);
  if (x >= 40 && y >= 40) return bgr(20, 210, 60);
  return bgr(30, 60, 190);
});
const FLAT_TGA = buildTga(64, 64, FLAT_PIXELS);

function decodeTgaRle(tga: Buffer): { header: TgaHeader; pixels: Buffer } {
  expect(tga.length, "TGA has an 18-byte header").toBeGreaterThanOrEqual(TGA_HEADER_BYTES);
  const header: TgaHeader = {
    idLength: tga.readUInt8(0),
    width: tga.readUInt16LE(12),
    height: tga.readUInt16LE(14),
    imageType: tga.readUInt8(2),
    pixelDepth: tga.readUInt8(16),
  };
  expect(header.imageType, "output image type").toBe(IMAGE_TYPE_RLE);
  const bytesPerPixel = header.pixelDepth / 8;
  const totalPixels = header.width * header.height;
  const pixels = Buffer.alloc(totalPixels * bytesPerPixel);
  let at = TGA_HEADER_BYTES + header.idLength;
  let decoded = 0;
  while (decoded < totalPixels) {
    expect(at, "RLE pixel data is not truncated").toBeLessThan(tga.length);
    const packet = tga[at++];
    const count = (packet & 0x7f) + 1;
    const column = decoded % header.width;
    expect(column + count, `packet at pixel ${decoded} crosses its scanline`).toBeLessThanOrEqual(
      header.width,
    );
    expect(decoded + count, "RLE packet runs past the image").toBeLessThanOrEqual(totalPixels);
    if (packet & 0x80) {
      expect(at + bytesPerPixel, "run packet is complete").toBeLessThanOrEqual(tga.length);
      for (let i = 0; i < count; i++) {
        tga.copy(pixels, (decoded + i) * bytesPerPixel, at, at + bytesPerPixel);
      }
      at += bytesPerPixel;
    } else {
      const bytes = count * bytesPerPixel;
      expect(at + bytes, "raw packet is complete").toBeLessThanOrEqual(tga.length);
      tga.copy(pixels, decoded * bytesPerPixel, at, at + bytes);
      at += bytes;
    }
    decoded += count;
  }
  return { header, pixels };
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

function bigEntryByName(parsed: ParsedBig, name: string): BigEntry {
  const entry = parsed.entries.find((candidate) => candidate.name === name);
  expect(entry, `BIG entry ${name}`).toBeDefined();
  return entry as BigEntry;
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

// --- ZIP helpers -------------------------------------------------------------

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

async function entryBytes(opened: OpenedZip, path: string): Promise<Uint8Array> {
  return collect(entryStream(opened.blob, entryAt(opened.entries, path)));
}

async function expectValidCrcs(opened: OpenedZip, label: string): Promise<void> {
  for (const entry of opened.entries) {
    const bytes = await collect(entryStream(opened.blob, entry));
    expect(crc32(bytes), `${label} ${entry.path} crc`).toBe(entry.crc32);
    expect(bytes.length, `${label} ${entry.path} size`).toBe(entry.size);
  }
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array, label: string): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  expect(Buffer.compare(Buffer.from(actual), Buffer.from(expected)), `${label} bytes`).toBe(0);
}

function linesOf(result: RunResult): string[] {
  return `${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter((line) => line !== "");
}

function matchingLines(result: RunResult, pattern: RegExp): string[] {
  return linesOf(result).filter((line) => pattern.test(line));
}

function onlySummary(result: RunResult, pattern: RegExp, label: string): RegExpMatchArray {
  const lines = matchingLines(result, pattern);
  expect(lines, `one ${label} line: ${report(result)}`).toHaveLength(1);
  return lines[0].match(pattern) as RegExpMatchArray;
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

function bigArchive(name: string): Uint8Array {
  return buildBig([{ path: `data/${name}`, data: `synthetic bytes of ${name}` }]);
}

function expectMp3(
  bytes: Uint8Array,
  path: string,
  options: { channels: number; sampleRate: number; kbps: number; tolerance: number },
  label: string,
): void {
  expect(Buffer.from(bytes).subarray(0, 4).toString("latin1"), `${label} is raw MP3`).not.toBe(
    "RIFF",
  );
  writeFileSync(path, bytes);
  const stream = probe(path);
  expect(stream.codec_name, `${label} codec`).toBe("mp3");
  expect(stream.channels, `${label} channels`).toBe(options.channels);
  expect(Number(stream.sample_rate), `${label} sample rate`).toBe(options.sampleRate);
  expect(Number(stream.bit_rate), `${label} bit rate`).toBeGreaterThanOrEqual(
    options.kbps * 1000 - options.tolerance,
  );
  expect(Number(stream.bit_rate), `${label} bit rate`).toBeLessThanOrEqual(
    options.kbps * 1000 + options.tolerance,
  );
}

// --- Tests -------------------------------------------------------------------

test("7: --voices-mp3 48 stores the PCM and IMA ADPCM WAV entries as raw MP3 under the same names and keeps the other entries byte-identical", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  const fixtures = join(root, "fixtures");
  mkdirSync(out);
  mkdirSync(fixtures);

  const pcm = readFileSync(makePcm16Wav(join(fixtures, "pcm.wav"), { seconds: 3 }));
  const adpcm = readFileSync(makeAdpcmWav(join(fixtures, "adpcm.wav"), { seconds: 3 }));
  const eightBit = readFileSync(makePcm8Wav(join(fixtures, "eight.wav")));
  const notes = text("synthetic speech notes\n");

  const speech = buildBig([
    { path: "data/voice/pcm.wav", data: pcm },
    { path: "data/voice/adpcm.wav", data: adpcm },
    { path: "data/voice/notes.txt", data: notes },
    { path: "data/voice/eight-bit.wav", data: eightBit },
  ]);
  const textures = buildBig([
    { path: "data/voice/placeholder.wav", data: pcm },
    { path: "data/notes.txt", data: text("textures\n") },
  ]);
  writeSource(src, { "SpeechEnglish.big": speech, "Textures.big": textures });

  const result = await run(["--src", src, "--out", out, "--voices-mp3", "48"]);
  expect(result.status, report(result)).toBe(0);

  const opened = await readZip(join(out, "game.zip"));
  const recoded = await entryBytes(opened, "SpeechEnglish.big");
  const before = parseBigArchive(speech);
  const after = parseBigArchive(recoded);
  expect(after.entries.map((entry) => entry.name), "entry names and order").toEqual(
    before.entries.map((entry) => entry.name),
  );

  for (const [name, source] of [
    ["data/voice/pcm.wav", pcm],
    ["data/voice/adpcm.wav", adpcm],
  ] as const) {
    const bytes = bigEntryBytes(recoded, bigEntryByName(after, name));
    expectMp3(
      bytes,
      join(root, `${name.split("/").pop()}.mp3`),
      { channels: 1, sampleRate: SAMPLE_RATE, kbps: VOICES_KBPS, tolerance: BITRATE_TOLERANCE },
      name,
    );
    expect(bytes.length, `${name} shrank`).toBeLessThan(source.length);
  }

  expectSameBytes(
    bigEntryBytes(recoded, bigEntryByName(after, "data/voice/notes.txt")),
    notes,
    "notes.txt",
  );
  expectSameBytes(
    bigEntryBytes(recoded, bigEntryByName(after, "data/voice/eight-bit.wav")),
    eightBit,
    "8-bit WAV",
  );
  expectSameBytes(await entryBytes(opened, "Textures.big"), textures, "Textures.big");
});

test("8: with --recode-audio --voices-mp3 48 a 1-frame WAV falls back to ADPCM or stays original, and the MP3 is encoded from the original WAV", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  const fixtures = join(root, "fixtures");
  mkdirSync(out);
  mkdirSync(fixtures);

  const oneFramePath = makeOneFrameWav(join(fixtures, "one-frame.wav"));
  const oneFrame = readFileSync(oneFramePath);
  const tonePath = makeToneNoiseWav(join(fixtures, "tone.wav"), { seconds: 2 });
  const tone = readFileSync(tonePath);

  const speech = buildBig([
    { path: "data/voice/one-frame.wav", data: oneFrame },
    { path: "data/voice/tone.wav", data: tone },
    { path: "data/voice/notes.txt", data: text("fallback and originals\n") },
  ]);
  writeSource(src, { "SpeechEnglish.big": speech });

  const result = await run([
    "--src",
    src,
    "--out",
    out,
    "--recode-audio",
    "--voices-mp3",
    "48",
  ]);
  expect(result.status, report(result)).toBe(0);

  const opened = await readZip(join(out, "game.zip"));
  const recoded = await entryBytes(opened, "SpeechEnglish.big");
  const before = parseBigArchive(speech);
  const after = parseBigArchive(recoded);
  expect(after.entries.map((entry) => entry.name), "entry names and order").toEqual(
    before.entries.map((entry) => entry.name),
  );

  // A 1-frame WAV cannot shrink as MP3, so the entry is either the original
  // bytes or the IMA ADPCM recode; it must never become an MP3.
  const fallback = Buffer.from(
    bigEntryBytes(recoded, bigEntryByName(after, "data/voice/one-frame.wav")),
  );
  if (fallback.equals(oneFrame)) {
    expect(fallback.length, "the 1-frame WAV keeps its original bytes").toBe(oneFrame.length);
  } else {
    const wav = parseWav(fallback);
    expect(wav.tag, "the fallback is IMA ADPCM").toBe(0x0011);
    expect(wav.fact, "the fallback keeps the frame count").toBe(1);
  }

  const mp3 = bigEntryBytes(recoded, bigEntryByName(after, "data/voice/tone.wav"));
  const mp3Path = join(root, "tone.wav");
  expectMp3(
    mp3,
    mp3Path,
    { channels: 1, sampleRate: SAMPLE_RATE, kbps: VOICES_KBPS, tolerance: BITRATE_TOLERANCE },
    "tone.wav",
  );

  // The decoded MP3 must match the original PCM, not a signal that already
  // went through the lossy ADPCM encoder.
  const originalSamples = decodeMono(tonePath);
  const decodedSamples = decodeMono(mp3Path);
  expect(
    Math.abs(originalSamples.length - decodedSamples.length),
    `decoded ${decodedSamples.length} frames, original ${originalSamples.length} frames`,
  ).toBeLessThanOrEqual(FRAME_TOLERANCE);
  const frames = Math.min(originalSamples.length, decodedSamples.length);
  expect(frames, "both decodes contain audio").toBeGreaterThan(0);
  let signal = 0;
  let noise = 0;
  for (let i = 0; i < frames; i++) {
    const delta = originalSamples[i] - decodedSamples[i];
    signal += originalSamples[i] * originalSamples[i];
    noise += delta * delta;
  }
  expect(signal, "the source is not silent").toBeGreaterThan(0);
  expect(noise, "the decode is not identical to the source").toBeGreaterThan(0);
  const snr = 10 * Math.log10(signal / noise);
  expect(snr, `SNR against the original = ${snr.toFixed(2)} dB`).toBeGreaterThanOrEqual(
    MIN_SNR_DB,
  );
});

test("9: --voices-mp3 rejects 0, -5, 1.5 and abc with exit 2, and missing ffmpeg exits 2 writing nothing", async () => {
  const root = scratch();
  const src = join(root, "game");
  writeSource(src, {
    "SpeechEnglish.big": buildBig([
      { path: "data/voice/notes.txt", data: text("invalid bit rates\n") },
    ]),
    "keep.bin": sample(400, 5),
  });

  for (const [label, value] of [
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "1.5"],
    ["non-numeric", "abc"],
  ] as const) {
    const out = join(root, `out-${label}`);
    mkdirSync(out);
    const result = await run(["--src", src, "--out", out, "--voices-mp3", value]);
    expect(result.status, `${label} must exit 2: ${report(result)}`).toBe(2);
    expect(
      `${result.stdout}\n${result.stderr}`,
      `${label} must be handled by --voices-mp3, not by an unknown-option error: ${report(result)}`,
    ).not.toMatch(/unknown option/i);
    expect(readdirSync(out), `${label} writes nothing`).toEqual([]);
    expect(leftovers(out), `${label} leaves no temporary files`).toEqual([]);
  }

  // Hide both tools from the child: the run must refuse before packing.
  const emptyPath = join(root, "empty-path");
  mkdirSync(emptyPath);
  const outMissing = join(root, "out-missing-ffmpeg");
  mkdirSync(outMissing);
  const missing = await run(["--src", src, "--out", outMissing, "--voices-mp3", "48"], {
    ...envWithoutGameDir(),
    PATH: emptyPath,
  });
  expect(missing.status, `missing ffmpeg must exit 2: ${report(missing)}`).toBe(2);
  expect(
    `${missing.stdout}\n${missing.stderr}`,
    `the message names the missing tools: ${report(missing)}`,
  ).toMatch(/ffmpeg|ffprobe/i);
  expect(
    `${missing.stdout}\n${missing.stderr}`,
    `the option is known: ${report(missing)}`,
  ).not.toMatch(/unknown option/i);
  expect(readdirSync(outMissing), "missing ffmpeg writes nothing").toEqual([]);
  expect(leftovers(outMissing), "missing ffmpeg leaves no temporary files").toEqual([]);
});

test("10: the voices mp3 summary reports the WAV count, archives, kbps and saved bytes matching the archive size difference", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const root = scratch();
  const src = join(root, "game");
  const outPlain = join(root, "out-plain");
  const outVoices = join(root, "out-voices");
  const fixtures = join(root, "fixtures");
  for (const out of [outPlain, outVoices]) mkdirSync(out);
  mkdirSync(fixtures);

  // One eligible WAV per speech/audio archive, so the reported counts are
  // unambiguous; the 8-bit WAV is not eligible.
  const speech = buildBig([
    { path: "data/voice/pcm.wav", data: readFileSync(makePcm16Wav(join(fixtures, "speech.wav"), { seconds: 3 })) },
    { path: "data/voice/eight.wav", data: readFileSync(makePcm8Wav(join(fixtures, "speech-eight.wav"))) },
    { path: "data/voice/notes.txt", data: text("speech pack\n") },
  ]);
  const audio = buildBig([
    { path: "data/voice/pcm.wav", data: readFileSync(makePcm16Wav(join(fixtures, "audio.wav"), { seconds: 2 })) },
    { path: "data/voice/eight.wav", data: readFileSync(makePcm8Wav(join(fixtures, "audio-eight.wav"))) },
    { path: "data/voice/notes.txt", data: text("audio pack\n") },
  ]);
  const untouched = buildBig([
    { path: "data/voice/pcm.wav", data: readFileSync(makePcm16Wav(join(fixtures, "ini.wav"), { seconds: 1 })) },
  ]);
  writeSource(src, {
    "SpeechEnglish.big": speech,
    "AudioEnglish.big": audio,
    "INI.big": untouched,
    "readme.txt": text("summary math\n"),
  });

  const plain = await run(["--src", src, "--out", outPlain]);
  expect(plain.status, report(plain)).toBe(0);
  const voices = await run(["--src", src, "--out", outVoices, "--voices-mp3", "48"]);
  expect(voices.status, report(voices)).toBe(0);

  const plainZip = await readZip(join(outPlain, "game.zip"));
  const voicesZip = await readZip(join(outVoices, "game.zip"));
  const savedInArchives =
    entryAt(plainZip.entries, "SpeechEnglish.big").size +
    entryAt(plainZip.entries, "AudioEnglish.big").size -
    entryAt(voicesZip.entries, "SpeechEnglish.big").size -
    entryAt(voicesZip.entries, "AudioEnglish.big").size;
  expect(savedInArchives, "the speech archives are smaller").toBeGreaterThan(0);

  const summary = onlySummary(
    voices,
    /voices mp3:\s*(\d+)\s+wav\s+in\s+(\d+)\s+archives\s+at\s+(\d+)\s+kbps,\s+saved\s+(\d+)\s+bytes/i,
    "voices mp3",
  );
  expect(Number(summary[1]), "encoded WAV count").toBe(2);
  expect(Number(summary[2]), "rebuilt archive count").toBe(2);
  expect(Number(summary[3]), "target kbps").toBe(VOICES_KBPS);
  expect(Number(summary[4]), "saved bytes").toBe(savedInArchives);
  expect(Number(summary[4]), "saved bytes match the ZIP size difference").toBe(
    readFileSync(join(outPlain, "game.zip")).length -
      readFileSync(join(outVoices, "game.zip")).length,
  );
  expect(entryAt(voicesZip.entries, "INI.big").size, "non-speech archives stay untouched").toBe(
    entryAt(plainZip.entries, "INI.big").size,
  );
});

test("11: a truncated speech*.big exits 4 naming it, and a successful run leaves no ZIP, .partial or .recode-tmp while the source folder is unchanged", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const failureRoot = scratch();
  const failureSrc = join(failureRoot, "game");
  const failureOut = join(failureRoot, "out");
  const failureFixtures = join(failureRoot, "fixtures");
  mkdirSync(failureOut);
  mkdirSync(failureFixtures);
  const validSpeech = buildBig([
    {
      path: "data/voice/pcm.wav",
      data: readFileSync(makePcm16Wav(join(failureFixtures, "pcm.wav"), { seconds: 2 })),
    },
    { path: "data/voice/notes.txt", data: text("truncated\n") },
  ]);
  writeSource(failureSrc, {
    "Data/SpeechEnglish.big": validSpeech.subarray(0, validSpeech.length - 1),
    "keep.bin": sample(500, 3),
  });
  const failureBefore = snapshot(failureSrc);
  const failure = await run([
    "--src",
    failureSrc,
    "--out",
    failureOut,
    "--voices-mp3",
    "48",
  ]);
  expect(failure.status, report(failure)).toBe(4);
  expect(
    `${failure.stdout}\n${failure.stderr}`,
    `the error names the corrupt archive: ${report(failure)}`,
  ).toContain("SpeechEnglish.big");
  expect(readdirSync(failureOut), "the failed run wrote nothing").toEqual([]);
  expect(leftovers(failureOut), "no .recode-tmp folder or .partial file").toEqual([]);
  expect(existsSync(join(failureOut, ".recode-tmp")), ".recode-tmp is absent").toBe(false);
  expect(snapshot(failureSrc), "the source after a failed run").toEqual(failureBefore);

  const successRoot = scratch();
  const successSrc = join(successRoot, "game");
  const successOut = join(successRoot, "out");
  const successFixtures = join(successRoot, "fixtures");
  mkdirSync(successOut);
  mkdirSync(successFixtures);
  writeSource(successSrc, {
    "SpeechEnglish.big": buildBig([
      {
        path: "data/voice/pcm.wav",
        data: readFileSync(makePcm16Wav(join(successFixtures, "pcm.wav"), { seconds: 2 })),
      },
      { path: "data/voice/notes.txt", data: text("successful\n") },
    ]),
    "keep.bin": sample(500, 4),
  });
  const successBefore = snapshot(successSrc);
  const success = await run([
    "--src",
    successSrc,
    "--out",
    successOut,
    "--voices-mp3",
    "48",
  ]);
  expect(success.status, report(success)).toBe(0);
  expect(readdirSync(successOut), "only the finished ZIP remains").toEqual(["game.zip"]);
  expect(leftovers(successOut), "no .recode-tmp folder or .partial file").toEqual([]);
  expect(existsSync(join(successOut, ".recode-tmp")), ".recode-tmp is absent").toBe(false);
  expect(snapshot(successSrc), "the source after a successful run").toEqual(successBefore);
});

test("12: --split with --no-videos --recode-audio --tga-rle --music-kbps 128 --voices-mp3 48 writes both ZIPs with valid CRCs and their REQUIRED archives", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  const fixtures = join(root, "fixtures");
  mkdirSync(out);
  mkdirSync(fixtures);

  const high = readFileSync(
    makeMp3(join(fixtures, "high-192.mp3"), { kbps: 192, channels: 2 }),
  );
  const low = readFileSync(
    makeMp3(join(fixtures, "low-64.mp3"), { kbps: 64, channels: 1 }),
  );
  const voice = readFileSync(makePcm16Wav(join(fixtures, "voice.wav"), { seconds: 2 }));

  // One archive touched by all three .big transforms: TGA, MP3 and WAV entries.
  const combo = buildBig([
    { path: "art/combo.tga", data: FLAT_TGA },
    { path: "music/combo.mp3", data: high },
    { path: "voice/combo.wav", data: voice },
    { path: "voice/combo.txt", data: text("combination\n") },
  ]);
  const generalsSpeech = buildBig([
    { path: "voice/generals.wav", data: voice },
    { path: "voice/notes.txt", data: text("generals speech\n") },
  ]);
  const textures = buildBig([
    { path: "art/zh.tga", data: FLAT_TGA },
    { path: "art/zh.bin", data: sample(256, 21) },
  ]);
  const music = buildBig([
    { path: "music/zh-high.mp3", data: high },
    { path: "music/zh-low.mp3", data: low },
  ]);

  const generalsIni = bigArchive("INI.big");
  const generalsW3d = bigArchive("W3D.big");
  const zhIni = bigArchive("INIZH.big");
  const zhW3d = bigArchive("W3DZH.big");
  writeSource(src, {
    "INI.big": generalsIni,
    "W3D.big": generalsW3d,
    "SpeechEnglish.big": generalsSpeech,
    "Movies/intro.bik": sample(1000, 1),
    "Data/generals.bin": sample(700, 2),
    "Zero Hour/INIZH.big": zhIni,
    "Zero Hour/W3DZH.big": zhW3d,
    "Zero Hour/Textures.big": textures,
    "Zero Hour/Music.big": music,
    "Zero Hour/AudioEnglish.big": combo,
    "Zero Hour/Movies/credits.bik": sample(512, 3),
    "Zero Hour/Data/zh.bin": sample(900, 4),
  });

  const result = await run([
    "--src",
    src,
    "--out",
    out,
    "--split",
    "--no-videos",
    "--recode-audio",
    "--tga-rle",
    "--music-kbps",
    "128",
    "--voices-mp3",
    "48",
  ]);
  expect(result.status, report(result)).toBe(0);
  expect(readdirSync(out).sort(), "both ZIPs and nothing else").toEqual([
    "generals.zip",
    "zero-hour.zip",
  ]);
  expect(leftovers(out), "no .recode-tmp folder or .partial file").toEqual([]);

  for (const [name, required] of [
    ["zero-hour.zip", ["Zero Hour/INIZH.big", "Zero Hour/W3DZH.big"]],
    ["generals.zip", ["INI.big", "W3D.big"]],
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
    await expectValidCrcs(opened, name);
  }

  const zh = await readZip(join(out, "zero-hour.zip"));

  const texturesOut = await entryBytes(zh, "Zero Hour/Textures.big");
  const texturesAfter = parseBigArchive(texturesOut);
  expect(
    decodeTgaRle(
      Buffer.from(bigEntryBytes(texturesOut, bigEntryByName(texturesAfter, "art/zh.tga"))),
    ).pixels,
    "Textures.big TGA pixels",
  ).toEqual(FLAT_PIXELS);

  const musicOut = await entryBytes(zh, "Zero Hour/Music.big");
  const musicAfter = parseBigArchive(musicOut);
  expectMp3(
    bigEntryBytes(musicOut, bigEntryByName(musicAfter, "music/zh-high.mp3")),
    join(root, "zh-high-at-128.mp3"),
    {
      channels: 2,
      sampleRate: MP3_SAMPLE_RATE,
      kbps: MUSIC_KBPS,
      tolerance: MUSIC_BITRATE_TOLERANCE,
    },
    "Music.big high MP3",
  );
  expectSameBytes(
    bigEntryBytes(musicOut, bigEntryByName(musicAfter, "music/zh-low.mp3")),
    low,
    "Music.big low MP3",
  );

  const comboOut = await entryBytes(zh, "Zero Hour/AudioEnglish.big");
  const comboAfter = parseBigArchive(comboOut);
  const comboBefore = parseBigArchive(combo);
  expect(comboAfter.entries.map((entry) => entry.name), "combo entry names and order").toEqual(
    comboBefore.entries.map((entry) => entry.name),
  );
  expect(
    decodeTgaRle(
      Buffer.from(bigEntryBytes(comboOut, bigEntryByName(comboAfter, "art/combo.tga"))),
    ).pixels,
    "combo TGA pixels",
  ).toEqual(FLAT_PIXELS);
  expectMp3(
    bigEntryBytes(comboOut, bigEntryByName(comboAfter, "music/combo.mp3")),
    join(root, "combo-at-128.mp3"),
    {
      channels: 2,
      sampleRate: MP3_SAMPLE_RATE,
      kbps: MUSIC_KBPS,
      tolerance: MUSIC_BITRATE_TOLERANCE,
    },
    "combo MP3",
  );
  expectMp3(
    bigEntryBytes(comboOut, bigEntryByName(comboAfter, "voice/combo.wav")),
    join(root, "combo-voice.wav"),
    { channels: 1, sampleRate: SAMPLE_RATE, kbps: VOICES_KBPS, tolerance: BITRATE_TOLERANCE },
    "combo voice WAV",
  );
  expectSameBytes(
    bigEntryBytes(comboOut, bigEntryByName(comboAfter, "voice/combo.txt")),
    text("combination\n"),
    "combo .txt",
  );

  const generals = await readZip(join(out, "generals.zip"));
  const generalsSpeechOut = await entryBytes(generals, "SpeechEnglish.big");
  const generalsSpeechAfter = parseBigArchive(generalsSpeechOut);
  expectMp3(
    bigEntryBytes(generalsSpeechOut, bigEntryByName(generalsSpeechAfter, "voice/generals.wav")),
    join(root, "generals-voice.wav"),
    { channels: 1, sampleRate: SAMPLE_RATE, kbps: VOICES_KBPS, tolerance: BITRATE_TOLERANCE },
    "generals speech WAV",
  );

  const voicesSummary = onlySummary(
    result,
    /voices mp3:\s*(\d+)\s+wav\s+in\s+(\d+)\s+archives\s+at\s+(\d+)\s+kbps,\s+saved\s+(\d+)\s+bytes/i,
    "voices mp3",
  );
  expect(Number(voicesSummary[1]), "voices WAV count").toBe(2);
  expect(Number(voicesSummary[2]), "voices archive count").toBe(2);
  expect(Number(voicesSummary[3]), "voices kbps").toBe(VOICES_KBPS);

  const musicSummary = onlySummary(
    result,
    /music:\s*(\d+)\s+mp3\s+re-encoded\s+at\s+(\d+)\s+kbps\s+in\s+(\d+)\s+archives?,\s+saved\s+(\d+)\s+bytes/i,
    "music",
  );
  expect(Number(musicSummary[1]), "MP3 count").toBe(2);
  expect(Number(musicSummary[2]), "MP3 kbps").toBe(MUSIC_KBPS);
  expect(Number(musicSummary[3]), "MP3 archive count").toBe(2);

  const rleSummary = onlySummary(
    result,
    /rle textures:\s*(\d+)\s+tga\s+in\s+(\d+)\s+archives?,\s+saved\s+(\d+)\s+bytes/i,
    "rle textures",
  );
  expect(Number(rleSummary[1]), "TGA count").toBe(2);
  expect(Number(rleSummary[2]), "TGA archive count").toBe(2);
});
