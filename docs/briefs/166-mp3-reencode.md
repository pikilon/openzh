# 166: Tool lib: MP3 re-encoder for music (ffmpeg)

Issue #166. Phase 1. Size s. Owner request 2026-10-19: compression experiments
one by one. The 56 music tracks are MP3: 53 at 192 kbps stereo 44.1 kHz, one at
256, one at 160, one at 64 mono; 192 MB in all. Re-encoding the ones above a
chosen bitrate to that bitrate saves about a third at 128 kbps with a small,
mostly inaudible loss (it is a lossy-to-lossy step, so it is opt-in, off by
default, and only ever shrinks files).

## Goal
A Node module that re-encodes an MP3 to a lower constant bitrate with ffmpeg
and reports when it should be left alone.

## Read first
`web/AGENTS.md`, `web/scripts/lib/ima-adpcm.mjs` (module style),
`web/tests/ima-adpcm.spec.ts` (Node tests; criterion 5 shows how an optional
`ffmpeg` test is skipped)

## Contract
New file `web/scripts/lib/mp3-reencode.mjs`, ES module, no npm dependencies.
It uses the `ffmpeg` and `ffprobe` executables from the PATH through
`node:child_process` (an external tool the maker script may require).

```js
// mp3: a whole .mp3 file; kbps: target constant bitrate (positive integer).
// Resolves to the re-encoded file, or null to keep the original bytes.
export async function reencodeMp3(mp3 /* Buffer */, kbps /* number */) /* Promise<Buffer | null> */;
// true when both ffmpeg and ffprobe run.
export async function ffmpegAvailable() /* Promise<boolean> */;
```

* The input is probed with `ffprobe` (codec, bit rate, channels, sample rate,
  duration). Returns `null` when: ffmpeg or ffprobe is unavailable, the input
  is not decodable MP3 audio, `kbps` is not a positive integer, the source
  bit rate is not above `kbps` (never re-encode up or sideways), the source
  has no audio stream, or the output is not smaller than the input.
* Encoding: `libmp3lame`, constant bit rate `kbps`, joint stereo kept when the
  source is stereo and mono kept when mono, the sample rate and channel
  count of the source preserved, no resampling, ID3 tags and cover art
  dropped. Input and output go through pipes or temporary files in
  `os.tmpdir()` that are removed on every path, including errors.
* The result must have the same duration as the source within 0.1 s.
* Never throws on bad input: errors resolve to `null`. A call that takes
  longer than 120 seconds is killed and resolves to `null`.

## Acceptance criteria
1. `ffmpegAvailable()` resolves to a boolean and is true on a machine with both tools (the tests below are skipped when it is false).
2. A 10-second 192 kbps stereo 44.1 kHz test MP3 (made in the test with ffmpeg from a generated tone and noise) re-encoded at 128 resolves to a Buffer that `ffprobe` reports as MP3, 128 kbps (within 2 kbps), 2 channels, 44100 Hz.
3. The output duration equals the source duration within 0.1 s, and it is smaller than the input.
4. A mono 64 kbps source with `kbps` 128 resolves to `null` (never re-encode up), and so does a 128 kbps source with `kbps` 128.
5. A 160 kbps source with `kbps` 128 is re-encoded; with `kbps` 192 it resolves to `null`.
6. Random bytes, an empty buffer and a truncated MP3 resolve to `null` without throwing; a WAV file resolves to `null`.
7. A non-positive, fractional or non-numeric `kbps` resolves to `null`.
8. When `ffmpeg` is hidden from the PATH (the test runs the call with `PATH` limited to an empty directory through a child process), `reencodeMp3` resolves to `null` and `ffmpegAvailable()` to false.
9. No temporary file created by the call remains in `os.tmpdir()` afterwards, on success and on failure.
10. The decoded audio of the output correlates with the source: the RMS of the difference between both decoded signals (mono mix, same length) is below 15 % of the source RMS.

## Test paths
`web/tests/mp3-reencode.spec.ts`

## Allowed paths
`web/scripts/lib/mp3-reencode.mjs`

## Check
`cd web && npm ci && npx playwright test tests/mp3-reencode.spec.ts`
