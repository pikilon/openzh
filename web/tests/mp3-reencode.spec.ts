import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ffmpegAvailable, reencodeMp3 } from "../scripts/lib/mp3-reencode.mjs";

// Contract of scripts/lib/mp3-reencode.mjs (docs/briefs/166-mp3-reencode.md).
//
// Node-side tests: the module is a dependency-free ES module imported directly.
// Test MP3s are synthetic, generated here with ffmpeg from a lavfi sine plus
// noise in a temp dir; no real game data is used. Tests that need ffmpeg are
// skipped when ffmpegAvailable() is false, except criterion 8, which must run
// with ffmpeg hidden from the PATH.

const SAMPLE_RATE = 44100;
const SOURCE_SECONDS = 10;
const TARGET_KBPS = 128;
const DURATION_TOLERANCE_S = 0.1;
const BITRATE_TOLERANCE = 2000;
const CORRELATION_LIMIT = 0.15;

interface Fixture {
  buffer: Buffer;
  path: string;
}

interface ProbedStream {
  codec_name?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
  duration?: string;
}

interface ProbedFile {
  streams: ProbedStream[];
  format?: { duration?: string };
}

let workDir: string | null = null;
const fixtures = new Map<string, Fixture>();

function tempWorkDir(): string {
  if (workDir === null) workDir = mkdtempSync(join(tmpdir(), "zhwp-mp3-reencode-"));
  return workDir;
}

test.afterAll(() => {
  if (workDir !== null) rmSync(workDir, { recursive: true, force: true });
});

async function requireFfmpeg(): Promise<void> {
  test.skip(!(await ffmpegAvailable()), "ffmpeg and ffprobe are not on PATH");
}

function runFfmpeg(args: string[], label: string): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], {
    encoding: "utf8",
  });
  expect(result.status, `${label}: ffmpeg failed: ${result.stderr}`).toBe(0);
}

// A synthetic MP3: a 440 Hz sine mixed with white noise, encoded with
// libmp3lame at the requested constant bit rate. Cached per test run.
function makeMp3(
  name: string,
  options: { kbps: number; channels: 1 | 2; seconds?: number },
): Fixture {
  const cached = fixtures.get(name);
  if (cached !== undefined) return cached;

  const { kbps, channels, seconds = SOURCE_SECONDS } = options;
  const path = join(tempWorkDir(), `${name}.mp3`);
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${SAMPLE_RATE}:duration=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=color=white:sample_rate=${SAMPLE_RATE}:duration=${seconds}:amplitude=0.02`,
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
    `generate ${name}`,
  );

  const fixture = { buffer: readFileSync(path), path };
  fixtures.set(name, fixture);
  return fixture;
}

// A PCM WAV, used only as an input that is not MP3.
function makeWav(name: string): Fixture {
  const cached = fixtures.get(name);
  if (cached !== undefined) return cached;

  const path = join(tempWorkDir(), `${name}.wav`);
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${SAMPLE_RATE}:duration=1`,
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      path,
    ],
    `generate ${name}`,
  );

  const fixture = { buffer: readFileSync(path), path };
  fixtures.set(name, fixture);
  return fixture;
}

function probe(path: string): ProbedFile {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,bit_rate,channels,sample_rate,duration:format=duration",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, `ffprobe failed: ${result.stderr}`).toBe(0);
  return JSON.parse(String(result.stdout)) as ProbedFile;
}

function durationOf(path: string): number {
  const info = probe(path);
  const value = info.format?.duration ?? info.streams[0]?.duration;
  if (value === undefined) throw new Error(`ffprobe reported no duration for ${path}`);
  return Number(value);
}

// Decodes an MP3 to mono 16-bit samples at the source sample rate, so the
// source and its re-encoding can be compared sample by sample.
function decodeMono(path: string): Int16Array {
  const rawPath = `${path}.raw`;
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
  expect(result.status, `ffmpeg decode failed: ${result.stderr}`).toBe(0);

  const raw = readFileSync(rawPath);
  const samples = new Int16Array(Math.floor(raw.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = raw.readInt16LE(i * 2);
  return samples;
}

function writeOutput(name: string, bytes: Buffer): string {
  const path = join(tempWorkDir(), name);
  writeFileSync(path, bytes);
  return path;
}

function temporaryEntries(): Set<string> {
  return new Set(readdirSync(tmpdir()));
}

function newTemporaryEntries(before: Set<string>): string[] {
  return readdirSync(tmpdir()).filter((name) => !before.has(name));
}

test("1: ffmpegAvailable resolves to a boolean, and true when both tools are on PATH", async () => {
  const available = await ffmpegAvailable();
  expect(typeof available, "resolves to a boolean").toBe("boolean");
  const tools =
    spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
    spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
  if (tools) expect(available, "both tools are on PATH").toBe(true);
});

test("2: a 10-second 192 kbps stereo source re-encoded at 128 is MP3 128 kbps stereo 44100 Hz", async () => {
  await requireFfmpeg();
  const source = makeMp3("source-192-stereo", { kbps: 192, channels: 2 });
  expect(Number(probe(source.path).streams[0].bit_rate), "fixture source bit rate").toBe(
    192000,
  );

  const output = await reencodeMp3(source.buffer, TARGET_KBPS);
  expect(output, "the source is re-encoded").not.toBeNull();
  expect(Buffer.isBuffer(output), "resolves to a Buffer").toBe(true);

  const path = writeOutput("criterion-2.mp3", output!);
  const stream = probe(path).streams[0];
  expect(stream.codec_name, "codec").toBe("mp3");
  expect(Number(stream.bit_rate), "bit rate").toBeGreaterThanOrEqual(
    TARGET_KBPS * 1000 - BITRATE_TOLERANCE,
  );
  expect(Number(stream.bit_rate), "bit rate").toBeLessThanOrEqual(
    TARGET_KBPS * 1000 + BITRATE_TOLERANCE,
  );
  expect(stream.channels, "channels").toBe(2);
  expect(Number(stream.sample_rate), "sample rate").toBe(SAMPLE_RATE);
});

test("3: output duration matches the source within 0.1 s and the output is smaller", async () => {
  await requireFfmpeg();
  const source = makeMp3("source-192-stereo", { kbps: 192, channels: 2 });

  const output = await reencodeMp3(source.buffer, TARGET_KBPS);
  expect(output, "the source is re-encoded").not.toBeNull();
  const path = writeOutput("criterion-3.mp3", output!);

  const sourceDuration = durationOf(source.path);
  const outputDuration = durationOf(path);
  expect(
    Math.abs(outputDuration - sourceDuration),
    `source ${sourceDuration.toFixed(3)} s, output ${outputDuration.toFixed(3)} s`,
  ).toBeLessThanOrEqual(DURATION_TOLERANCE_S);
  expect(output!.length, "output is smaller than the input").toBeLessThan(source.buffer.length);
});

test("4: a 64 kbps mono source at 128 and a 128 kbps source at 128 both resolve to null", async () => {
  await requireFfmpeg();
  const mono = makeMp3("source-64-mono", { kbps: 64, channels: 1, seconds: 2 });
  const monoStream = probe(mono.path).streams[0];
  expect(monoStream.channels, "fixture is mono").toBe(1);
  expect(Number(monoStream.bit_rate), "fixture bit rate").toBe(64000);
  await expect(
    reencodeMp3(mono.buffer, TARGET_KBPS),
    "a 64 kbps mono source is never re-encoded up",
  ).resolves.toBeNull();

  const stereo = makeMp3("source-128-stereo", { kbps: 128, channels: 2, seconds: 2 });
  expect(Number(probe(stereo.path).streams[0].bit_rate), "fixture bit rate").toBe(128000);
  await expect(
    reencodeMp3(stereo.buffer, TARGET_KBPS),
    "a source at the target bit rate is left alone",
  ).resolves.toBeNull();
});

test("5: a 160 kbps source is re-encoded at 128 and left alone at 192", async () => {
  await requireFfmpeg();
  const source = makeMp3("source-160-stereo", { kbps: 160, channels: 2, seconds: 2 });
  expect(Number(probe(source.path).streams[0].bit_rate), "fixture bit rate").toBe(160000);

  const output = await reencodeMp3(source.buffer, TARGET_KBPS);
  expect(output, "a 160 kbps source is re-encoded at 128").not.toBeNull();
  expect(Buffer.isBuffer(output), "resolves to a Buffer").toBe(true);
  expect(output!.length, "the re-encoded file is smaller").toBeLessThan(source.buffer.length);
  await expect(
    reencodeMp3(source.buffer, 192),
    "a 160 kbps source is left alone at 192",
  ).resolves.toBeNull();
});

test("6: random bytes, an empty buffer, a truncated MP3 and a WAV resolve to null without throwing", async () => {
  await requireFfmpeg();
  const source = makeMp3("source-192-stereo", { kbps: 192, channels: 2 });
  const wav = makeWav("criterion-6");

  const random = Buffer.alloc(4096);
  for (let i = 0; i < random.length; i++) random[i] = (i * 37 + 11) & 0xff;
  const cases: [string, Buffer][] = [
    ["random bytes", random],
    ["empty buffer", Buffer.alloc(0)],
    ["truncated MP3", source.buffer.subarray(0, 512)],
    ["WAV file", wav.buffer],
  ];

  for (const [label, input] of cases) {
    await expect(
      reencodeMp3(input, TARGET_KBPS),
      `${label} must not throw and must resolve to null`,
    ).resolves.toBeNull();
  }
});

test("7: non-positive, fractional and non-numeric kbps resolve to null", async () => {
  await requireFfmpeg();
  const source = makeMp3("source-192-stereo", { kbps: 192, channels: 2 });
  const cases: [string, unknown][] = [
    ["zero", 0],
    ["negative", -128],
    ["fractional", 1.5],
    ["string", "128"],
    ["NaN", Number.NaN],
    ["undefined", undefined],
  ];

  for (const [label, kbps] of cases) {
    await expect(
      reencodeMp3(source.buffer, kbps as number),
      `${label} kbps must not throw and must resolve to null`,
    ).resolves.toBeNull();
  }
});

test("8: with ffmpeg hidden from PATH, reencodeMp3 resolves to null and ffmpegAvailable to false", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zhwp-mp3-hidden-"));
  try {
    const emptyPath = join(dir, "empty-path");
    mkdirSync(emptyPath);

    const modulePath = fileURLToPath(new URL("../scripts/lib/mp3-reencode.mjs", import.meta.url));
    const sourcePath = join(dir, "source.mp3");
    const tools =
      spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
      spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
    if (tools) {
      // A real MP3 makes the null below proof that PATH was honoured, not that
      // the input was rejected.
      writeFileSync(sourcePath, makeMp3("source-192-stereo", { kbps: 192, channels: 2 }).buffer);
    } else {
      writeFileSync(sourcePath, Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]));
    }

    const scriptPath = join(dir, "hidden-path.mjs");
    writeFileSync(
      scriptPath,
      [
        'import { readFileSync } from "node:fs";',
        'import { pathToFileURL } from "node:url";',
        "const { reencodeMp3, ffmpegAvailable } = await import(",
        "  pathToFileURL(process.argv[2]).href,",
        ");",
        "const mp3 = readFileSync(process.argv[3]);",
        "const reencoded = await reencodeMp3(mp3, 128);",
        "const available = await ffmpegAvailable();",
        "process.stdout.write(",
        "  JSON.stringify({ reencodedIsNull: reencoded === null, available }),",
        ");",
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [scriptPath, modulePath, sourcePath], {
      encoding: "utf8",
      env: { ...process.env, PATH: emptyPath },
      timeout: 30_000,
    });
    expect(result.status, `child failed: ${result.stderr}`).toBe(0);
    const output = JSON.parse(String(result.stdout).trim()) as {
      available: boolean;
      reencodedIsNull: boolean;
    };
    expect(output.reencodedIsNull, "reencodeMp3 resolves to null").toBe(true);
    expect(output.available, "ffmpegAvailable resolves to false").toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("9: no temporary file is left in os.tmpdir() after success or failure", async () => {
  await requireFfmpeg();
  const source = makeMp3("source-192-stereo", { kbps: 192, channels: 2 });

  const beforeSuccess = temporaryEntries();
  const output = await reencodeMp3(source.buffer, TARGET_KBPS);
  expect(output, "the success call re-encodes").not.toBeNull();
  expect(newTemporaryEntries(beforeSuccess), "temporary files left after success").toEqual([]);

  const beforeFailure = temporaryEntries();
  const truncated = source.buffer.subarray(0, 512);
  expect(await reencodeMp3(truncated, TARGET_KBPS), "the failure call returns null").toBeNull();
  expect(newTemporaryEntries(beforeFailure), "temporary files left after failure").toEqual([]);
});

test("10: the decoded output correlates with the source within 15 % RMS difference", async () => {
  await requireFfmpeg();
  const source = makeMp3("source-192-stereo", { kbps: 192, channels: 2 });
  const output = await reencodeMp3(source.buffer, TARGET_KBPS);
  expect(output, "the source is re-encoded").not.toBeNull();

  const outputPath = writeOutput("criterion-10.mp3", output!);
  const original = decodeMono(source.path);
  const reencoded = decodeMono(outputPath);
  const frames = Math.min(original.length, reencoded.length);
  expect(frames, "both decodes contain audio").toBeGreaterThan(0);
  expect(
    Math.abs(original.length - reencoded.length),
    `decoded frame counts ${original.length} and ${reencoded.length}`,
  ).toBeLessThanOrEqual(SAMPLE_RATE * DURATION_TOLERANCE_S);

  let difference = 0;
  let signal = 0;
  for (let i = 0; i < frames; i++) {
    const delta = original[i] - reencoded[i];
    difference += delta * delta;
    signal += original[i] * original[i];
  }
  expect(signal, "the source is not silent").toBeGreaterThan(0);
  const ratio = Math.sqrt(difference) / Math.sqrt(signal);
  expect(
    ratio,
    `RMS difference / source RMS = ${ratio.toFixed(4)}`,
  ).toBeLessThan(CORRELATION_LIMIT);
});
