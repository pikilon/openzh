# 39: Put a replay file into the engine's user data before start

Issue #39. Phase 2. Size m. Depends on #38 (same file `smoke.js`).

## Goal
The engine reads replays from its user data folder (`Replays/` under
`USER_DATA_DIRS[0]`). A harness must be able to place a `.rep` file there
before the engine starts, without it being wiped by the IDBFS load that
restores saved user data (#19).

## Read first
* `web/AGENTS.md`
* `web/src/user-data.ts`, `web/src/engine.ts`, `web/smoke/smoke.js`
* `web/tests/user-data.spec.ts`
* `docs/briefs/19-persist-user-data.md`; Emscripten `FS.syncfs(true, …)`
  makes the in-memory folder match IndexedDB, removing entries IndexedDB
  does not have.

## Contract

### `web/src/user-files.ts`
```ts
export interface UserFile { path: string; data: Uint8Array }
export function addUserFiles<T extends object>(options: T, files: UserFile[]): T & { preRun: ((m: any) => void)[] };
```
* `path` is relative to `USER_DATA_DIRS[0]`, `/`-separated. A path that is
  empty, starts with `/`, or has an empty, `.` or `..` segment makes
  `addUserFiles` throw an `Error` before returning.
* Returns a copy of `options` whose `preRun` (appended to existing ones)
  makes every file exist at `USER_DATA_DIRS[0] + "/" + path`, with exactly
  `data` as its content and parent folders created, by the time the
  engine's `main` runs. This holds both for plain options and for options
  that went through `prepareEngineOptions` (whose IDBFS load completes
  before `main`): files from the IDBFS load stay, and a loaded file with the
  same path is replaced by the given one.

### `web/src/engine.ts`
* Re-exports `addUserFiles` (and the `UserFile` type).

### `web/smoke/smoke.js`
* A `preRun` always sets `window.__zhwpModule` to the module (not only with
  `archives=opfs`).
* Each `replay=<url>` query parameter (repeatable) is fetched before the
  factory is called; its bytes become a user file at
  `Replays/<last path segment of the URL, decoded>`. They are applied with
  `addUserFiles` (imported from `/dist/engine.js`) after
  `prepareEngineOptions` when `archives=opfs`.
* A failed fetch (network error or non-2xx) sets `__zhwpDone = { status:
  "error", message }` with the URL in the message, and the factory is not
  called.

## Acceptance criteria
1. `addUserFiles` throws for the paths `""`, `"/a"`, `"a//b"`, `"./a"` and `"a/../b"`.
2. With plain options, a given file is readable through `module.FS` at its full path with identical bytes once the engine has started.
3. Parent folders of a nested path are created.
4. With options from `prepareEngineOptions`, a file saved to IndexedDB in an earlier page load is still present together with the given file.
5. A file saved earlier under the same path is replaced by the given content.
6. On the smoke page, `?replay=<url of a test file>` makes `Replays/<name>` exist in the engine's user data with the served bytes, with and without `archives=opfs`.
7. A `replay` URL that returns 404 gives `__zhwpDone.status === "error"` with the URL in the message, and the engine does not start.
8. `window.__zhwpModule` is set on the smoke page without `archives=opfs`.

## Test paths
* `web/tests/user-files.spec.ts`
* `web/tests/harness/replays/` (synthetic replay bytes served at
  `/harness/replays/`; never a real replay)

## Allowed paths
* `web/src/user-files.ts`
* `web/src/engine.ts`
* `web/smoke/smoke.js`

## Check command
`cd web && npm ci && npx playwright test`
