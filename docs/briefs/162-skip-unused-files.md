# 162: ZIP import keeps only the game archives (.big)

Issue #162. Phase 1. Size s. Owner request 2026-10-18: skip what the engine does
not use. **No new tests (owner decision, an exception to D-05's test step);**
the check is the existing suite. The engine only ever reads the stored `.big`
archives (`web/src/mount.ts` mounts exactly `listStored()`); the files stored
under `zhwp/extra/` (videos, executables, DLLs, data files) are never read.
They cost about 700 MB for an original copy, which matters under the ~2 GB
browser quota.

## Read first
`web/src/zip-import.ts`, `web/src/opfs-store.ts`, `web/src/main.ts`,
`web/src/mount.ts`, `docs/briefs/127-zip-import.md`, `157-zip-replace-install.md`

## Contract
* `importZips` imports only entries that `classifyArchives` treats as archives
  (name ends in `.big`, case-insensitive; the existing duplicate rule applies).
  Every other entry is ignored: not written, not counted in `totalBytes`,
  `filesTotal`, `written` or `skipped`, and not an error. `ImportResult.extra`
  stays in the type and is always 0.
* The replace rule (#157) now sees only archives in the incoming set, so any
  `extra/` file left by an older import is removed by the next import.
* One-time cleanup: when the launcher starts, any existing `zhwp/extra` tree
  is removed (it is dead weight), before the stored summary is computed, with
  errors ignored (cleanup must never block the page). `listExtra()` stays as an
  API and returns an empty list afterwards.
* The pre-import storage warning (#70) and the summary count only archives.
* `docs/decisions.md` D-10: add one sentence to its Consequences saying that
  since 2026-10-18 the import keeps only `.big` archives because the engine
  reads nothing else, and that this supersedes "nothing filtered".
* `make-game-zip.mjs` is not changed (full ZIPs still pack everything).
* Existing specs that assert non-`.big` files are stored under `extra/` are
  edited minimally to the new rule (assert they are ignored instead); no new
  specs are written.

## Allowed paths
`web/src/zip-import.ts`, `web/src/opfs-store.ts`, `web/src/main.ts`,
`docs/decisions.md`, `web/tests/zip-import.spec.ts`, `web/tests/zip-persistence.spec.ts`,
`web/tests/zip-replace.spec.ts`, `web/tests/launcher-zip.spec.ts`,
`web/tests/launcher-storage.spec.ts`, `web/tests/store.spec.ts`

## Check
`cd web && npm ci && npx playwright test`
