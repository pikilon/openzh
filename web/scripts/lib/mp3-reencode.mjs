// MP3 re-encoder through ffmpeg (docs/briefs/166-mp3-reencode.md).
//
// reencodeMp3 shrinks an MP3 to a lower constant bitrate with libmp3lame,
// keeping the source sample rate and channel layout and dropping metadata.
// The source is probed first: it is left untouched (null) when the tools are
// missing, the bytes are not a decodable MP3, the requested bitrate is not a
// positive integer, or the source is not above that bitrate. Re-encoding is a
// lossy-to-lossy step, so the caller opts in. Bad input resolves to null,
// never a throw, and every temporary file is removed.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE_TIMEOUT_MS = 10_000;
const ENCODE_TIMEOUT_MS = 120_000;
const TEMP_PREFIX = "zhwp-mp3-reencode-";
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

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

// Probes the first audio stream. Returns null when the tool fails, reports no
// audio stream or prints something that is not JSON.
async function probe(path) {
  const result = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,bit_rate,channels,sample_rate,duration:format=bit_rate,duration",
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

  const stream = Array.isArray(info.streams) ? info.streams[0] : undefined;
  if (stream === undefined || stream === null) return null;

  const format = info.format ?? {};
  const bitRate = Number(stream.bit_rate ?? format.bit_rate);
  const duration = Number(stream.duration ?? format.duration);
  const channels = Number(stream.channels);
  const sampleRate = Number(stream.sample_rate);

  return {
    codec: stream.codec_name,
    bitRate: Number.isFinite(bitRate) ? bitRate : NaN,
    duration: Number.isFinite(duration) ? duration : NaN,
    channels: Number.isInteger(channels) ? channels : NaN,
    sampleRate: Number.isInteger(sampleRate) ? sampleRate : NaN,
  };
}

/**
 * Re-encodes an MP3 at a lower constant bitrate.
 * @param {Buffer} mp3 a whole .mp3 file
 * @param {number} kbps target constant bitrate in kbps (positive integer)
 * @returns {Promise<Buffer | null>} the re-encoded file, or null to keep the original bytes
 */
export async function reencodeMp3(mp3, kbps) {
  let dir = null;
  try {
    if (!Number.isInteger(kbps) || kbps <= 0) return null;
    if (!Buffer.isBuffer(mp3) || mp3.length === 0) return null;

    dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
    const inputPath = join(dir, "input.mp3");
    const outputPath = join(dir, "output.mp3");
    writeFileSync(inputPath, mp3);

    const source = await probe(inputPath);
    if (source === null) return null;
    if (source.codec !== "mp3") return null;
    if (!Number.isFinite(source.bitRate) || source.bitRate <= kbps * 1000) return null;
    if (!Number.isFinite(source.sampleRate) || source.sampleRate <= 0) return null;
    if (!Number.isInteger(source.channels) || source.channels <= 0) return null;

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
      String(source.sampleRate),
      "-ac",
      String(source.channels),
    ];
    // Keep the stereo image as joint stereo; mono is selected by -ac above.
    if (source.channels === 2) args.push("-joint_stereo", "1");
    args.push("-f", "mp3", outputPath);

    const encoded = await run("ffmpeg", args, ENCODE_TIMEOUT_MS);
    if (encoded === null) return null;

    const output = readFileSync(outputPath);
    if (output.length === 0 || output.length >= mp3.length) return null;

    // The contract fixes the duration; a mismatch means a broken encode.
    if (Number.isFinite(source.duration)) {
      const result = await probe(outputPath);
      if (result === null) return null;
      if (
        Number.isFinite(result.duration) &&
        Math.abs(result.duration - source.duration) > 0.1
      ) {
        return null;
      }
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

/**
 * Reports whether both ffmpeg and ffprobe can be executed.
 * @returns {Promise<boolean>}
 */
export async function ffmpegAvailable() {
  try {
    const [ffmpeg, ffprobe] = await Promise.all([
      run("ffmpeg", ["-version"], PROBE_TIMEOUT_MS),
      run("ffprobe", ["-version"], PROBE_TIMEOUT_MS),
    ]);
    return ffmpeg !== null && ffprobe !== null;
  } catch {
    return false;
  }
}
