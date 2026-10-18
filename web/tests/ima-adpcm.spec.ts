import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeImaWav } from "../scripts/lib/ima-adpcm.mjs";

// Contract of scripts/lib/ima-adpcm.mjs (docs/briefs/149-ima-adpcm-encoder.md).
//
// Node-side tests: the encoder is a dependency-free ES module imported
// directly. Inputs are synthetic PCM WAVs built here; outputs are parsed and
// decoded by the independent reference decoder below, and (criterion 5) by
// ffmpeg when it is on the PATH. No real game data is used.

const SAMPLE_RATE = 22050;
const MONO_BLOCK_ALIGN = 512;
const MONO_SAMPLES_PER_BLOCK = 1017;
const MIN_SNR_DB = 25;

const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
  73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
  494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272,
  2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
  10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8];

function clamp16(value: number): number {
  return value < -32768 ? -32768 : value > 32767 ? 32767 : value;
}

// One IMA ADPCM nibble: reconstruct the sample and advance the step index.
function decodeNibble(predictor: number, index: number, nibble: number): [number, number] {
  const step = STEP_TABLE[index];
  if (step === undefined) throw new Error(`invalid IMA ADPCM step index ${index}`);
  let diff = step >> 3;
  if (nibble & 1) diff += step >> 2;
  if (nibble & 2) diff += step >> 1;
  if (nibble & 4) diff += step;
  if (nibble & 8) diff = -diff;
  const nextIndex = index + INDEX_TABLE[nibble & 7];
  return [clamp16(predictor + diff), nextIndex < 0 ? 0 : nextIndex > 88 ? 88 : nextIndex];
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

interface Chunk {
  id: string;
  data: Buffer;
  // Overrides the size written in the chunk header; the file keeps the actual
  // bytes, so a larger value exercises the clamp.
  declaredSize?: number;
}

// Builds a RIFF/WAVE file from raw chunks, padding odd-sized chunks to even
// length. Used only for inputs; outputs are parsed by parseChunks below.
function buildWav(chunks: Chunk[]): Buffer {
  const parts: Buffer[] = [Buffer.from("WAVE", "ascii")];
  for (const chunk of chunks) {
    const body = chunk.data;
    parts.push(
      Buffer.from(chunk.id, "ascii"),
      u32(chunk.declaredSize ?? body.length),
      body,
    );
    if (body.length & 1) parts.push(Buffer.alloc(1));
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), u32(body.length), body]);
}

function pcmFmt(options: {
  channels: number;
  sampleRate: number;
  bits?: number;
  tag?: number;
}): Buffer {
  const { channels, sampleRate, bits = 16, tag = 1 } = options;
  const blockAlign = (channels * bits) / 8;
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(tag, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE((sampleRate * blockAlign), 8);
  fmt.writeUInt16LE(blockAlign, 12);
  fmt.writeUInt16LE(bits, 14);
  return fmt;
}

function pcmData(samples: Int16Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(samples[i], i * 2);
  return data;
}

function pcmWav(channels: number, sampleRate: number, samples: Int16Array): Buffer {
  return buildWav([
    { id: "fmt ", data: pcmFmt({ channels, sampleRate }) },
    { id: "data", data: pcmData(samples) },
  ]);
}

function interleave(left: Int16Array, right: Int16Array): Int16Array {
  const out = new Int16Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    out[i * 2] = left[i];
    out[i * 2 + 1] = right[i];
  }
  return out;
}

// Deterministic pseudo-random noise, so every run encodes the same bytes.
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function tone(
  frames: number,
  sampleRate: number,
  frequency: number,
  amplitude: number,
  noiseAmplitude: number,
  seed: number,
): Int16Array {
  const random = noise(seed);
  const samples = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    const value =
      amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate) +
      (random() * 2 - 1) * noiseAmplitude;
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(value)));
  }
  return samples;
}

function monoInput(frames = SAMPLE_RATE): { wav: Buffer; samples: Int16Array } {
  const samples = tone(frames, SAMPLE_RATE, 440, 12000, 300, 1);
  return { wav: pcmWav(1, SAMPLE_RATE, samples), samples };
}

function stereoInput(sampleRate: number): {
  wav: Buffer;
  left: Int16Array;
  right: Int16Array;
} {
  const left = tone(sampleRate, sampleRate, 440, 9000, 300, 2);
  const right = tone(sampleRate, sampleRate, 660, 7000, 200, 3);
  return { wav: pcmWav(2, sampleRate, interleave(left, right)), left, right };
}

interface ParsedChunk {
  id: string;
  size: number;
  data: Buffer;
}

// Walks a RIFF/WAVE file and returns its chunks in file order.
function parseChunks(wav: Buffer): ParsedChunk[] {
  expect(wav.length, "at least a RIFF/WAVE header").toBeGreaterThanOrEqual(12);
  expect(wav.toString("ascii", 0, 4), "RIFF").toBe("RIFF");
  expect(wav.toString("ascii", 8, 12), "WAVE").toBe("WAVE");
  expect(wav.readUInt32LE(4), "RIFF size counts the bytes that follow").toBe(wav.length - 8);

  const chunks: ParsedChunk[] = [];
  let at = 12;
  while (at + 8 <= wav.length) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const start = at + 8;
    expect(start + size, `${id} chunk fits in the file`).toBeLessThanOrEqual(wav.length);
    chunks.push({ id, size, data: wav.subarray(start, start + size) });
    at = start + size + (size & 1);
  }
  expect(at, "chunks consume the whole file").toBe(wav.length);
  return chunks;
}

interface EncodedWav {
  chunks: ParsedChunk[];
  fmt: {
    tag: number;
    channels: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bits: number;
    extraSize: number;
    samplesPerBlock: number;
  };
  fact: number;
  data: Buffer;
}

// Parses an encoder output and checks the layout the contract fixes: fmt
// (20 bytes), then fact (4 bytes), then data; unknown chunks are dropped.
function inspectImaWav(wav: Buffer): EncodedWav {
  const chunks = parseChunks(wav);
  expect(chunks.map((chunk) => chunk.id), "output chunk order").toEqual([
    "fmt ",
    "fact",
    "data",
  ]);
  const [fmtChunk, factChunk, dataChunk] = chunks;
  expect(fmtChunk.size, "fmt chunk size").toBe(20);
  expect(factChunk.size, "fact chunk size").toBe(4);
  const fmt = fmtChunk.data;
  return {
    chunks,
    fmt: {
      tag: fmt.readUInt16LE(0),
      channels: fmt.readUInt16LE(2),
      sampleRate: fmt.readUInt32LE(4),
      byteRate: fmt.readUInt32LE(8),
      blockAlign: fmt.readUInt16LE(12),
      bits: fmt.readUInt16LE(14),
      extraSize: fmt.readUInt16LE(16),
      samplesPerBlock: fmt.readUInt16LE(18),
    },
    fact: factChunk.data.readUInt32LE(0),
    data: dataChunk.data,
  };
}

interface DecodedWav {
  tag: number;
  channels: number;
  sampleRate: number;
  blockAlign: number;
  bits: number;
  samplesPerBlock: number;
  fact: number | undefined;
  perChannel: number[][];
}

// Independent reference decoder for the standard Microsoft IMA/DVI ADPCM
// layout: one 4-byte header per channel per block (int16 predictor, uint8
// step index, reserved byte), then nibbles. Stereo nibbles come in groups of
// 8 samples per channel (4 bytes), left then right, alternating. The fact
// chunk trims the padded last block to the true frame count.
function decodeImaWav(wav: Buffer): DecodedWav {
  const chunks = parseChunks(wav);
  const fmtChunk = chunks.find((chunk) => chunk.id === "fmt ");
  const factChunk = chunks.find((chunk) => chunk.id === "fact");
  const dataChunk = chunks.find((chunk) => chunk.id === "data");
  if (!fmtChunk || !dataChunk) throw new Error("output is missing fmt or data");
  const fmt = fmtChunk.data;
  const tag = fmt.readUInt16LE(0);
  const channels = fmt.readUInt16LE(2);
  const sampleRate = fmt.readUInt32LE(4);
  const blockAlign = fmt.readUInt16LE(12);
  const bits = fmt.readUInt16LE(14);
  const samplesPerBlock = fmt.readUInt16LE(18);
  const fact = factChunk ? factChunk.data.readUInt32LE(0) : undefined;
  const data = dataChunk.data;

  const perChannel: number[][] = Array.from({ length: channels }, () => []);
  for (let block = 0; block + 4 * channels <= data.length; block += blockAlign) {
    const end = Math.min(block + blockAlign, data.length);
    const predictor: number[] = [];
    const index: number[] = [];
    for (let ch = 0; ch < channels; ch++) {
      predictor.push(data.readInt16LE(block + 4 * ch));
      index.push(data.readUInt8(block + 4 * ch + 2));
      perChannel[ch].push(predictor[ch]);
    }
    if (channels === 1) {
      for (let at = block + 4; at < end; at++) {
        const byte = data[at];
        for (const nibble of [byte & 0xf, byte >> 4]) {
          const [sample, next] = decodeNibble(predictor[0], index[0], nibble);
          predictor[0] = sample;
          index[0] = next;
          perChannel[0].push(sample);
        }
      }
    } else {
      for (let at = block + 4 * channels; at + 8 <= end; at += 8) {
        for (let ch = 0; ch < 2; ch++) {
          for (let byte = 0; byte < 4; byte++) {
            const value = data[at + 4 * ch + byte];
            for (const nibble of [value & 0xf, value >> 4]) {
              const [sample, next] = decodeNibble(predictor[ch], index[ch], nibble);
              predictor[ch] = sample;
              index[ch] = next;
              perChannel[ch].push(sample);
            }
          }
        }
      }
    }
  }
  if (fact !== undefined) {
    for (const samples of perChannel) samples.length = fact;
  }
  return { tag, channels, sampleRate, blockAlign, bits, samplesPerBlock, fact, perChannel };
}

// Signal-to-noise ratio in dB between the PCM input and the decoded output.
function expectSnrAtLeast(
  reference: Int16Array,
  decoded: number[],
  minimumDb: number,
  label: string,
): void {
  const frames = Math.min(reference.length, decoded.length);
  let signal = 0;
  let noisePower = 0;
  for (let i = 0; i < frames; i++) {
    const original = reference[i];
    const difference = original - decoded[i];
    signal += original * original;
    noisePower += difference * difference;
  }
  expect(frames, `${label}: SNR compares every frame`).toBe(reference.length);
  expect(signal, `${label}: reference is not silent`).toBeGreaterThan(0);
  const db =
    noisePower === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10(signal / noisePower);
  expect(db, `${label}: SNR ${db.toFixed(2)} dB`).toBeGreaterThanOrEqual(minimumDb);
}

// Criterion 5 only runs when ffmpeg can decode IMA ADPCM WAV.
const FFMPEG_AVAILABLE = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("1: a 1-second mono 22050 Hz tone-plus-noise WAV gets the IMA ADPCM header and fact count", () => {
  const { wav } = monoInput();
  const encoded = encodeImaWav(wav);
  expect(encoded, "eligible PCM input is encoded").not.toBeNull();
  const { fmt, fact, data } = inspectImaWav(encoded!);

  expect(fmt.tag, "WAVE format tag").toBe(0x0011);
  expect(fmt.channels, "channels").toBe(1);
  expect(fmt.sampleRate, "sample rate").toBe(22050);
  expect(fmt.blockAlign, "block align").toBe(MONO_BLOCK_ALIGN);
  expect(fmt.bits, "bits per sample").toBe(4);
  expect(fmt.extraSize, "extra size").toBe(2);
  expect(fmt.samplesPerBlock, "samples per block").toBe(MONO_SAMPLES_PER_BLOCK);
  expect(fmt.byteRate, "byte rate").toBe(
    Math.ceil((22050 * MONO_BLOCK_ALIGN) / MONO_SAMPLES_PER_BLOCK),
  );
  expect(fact, "fact chunk").toBe(22050);
  expect(data.length, "data chunk is present").toBeGreaterThan(0);
});

test("2: the encoded data is block aligned and about a quarter of the input", () => {
  const { wav } = monoInput();
  const encoded = encodeImaWav(wav);
  expect(encoded, "eligible PCM input is encoded").not.toBeNull();
  const { fmt, data } = inspectImaWav(encoded!);

  expect(data.length % fmt.blockAlign, "data length is a multiple of block align").toBe(0);
  const ratio = data.length / wav.length;
  expect(ratio, `encoded data / input file = ${ratio.toFixed(4)}`).toBeGreaterThanOrEqual(0.24);
  expect(ratio, `encoded data / input file = ${ratio.toFixed(4)}`).toBeLessThanOrEqual(0.27);
});

test("3: the reference decoder recovers every frame with at least 25 dB SNR", () => {
  const { wav, samples } = monoInput();
  const encoded = encodeImaWav(wav);
  expect(encoded, "eligible PCM input is encoded").not.toBeNull();
  const decoded = decodeImaWav(encoded!);

  expect(decoded.tag, "format tag").toBe(0x0011);
  expect(decoded.channels, "channels").toBe(1);
  expect(decoded.sampleRate, "sample rate").toBe(22050);
  expect(decoded.fact, "fact frame count").toBe(samples.length);
  expect(decoded.perChannel[0], "decoded frame count").toHaveLength(samples.length);
  expectSnrAtLeast(samples, decoded.perChannel[0], MIN_SNR_DB, "mono 22050 Hz");
});

test("4: stereo input keeps both channels above 25 dB SNR with the contract block align", () => {
  // The Contract formula is 256 * channels * max(1, floor(rate / 11025)):
  // 1024 bytes at 22050 Hz stereo and 2048 at 44100 Hz stereo. Criterion 4's
  // parenthetical ("block align 1024 at 44100 Hz") mixes the two, so both
  // rates are checked here against the formula and per-channel decoding.
  for (const [sampleRate, blockAlign, samplesPerBlock] of [
    [22050, 1024, 1017],
    [44100, 2048, 2041],
  ] as const) {
    const { wav, left, right } = stereoInput(sampleRate);
    const encoded = encodeImaWav(wav);
    expect(encoded, `${sampleRate} Hz stereo is encoded`).not.toBeNull();
    const { fmt, fact } = inspectImaWav(encoded!);

    expect(fmt.tag, `${sampleRate} Hz format tag`).toBe(0x0011);
    expect(fmt.channels, `${sampleRate} Hz channels`).toBe(2);
    expect(fmt.sampleRate, `${sampleRate} Hz sample rate`).toBe(sampleRate);
    expect(fmt.blockAlign, `${sampleRate} Hz block align`).toBe(blockAlign);
    expect(fmt.samplesPerBlock, `${sampleRate} Hz samples per block`).toBe(samplesPerBlock);
    expect(fact, `${sampleRate} Hz fact count`).toBe(sampleRate);

    const decoded = decodeImaWav(encoded!);
    expect(decoded.perChannel, `${sampleRate} Hz decoded channels`).toHaveLength(2);
    expect(decoded.perChannel[0], `${sampleRate} Hz left frame count`).toHaveLength(sampleRate);
    expect(decoded.perChannel[1], `${sampleRate} Hz right frame count`).toHaveLength(sampleRate);
    expectSnrAtLeast(left, decoded.perChannel[0], MIN_SNR_DB, `${sampleRate} Hz left`);
    expectSnrAtLeast(right, decoded.perChannel[1], MIN_SNR_DB, `${sampleRate} Hz right`);
  }
});

test("5: ffmpeg decodes the output to the same frame count with at least 25 dB SNR", () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg is not on PATH");

  const { wav, samples } = monoInput();
  const encoded = encodeImaWav(wav);
  expect(encoded, "eligible PCM input is encoded").not.toBeNull();
  const { fmt } = inspectImaWav(encoded!);
  expect(fmt.channels, "mono input").toBe(1);

  const dir = mkdtempSync(join(tmpdir(), "zhwp-ima-adpcm-"));
  try {
    const inputPath = join(dir, "input.wav");
    const rawPath = join(dir, "decoded.raw");
    writeFileSync(inputPath, encoded!);
    // ffmpeg emits the padded last block; -t trims it to the input duration so
    // the frame count is directly comparable with the source.
    const result = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-v",
        "error",
        "-y",
        "-i",
        inputPath,
        "-t",
        (samples.length / SAMPLE_RATE).toFixed(9),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        rawPath,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, `ffmpeg failed: ${result.stderr}`).toBe(0);

    const raw = readFileSync(rawPath);
    const decodedFrames = raw.length / 2 / fmt.channels;
    expect(decodedFrames, "ffmpeg frame count").toBe(samples.length);
    const decoded = new Int16Array(decodedFrames);
    for (let i = 0; i < decodedFrames; i++) decoded[i] = raw.readInt16LE(i * 2);
    expectSnrAtLeast(samples, Array.from(decoded), MIN_SNR_DB, "ffmpeg mono");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("6: silence encodes and decodes to silence", () => {
  const samples = new Int16Array(SAMPLE_RATE);
  const encoded = encodeImaWav(pcmWav(1, SAMPLE_RATE, samples));
  expect(encoded, "silent PCM input is encoded").not.toBeNull();
  const { fact, data, fmt, chunks } = inspectImaWav(encoded!);

  expect(fact, "fact frame count").toBe(SAMPLE_RATE);
  expect(data.length % fmt.blockAlign, "data length is block aligned").toBe(0);
  expect(chunks.map((chunk) => chunk.id), "silent output keeps the normal layout").toEqual([
    "fmt ",
    "fact",
    "data",
  ]);

  const decoded = decodeImaWav(encoded!);
  expect(decoded.perChannel[0], "decoded frame count").toHaveLength(SAMPLE_RATE);
  const peak = decoded.perChannel[0].reduce(
    (maximum, sample) => Math.max(maximum, Math.abs(sample)),
    0,
  );
  expect(peak, "every decoded sample stays within +-8").toBeLessThanOrEqual(8);
});

test("7: a single frame and a non-block-length input report the true frame count in fact", () => {
  const one = encodeImaWav(pcmWav(1, SAMPLE_RATE, new Int16Array([1234])));
  expect(one, "a 1-frame PCM input is encoded").not.toBeNull();
  const oneInfo = inspectImaWav(one!);
  expect(oneInfo.fact, "1-frame fact count").toBe(1);
  expect(oneInfo.data.length, "1-frame data is padded to exactly one block").toBe(
    oneInfo.fmt.blockAlign,
  );
  const oneDecoded = decodeImaWav(one!);
  expect(oneDecoded.perChannel[0], "1-frame decoded count").toHaveLength(1);
  expect(oneDecoded.perChannel[0][0], "the header stores the only sample").toBe(1234);

  const frames = 1500; // Not a multiple of 1017 samples per block.
  const samples = tone(frames, SAMPLE_RATE, 440, 8000, 100, 7);
  const partial = encodeImaWav(pcmWav(1, SAMPLE_RATE, samples));
  expect(partial, "a non-block-length input is encoded").not.toBeNull();
  const partialInfo = inspectImaWav(partial!);
  expect(partialInfo.fact, "partial-block fact count").toBe(frames);
  expect(
    partialInfo.data.length % partialInfo.fmt.blockAlign,
    "partial-block data is a whole number of blocks",
  ).toBe(0);
  expect(partialInfo.data.length, "the partial input spans two blocks").toBe(
    2 * partialInfo.fmt.blockAlign,
  );
  const partialDecoded = decodeImaWav(partial!);
  expect(partialDecoded.perChannel[0], "partial-block decoded count").toHaveLength(frames);
});

test("8: ineligible and malformed inputs return null without throwing", () => {
  const { wav: valid } = monoInput(64);
  const random = Buffer.alloc(200);
  for (let i = 0; i < random.length; i++) random[i] = (i * 37 + 11) & 0xff;

  const cases: [string, Buffer][] = [
    [
      "format tag 17 (ADPCM)",
      buildWav([
        { id: "fmt ", data: pcmFmt({ channels: 1, sampleRate: 22050, tag: 17 }) },
        { id: "data", data: Buffer.alloc(200) },
      ]),
    ],
    [
      "8-bit PCM",
      buildWav([
        { id: "fmt ", data: pcmFmt({ channels: 1, sampleRate: 22050, bits: 8 }) },
        { id: "data", data: Buffer.alloc(100) },
      ]),
    ],
    [
      "3 channels",
      buildWav([
        { id: "fmt ", data: pcmFmt({ channels: 3, sampleRate: 22050 }) },
        { id: "data", data: Buffer.alloc(300) },
      ]),
    ],
    ["truncated header", valid.subarray(0, 20)],
    ["random bytes", random],
    ["empty buffer", Buffer.alloc(0)],
  ];

  for (const [label, input] of cases) {
    expect(() => encodeImaWav(input), `${label}: must not throw`).not.toThrow();
    expect(encodeImaWav(input), `${label}: returns null`).toBeNull();
  }
});

test("9: an oversized data size is clamped and LIST chunks are dropped", () => {
  const frames = 1000;
  const samples = tone(frames, SAMPLE_RATE, 330, 9000, 200, 11);
  const data = pcmData(samples);

  const inflated = buildWav([
    { id: "fmt ", data: pcmFmt({ channels: 1, sampleRate: 22050 }) },
    { id: "data", data, declaredSize: data.length + 4096 },
  ]);
  const clamped = encodeImaWav(inflated);
  expect(clamped, "a data chunk larger than the file is still encoded").not.toBeNull();
  const clampedInfo = inspectImaWav(clamped!);
  expect(clampedInfo.fact, "clamped fact count").toBe(frames);
  const clampedDecoded = decodeImaWav(clamped!);
  expect(clampedDecoded.perChannel[0], "clamped decoded count").toHaveLength(frames);

  // Unknown chunks before fmt and after data, with odd sizes that need pad
  // bytes; both are dropped from the output.
  const withLists = buildWav([
    { id: "LIST", data: Buffer.from([1, 2, 3, 4, 5]) },
    { id: "fmt ", data: pcmFmt({ channels: 1, sampleRate: 22050 }) },
    { id: "data", data },
    { id: "LIST", data: Buffer.from([9, 8, 7]) },
  ]);
  const cleaned = encodeImaWav(withLists);
  expect(cleaned, "LIST chunks do not make the input ineligible").not.toBeNull();
  const cleanedInfo = inspectImaWav(cleaned!); // Asserts fmt, fact, data only.
  expect(cleanedInfo.fact, "LIST fact count").toBe(frames);
  const cleanedDecoded = decodeImaWav(cleaned!);
  expect(cleanedDecoded.perChannel[0], "LIST decoded count").toHaveLength(frames);
});

test("10: two calls on the same input return byte-identical buffers", () => {
  const { wav } = monoInput();
  const first = encodeImaWav(wav);
  const second = encodeImaWav(wav);
  expect(first, "first call is encoded").not.toBeNull();
  expect(second, "second call is encoded").not.toBeNull();
  expect(first, "each call returns its own buffer").not.toBe(second);
  expect(Buffer.compare(first!, second!), "buffers are byte-identical").toBe(0);
});
