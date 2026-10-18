# 157: ZIP import replaces the previous install

Issue #157. Phase 1. Size m. Owner request 2026-10-18: "when loading new ZIPs
you must delete what was there before." The browser quota is about 2 GB in the
owner's Brave, so leftovers of earlier imports (31 stale archives, partial
files) fill it and make the next import fail.

## Goal
Loading ZIPs leaves exactly what those ZIPs contain. Whatever an earlier
import stored and the new ZIPs do not bring is removed first, before any new
byte is written, but only once the new ZIPs are known to be good.

## Read first
`web/AGENTS.md`, `web/src/zip-import.ts`, `web/src/opfs-store.ts`,
`web/src/main.ts` (`refresh`, the ZIP import handler), `web/src/import-error.ts`,
`docs/briefs/127-zip-import.md`, `docs/briefs/129-zip-persistence.md`,
`web/tests/zip-import.spec.ts`, `web/tests/zip-persistence.spec.ts`,
`web/tests/launcher-zip.spec.ts`

## Contract
### `importZips` (web/src/zip-import.ts, helpers in web/src/opfs-store.ts)
* After every ZIP is opened and classified and the REQUIRED-archive check
  has passed, and before the first write, the stored install is reconciled
  with the incoming set. The incoming set is every non-directory entry of the
  ZIPs after the existing duplicate rule (first wins): `.big` files by
  `<kind>/<name>`, every other file by `extra/<path>`.
* A stored file (under `zhwp/<kind>/` or `zhwp/extra/`) is **kept** when the
  incoming set has the same key and the same size (it is then skipped by the
  normal write loop, so a re-import after an interruption still resumes). It
  is **removed** otherwise: its key is not in the incoming set, or its size
  differs. Directories left empty under `extra/` are removed too.
* If anything fails before that point (`missing-archives`, `not-a-zip`,
  `truncated`, `multi-disk`, `unsafe-path`, `aborted`), nothing is removed:
  the previous install stays exactly as it was.
* `ImportResult` gains `removed: number` (files removed) and
  `freedBytes: number` (their total size). Removal happens before progress
  reporting starts; `totalBytes` and `filesTotal` stay as today.
* `signal` is honoured during the removal: abort throws
  `ImportError("aborted")`, no new file is written; files already removed
  stay removed. An error while removing becomes `ImportError` with code
  `storage-unavailable`, no new file is written.
* `clearStored()` keeps working as today.

### Launcher (web/src/main.ts, web/app/index.html)
* While the removal runs `#status` reads `Removing the previous install`;
  then it reads `Importing` as today.
* The summary and `#play` reflect the new install when the import ends. A
  rejected import (any failure before the removal point) leaves the previous
  install, the summary and `#play` unchanged.
* The pre-import storage warning (#70) takes the space the removal will free
  into account (free space + bytes to remove), so it is not shown for an
  install that fits once the old one is gone.

## Acceptance criteria
1. After importing install A and then install B (different archive names and extra files), `listStored()` and `listExtra()` contain only B's files; A's files that B lacks are gone.
2. A file present in both with the same size is kept untouched (counted in `skipped`, not rewritten); one with a different size is replaced by the new bytes.
3. The result reports `removed` and `freedBytes` equal to the files and bytes of A that were not kept.
4. Importing a ZIP set that misses a REQUIRED archive, a non-ZIP blob, and a truncated ZIP each throw their error and leave A's files exactly as they were (same list, same bytes).
5. Aborting before the first write (a signal already aborted) throws `aborted` and writes nothing; aborting during removal leaves the unremoved files and writes nothing.
6. Re-importing the same ZIPs after an import interrupted midway keeps the completed files (resume) and removes leftover files that the ZIPs do not contain.
7. Empty subdirectories under `extra/` are removed after their files go.
8. In the launcher, picking ZIPs after an install replaces it: `#stored-summary` shows the new archive count, old-only archives are absent from `listStored()`, and `#status` goes through `Removing the previous install` before `Importing` and `Ready`.
9. In the launcher, picking a bad ZIP after an install shows the error, keeps `#play` enabled and `#stored-summary` unchanged.
10. The storage warning is not shown when `free + bytes to remove` covers the import (forced `estimate()` stub), and is shown when it does not.
11. The existing specs that assumed imports accumulate are updated to the replace rule, and every other existing ZIP, persistence and launcher spec passes.

## Test paths
`web/tests/zip-replace.spec.ts`, `web/tests/zip-import.spec.ts`,
`web/tests/zip-persistence.spec.ts`, `web/tests/launcher-zip.spec.ts`

## Allowed paths
`web/src/zip-import.ts`, `web/src/opfs-store.ts`, `web/src/main.ts`,
`web/app/index.html`, `web/src/test-api.ts`

## Check
`cd web && npm ci && npx playwright test tests/zip-replace.spec.ts tests/zip-import.spec.ts tests/zip-persistence.spec.ts tests/launcher-zip.spec.ts tests/launcher-storage.spec.ts tests/store.spec.ts`
