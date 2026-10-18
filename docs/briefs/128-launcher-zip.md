# 128: Launcher: load one or more ZIPs with detailed progress, errors and cancel

Issue #128. Phase 1. Size m. Depends on #127. Owner request 2026-10-18. The
folder pick stays working in this task (it is removed in #133, after the ZIP
path is proven); this task adds the ZIP path next to it.

## Goal
The launcher page loads the game from one or more ZIP files the player picks
or drops, shows detailed progress, lets the player cancel, and shows every
failure clearly.

## Read first
* `web/AGENTS.md`, `web/app/index.html`, `web/src/main.ts`
  (`storeEntries`, `refresh`, `showProgress`), `web/src/zip-import.ts` (#127),
  `web/src/import-error.ts` (#125), `web/src/storage.ts`
* `web/tests/launcher.spec.ts`, `web/tests/launcher-errors.spec.ts`,
  `web/tests/launcher-storage.spec.ts`, `web/tests/helpers/zip.ts` (#126)

## Contract
Ids are the contract. New elements in `web/app/index.html`:
* `#zip-input`: `<input type="file" accept=".zip,application/zip" multiple>`,
  with a visible `<label>` reading `Pick the game ZIP files`.
* `#drop-zone`: a visible area; dropping files on it imports the dropped ZIPs
  like `#zip-input`. Non-ZIP dropped files (by `.zip` extension, case-insensitive)
  are ignored; if none is a ZIP, nothing happens and `#import-error` says so
  with code `not-a-zip`.
* `#import-detail`: text line visible while importing, in the form
  `<doneMB> MB of <totalMB> MB · <filesDone> of <filesTotal> files · <speed> MB/s · <eta> left`
  (`calculating…` instead of the ETA while `etaSeconds` is null; ETA as
  `m:ss` or `h:mm:ss`), plus the current file name in `#import-current`.
  Both hidden when idle. `#import-progress` also reflects the progress.
* `#import-cancel`: button, visible only while importing. Pressing it aborts
  the import; then `#status` reads `Cancelled` and `#import-error` stays hidden.
* `#import-error`: element with `role="alert"`, hidden when there is no error.
  On a failure it shows `describeImportError(error).message` and, below,
  the hint; its `data-code` attribute is the error code. `#status` reads
  `Import failed`. Starting a new import hides it.
* While importing: `#play`, `#clear`, `#zip-input` and the folder input are
  disabled; afterwards they are enabled according to what is stored.
* On success `#status` reads `Ready`, the summary and `#play` update as after
  a folder import, and `navigator.storage.persist()` was requested before the
  first write, as today.
* The existing storage warning (#70) is shown before importing when
  `estimate()` says the free space is below the ZIPs' total size, as today.
* `main.ts` gets the new import path through `importZips`; the folder path
  keeps working unchanged.

## Acceptance criteria
1. The page has `#zip-input` accepting `.zip` with `multiple`, a labelled picker, and `#drop-zone`.
2. Picking one synthetic ZIP with the four REQUIRED archives ends with `#status` containing `Ready`, `#play` enabled and `#stored-summary` `Stored: 4 archives`.
3. Picking two ZIPs (one per game) works as one install.
4. While importing a ~40 MB synthetic ZIP, `#import-detail` is visible and matches the documented format, `#import-current` names a file, and `#import-cancel` is visible; when done they are hidden.
5. Early in the import the ETA reads `calculating…`; later it reads `m:ss`.
6. While importing, `#play`, `#clear` and `#zip-input` are disabled.
7. Pressing `#import-cancel` midway leaves `#status` `Cancelled`, `#import-error` hidden, and the files completed before stored.
8. A ZIP missing a REQUIRED archive shows `#import-error` with `data-code="missing-archives"`, message containing the missing names, and stores nothing.
9. A non-ZIP file, a truncated ZIP and a ZIP with a corrupt entry show `#import-error` with `data-code` `not-a-zip`, `truncated` and `bad-crc`, each with a non-empty message and hint, and `#status` `Import failed`.
10. A forced quota failure (test hook: the page's `navigator.storage` writable throwing `QuotaExceededError`) shows `data-code="quota-exceeded"`.
11. Dropping a ZIP on `#drop-zone` imports it; dropping only a `.txt` shows `data-code="not-a-zip"`.
12. A new import hides the previous `#import-error`.
13. The folder path still passes every existing launcher spec.

## Test paths
`web/tests/launcher-zip.spec.ts`

## Allowed paths
`web/app/index.html`, `web/src/main.ts`

## Check
`cd web && npx playwright test tests/launcher-zip.spec.ts tests/launcher.spec.ts tests/launcher-errors.spec.ts tests/launcher-storage.spec.ts`
