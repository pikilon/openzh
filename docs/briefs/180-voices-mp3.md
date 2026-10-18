# 180: make-game-zip: --voices-mp3 option

Issue #180. Phase 1. Size m. Owner request 2026-10-19: store the voices as MP3.
Checked on this machine with the engine's own miniaudio (default
`ma_decoder_config`, as in `MiniAudioManager.cpp`): a raw MP3 file named
`.wav` initialises, reports its length and decodes to PCM, because the decoder
sniffs the content; the engine does no RIFF parsing of its own. The music is
already MP3 and plays in the engine. Voices in the original game are PCM
(Generals) or IMA ADPCM (Zero Hour); a 48 kbps mono MP3 at 22.05 kHz is about
half the size of that ADPCM.

## Read first
`web/scripts/make-game-zip.mjs`, `web/scripts/lib/mp3-reencode.mjs` (how ffmpeg is
called), `web/scripts/lib/ima-adpcm.mjs`, `web/scripts/lib/big-archive.mjs`,
`docs/briefs/151-make-game-zip-options.md`, `167-make-game-zip-gfx-music.md`,
`web/tests/make-game-zip-options.spec.ts`

## Contract
### `web/scripts/lib/wav-mp3.mjs` (new, ES module, no npm dependencies)
```js
// wav: a whole .wav file; kbps: target constant bitrate (positive integer).
// Resolves to a RAW MP3 file (no RIFF wrapper), or null to keep the original.
export async function encodeWavAsMp3(wav /* Buffer */, kbps /* number */) /* Promise<Buffer | null> */;
```
* Uses `ffmpeg`/`ffprobe` from the PATH like `mp3-reencode.mjs`. Eligible input: a
  RIFF/WAVE file that ffprobe reports as one audio stream with codec `pcm_s16le`
  or `adpcm_ima_wav`, 1 or 2 channels, sample rate 8000 to 48000 Hz. Anything
  else, a bitrate that is not a positive integer or that libmp3lame cannot use
  at that sample rate, ffmpeg missing, a decoding error, a 120 s timeout, or an
  output not smaller than the input resolves to `null`. Never throws.
* Encoding: `libmp3lame`, constant bit rate, the source sample rate and channel
  count kept (no resampling), Xing/LAME header written (so the decoder knows the
  exact length), no ID3 tags. Temporary files live in `os.tmpdir()` and are
  removed on every path.
* The decoded result has the same number of sample frames as the source within
  2,300 frames (encoder delay and padding) and the same duration within 0.1 s.

### `web/scripts/make-game-zip.mjs`
New flag `--voices-mp3 <kbps>`, off by default; everything existing stays.
* Applies to the same archives as `--recode-audio` (`.big` whose lower-cased name
  starts with `speech` or `audio`) and the same entries (`.wav`). Each entry is
  replaced by `encodeWavAsMp3` output (the entry keeps its `.wav` name) when it is
  not `null`.
* With both `--recode-audio` and `--voices-mp3`: the MP3 wins for every entry it
  can encode, always encoded from the ORIGINAL wav (never from the ADPCM
  output); entries MP3 returns `null` for fall back to the ADPCM recode, and
  those that ADPCM cannot shrink keep the original bytes.
* The value must be a positive integer, else exit 2; without ffmpeg and
  ffprobe the run exits 2 with a message before touching anything.
* Entries are encoded with up to 4 ffmpeg processes at a time; the output
  archive keeps the original entry order and is deterministic.
* Prints once: `voices mp3: <n> wav in <m> archives at <k> kbps, saved <bytes> bytes`.
* Failure handling as for the other flags: exit 4 naming the archive, no ZIP, no
  `.partial`, no `.recode-tmp`; the source folder is never modified; unaffected
  files stay byte-identical; the ZIPs open with `openZip` with valid CRCs.

## Acceptance criteria
1. `encodeWavAsMp3` of a 3-second 22050 Hz mono PCM16 WAV (made with ffmpeg) at 48 resolves to a Buffer that does not start with `RIFF`, that `ffprobe` reports as mp3, mono, 22050 Hz, about 48 kbps (within 3 kbps), and that is smaller than the input.
2. The same for an IMA ADPCM WAV input (made with ffmpeg `adpcm_ima_wav`) and a 44100 Hz stereo PCM WAV at 96.
3. The decoded output has the source's frame count within 2,300 frames and its duration within 0.1 s.
4. An 8-bit PCM WAV, a 3-channel file, an MP3 file, random bytes, an empty buffer and a truncated WAV resolve to `null` without throwing; a bitrate of 0, 1.5, -3 or "abc" resolves to `null`; a source whose MP3 would not be smaller (a 1-frame WAV) resolves to `null`.
5. With ffmpeg hidden from the PATH the function resolves to `null`; no temporary file remains in `os.tmpdir()` after success or failure.
6. The engine's decoder accepts the output: when a C compiler and the engine's miniaudio header are available (`build/webgpu/_deps/miniaudio-src/miniaudio.h`; otherwise skipped), a small program using `ma_decoder_init_file` with the default config reads the output stored under a `.wav` name and reports the source's frame count within 2,300 frames.
7. `make-game-zip.mjs --voices-mp3 48` on a synthetic folder with `SpeechEnglish.big` (a PCM16 WAV, an ADPCM WAV, a `.txt`, an 8-bit WAV) and a `Textures.big` containing a WAV-named entry: the first two entries come out as raw MP3 under the same names, the `.txt` and the 8-bit WAV byte-identical, `Textures.big` byte-identical.
8. With `--recode-audio --voices-mp3 48`, an entry MP3 cannot shrink (1-frame WAV) falls back to the ADPCM recode or stays original, and no entry is MP3-encoded from ADPCM output (the MP3's decoded signal matches the original WAV, not a doubly-lossy one: SNR against the original at least 15 dB for a tone-plus-noise input).
9. `--voices-mp3` with 0, -5, 1.5 or abc exits 2; with ffmpeg missing it exits 2 and writes nothing.
10. The summary line reports the WAV count, archives, kbps and saved bytes, matching the difference in archive sizes.
11. A truncated `speech*.big` exits 4 naming it and leaves no ZIP, `.partial` or `.recode-tmp`; after a successful run neither remains and the source folder is unchanged.
12. `--split` with all flags together (`--no-videos --recode-audio --tga-rle --music-kbps 128 --voices-mp3 48`) writes both ZIPs, readable with valid CRCs and with their REQUIRED archives.
13. The existing `make-game-zip`, `-options`, and `-gfx-music` specs still pass.

## Test paths
`web/tests/wav-mp3.spec.ts`, `web/tests/make-game-zip-voices.spec.ts`

## Allowed paths
`web/scripts/lib/wav-mp3.mjs`, `web/scripts/make-game-zip.mjs`

## Check
`cd web && npm ci && npx playwright test tests/wav-mp3.spec.ts tests/make-game-zip-voices.spec.ts tests/make-game-zip-gfx-music.spec.ts tests/make-game-zip-options.spec.ts tests/make-game-zip.spec.ts`
