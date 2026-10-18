# 167: make-game-zip: --tga-rle and --music-kbps options

Issue #167. Phase 1. Size m. Depends on #164 and #166. Owner request
2026-10-19: apply the compression experiments that do not damage quality, one
by one, as options of the ZIP maker.

## Goal
`make-game-zip.mjs` can store the TGA textures RLE-encoded (lossless) and
re-encode the music at a lower bit rate while it packs.

## Read first
`web/scripts/make-game-zip.mjs`, `web/scripts/lib/tga-rle.mjs` (#164),
`web/scripts/lib/mp3-reencode.mjs` (#166), `web/scripts/lib/big-archive.mjs`,
`docs/briefs/151-make-game-zip-options.md`, `web/tests/make-game-zip-options.spec.ts`

## Contract
Two new flags, both off by default; every existing flag and behaviour stays.

* `--tga-rle`: every `.big` is scanned; for each entry whose name ends in
  `.tga` (case-insensitive) `encodeTgaRle` runs and the result replaces the
  entry when it is not `null`. Other entries are untouched. Rebuilt archives
  are written with `rewriteBig` to the same temporary `.recode-tmp` folder
  `--recode-audio` uses and packed under the original path and name. Prints
  `rle textures: <n> tga in <m> archives, saved <bytes> bytes` once.
* `--music-kbps <n>`: for each `.big` entry whose name ends in `.mp3`
  `reencodeMp3(data, n)` runs (entries are processed one at a time) and the
  result replaces the entry when it is not `null`. If `ffmpeg` or `ffprobe` is
  unavailable the run exits 2 with a message before touching anything. The
  value must be a positive integer, else exit 2. Prints
  `music: <n> mp3 re-encoded at <k> kbps in <m> archives, saved <bytes> bytes` once.
* The flags combine with each other and with `--recode-audio`, `--no-videos`
  and `--split`; an archive that several flags touch is rewritten once, with
  every transform applied to its own entries. The REQUIRED-archive check,
  the splitting rule and the output naming use the original paths.
* A failure on one archive exits 4 naming it, writes no ZIP and leaves no
  `.partial` or `.recode-tmp`. The source folder is never modified.
* Unaffected entries and files stay byte-identical, and the ZIPs open with
  `openZip` with valid CRCs.

## Acceptance criteria
1. Without the new flags every entry of every output ZIP is byte-identical to the source file (as before this change).
2. With `--tga-rle`, a synthetic `Textures.big` holding a flat 64x64 TGA, a noisy TGA that does not shrink, a DDS and a `.txt` comes out with the flat TGA RLE-encoded (image type 10, same decoded pixels), and the other three entries byte-identical.
3. With `--tga-rle`, `.big` archives without `.tga` entries are packed byte-identical, and TGA entries in any archive name are encoded.
4. The summary line `rle textures: ...` reports the number of TGA files, archives and saved bytes, matching the difference in archive sizes.
5. With `--music-kbps 128` (test skipped without ffmpeg), a `Music.big` holding a 192 kbps MP3, a 64 kbps MP3 and a `.txt` comes out with the 192 kbps entry re-encoded at 128 kbps (ffprobe) and the other two byte-identical; the summary line reports counts and saved bytes.
6. `--music-kbps` with a value of 0, -5, 1.5 or abc exits 2; with ffmpeg missing from the PATH it exits 2 and writes nothing.
7. `--tga-rle --music-kbps 128 --recode-audio --no-videos --split` together produce `zero-hour.zip` and `generals.zip`, each readable with valid CRCs and its REQUIRED archives, with an archive touched by several flags rewritten once.
8. A corrupt (truncated) `.big` exits 4 naming it, with no ZIP, `.partial` or `.recode-tmp` left, for either flag.
9. After a successful run no `.recode-tmp` folder or `.partial` file remains in `--out`; the source folder is unchanged.
10. The existing `make-game-zip` and `make-game-zip-options` specs still pass.

## Test paths
`web/tests/make-game-zip-gfx-music.spec.ts`

## Allowed paths
`web/scripts/make-game-zip.mjs`

## Check
`cd web && npm ci && npx playwright test tests/make-game-zip-gfx-music.spec.ts tests/make-game-zip-options.spec.ts tests/make-game-zip.spec.ts`
