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

// Contract of scripts/make-game-zip.mjs --tga-rle and --music-kbps
// (docs/briefs/167-make-game-zip-gfx-music.md).
//
// Node-side tests: the tool is spawned as a child process against synthetic
// source folders created in a temporary directory. TGAs, BIG archives and WAVs
// are built here; MP3 fixtures are generated with ffmpeg. No real game data is
// used and nothing is written inside the repository.
//
// Criterion 10 (the existing make-game-zip and make-game-zip-options specs
// still pass) is covered by the brief's check command, which runs them next
// to this file.

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(TESTS_DIR, "..");
const SCRIPT = join(WEB_ROOT, "scripts", "make-game-zip.mjs");

const SAMPLE_RATE = 22050;
const MP3_SAMPLE_RATE = 44100;
const MP3_SECONDS = 2;
const MUSIC_KBPS = 128;
const BITRATE_TOLERANCE = 2000;

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
  const dir = mkdtempSync(join(tmpdir(), "zhwp-make-game-zip-gfx-music-"));
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

// A DDS-like blob: the magic plus synthetic bytes. The maker script treats
// every non-TGA entry as opaque and must never touch it.
function ddsBlob(seed: number): Buffer {
  const bytes = Buffer.alloc(256);
  bytes.write("DDS ", 0, "ascii");
  for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 53 + seed) & 0xff;
  return bytes;
}

// --- Synthetic TGA files -----------------------------------------------------

const TGA_HEADER_BYTES = 18;
const IMAGE_TYPE_UNCOMPRESSED = 2;
const IMAGE_TYPE_RLE = 10;

interface TgaHeader {
  idLength: number;
  colorMapType: number;
  imageType: number;
  width: number;
  height: number;
  pixelDepth: number;
  descriptor: number;
}

function readTgaHeader(tga: Buffer): TgaHeader {
  expect(tga.length, "TGA has an 18-byte header").toBeGreaterThanOrEqual(TGA_HEADER_BYTES);
  return {
    idLength: tga.readUInt8(0),
    colorMapType: tga.readUInt8(1),
    imageType: tga.readUInt8(2),
    width: tga.readUInt16LE(12),
    height: tga.readUInt16LE(14),
    pixelDepth: tga.readUInt8(16),
    descriptor: tga.readUInt8(17),
  };
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

// An uncompressed true-colour TGA (image type 2), eligible for RLE.
function buildTga(width: number, height: number, pixels: Buffer): Buffer {
  const header = Buffer.alloc(TGA_HEADER_BYTES);
  header.writeUInt8(0, 0); // no image ID
  header.writeUInt8(0, 1); // no colour map
  header.writeUInt8(IMAGE_TYPE_UNCOMPRESSED, 2);
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header.writeUInt8(24, 16); // 24 bits per pixel
  header.writeUInt8(0x20, 17); // top-left origin
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

// 64x64 where every adjacent pixel differs, so RLE would grow it: the entry
// must keep its original bytes.
const NOISY_PIXELS = makePixels(64, 64, 24, (x, y) => {
  const pixel = y * 64 + x;
  return [(pixel * 73 + 11) & 0xff, (pixel * 151 + 29) & 0xff, (pixel * 199 + 47) & 0xff];
});
const NOISY_TGA = buildTga(64, 64, NOISY_PIXELS);

interface DecodedTga {
  header: TgaHeader;
  pixels: Buffer;
}

// Independent reference decoder for a standard TGA type 10 file. A packet that
// crosses a scanline is an error, as the TGA spec forbids it.
function decodeTgaRle(tga: Buffer): DecodedTga {
  const header = readTgaHeader(tga);
  expect(header.imageType, "output image type").toBe(IMAGE_TYPE_RLE);
  expect([24, 32], "output pixel depth").toContain(header.pixelDepth);
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

// --- Synthetic WAV files (only for --recode-audio in the combined test) ------

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

function wavFmt(): Buffer {
  const channels = 1;
  const bits = 16;
  const blockAlign = (channels * bits) / 8;
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(SAMPLE_RATE, 4);
  fmt.writeUInt32LE(SAMPLE_RATE * blockAlign, 8);
  fmt.writeUInt16LE(blockAlign, 12);
  fmt.writeUInt16LE(bits, 14);
  return fmt;
}

// Mono 16-bit PCM, long enough that IMA ADPCM is much smaller than the input.
function pcm16Wav(frames: number): Buffer {
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const tone = 12000 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    const value = Math.round(tone) + (((i * 7) % 9) - 4);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2);
  }
  return wavFile([
    ["fmt ", wavFmt()],
    ["data", data],
  ]);
}

interface ParsedWav {
  tag: number;
  fact: number | undefined;
}

function parseWav(bytes: Uint8Array): ParsedWav {
  const wav = Buffer.from(bytes);
  expect(wav.toString("ascii", 0, 4), "RIFF").toBe("RIFF");
  expect(wav.toString("ascii", 8, 12), "WAVE").toBe("WAVE");
  let fmt: Buffer | undefined;
  let fact: number | undefined;
  let at = 12;
  while (at + 8 <= wav.length) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const start = at + 8;
    expect(start + size, `${id} chunk fits`).toBeLessThanOrEqual(wav.length);
    if (id === "fmt ") fmt = wav.subarray(start, start + size);
    else if (id === "fact" && size >= 4) fact = wav.readUInt32LE(start);
    at = start + size + (size & 1);
  }
  expect(fmt, "fmt chunk").toBeDefined();
  return { tag: fmt!.readUInt16LE(0), fact };
}

// --- Synthetic MP3 files (ffmpeg) --------------------------------------------

function makeMp3(
  path: string,
  options: { kbps: number; channels: 1 | 2; seconds?: number },
): Buffer {
  const { kbps, channels, seconds = MP3_SECONDS } = options;
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-v",
      "error",
      "-y",
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
    { encoding: "utf8" },
  );
  expect(result.status, `ffmpeg could not generate ${path}: ${result.stderr}`).toBe(0);
  return readFileSync(path);
}

interface ProbedStream {
  codec_name?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
}

function probeMp3(path: string): ProbedStream {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,bit_rate,channels,sample_rate",
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

function onlySummary(
  result: RunResult,
  pattern: RegExp,
  label: string,
): RegExpMatchArray {
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

// --- Tests -------------------------------------------------------------------

test("1: without the new flags every ZIP entry is byte-identical to its source file, including .big archives that hold TGAs and MP3s", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const texturesBig = buildBig([
    { path: "data/flat.tga", data: FLAT_TGA },
    { path: "data/logo.dds", data: ddsBlob(3) },
    { path: "data/readme.txt", data: text("no flags\n") },
  ]);
  const musicBig = buildBig([
    { path: "music/pending.mp3", data: sample(2048, 9) },
    { path: "music/notes.txt", data: text("music is opaque without the flag\n") },
  ]);
  const expected = new Map<string, Uint8Array>([
    ["Textures.big", texturesBig],
    ["Music.big", musicBig],
    ["Movies/intro.bik", sample(1024, 1)],
    ["readme.txt", text("the whole folder is packed\n")],
  ]);
  writeSource(src, Object.fromEntries(expected));

  const result = await run(["--src", src, "--out", out]);
  expect(result.status, report(result)).toBe(0);
  expect(readdirSync(out), "one finished archive and no partial file").toEqual(["game.zip"]);

  const opened = await readZip(join(out, "game.zip"));
  await expectArchiveMatches(opened, expected, "game.zip");
  expect(matchingLines(result, /rle textures:/i), "no rle line without the flag").toEqual([]);
  expect(matchingLines(result, /^music:/i), "no music line without the flag").toEqual([]);
});

test("2: --tga-rle turns a flat TGA in Textures.big into type 10 with the same pixels and keeps the noisy TGA, DDS and .txt byte-identical", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const texturesBig = buildBig([
    { path: "data/flat.tga", data: FLAT_TGA },
    { path: "data/noisy.tga", data: NOISY_TGA },
    { path: "data/logo.dds", data: ddsBlob(7) },
    { path: "data/readme.txt", data: text("archive notes\n") },
  ]);
  writeSource(src, {
    "Textures.big": texturesBig,
    "keep.bin": sample(700, 2),
  });

  const result = await run(["--src", src, "--out", out, "--tga-rle"]);
  expect(result.status, report(result)).toBe(0);

  const opened = await readZip(join(out, "game.zip"));
  const recoded = await entryBytes(opened, "Textures.big");
  expectSameBytes(await entryBytes(opened, "keep.bin"), sample(700, 2), "keep.bin");

  const before = parseBigArchive(texturesBig);
  const after = parseBigArchive(recoded);
  expect(after.entries.map((entry) => entry.name), "entry names and order").toEqual(
    before.entries.map((entry) => entry.name),
  );

  const flatEntry = bigEntryByName(after, "data/flat.tga");
  const flat = bigEntryBytes(recoded, flatEntry);
  const decoded = decodeTgaRle(Buffer.from(flat));
  expect(decoded.pixels, "flat TGA pixels round-trip bit for bit").toEqual(FLAT_PIXELS);
  expect(flat.length, "the flat TGA shrank").toBeLessThan(FLAT_TGA.length);

  expectSameBytes(
    bigEntryBytes(recoded, bigEntryByName(after, "data/noisy.tga")),
    NOISY_TGA,
    "noisy TGA keeps its bytes",
  );
  expectSameBytes(
    bigEntryBytes(recoded, bigEntryByName(after, "data/logo.dds")),
    ddsBlob(7),
    "DDS entry keeps its bytes",
  );
  expectSameBytes(
    bigEntryBytes(recoded, bigEntryByName(after, "data/readme.txt")),
    text("archive notes\n"),
    ".txt entry keeps its bytes",
  );
});

test("3: --tga-rle encodes TGAs in any archive name and packs .big archives without TGA entries byte-identical", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const noTga = buildBig([
    { path: "data/logo.dds", data: ddsBlob(11) },
    { path: "data/readme.txt", data: text("no textures here\n") },
  ]);
  const lowerTga = buildBig([
    { path: "art/first.tga", data: FLAT_TGA },
    { path: "art/other.dds", data: ddsBlob(12) },
  ]);
  const upperTga = buildBig([
    { path: "art/SECOND.TGA", data: FLAT_TGA },
    { path: "art/notes.txt", data: text("uppercase extension\n") },
  ]);
  writeSource(src, {
    "INI.big": noTga,
    "W3D.big": lowerTga,
    "Sounds.big": upperTga,
  });

  const result = await run(["--src", src, "--out", out, "--tga-rle"]);
  expect(result.status, report(result)).toBe(0);

  const opened = await readZip(join(out, "game.zip"));
  expectSameBytes(await entryBytes(opened, "INI.big"), noTga, "archive without TGA entries");

  for (const [archivePath, entryName, original] of [
    ["W3D.big", "art/first.tga", lowerTga],
    ["Sounds.big", "art/SECOND.TGA", upperTga],
  ] as const) {
    const recoded = await entryBytes(opened, archivePath);
    const before = parseBigArchive(original);
    const after = parseBigArchive(recoded);
    expect(after.entries.map((entry) => entry.name), `${archivePath} entry names`).toEqual(
      before.entries.map((entry) => entry.name),
    );
    const tga = bigEntryBytes(recoded, bigEntryByName(after, entryName));
    expect(decodeTgaRle(Buffer.from(tga)).pixels, `${archivePath} ${entryName} pixels`).toEqual(
      FLAT_PIXELS,
    );
  }
  const w3dOut = await entryBytes(opened, "W3D.big");
  const w3dAfter = parseBigArchive(w3dOut);
  expectSameBytes(
    bigEntryBytes(w3dOut, bigEntryByName(w3dAfter, "art/other.dds")),
    ddsBlob(12),
    "non-TGA entry in an encoded archive",
  );
});

test("4: the rle textures summary reports the TGA count, archive count and saved bytes matching the archive size difference", async () => {
  const root = scratch();
  const src = join(root, "game");
  const outDefault = join(root, "out-default");
  const outRle = join(root, "out-rle");
  for (const out of [outDefault, outRle]) mkdirSync(out);

  // One encodable TGA per archive, so the counts are unambiguous.
  writeSource(src, {
    "Textures.big": buildBig([
      { path: "art/flat.tga", data: FLAT_TGA },
      { path: "art/notes.txt", data: text("textures\n") },
    ]),
    "Art.big": buildBig([
      { path: "art/second.tga", data: FLAT_TGA },
      { path: "art/readme.txt", data: text("art\n") },
    ]),
    "keep.bin": sample(500, 4),
  });

  const plain = await run(["--src", src, "--out", outDefault]);
  expect(plain.status, report(plain)).toBe(0);
  const rle = await run(["--src", src, "--out", outRle, "--tga-rle"]);
  expect(rle.status, report(rle)).toBe(0);

  const plainZip = await readZip(join(outDefault, "game.zip"));
  const rleZip = await readZip(join(outRle, "game.zip"));
  const savedInArchives =
    entryAt(plainZip.entries, "Textures.big").size +
    entryAt(plainZip.entries, "Art.big").size -
    entryAt(rleZip.entries, "Textures.big").size -
    entryAt(rleZip.entries, "Art.big").size;
  expect(savedInArchives, "the RLE archives are smaller").toBeGreaterThan(0);

  const summary = onlySummary(
    rle,
    /rle textures:\s*(\d+)\s+tga\s+in\s+(\d+)\s+archives?,\s+saved\s+(\d+)\s+bytes/i,
    "rle textures",
  );
  expect(Number(summary[1]), "TGA count").toBe(2);
  expect(Number(summary[2]), "archive count").toBe(2);
  expect(Number(summary[3]), "saved bytes").toBe(savedInArchives);
  expect(Number(summary[3]), "saved bytes match the ZIP size difference").toBe(
    readFileSync(join(outDefault, "game.zip")).length - readFileSync(join(outRle, "game.zip")).length,
  );
});

test("5: --music-kbps 128 re-encodes the 192 kbps MP3 in Music.big at 128 kbps and keeps the 64 kbps MP3 and .txt byte-identical", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  const fixtures = join(root, "fixtures");
  mkdirSync(out);
  mkdirSync(fixtures);

  const high = makeMp3(join(fixtures, "high-192.mp3"), { kbps: 192, channels: 2 });
  const low = makeMp3(join(fixtures, "low-64.mp3"), { kbps: 64, channels: 1 });
  const notes = text("music notes\n");
  const musicBig = buildBig([
    { path: "music/high.mp3", data: high },
    { path: "music/low.mp3", data: low },
    { path: "music/readme.txt", data: notes },
  ]);
  writeSource(src, { "Music.big": musicBig });

  const result = await run(["--src", src, "--out", out, "--music-kbps", "128"]);
  expect(result.status, report(result)).toBe(0);

  const opened = await readZip(join(out, "game.zip"));
  const recoded = await entryBytes(opened, "Music.big");
  const before = parseBigArchive(musicBig);
  const after = parseBigArchive(recoded);
  expect(after.entries.map((entry) => entry.name), "entry names and order").toEqual(
    before.entries.map((entry) => entry.name),
  );

  const highBytes = bigEntryBytes(recoded, bigEntryByName(after, "music/high.mp3"));
  const highPath = join(root, "high-at-128.mp3");
  writeFileSync(highPath, highBytes);
  const stream = probeMp3(highPath);
  expect(stream.codec_name, "re-encoded codec").toBe("mp3");
  expect(Number(stream.bit_rate), "re-encoded bit rate").toBeGreaterThanOrEqual(
    MUSIC_KBPS * 1000 - BITRATE_TOLERANCE,
  );
  expect(Number(stream.bit_rate), "re-encoded bit rate").toBeLessThanOrEqual(
    MUSIC_KBPS * 1000 + BITRATE_TOLERANCE,
  );
  expect(highBytes.length, "the re-encoded MP3 shrank").toBeLessThan(high.length);

  expectSameBytes(
    bigEntryBytes(recoded, bigEntryByName(after, "music/low.mp3")),
    low,
    "64 kbps MP3 keeps its bytes",
  );
  expectSameBytes(
    bigEntryBytes(recoded, bigEntryByName(after, "music/readme.txt")),
    notes,
    ".txt entry keeps its bytes",
  );

  const savedInArchive = musicBig.length - recoded.length;
  expect(savedInArchive, "the archive is smaller").toBeGreaterThan(0);
  const summary = onlySummary(
    result,
    /music:\s*(\d+)\s+mp3\s+re-encoded\s+at\s+(\d+)\s+kbps\s+in\s+(\d+)\s+archives?,\s+saved\s+(\d+)\s+bytes/i,
    "music",
  );
  expect(Number(summary[1]), "re-encoded MP3 count").toBe(1);
  expect(Number(summary[2]), "target bit rate").toBe(MUSIC_KBPS);
  expect(Number(summary[3]), "archive count").toBe(1);
  expect(Number(summary[4]), "saved bytes").toBe(savedInArchive);
});

test("6: --music-kbps rejects 0, -5, 1.5 and abc with exit 2 and exits 2 writing nothing when ffmpeg is missing", async () => {
  const root = scratch();
  const src = join(root, "game");
  writeSource(src, {
    "Music.big": buildBig([
      { path: "music/high.mp3", data: sample(2048, 6) },
      { path: "music/readme.txt", data: text("invalid bit rates\n") },
    ]),
  });

  for (const [label, value] of [
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "1.5"],
    ["non-numeric", "abc"],
  ] as const) {
    const out = join(root, `out-${label}`);
    mkdirSync(out);
    const result = await run(["--src", src, "--out", out, "--music-kbps", value]);
    expect(result.status, `${label} must exit 2: ${report(result)}`).toBe(2);
    expect(readdirSync(out), `${label} writes nothing`).toEqual([]);
    expect(leftovers(out), `${label} leaves no temporary files`).toEqual([]);
  }

  // Hide both tools from the child: the run must refuse before packing.
  const emptyPath = join(root, "empty-path");
  mkdirSync(emptyPath);
  const outMissing = join(root, "out-missing-ffmpeg");
  mkdirSync(outMissing);
  const missing = await run(["--src", src, "--out", outMissing, "--music-kbps", "128"], {
    ...envWithoutGameDir(),
    PATH: emptyPath,
  });
  expect(missing.status, `missing ffmpeg must exit 2: ${report(missing)}`).toBe(2);
  expect(
    `${missing.stdout}\n${missing.stderr}`,
    `the message names the missing tools: ${report(missing)}`,
  ).toMatch(/ffmpeg|ffprobe/i);
  expect(readdirSync(outMissing), "missing ffmpeg writes nothing").toEqual([]);
  expect(leftovers(outMissing), "missing ffmpeg leaves no temporary files").toEqual([]);
});

test("7: --tga-rle --music-kbps 128 --recode-audio --no-videos --split writes both ZIPs with valid CRCs and rewrites an archive touched by several flags once", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  const fixtures = join(root, "fixtures");
  mkdirSync(out);
  mkdirSync(fixtures);

  const high = makeMp3(join(fixtures, "high-192.mp3"), { kbps: 192, channels: 2 });
  const low = makeMp3(join(fixtures, "low-64.mp3"), { kbps: 64, channels: 1 });
  const frames = 4096;
  const wav = pcm16Wav(frames);

  // One archive touched by all three transforms: TGA, MP3 and WAV entries.
  const combo = buildBig([
    { path: "art/combo.tga", data: FLAT_TGA },
    { path: "music/combo.mp3", data: high },
    { path: "voice/combo.wav", data: wav },
    { path: "voice/combo.txt", data: text("combination\n") },
  ]);
  const textures = buildBig([
    { path: "art/zh.tga", data: FLAT_TGA },
    { path: "art/zh.dds", data: ddsBlob(21) },
  ]);
  const music = buildBig([
    { path: "music/zh-high.mp3", data: high },
    { path: "music/zh-low.mp3", data: low },
  ]);
  const generlsIni = buildBig([{ path: "data/ini.txt", data: text("ini\n") }]);
  const generlsW3d = buildBig([{ path: "art/terrain.dds", data: ddsBlob(22) }]);
  const zhIni = buildBig([{ path: "data/inizh.txt", data: text("inizh\n") }]);
  const zhW3d = buildBig([{ path: "art/zh-terrain.dds", data: ddsBlob(23) }]);

  const generals = new Map<string, Uint8Array>([
    ["INI.big", generlsIni],
    ["W3D.big", generlsW3d],
    ["Movies/intro.bik", sample(1000, 1)],
    ["Data/generals.bin", sample(700, 2)],
  ]);
  const zeroHour = new Map<string, Uint8Array>([
    ["Zero Hour/INIZH.big", zhIni],
    ["Zero Hour/W3DZH.big", zhW3d],
    ["Zero Hour/Textures.big", textures],
    ["Zero Hour/Music.big", music],
    ["Zero Hour/AudioEnglish.big", combo],
    ["Zero Hour/Movies/credits.bik", sample(512, 3)],
    ["Zero Hour/Data/zh.bin", sample(900, 4)],
  ]);
  writeSource(src, Object.fromEntries([...generals, ...zeroHour]));

  const result = await run([
    "--src",
    src,
    "--out",
    out,
    "--tga-rle",
    "--music-kbps",
    "128",
    "--recode-audio",
    "--no-videos",
    "--split",
  ]);
  expect(result.status, report(result)).toBe(0);
  expect(readdirSync(out).sort(), "both ZIPs and nothing else").toEqual([
    "generals.zip",
    "zero-hour.zip",
  ]);
  expect(leftovers(out), "no .recode-tmp folder or .partial file").toEqual([]);

  // Archives that no flag touches stay byte-identical.
  for (const [zipName, archivePath, original] of [
    ["generals.zip", "INI.big", generlsIni],
    ["generals.zip", "W3D.big", generlsW3d],
    ["zero-hour.zip", "Zero Hour/INIZH.big", zhIni],
    ["zero-hour.zip", "Zero Hour/W3DZH.big", zhW3d],
  ] as const) {
    const opened = await readZip(join(out, zipName));
    expectSameBytes(await entryBytes(opened, archivePath), original, `${zipName} ${archivePath}`);
  }

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
  expectSameBytes(
    bigEntryBytes(texturesOut, bigEntryByName(texturesAfter, "art/zh.dds")),
    ddsBlob(21),
    "Textures.big DDS",
  );

  const musicOut = await entryBytes(zh, "Zero Hour/Music.big");
  const musicAfter = parseBigArchive(musicOut);
  const zhHighPath = join(root, "zh-high-at-128.mp3");
  writeFileSync(zhHighPath, bigEntryBytes(musicOut, bigEntryByName(musicAfter, "music/zh-high.mp3")));
  expect(Number(probeMp3(zhHighPath).bit_rate), "Music.big high bit rate").toBeGreaterThanOrEqual(
    MUSIC_KBPS * 1000 - BITRATE_TOLERANCE,
  );
  expectSameBytes(
    bigEntryBytes(musicOut, bigEntryByName(musicAfter, "music/zh-low.mp3")),
    low,
    "Music.big low MP3",
  );

  // The archive touched by --tga-rle, --music-kbps and --recode-audio comes out
  // as one archive with every transform applied to its own entries.
  const comboOut = await entryBytes(zh, "Zero Hour/AudioEnglish.big");
  const comboAfter = parseBigArchive(comboOut);
  const comboBefore = parseBigArchive(combo);
  expect(comboAfter.entries.map((entry) => entry.name), "combo entry names and order").toEqual(
    comboBefore.entries.map((entry) => entry.name),
  );
  expect(
    decodeTgaRle(Buffer.from(bigEntryBytes(comboOut, bigEntryByName(comboAfter, "art/combo.tga"))))
      .pixels,
    "combo TGA pixels",
  ).toEqual(FLAT_PIXELS);
  const comboMp3Path = join(root, "combo-at-128.mp3");
  writeFileSync(
    comboMp3Path,
    bigEntryBytes(comboOut, bigEntryByName(comboAfter, "music/combo.mp3")),
  );
  expect(Number(probeMp3(comboMp3Path).bit_rate), "combo MP3 bit rate").toBeGreaterThanOrEqual(
    MUSIC_KBPS * 1000 - BITRATE_TOLERANCE,
  );
  expect(Number(probeMp3(comboMp3Path).bit_rate), "combo MP3 bit rate").toBeLessThanOrEqual(
    MUSIC_KBPS * 1000 + BITRATE_TOLERANCE,
  );
  const comboWav = parseWav(bigEntryBytes(comboOut, bigEntryByName(comboAfter, "voice/combo.wav")));
  expect(comboWav.tag, "combo WAV format tag").toBe(0x0011);
  expect(comboWav.fact, "combo WAV frame count").toBe(frames);
  expectSameBytes(
    bigEntryBytes(comboOut, bigEntryByName(comboAfter, "voice/combo.txt")),
    text("combination\n"),
    "combo .txt",
  );

  const rleSummary = onlySummary(
    result,
    /rle textures:\s*(\d+)\s+tga\s+in\s+(\d+)\s+archives?,\s+saved\s+(\d+)\s+bytes/i,
    "rle textures",
  );
  expect(Number(rleSummary[1]), "TGA count").toBe(2);
  expect(Number(rleSummary[2]), "TGA archive count").toBe(2);
  const musicSummary = onlySummary(
    result,
    /music:\s*(\d+)\s+mp3\s+re-encoded\s+at\s+(\d+)\s+kbps\s+in\s+(\d+)\s+archives?,\s+saved\s+(\d+)\s+bytes/i,
    "music",
  );
  expect(Number(musicSummary[1]), "MP3 count").toBe(2);
  expect(Number(musicSummary[2]), "MP3 target bit rate").toBe(MUSIC_KBPS);
  expect(Number(musicSummary[3]), "MP3 archive count").toBe(2);
  const audioSummary = onlySummary(
    result,
    /recoded audio:\s*(\d+)\s+wav\s+in\s+(\d+)\s+archives?,\s+saved\s+(\d+)\s+bytes/i,
    "recoded audio",
  );
  expect(Number(audioSummary[1]), "WAV count").toBe(1);
  expect(Number(audioSummary[2]), "WAV archive count").toBe(1);
});

test("8: a truncated .big exits 4 naming it and leaves no ZIP, .partial or .recode-tmp with --tga-rle", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const valid = buildBig([
    { path: "art/flat.tga", data: FLAT_TGA },
    { path: "art/notes.txt", data: text("truncated\n") },
  ]);
  writeSource(src, {
    "Textures.big": valid.subarray(0, valid.length - 1),
    "keep.bin": sample(400, 8),
  });

  const result = await run(["--src", src, "--out", out, "--tga-rle"]);
  expect(result.status, report(result)).toBe(4);
  expect(
    `${result.stdout}\n${result.stderr}`,
    `the error names the corrupt archive: ${report(result)}`,
  ).toContain("Textures.big");
  expect(readdirSync(out), "the failed run wrote nothing").toEqual([]);
  expect(leftovers(out), "no .recode-tmp folder or .partial file").toEqual([]);
  expect(existsSync(join(out, ".recode-tmp")), ".recode-tmp is absent").toBe(false);
});

test("8: a truncated .big exits 4 naming it and leaves no ZIP, .partial or .recode-tmp with --music-kbps", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  const fixtures = join(root, "fixtures");
  mkdirSync(out);
  mkdirSync(fixtures);

  const high = makeMp3(join(fixtures, "high-192.mp3"), { kbps: 192, channels: 2 });
  const valid = buildBig([
    { path: "music/high.mp3", data: high },
    { path: "music/notes.txt", data: text("truncated\n") },
  ]);
  writeSource(src, {
    "Music.big": valid.subarray(0, valid.length - 1),
    "keep.bin": sample(400, 9),
  });

  const result = await run(["--src", src, "--out", out, "--music-kbps", "128"]);
  expect(result.status, report(result)).toBe(4);
  expect(
    `${result.stdout}\n${result.stderr}`,
    `the error names the corrupt archive: ${report(result)}`,
  ).toContain("Music.big");
  expect(readdirSync(out), "the failed run wrote nothing").toEqual([]);
  expect(leftovers(out), "no .recode-tmp folder or .partial file").toEqual([]);
  expect(existsSync(join(out, ".recode-tmp")), ".recode-tmp is absent").toBe(false);
});

test("9: after a successful run no .recode-tmp folder or .partial file remains and the source folder is unchanged", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  const fixtures = join(root, "fixtures");
  mkdirSync(out);
  mkdirSync(fixtures);

  const files: Record<string, Uint8Array> = {
    "Textures.big": buildBig([
      { path: "art/flat.tga", data: FLAT_TGA },
      { path: "art/logo.dds", data: ddsBlob(31) },
    ]),
    "keep.bin": sample(500, 5),
  };
  if (FFMPEG_AVAILABLE) {
    files["Music.big"] = buildBig([
      { path: "music/high.mp3", data: makeMp3(join(fixtures, "high-192.mp3"), { kbps: 192, channels: 2 }) },
    ]);
  }
  writeSource(src, files);
  const before = snapshot(src);

  const args = ["--src", src, "--out", out, "--tga-rle"];
  if (FFMPEG_AVAILABLE) args.push("--music-kbps", "128");
  const result = await run(args);
  expect(result.status, report(result)).toBe(0);

  expect(readdirSync(out), "only the finished ZIP remains").toEqual(["game.zip"]);
  expect(leftovers(out), "no .recode-tmp folder or .partial file").toEqual([]);
  expect(existsSync(join(out, ".recode-tmp")), ".recode-tmp is absent").toBe(false);
  expect(snapshot(src), "the source folder is unchanged").toEqual(before);

  const opened = await readZip(join(out, "game.zip"));
  expect(opened.entries.map((entry) => entry.path).sort(), "every source file is packed").toEqual(
    Object.keys(files).sort(),
  );
});
