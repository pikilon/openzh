# 127: ZIP import: stream a ZIP's files into OPFS with progress and abort

Issue #127. Phase 1. Size m. Depends on #125 and #126. Owner request
2026-10-18: the whole game is loaded, nothing is left out, and nothing
touches a server: the ZIPs are read from the player's disk and written to
OPFS in the page.

## Goal
`importZips` takes one or more ZIP blobs and leaves the game stored in OPFS,
streaming, with progress, abort and typed errors.

## Read first
* `web/AGENTS.md`, `web/src/zip.ts` (#126), `web/src/import-error.ts` (#125),
  `web/src/opfs-store.ts`, `web/src/install.ts`, `web/src/storage.ts`,
  `web/tests/store.spec.ts` (page tests through `/harness/index.html`),
  `docs/decisions.md` D-03

## Contract
New file `web/src/zip-import.ts`; additions to `web/src/opfs-store.ts`.

```ts
export interface ImportProgress {
  doneBytes: number; totalBytes: number;
  filesDone: number; filesTotal: number;
  currentFile: string;
  bytesPerSecond: number;           // moving average over the last ~3 s
  etaSeconds: number | null;        // null until 1 s of data exists
}
export interface ImportOptions {
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}
export interface ImportResult {
  written: number; skipped: number;         // files, extra files included
  archives: { kind: GameKind; name: string; size: number }[];
  extra: number;                            // non-.big files in `written + skipped`
}
export function importZips(zips: Blob[], options?: ImportOptions): Promise<ImportResult>;
```

* Everything in the ZIPs is imported; nothing is filtered by extension.
  Directory entries create nothing by themselves.
* `.big` entries (by `classifyArchives` over every non-directory path of all
  ZIPs, which also decides `kind` and the duplicate rule: the first wins) are
  stored exactly where the engine reads them today: `zhwp/<kind>/<name>`.
  Every other file goes to `zhwp/extra/<entry path>` with subdirectories
  created as needed. `listStored()` keeps listing only the `.big` files.
  New in `opfs-store.ts`: `listExtra(): Promise<{ path: string; size: number }[]>`
  sorted by path; `clearStored()` removes both.
* Before writing anything, all ZIPs are opened and classified. If a REQUIRED
  archive is missing across all of them, throw `ImportError("missing-archives",
  { missing })` and write nothing.
* A file whose stored size already equals the entry size is skipped (counts
  as done at once). Same path in two ZIPs: the first wins.
* Each file is streamed from `entryStream` into a writable obtained with
  `createWritable` and committed on close, so a file that fails midway leaves
  the previous content or nothing, never a partial file. Memory stays
  bounded (no whole-file buffering).
* Progress: `totalBytes` is the sum of all non-directory entry sizes;
  `doneBytes` never decreases and ends equal to `totalBytes`; `onProgress`
  is called at most every 100 ms while data flows, and always at the end of
  each file and at the very end.
* `signal`: if aborted before or during the import, stop within one chunk
  and throw `ImportError("aborted")`; files already completed stay; the file
  in flight is not left behind.
* Failures are `ImportError`s: a `QuotaExceededError` becomes `quota-exceeded`
  (with `needed` = bytes still to write and `free` from `navigator.storage.estimate()`
  when available); storage errors become `storage-unavailable`; ZIP errors
  from #126 pass through unchanged; anything else becomes `read-failed` with
  `detail.file`. Completed files stay stored.
* `web/src/test-api.ts` re-exports `importZips`, `listExtra`.

## Acceptance criteria
1. Importing one synthetic ZIP with the four REQUIRED archives stores them at `zhwp/<kind>/<name>` with the right sizes and bytes, and `listStored()` lists only them.
2. Non-`.big` files, including ones in nested folders, are stored under `extra/` with their relative path and bytes, and `listExtra()` lists them sorted.
3. Two ZIPs (one per game) import as one install; the first copy of a duplicate path wins.
4. A set of ZIPs missing a REQUIRED archive throws `missing-archives` with `detail.missing` and stores nothing, not even the other files.
5. Importing the same ZIP again writes nothing (`written` 0, `skipped` equal to the file count).
6. `onProgress` is monotonic, ends with `doneBytes === totalBytes` and `filesDone === filesTotal`, and reports `currentFile` and a finite `bytesPerSecond`.
7. `etaSeconds` is `null` at the first call and a non-negative number later in a 40 MB import.
8. Aborting midway throws `aborted`, keeps the files completed before, and leaves no partial file (a re-import completes the rest).
9. A corrupt entry (flipped byte) throws `bad-crc` with `detail.file`, keeps earlier files, and leaves the previous content of that file intact when it existed.
10. A truncated ZIP throws `truncated`; a non-ZIP blob throws `not-a-zip`.
11. A forced `QuotaExceededError` from the writable becomes `quota-exceeded` and keeps the files completed before.
12. Importing a 64 MiB stored entry keeps JS heap growth under 48 MiB (`performance.memory` or an instrumented chunk count).
13. `clearStored()` removes the `extra` files too.

## Test paths
`web/tests/zip-import.spec.ts`

## Allowed paths
`web/src/zip-import.ts`, `web/src/opfs-store.ts`, `web/src/test-api.ts`

## Check
`cd web && npm ci && npx playwright test tests/zip-import.spec.ts tests/zip.spec.ts tests/store.spec.ts`
