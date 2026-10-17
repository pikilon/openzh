# 19: Persist the engine's user data across reloads

Issue #19. Tests exist (`web/tests/user-data.spec.ts`) and fail.

## Read first
* `web/AGENTS.md`, `web/src/engine.ts`, `web/smoke/smoke.js`
* `web/tests/user-data.spec.ts`
* Emscripten IDBFS (`FS.filesystems.IDBFS`, `FS.syncfs(populate, callback)`);
  the engine links `-lidbfs.js` and exports `FS`, `IDBFS`,
  `addRunDependency`, `removeRunDependency`.

## Background
In the browser `HOME` is `/home/web_user`, so the engine keeps options and
saved games under `/home/web_user/.local/share/GeneralsX` and its settings
INI under `/home/web_user/.config/GeneralsX` (see `GlobalData.cpp` and
`registryini.cpp`). Today both live in memory.

## Contract

### `web/src/user-data.ts`
```ts
export const USER_DATA_DIRS: readonly string[]; // the two paths above, in that order
export function addUserDataPersistence<T extends object>(options: T): T & { preRun: ((m: any) => void)[] };
export function saveUserData(module: any): Promise<void>;
```
* `addUserDataPersistence` returns a copy of `options` whose `preRun`
  (appended to existing ones) creates each directory (with parents), mounts
  IDBFS on it, and loads it with `FS.syncfs(true, …)` while holding a run
  dependency (`addRunDependency("zhwp-user-data")` /
  `removeRunDependency`), so the engine starts only after the data is loaded.
  A load error is logged with `console.warn` and does not block start-up.
* After start-up it saves with `FS.syncfs(false, …)` every 10 s and on
  `pagehide`. `saveUserData(module)` saves now and resolves when done
  (rejects on error).

### `web/src/engine.ts`
* `prepareEngineOptions` also applies `addUserDataPersistence`, and re-exports
  `saveUserData`.

### `web/smoke/smoke.js`
* With `archives=opfs`, add a `preRun` that sets `window.__zhwpModule` to the
  module, and set `window.__zhwpSaveUserData = () => saveUserData(window.__zhwpModule)`
  (import `saveUserData` from `/dist/engine.js`). Nothing else changes.

## Check
From `web/`: `npx playwright test` exits 0 (all specs; Brave only).

## Allowed paths
* `web/src/user-data.ts`
* `web/src/engine.ts`
* `web/smoke/smoke.js`
