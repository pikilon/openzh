# 151: make-game-zip: --no-videos and --recode-audio options

Issue #151. Phase 1. Size m. Depends on #149 and #150. Owner request
2026-10-18: after the video test went well (the game reaches the menu with
no `.bik` files), the ZIPs can leave out the videos and carry the voices as
IMA ADPCM. Both are options; the default output stays the whole game.

## Goal
`make-game-zip.mjs` can leave out the videos and recode the voices while it
packs, so the ZIPs the launcher loads are about 1.2 GB smaller.

## Read first
`web/scripts/make-game-zip.mjs`, `web/scripts/lib/ima-adpcm.mjs` (#149),
`web/scripts/lib/big-archive.mjs` (#150), `web/tests/make-game-zip.spec.ts`,
`docs/briefs/131-make-game-zip.md`

## Contract
Two new flags, both off by default; every existing flag and behaviour stays.

* `--no-videos`: files whose name ends in `.bik` (case-insensitive) are not
  packed. The summary line per ZIP is unchanged; an extra line
  `skipped videos: <n> files, <bytes> bytes` is printed once.
* `--recode-audio`: every `.big` whose lower-cased file name starts with
  `speech` or `audio` is rebuilt with `rewriteBig` before being packed: for
  each entry whose name ends in `.wav` (case-insensitive) `encodeImaWav`
  runs; the result replaces the entry only when it is not `null` and is
  smaller than the original, otherwise the original bytes stay. The rebuilt
  archive goes to a temporary file inside `--out` (a `.recode-tmp` folder,
  removed at the end and on error, also when the process fails) and is
  packed under the original relative path and name. The source folder is
  never modified. Other `.big` files are packed untouched. An extra line
  `recoded audio: <n> wav in <m> archives, saved <bytes> bytes` is printed once.
* The REQUIRED-archive check, the splitting rule and the output naming use the
  original paths. A recode failure on one archive (code from #150 or an
  exception) exits 4 naming the archive, writes no ZIP and leaves no
  `.partial` or `.recode-tmp`.
* Both flags together are allowed. Unaffected files stay byte-identical, and
  the ZIPs open with `openZip` and stream with valid CRCs.

## Acceptance criteria
1. Without the new flags every file of the source folder is in the ZIPs with identical bytes, including `.bik` files and unrecoded `speech*.big` archives.
2. With `--no-videos`, no entry ending in `.bik` or `.BIK` is in any ZIP, every other file is present with identical bytes, and the extra summary line reports the skipped count and bytes.
3. With `--recode-audio`, a `SpeechEnglish.big` holding a PCM 16-bit WAV, an already-ADPCM WAV, a `.txt` and an 8-bit WAV comes out with the PCM WAV recoded (tag 0x0011, same frame count) and the other three entries byte-identical.
4. With `--recode-audio`, a recoded entry that would not be smaller (a 1-frame WAV) keeps its original bytes.
5. `.big` files whose names do not start with `speech` or `audio` are packed byte-identical even if they contain WAV entries.
6. The names, order and relative paths of the ZIP entries are the same with and without the flags (apart from skipped videos), and the recoded archive's size differs from the original.
7. The summary line `recoded audio: ...` reports the number of WAV files, archives and the saved bytes, matching the difference in total archive sizes.
8. After a successful run no `.recode-tmp` folder or `.partial` file remains in `--out`.
9. A corrupt `speech*.big` (truncated) exits 4 naming the archive, with no ZIP, `.partial` or `.recode-tmp` left.
10. Both flags together with `--split` produce `zero-hour.zip` and `generals.zip`, each readable by `openZip` with valid CRCs and its REQUIRED archives.
11. The source folder is unchanged after any run (same file list, sizes and modification times).

## Test paths
`web/tests/make-game-zip-options.spec.ts`

## Allowed paths
`web/scripts/make-game-zip.mjs`

## Check
`cd web && npm ci && npx playwright test tests/make-game-zip-options.spec.ts tests/make-game-zip.spec.ts`
