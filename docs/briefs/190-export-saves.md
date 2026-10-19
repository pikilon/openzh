# 190: Export the saved games as a ZIP from the top menu

Issue #190. Phase 1. Size m. Owner's request (2026-10-19): "posibilidad de
exportar partidas guardadas en un zip (menú superior)".

The hamburger menu is the "top menu" (as opposed to the top bar of #192). A
player needs a copy of the engine's saved games before changing computer or
clearing browser storage. The saves live on the IDBFS mount described in #189;
the export reads that database, never the game archives.

## Contract

* `web/src/zip-write.ts` is a pure ZIP writer: `buildZip(entries)` with
  `{path, data, mtime?}`. It writes UTF-8 names (general-purpose bit 11),
  method 0 (stored), CRC-32, DOS date/time from `mtime`, local headers, the
  central directory and the end record. Duplicate paths, an absolute path or
  a `..` segment throw. More than 65535 entries or more than 4 GiB throw.
  The result is a `Blob` with type `application/zip`.
* `web/src/saves.ts` adds `savedGamesZip(flush?)`: when `flush` is given it is
  awaited first (the page passes the engine's `saveUserData`, so a save made in
  the last ten seconds is in IndexedDB); then it reads `listSavedGames()` and
  returns `null` for zero saves, otherwise a `{ blob, count }`.
* The menu gets a "Saved games" section with `#saves-summary` and
  `#export-saves`. Opening the menu refreshes the summary ("Saved games: N" /
  "Saved games: none" / "Saved games: unavailable"); the button is disabled
  when there is nothing to export and while a refresh is in flight.
* Clicking `#export-saves` flushes the engine (when it has a mounted FS),
  reads the saves, downloads `openzh-saves-<YYYY-MM-DD>.zip`, and reports in
  `#saves-status` how many files were exported. Zero saves keeps the button
  disabled and says so. A read failure shows a message and never throws out of
  the page.
* The page creates the download with an object URL and a temporary `<a
  download>`; the URL is revoked afterwards.
* No game data in tests: synthetic IDBFS entries and the fake engine.

## Acceptance criteria

1. `buildZip` round-trips nested paths, a UTF-8 name, an empty file and a
   multi-byte payload through `openZip`/`entryStream`, with method 0, bit 11
   set and matching CRC-32.
2. `buildZip` rejects a duplicate path, an absolute path and a `..` segment.
3. With two seeded IDBFS saves, opening the menu shows "Saved games: 2" and
   enables `#export-saves`.
4. Clicking `#export-saves` downloads one ZIP named
   `openzh-saves-YYYY-MM-DD.zip` whose entries are the two save paths with
   their exact bytes, and `#saves-status` reports 2.
5. With no saves the summary says "Saved games: none", the button is disabled
   and no download starts.
6. `listSavedGames()` ignores directory entries and files outside `Save/`
   (covered with #189's fixtures).

## Test paths

* `web/tests/zip-write.spec.ts`: criteria 1-2 (pure Node test).
* `web/tests/saves.spec.ts`: criteria 3-6 and #189.

## Allowed paths

* `web/src/zip-write.ts`
* `web/src/saves.ts`
* `web/src/main.ts`
* `web/app/index.html`
* `web/app/shell.css`
* `web/tests/zip-write.spec.ts`
* `web/tests/saves.spec.ts`

## Check command

`cd web && npx playwright test tests/zip-write.spec.ts tests/saves.spec.ts`

Before the change the menu has no `#export-saves` and `zip-write.ts` does not
exist; the new tests fail at the missing module and the missing control.
