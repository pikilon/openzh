import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWavAsMp3 } from "../scripts/lib/wav-mp3.mjs";

// Contract of scripts/lib/wav-mp3.mjs (docs/briefs/180-voices-mp3.md).
//
// Node-side tests: the encoder is a dependency-free ES module imported
// directly. Input WAVs are generated here with ffmpeg in a temp dir; the
// output is probed with ffprobe and decoded with ffmpeg. Criterion 6 compiles
// the engine's own miniaudio against the header in build/ when both the header
// and a C compiler are available. No real game data is used.

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(TESTS_DIR, "..");
const REPO_ROOT = resolve(WEB_ROOT, "..");

const SAMPLE_RATE = 22050;
const VOICES_KBPS = 48;
const BITRATE_TOLERANCE = 3000;
const FRAME_TOLERANCE = 2300;
const DURATION_TOLERANCE_S = 0.1;

const MINIAUDIO_HEADER = join(
  REPO_ROOT,
  "build",
  "webgpu",
  "_deps",
  "miniaudio-src",
  "miniaudio.h",
);

const FFMPEG_AVAILABLE =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

const CC_AVAILABLE = spawnSync("cc", ["--version"], { stdio: "ignore" }).status === 0;

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

let workDir: string;

test.beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "zhwp-wav-mp3-"));
});

test.afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function runFfmpeg(args: string[], label: string): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], {
    encoding: "utf8",
  });
  expect(result.status, `${label}: ffmpeg failed: ${result.stderr}`).toBe(0);
}

function makePcm16Wav(
  name: string,
  options: {
    sampleRate?: number;
    channels?: number;
    seconds?: number;
    toneNoise?: boolean;
  } = {},
): string {
  const {
    sampleRate = SAMPLE_RATE,
    channels = 1,
    seconds = 3,
    toneNoise = false,
  } = options;
  const path = join(workDir, `${name}.wav`);
  const sine = `sine=frequency=440:sample_rate=${sampleRate}:duration=${seconds}`;
  const args = toneNoise
    ? [
        "-f",
        "lavfi",
        "-i",
        sine,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=color=white:sample_rate=${sampleRate}:duration=${seconds}:amplitude=0.05`,
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:duration=first[a]",
        "-map",
        "[a]",
      ]
    : ["-f", "lavfi", "-i", sine];
  args.push("-ac", String(channels), "-c:a", "pcm_s16le", path);
  runFfmpeg(args, `generate ${name}`);
  return path;
}

function makeAdpcmWav(name: string, options: { seconds?: number } = {}): string {
  const { seconds = 3 } = options;
  const path = join(workDir, `${name}.wav`);
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
    `generate ${name}`,
  );
  return path;
}

function makePcm8Wav(name: string): string {
  const path = join(workDir, `${name}.wav`);
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
    `generate ${name}`,
  );
  return path;
}

function makeThreeChannelWav(name: string): string {
  const path = join(workDir, `${name}.wav`);
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${SAMPLE_RATE}:duration=1`,
      "-ac",
      "3",
      "-c:a",
      "pcm_s16le",
      path,
    ],
    `generate ${name}`,
  );
  return path;
}

function makeMp3(name: string, options: { kbps?: number; seconds?: number } = {}): string {
  const { kbps = 64, seconds = 1 } = options;
  const path = join(workDir, `${name}.mp3`);
  runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=${SAMPLE_RATE}:duration=${seconds}`,
      "-ac",
      "1",
      "-c:a",
      "libmp3lame",
      "-b:a",
      `${kbps}k`,
      path,
    ],
    `generate ${name}`,
  );
  return path;
}

function makeOneFrameWav(name: string): string {
  const path = join(workDir, `${name}.wav`);
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
    `generate ${name}`,
  );
  return path;
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

function audioStream(path: string): ProbedStream {
  const info = probe(path);
  const stream = info.streams[0];
  expect(stream, `ffprobe reported an audio stream for ${path}`).toBeDefined();
  return stream as ProbedStream;
}

function durationOf(path: string): number {
  const info = probe(path);
  const value = Number(info.format?.duration ?? info.streams[0]?.duration);
  expect(Number.isFinite(value), `ffprobe reported a duration for ${path}`).toBe(true);
  return value;
}

// Decodes to mono 16-bit PCM at the source sample rate, so the frame counts
// can be compared directly.
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
  expect(result.status, `ffmpeg decode failed: ${result.stderr}`).toBe(0);
  const raw = readFileSync(rawPath);
  const samples = new Int16Array(Math.floor(raw.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = raw.readInt16LE(i * 2);
  return samples;
}

function writeOutput(name: string, bytes: Buffer): string {
  const path = join(workDir, name);
  writeFileSync(path, bytes);
  return path;
}

function expectMp3Stream(
  path: string,
  options: { channels: number; sampleRate: number; kbps: number },
  label: string,
): void {
  const stream = audioStream(path);
  expect(stream.codec_name, `${label} codec`).toBe("mp3");
  expect(stream.channels, `${label} channels`).toBe(options.channels);
  expect(Number(stream.sample_rate), `${label} sample rate`).toBe(options.sampleRate);
  expect(Number(stream.bit_rate), `${label} bit rate`).toBeGreaterThanOrEqual(
    options.kbps * 1000 - BITRATE_TOLERANCE,
  );
  expect(Number(stream.bit_rate), `${label} bit rate`).toBeLessThanOrEqual(
    options.kbps * 1000 + BITRATE_TOLERANCE,
  );
}

// --- Tests -------------------------------------------------------------------

test("1: a 3-second 22050 Hz mono PCM16 WAV at 48 becomes a smaller raw MP3", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const sourcePath = makePcm16Wav("criterion-1-source", { seconds: 3 });
  const source = readFileSync(sourcePath);
  const output = await encodeWavAsMp3(source, VOICES_KBPS);
  expect(output, "the PCM16 WAV is encoded").not.toBeNull();
  expect(Buffer.isBuffer(output), "resolves to a Buffer").toBe(true);
  expect(output!.subarray(0, 4).toString("latin1"), "no RIFF wrapper").not.toBe("RIFF");

  const outputPath = writeOutput("criterion-1.mp3", output!);
  expectMp3Stream(
    outputPath,
    { channels: 1, sampleRate: SAMPLE_RATE, kbps: VOICES_KBPS },
    "criterion 1",
  );
  expect(output!.length, "the MP3 is smaller than the input").toBeLessThan(source.length);
});

test("2: an IMA ADPCM WAV at 48 and a 44100 Hz stereo PCM16 WAV at 96 also become raw MP3", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const adpcmPath = makeAdpcmWav("criterion-2-adpcm", { seconds: 3 });
  const adpcmSource = readFileSync(adpcmPath);
  const adpcmInput = audioStream(adpcmPath);
  expect(adpcmInput.codec_name, "ADPCM fixture codec").toBe("adpcm_ima_wav");

  const adpcmOutput = await encodeWavAsMp3(adpcmSource, VOICES_KBPS);
  expect(adpcmOutput, "the IMA ADPCM WAV is encoded").not.toBeNull();
  expect(Buffer.isBuffer(adpcmOutput), "ADPCM resolves to a Buffer").toBe(true);
  expect(adpcmOutput!.subarray(0, 4).toString("latin1"), "ADPCM output is raw").not.toBe(
    "RIFF",
  );
  const adpcmOutputPath = writeOutput("criterion-2-adpcm.mp3", adpcmOutput!);
  expectMp3Stream(
    adpcmOutputPath,
    { channels: 1, sampleRate: SAMPLE_RATE, kbps: VOICES_KBPS },
    "criterion 2 ADPCM",
  );
  expect(
    adpcmOutput!.length,
    "the ADPCM MP3 is smaller than the input",
  ).toBeLessThan(adpcmSource.length);

  const stereoRate = 44100;
  const stereoPath = makePcm16Wav("criterion-2-stereo", {
    sampleRate: stereoRate,
    channels: 2,
    seconds: 3,
  });
  const stereoSource = readFileSync(stereoPath);
  const stereo = await encodeWavAsMp3(stereoSource, 96);
  expect(stereo, "the stereo PCM16 WAV is encoded").not.toBeNull();
  expect(Buffer.isBuffer(stereo), "stereo resolves to a Buffer").toBe(true);
  expect(stereo!.subarray(0, 4).toString("latin1"), "stereo output is raw").not.toBe("RIFF");
  const stereoOutputPath = writeOutput("criterion-2-stereo.mp3", stereo!);
  expectMp3Stream(
    stereoOutputPath,
    { channels: 2, sampleRate: stereoRate, kbps: 96 },
    "criterion 2 stereo",
  );
  expect(stereo!.length, "the stereo MP3 is smaller than the input").toBeLessThan(
    stereoSource.length,
  );
});

test("3: the decoded output keeps the source frame count within 2300 frames and the duration within 0.1 s", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const sourcePath = makePcm16Wav("criterion-3-source", { seconds: 3 });
  const sourceFrames = decodeMono(sourcePath).length;
  expect(sourceFrames, "the source is 3 seconds at 22050 Hz").toBe(3 * SAMPLE_RATE);

  const output = await encodeWavAsMp3(readFileSync(sourcePath), VOICES_KBPS);
  expect(output, "the source is encoded").not.toBeNull();
  const outputPath = writeOutput("criterion-3.mp3", output!);

  const decodedFrames = decodeMono(outputPath).length;
  expect(
    Math.abs(decodedFrames - sourceFrames),
    `decoded ${decodedFrames} frames, source ${sourceFrames} frames`,
  ).toBeLessThanOrEqual(FRAME_TOLERANCE);

  const sourceDuration = durationOf(sourcePath);
  const outputDuration = durationOf(outputPath);
  expect(
    Math.abs(outputDuration - sourceDuration),
    `source ${sourceDuration.toFixed(3)} s, output ${outputDuration.toFixed(3)} s`,
  ).toBeLessThanOrEqual(DURATION_TOLERANCE_S);
});

test("4: ineligible WAVs, non-audio bytes and invalid bit rates resolve to null without throwing", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const pcm16 = readFileSync(makePcm16Wav("criterion-4-pcm16", { seconds: 1 }));
  const eightBit = readFileSync(makePcm8Wav("criterion-4-eight-bit"));
  const threeChannels = readFileSync(makeThreeChannelWav("criterion-4-three-channels"));
  const mp3 = readFileSync(makeMp3("criterion-4-mp3"));
  const oneFramePath = makeOneFrameWav("criterion-4-one-frame");
  const oneFrame = readFileSync(oneFramePath);
  expect(audioStream(oneFramePath).codec_name, "one-frame fixture codec").toBe("pcm_s16le");

  const random = Buffer.alloc(4096);
  for (let i = 0; i < random.length; i++) random[i] = (i * 37 + 11) & 0xff;
  const truncated = pcm16.subarray(0, 40);

  const cases: [string, Buffer][] = [
    ["8-bit PCM WAV", eightBit],
    ["3-channel PCM16 WAV", threeChannels],
    ["MP3 file", mp3],
    ["random bytes", random],
    ["empty buffer", Buffer.alloc(0)],
    ["truncated WAV", truncated],
    ["1-frame WAV", oneFrame],
  ];

  for (const [label, input] of cases) {
    await expect(
      encodeWavAsMp3(input, VOICES_KBPS),
      `${label} must not throw and must resolve to null`,
    ).resolves.toBeNull();
  }

  for (const [label, kbps] of [
    ["zero", 0],
    ["fractional", 1.5],
    ["negative", -3],
    ["non-numeric", "abc"],
  ] as const) {
    await expect(
      encodeWavAsMp3(pcm16, kbps as unknown as number),
      `${label} bit rate must not throw and must resolve to null`,
    ).resolves.toBeNull();
  }
});

test("5: with ffmpeg hidden from PATH the function resolves to null, and no temporary file remains after success or failure", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");

  const sourcePath = makePcm16Wav("criterion-5-source", { seconds: 1 });
  const modulePath = fileURLToPath(new URL("../scripts/lib/wav-mp3.mjs", import.meta.url));
  const scriptPath = join(workDir, "call-wav-mp3.mjs");
  writeFileSync(
    scriptPath,
    [
      'import { readFileSync } from "node:fs";',
      'import { pathToFileURL } from "node:url";',
      "const { encodeWavAsMp3 } = await import(pathToFileURL(process.argv[2]).href);",
      "const wav = readFileSync(process.argv[3]);",
      "const kbps = Number(process.argv[4]);",
      "const result = await encodeWavAsMp3(wav, kbps);",
      "process.stdout.write(",
      "  JSON.stringify({",
      "    isNull: result === null,",
      "    isBuffer: Buffer.isBuffer(result),",
      "    length: result === null ? 0 : result.length,",
      "  }),",
      ");",
    ].join("\n"),
  );

  const emptyPath = join(workDir, "empty-path");
  mkdirSync(emptyPath);

  function runChild(
    name: string,
    options: { tmpDir: string; kbps: number; path: string },
  ): { status: number | null; stdout: string; stderr: string } {
    mkdirSync(options.tmpDir, { recursive: true });
    const result = spawnSync(process.execPath, [scriptPath, modulePath, sourcePath, String(options.kbps)], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: options.path,
        TMPDIR: options.tmpDir,
        TMP: options.tmpDir,
        TEMP: options.tmpDir,
      },
      timeout: 120_000,
    });
    return {
      status: result.status,
      stdout: String(result.stdout).trim(),
      stderr: String(result.stderr),
    };
  }

  const successTmp = join(workDir, "tmp-success");
  const success = runChild("success", {
    tmpDir: successTmp,
    kbps: VOICES_KBPS,
    path: process.env.PATH ?? "",
  });
  expect(success.status, `successful child failed: ${success.stderr}`).toBe(0);
  const successResult = JSON.parse(success.stdout) as {
    isNull: boolean;
    isBuffer: boolean;
    length: number;
  };
  expect(successResult.isNull, "the eligible WAV is encoded").toBe(false);
  expect(successResult.isBuffer, "the success result is a Buffer").toBe(true);
  expect(successResult.length, "the success result has bytes").toBeGreaterThan(0);
  expect(readdirSync(successTmp), "temporary files left after success").toEqual([]);

  const hiddenTmp = join(workDir, "tmp-hidden-ffmpeg");
  const hidden = runChild("hidden", {
    tmpDir: hiddenTmp,
    kbps: VOICES_KBPS,
    path: emptyPath,
  });
  expect(hidden.status, `hidden-ffmpeg child failed: ${hidden.stderr}`).toBe(0);
  const hiddenResult = JSON.parse(hidden.stdout) as { isNull: boolean };
  expect(hiddenResult.isNull, "with ffmpeg hidden the result is null").toBe(true);
  expect(readdirSync(hiddenTmp), "temporary files left with ffmpeg hidden").toEqual([]);

  const failureTmp = join(workDir, "tmp-failure");
  const failure = runChild("failure", {
    tmpDir: failureTmp,
    kbps: 0,
    path: process.env.PATH ?? "",
  });
  expect(failure.status, `failing child failed: ${failure.stderr}`).toBe(0);
  const failureResult = JSON.parse(failure.stdout) as { isNull: boolean };
  expect(failureResult.isNull, "an invalid bit rate resolves to null").toBe(true);
  expect(readdirSync(failureTmp), "temporary files left after failure").toEqual([]);
});

test("6: the engine's miniaudio decoder accepts the output stored under a .wav name", async () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg and ffprobe are not on PATH");
  test.skip(!CC_AVAILABLE, "cc is not available");
  test.skip(!existsSync(MINIAUDIO_HEADER), `miniaudio header is not available: ${MINIAUDIO_HEADER}`);

  const sourcePath = makePcm16Wav("criterion-6-source", { seconds: 3 });
  const sourceFrames = decodeMono(sourcePath).length;
  const output = await encodeWavAsMp3(readFileSync(sourcePath), VOICES_KBPS);
  expect(output, "the source is encoded").not.toBeNull();

  const mp3WavPath = writeOutput("criterion-6.wav", output!);
  const cPath = join(workDir, "miniaudio-decoder.c");
  writeFileSync(
    cPath,
    [
      "#define MINIAUDIO_IMPLEMENTATION",
      '#include "miniaudio.h"',
      "#include <stdio.h>",
      "",
      "int main(int argc, char **argv) {",
      "    ma_decoder decoder;",
      "    ma_decoder_config config = ma_decoder_config_init_default();",
      "    ma_result result = ma_decoder_init_file(argv[1], &config, &decoder);",
      "    if (result != MA_SUCCESS) {",
      '        fprintf(stderr, "ma_decoder_init_file failed: %d\\n", result);',
      "        return 1;",
      "    }",
      "    ma_uint64 length = 0;",
      "    result = ma_decoder_get_length_in_pcm_frames(&decoder, &length);",
      "    if (result != MA_SUCCESS) {",
      '        fprintf(stderr, "ma_decoder_get_length_in_pcm_frames failed: %d\\n", result);',
      "        ma_decoder_uninit(&decoder);",
      "        return 1;",
      "    }",
      '    printf("%llu\\n", (unsigned long long)length);',
      "    ma_decoder_uninit(&decoder);",
      "    return 0;",
      "}",
    ].join("\n"),
  );

  const executable = join(workDir, "miniaudio-decoder");
  const compile = spawnSync(
    "cc",
    ["-O2", "-I", dirname(MINIAUDIO_HEADER), "-o", executable, cPath, "-lm"],
    { encoding: "utf8", timeout: 60_000 },
  );
  expect(compile.status, `cc failed: ${compile.stderr}`).toBe(0);

  const decoded = spawnSync(executable, [mp3WavPath], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(decoded.status, `the decoder failed: ${decoded.stderr}`).toBe(0);
  const decodedFrames = Number(String(decoded.stdout).trim());
  expect(Number.isInteger(decodedFrames), "the decoder reports a frame count").toBe(true);
  expect(
    Math.abs(decodedFrames - sourceFrames),
    `miniaudio read ${decodedFrames} frames, source ${sourceFrames} frames`,
  ).toBeLessThanOrEqual(FRAME_TOLERANCE);
});
