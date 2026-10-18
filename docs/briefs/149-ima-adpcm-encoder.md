# 149: Tool lib: IMA ADPCM encoder for PCM WAV files

Issue #149. Phase 1. Size m. Owner request 2026-10-18: shrink the game for the
browser by recoding the voices. The engine decodes audio with miniaudio's
`ma_decoder` (default config), whose WAV decoder (dr_wav) reads IMA/DVI ADPCM
(WAVE format tag 0x0011). The game's own `Audio.big` already holds such files.
The voices are 16-bit mono PCM at 22050 Hz, so ADPCM makes them about 4 times
smaller with no change to the engine.

## Goal
A dependency-free Node module that turns a PCM WAV into an IMA ADPCM WAV.

## Read first
`web/AGENTS.md`, `web/scripts/make-game-zip.mjs` (script style, ES modules),
`web/tests/helpers/big.ts`, `web/tests/make-game-zip.spec.ts` (Node-side tests)

## Contract
New file `web/scripts/lib/ima-adpcm.mjs`, ES module, no dependencies.

```js
// wav: a whole .wav file. Returns the recoded file, or null when the input is
// not eligible (the caller then keeps the original bytes).
export function encodeImaWav(wav /* Buffer */) /* Buffer | null */;
```

* Eligible input: RIFF/WAVE with a `fmt ` chunk of format tag 1 (PCM), 16
  bits per sample, 1 or 2 channels, any sample rate, and a non-empty `data`
  chunk. Chunks may appear in any order and may be padded to even length;
  unknown chunks (`LIST`, `fact`, ...) are dropped. A `data` size larger than
  the bytes present is clamped to the bytes present. Anything else (other
  tags, 8/24/32 bits, more channels, no `fmt `/`data`, not RIFF/WAVE, empty
  data) returns `null`; the function never throws on bad input.
* Output: `RIFF`/`WAVE`, then `fmt ` (size 20: tag 0x0011, channels, sample
  rate, byte rate = `ceil(rate * blockAlign / samplesPerBlock)`, block align,
  4 bits per sample, extra size 2, samples per block), `fact` (4 bytes: the
  number of sample frames of the input), `data`. Block align is
  `256 * channels * max(1, floor(rate / 11025))`; samples per block is
  `(blockAlign - 4 * channels) * 8 / (4 * channels) + 1`.
* Encoding is the standard Microsoft IMA/DVI ADPCM: the 89-entry step table
  and the index table `[-1,-1,-1,-1,2,4,6,8]`. Each block starts, per
  channel, with a 4-byte header (int16 LE predictor = the block's first
  sample, uint8 step index, one zero byte); for stereo the following nibbles
  come in groups of 8 samples (4 bytes) per channel, left then right,
  alternating. The last block is padded by repeating the last frame; the
  `fact` count tells the true length. The step index carries across blocks
  of the encoder only as the header says (each block header stores it).
* Pure and deterministic: the same input gives the same bytes.

## Acceptance criteria
1. A 1-second 22050 Hz mono tone-plus-noise WAV encodes to a file whose header parses as: tag 0x0011, 1 channel, 22050 Hz, block align 512, 4 bits, extra size 2, samples per block 1017, and a `fact` chunk equal to 22050.
2. The encoded `data` length is a multiple of the block align and about a quarter of the input (between 0.24 and 0.27 of the input size).
3. Decoding the output with an independent reference decoder written in the test (standard IMA algorithm) gives the same number of frames as the input and a signal-to-noise ratio of at least 25 dB against it for the tone-plus-noise input.
4. The same holds for a stereo input (block align 1024 at 44100 Hz with two different tones in the two channels), per channel.
5. When `ffmpeg` is on the PATH, `ffmpeg` decodes the encoder's output without error to the same frame count and an SNR of at least 25 dB (the test is skipped when `ffmpeg` is absent).
6. Silence encodes and decodes to silence (all decoded samples within ±8 of zero).
7. A 1-frame WAV and a WAV whose length is not a multiple of the samples per block encode and report the true frame count in `fact`.
8. Input with format tag 17 (already ADPCM), 8-bit PCM, 3 channels, a truncated header, random bytes and an empty buffer return `null` without throwing.
9. A `data` chunk that claims more bytes than the file holds is clamped and still encodes; extra chunks (`LIST`) before and after `data` are accepted and dropped from the output.
10. Two calls on the same input return byte-identical buffers.

## Test paths
`web/tests/ima-adpcm.spec.ts`

## Allowed paths
`web/scripts/lib/ima-adpcm.mjs`

## Check
`cd web && npm ci && npx playwright test tests/ima-adpcm.spec.ts`
