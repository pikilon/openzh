# 131: Tool: script that builds the full-game ZIPs outside the repo

Issue #131. Phase 1. Size m. Depends on #126. Owner request 2026-10-18: for
the final tests the whole game is packed into ZIPs (two batches, one per
game, because Brave's reported quota is about 2 GB, see #70). Nothing of the
game is ever written inside the repository.

## Goal
`node scripts/make-game-zip.mjs` packs an installed game folder into the ZIP
files the launcher loads, with no filtering.

## Read first
* `web/AGENTS.md`, `AGENTS.md` (Legal Limits), `scripts/check-no-ea-assets.sh`,
  `web/src/zip.ts`, `web/tests/helpers/zip.ts`, `web/scripts/serve.mjs`
  (script style)

## Contract
New `web/scripts/make-game-zip.mjs`, Node only, no dependencies (it writes
the ZIP format itself: stored method, ZIP64 records when a size or offset
exceeds 4 GiB - 1 or the file count 65535; streaming from disk, never
reading a whole file into memory).

```
node scripts/make-game-zip.mjs --src <dir> --out <dir> [--split]
```

* `--src` defaults to `$ZHWP_GAME_DIR`; neither set → exit 2 with a message.
  `--src` must be an existing directory, else exit 2.
* `--out` is required and must be an existing or creatable directory that is
  **not inside the repository** (the git top level containing the script):
  inside → exit 2 with `refusing to write game data inside the repository`.
* Every regular file under `--src` is packed, at any depth, nothing skipped,
  keeping its path relative to `--src` with `/` separators. Symlinks and
  special files are skipped with one warning line each.
* Without `--split`: one file `game.zip`. With `--split`: files are grouped
  into the two installs the folder holds: a file belongs to `zero-hour.zip`
  when any directory segment of its relative path, lower-cased, contains
  `zero hour`, and otherwise to `generals.zip`. Each ZIP must contain its own REQUIRED
  archives (`INIZH.big`, `W3DZH.big` / `INI.big`, `W3D.big`); if a group
  lacks them, exit 3 naming the missing ones and writing nothing.
* The ZIPs are written to a `.partial` name and renamed when finished, so an
  interrupted run leaves no file that looks complete.
* Prints one line per ZIP: path, file count, bytes. Exit 0.
* The output opens with `openZip` from `web/src/zip.ts` and every entry
  streams with a valid CRC.
* No game bytes are logged or copied anywhere else.

## Acceptance criteria
1. On a synthetic source folder with a Zero Hour and a Generals install (nested), `--split` writes `zero-hour.zip` and `generals.zip`, each readable by `openZip`, each with its REQUIRED archives.
2. Without `--split` one `game.zip` contains every file of the folder, none skipped, with relative `/` paths, and each entry's bytes and CRC match the source.
3. A source file larger than 4 GiB is not needed: a test forces ZIP64 records with a small hidden option `--zip64` and the output still opens with `openZip` and matches.
4. `--out` inside the repository exits 2 with the documented message and writes nothing.
5. Missing `--src` and `$ZHWP_GAME_DIR`, or a non-directory `--src`, exits 2.
6. With `--split`, a group missing a REQUIRED archive exits 3, names it, and leaves no ZIP or `.partial` file.
7. An interrupted run (the test kills it) leaves no `*.zip` that opens, only `.partial` or nothing.
8. Symlinks are skipped with a warning, regular files are packed.
9. Memory stays flat: packing a 200 MB synthetic file keeps the process RSS growth under 100 MB.

## Test paths
`web/tests/make-game-zip.spec.ts`

## Allowed paths
`web/scripts/make-game-zip.mjs`

## Check
`cd web && npx playwright test tests/make-game-zip.spec.ts tests/zip.spec.ts`
