// IMA/DVI ADPCM encoder for PCM WAV files
// (docs/briefs/149-ima-adpcm-encoder.md).
//
// encodeImaWav turns a 16-bit mono or stereo PCM WAV into the Microsoft IMA
// ADPCM layout miniaudio's decoder reads (WAVE format tag 0x0011): per block,
// a 4-byte header per channel (int16 predictor, uint8 step index, zero byte)
// and then 4-bit nibbles, stereo in groups of 8 samples per channel. The last
// block is padded by repeating the last frame and the `fact` chunk carries the
// true frame count. Input that is not eligible returns null, never a throw.

const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
  73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
  494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272,
  2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
  10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8];

const PCM_TAG = 1;
const IMA_TAG = 0x0011;
const PCM_BITS = 16;
const MAX_STEP_INDEX = 88;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

const RIFF_HEADER_BYTES = 12;
const FMT_CHUNK_BYTES = 28; // 8-byte header + 20-byte body.
const FACT_CHUNK_BYTES = 12; // 8-byte header + 4-byte body.
const DATA_HEADER_BYTES = 8;
const DATA_OFFSET = RIFF_HEADER_BYTES + FMT_CHUNK_BYTES + FACT_CHUNK_BYTES + DATA_HEADER_BYTES;

function clamp16(value) {
  return value < -32768 ? -32768 : value > 32767 ? 32767 : value;
}

function clampStepIndex(value) {
  return value < 0 ? 0 : value > MAX_STEP_INDEX ? MAX_STEP_INDEX : value;
}

// Encodes one sample against the running state, returning the 4-bit nibble.
// The reconstructed predictor and step index match what a decoder computes
// from that nibble, so both sides stay in sync.
function encodeNibble(sample, state) {
  const step = STEP_TABLE[state.index];
  let difference = sample - state.predictor;
  let nibble = 0;
  if (difference < 0) {
    nibble = 8;
    difference = -difference;
  }
  let delta = step >> 3;
  if (difference >= step) {
    nibble |= 4;
    difference -= step;
    delta += step;
  }
  if (difference >= step >> 1) {
    nibble |= 2;
    difference -= step >> 1;
    delta += step >> 1;
  }
  if (difference >= step >> 2) {
    nibble |= 1;
    difference -= step >> 2;
    delta += step >> 2;
  }
  state.predictor = clamp16(state.predictor + (nibble & 8 ? -delta : delta));
  state.index = clampStepIndex(state.index + INDEX_TABLE[nibble & 7]);
  return nibble;
}

// Walks the chunks in file order. Unknown chunks are ignored, `data` and other
// chunk sizes are clamped to the bytes actually present, and chunks may be
// padded to even length. Returns the fmt fields and the data bytes, or null.
function readChunks(wav) {
  if (!Buffer.isBuffer(wav) || wav.length < RIFF_HEADER_BYTES) return null;
  if (wav.toString("ascii", 0, 4) !== "RIFF") return null;
  if (wav.toString("ascii", 8, 12) !== "WAVE") return null;

  let fmt = null;
  let data = null;
  let at = RIFF_HEADER_BYTES;
  while (at + 8 <= wav.length) {
    const id = wav.toString("ascii", at, at + 4);
    const declared = wav.readUInt32LE(at + 4);
    const start = at + 8;
    const size = Math.min(declared, wav.length - start);
    if (id === "fmt " && fmt === null && size >= 16) {
      fmt = wav.subarray(start, start + 16);
    } else if (id === "data" && data === null && size > 0) {
      data = wav.subarray(start, start + size);
    }
    at = start + size + (size & 1);
  }

  if (fmt === null || data === null) return null;
  return {
    tag: fmt.readUInt16LE(0),
    channels: fmt.readUInt16LE(2),
    sampleRate: fmt.readUInt32LE(4),
    bits: fmt.readUInt16LE(14),
    data,
  };
}

/**
 * Recodes a PCM WAV file as IMA ADPCM.
 * @param {Buffer} wav a whole .wav file
 * @returns {Buffer | null} the recoded file, or null when the input is not eligible
 */
export function encodeImaWav(wav) {
  const parsed = readChunks(wav);
  if (parsed === null) return null;

  const { tag, channels, sampleRate, bits, data } = parsed;
  if (tag !== PCM_TAG || bits !== PCM_BITS) return null;
  if (channels !== 1 && channels !== 2) return null;
  if (sampleRate === 0) return null;

  const frameBytes = channels * 2;
  const totalFrames = Math.floor(data.length / frameBytes);
  if (totalFrames === 0) return null;

  const blockAlign = 256 * channels * Math.max(1, Math.floor(sampleRate / 11025));
  const samplesPerBlock = ((blockAlign - 4 * channels) * 8) / (4 * channels) + 1;
  if (samplesPerBlock > MAX_U16) return null;
  const byteRate = Math.ceil((sampleRate * blockAlign) / samplesPerBlock);
  if (byteRate > MAX_U32) return null;

  const blocks = Math.ceil(totalFrames / samplesPerBlock);
  const encodedBytes = blocks * blockAlign;
  const totalBytes = DATA_OFFSET + encodedBytes;
  if (totalBytes - 8 > MAX_U32) return null;

  const out = Buffer.alloc(totalBytes);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(totalBytes - 8, 4);
  out.write("WAVE", 8, "ascii");

  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(20, 16);
  out.writeUInt16LE(IMA_TAG, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(4, 34);
  out.writeUInt16LE(2, 36);
  out.writeUInt16LE(samplesPerBlock, 38);

  out.write("fact", 40, "ascii");
  out.writeUInt32LE(4, 44);
  out.writeUInt32LE(totalFrames, 48);

  out.write("data", 52, "ascii");
  out.writeUInt32LE(encodedBytes, 56);

  const lastFrame = totalFrames - 1;
  const states = Array.from({ length: channels }, () => ({ predictor: 0, index: 0 }));
  const sampleAt = (frame, channel) => data.readInt16LE((frame * channels + channel) * 2);

  for (let block = 0; block < blocks; block++) {
    const blockStart = block * samplesPerBlock;
    const offset = DATA_OFFSET + block * blockAlign;

    for (let channel = 0; channel < channels; channel++) {
      const state = states[channel];
      const first = sampleAt(Math.min(blockStart, lastFrame), channel);
      state.predictor = first;
      out.writeInt16LE(first, offset + 4 * channel);
      out[offset + 4 * channel + 2] = state.index;
      out[offset + 4 * channel + 3] = 0;
    }

    if (channels === 1) {
      const state = states[0];
      let at = offset + 4;
      for (let index = 1; index < samplesPerBlock; index += 2) {
        let byte = encodeNibble(sampleAt(Math.min(blockStart + index, lastFrame), 0), state);
        byte |= encodeNibble(sampleAt(Math.min(blockStart + index + 1, lastFrame), 0), state) << 4;
        out[at++] = byte;
      }
    } else {
      const groups = (samplesPerBlock - 1) / 8;
      let at = offset + 8;
      for (let group = 0; group < groups; group++) {
        const first = blockStart + 1 + group * 8;
        for (let channel = 0; channel < 2; channel++) {
          const state = states[channel];
          for (let pair = 0; pair < 8; pair += 2) {
            let byte = encodeNibble(sampleAt(Math.min(first + pair, lastFrame), channel), state);
            byte |= encodeNibble(sampleAt(Math.min(first + pair + 1, lastFrame), channel), state) << 4;
            out[at++] = byte;
          }
        }
      }
    }
  }

  return out;
}
