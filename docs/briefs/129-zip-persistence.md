# 129: Persistence: a stored install survives reloads and a partial import resumes

Issue #129. Phase 1. Size s. Depends on #128. Owner request 2026-10-18: once
the game is loaded, the page must not ask for it again on every visit.

## Goal
Prove, and fix where needed, that a ZIP import survives reloads and browser
restarts, and that an interrupted import costs only the missing files.

## Read first
* `web/AGENTS.md`, `web/src/main.ts` (`refresh`, `storeEntries`),
  `web/src/zip-import.ts`, `web/src/opfs-store.ts`, `web/src/storage.ts`
* `web/tests/launcher-zip.spec.ts` (#128), `web/tests/launcher-storage.spec.ts`

## Contract
* After a successful ZIP import, reloading the page (same origin, same
  profile) shows `#stored-summary` `Stored: 4 archives`, `#play` enabled and
  `#status` not `Importing`, with no network request for any ZIP and no
  prompt. Nothing needs to be picked again.
* After an import interrupted by closing the page (or a forced failure), the
  stored files are exactly the completed ones; picking the same ZIPs again
  writes only the rest (`skipped` equals the completed count) and ends
  `Ready`.
* `navigator.storage.persist()` is requested once per import, before the
  first write; when the browser grants it the launcher shows `(persistent)`
  in the storage line as today, and when it denies it the import still
  works and the storage line says the storage may be cleared by the browser
  when space is low (one added sentence, no error).
* `#clear` removes the `.big` archives and the `extra` files; after a reload
  the page shows `Stored: 0 archives` and `#play` disabled.
* A reload while an import is running does not leave a half-written file:
  after the reload, `Stored` counts only complete archives.
* Fix whatever the tests show failing, in the allowed paths only.

## Acceptance criteria
1. After importing a synthetic install and reloading, `#stored-summary` is `Stored: 4 archives` and `#play` is enabled, with zero requests for a `.zip` after the reload.
2. After a forced failure on the third file, a second import of the same ZIP reports the first two as skipped and ends `Ready` with all files stored and byte-identical.
3. A reload midway through a 40 MB import leaves only complete archives stored, and a new import completes the rest.
4. `persist()` is called exactly once per import and before the first OPFS write (instrumented).
5. When `persist()` resolves false, the import still ends `Ready` and the storage line contains the added sentence.
6. `#clear` followed by a reload shows `Stored: 0 archives`, `#play` disabled, and `listExtra()` empty.
7. Extra files (non-`.big`) survive the reload and are still listed by `listExtra()`.

## Test paths
`web/tests/zip-persistence.spec.ts`

## Allowed paths
`web/src/main.ts`, `web/src/zip-import.ts`, `web/src/opfs-store.ts`, `web/app/index.html`

## Check
`cd web && npx playwright test tests/zip-persistence.spec.ts tests/launcher-zip.spec.ts tests/launcher-storage.spec.ts`
