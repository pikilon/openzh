// WAV to MP3 encoder through ffmpeg (docs/briefs/180-voices-mp3.md).
//
// encodeWavAsMp3 turns an eligible RIFF/WAVE file into a raw MP3 (no RIFF
// wrapper) with libmp3lame at a constant bitrate, keeping the source sample
// rate and channel count. The engine's miniaudio decoder sniffs the content,
// so an MP3 stored under a .wav name still plays.
//
// Eligibility is checked with ffprobe first: one audio stream, codec
// pcm_s16le or adpcm_ima_wav, 1 or 2 channels and 8000 to 48000 Hz. Anything
// else, missing tools, a bad bitrate, a failed encode or an output that is not
// smaller than the source resolves to null, never a throw. Every temporary
// file lives in os.tmpdir() and is removed on every path.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE_TIMEOUT_MS = 10_000;
const ENCODE_TIMEOUT_MS = 120_000;
const TEMP_PREFIX = "zhwp-wav-mp3-";
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const ELIGIBLE_CODECS = new Set(["pcm_s16le", "adpcm_ima_wav"]);
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 48000;
const DURATION_TOLERANCE_S = 0.1;

// Runs one external tool without ever rejecting: null means the tool failed,
// timed out or could not be spawned (for example, no PATH entry for it).
function run(command, args, timeout) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout,
        killSignal: "SIGKILL",
        maxBuffer: MAX_OUTPUT_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

// Probes every audio stream. Returns null when the tool fails or prints
// something that is not JSON; an empty stream list is a valid answer.
async function probe(path) {
  const result = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_name,channels,sample_rate,duration:format=duration",
      "-of",
      "json",
      path,
    ],
    PROBE_TIMEOUT_MS,
  );
  if (result === null) return null;

  let info;
  try {
    info = JSON.parse(result.stdout);
  } catch {
    return null;
  }

  const streams = Array.isArray(info.streams) ? info.streams : [];
  const format = info.format ?? {};
  return {
    streams: streams.map((stream) => {
      const sampleRate = Number(stream.sample_rate);
      const channels = Number(stream.channels);
      const duration = Number(stream.duration);
      return {
        codec: stream.codec_name,
        channels: Number.isInteger(channels) ? channels : NaN,
        sampleRate: Number.isInteger(sampleRate) ? sampleRate : NaN,
        duration: Number.isFinite(duration) ? duration : NaN,
      };
    }),
    duration: Number.isFinite(Number(format.duration)) ? Number(format.duration) : NaN,
  };
}

function isRiffWave(wav) {
  return (
    wav.length >= 12 &&
    wav.toString("latin1", 0, 4) === "RIFF" &&
    wav.toString("latin1", 8, 12) === "WAVE"
  );
}

/**
 * Encodes a whole WAV file as a raw constant-bitrate MP3.
 * @param {Buffer} wav a whole .wav file
 * @param {number} kbps target constant bitrate in kbps (positive integer)
 * @returns {Promise<Buffer | null>} the raw MP3, or null to keep the original bytes
 */
export async function encodeWavAsMp3(wav, kbps) {
  let dir = null;
  try {
    if (!Number.isInteger(kbps) || kbps <= 0) return null;
    if (!Buffer.isBuffer(wav) || wav.length === 0) return null;
    if (!isRiffWave(wav)) return null;

    dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
    const inputPath = join(dir, "input.wav");
    const outputPath = join(dir, "output.mp3");
    writeFileSync(inputPath, wav);

    const source = await probe(inputPath);
    if (source === null || source.streams.length !== 1) return null;

    const stream = source.streams[0];
    if (!ELIGIBLE_CODECS.has(stream.codec)) return null;
    if (stream.channels !== 1 && stream.channels !== 2) return null;
    if (
      !Number.isInteger(stream.sampleRate) ||
      stream.sampleRate < MIN_SAMPLE_RATE ||
      stream.sampleRate > MAX_SAMPLE_RATE
    ) {
      return null;
    }

    const args = [
      "-hide_banner",
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-map_metadata",
      "-1",
      "-id3v2_version",
      "0",
      "-write_id3v1",
      "0",
      "-c:a",
      "libmp3lame",
      "-b:a",
      `${kbps}k`,
      "-ar",
      String(stream.sampleRate),
      "-ac",
      String(stream.channels),
      // Write the Xing/LAME header so the decoder knows the exact length.
      "-write_xing",
      "1",
    ];
    if (stream.channels === 2) args.push("-joint_stereo", "1");
    args.push("-f", "mp3", outputPath);

    const encoded = await run("ffmpeg", args, ENCODE_TIMEOUT_MS);
    if (encoded === null) return null;

    const output = readFileSync(outputPath);
    if (output.length === 0 || output.length >= wav.length) return null;

    // The contract fixes the duration and the stream layout; a mismatch means
    // a broken encode.
    const result = await probe(outputPath);
    if (result === null || result.streams.length !== 1) return null;
    const decoded = result.streams[0];
    if (decoded.codec !== "mp3") return null;
    if (decoded.channels !== stream.channels) return null;
    if (decoded.sampleRate !== stream.sampleRate) return null;

    const sourceDuration = Number.isFinite(stream.duration)
      ? stream.duration
      : source.duration;
    const outputDuration = Number.isFinite(decoded.duration)
      ? decoded.duration
      : result.duration;
    if (
      Number.isFinite(sourceDuration) &&
      Number.isFinite(outputDuration) &&
      Math.abs(outputDuration - sourceDuration) > DURATION_TOLERANCE_S
    ) {
      return null;
    }

    return output;
  } catch {
    return null;
  } finally {
    if (dir !== null) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A leftover temporary directory never turns a result into an error.
      }
    }
  }
}
