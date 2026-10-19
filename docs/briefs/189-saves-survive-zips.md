# 189: Saved games survive changing the game-data ZIPs

Issue #189. Phase 1. Size s. Owner's request (2026-10-19): "verifica que las
partidas guardadas no se borran cuando cambiamos los zips".

The engine writes saves under `/home/web_user/.local/share/GeneralsX/Save`,
mounted as Emscripten IDBFS (IndexedDB database named after the mountpoint,
object store `FILE_DATA`, one entry per absolute path with `{timestamp, mode,
contents}`). The ZIP importer rewrites only the OPFS archive tree
(`zhwp/<kind>/<name>.big`, issue #157); it never opens IndexedDB. This task
proves that separation with a regression test, and fixes the importer if the
test finds a real deletion.

## Contract

* Importing a different install (the launcher's replace path, `importZips` in
  `web/src/zip-import.ts`) leaves every entry under
  `/home/web_user/.local/share/GeneralsX/` in IndexedDB untouched: same keys,
  same bytes, same timestamps.
* `clearStored()` (the menu's Reload game data) likewise deletes only the OPFS
  archive tree. It is not a user-data reset.
* The new `web/src/saves.ts` reads those entries without the engine running:
  file entries below the `Save/` directory, sorted by path. Directory entries
  and files outside `Save/` are ignored. An empty or absent database is zero
  saves, not an error.
* No engine, no game data and no real IndexedDB database from a player are
  required: tests seed synthetic IDBFS entries in the test browser profile.

## Acceptance criteria

1. A synthetic save (`Save/Test A.SAV`, nested `Save/campaign/B.sav`, plus an
   empty `Save/empty.sav`) written as IDBFS entries keeps exactly its bytes
   and timestamps after a first install is imported.
2. The same saves keep their bytes and timestamps after a second, different
   install replaces the first through `importZips`.
3. `clearStored()` leaves the saves and their timestamps untouched.
4. `saves.ts` lists only file entries under `Save/`, in sorted path order,
   with the exact bytes, including an empty file and a path with a space.
5. A missing database (fresh profile) lists zero saves without creating a
   database that later confuses IDBFS.

## Test paths

* `web/tests/saves.spec.ts`: criteria 1-4; the missing-database case is
  criterion 5 in the same spec.

## Allowed paths

* `web/src/saves.ts`
* `web/tests/saves.spec.ts`
* `web/tests/helpers/install-zip.ts` only if the test needs a new fixture
  option; prefer the existing options.

## Check command

`cd web && npx playwright test tests/saves.spec.ts`

Before `saves.ts` exists the test fails to import it; the persistence
assertions themselves already pass because the importer is correct, which is
the point of this task.
