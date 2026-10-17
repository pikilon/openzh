# 5b: Mount the stored archives into the engine's file system

Part of issue #5, after 5a, following D-03. Tests exist and fail.

## Read first
* `web/AGENTS.md`, D-03 in `docs/decisions.md`, `docs/briefs/5a-opfs-store-and-bridge.md`
* `web/tests/archives.spec.ts`, `web/tests/helpers/big.ts`
* `web/src/bridge.ts`, `web/src/opfs-store.ts`, `web/smoke/smoke.js`
* Emscripten's WORKERFS (`src/lib/libworkerfs.js` in the emscripten sources,
  e.g. `$(brew --prefix emscripten)/libexec/src/lib/libworkerfs.js`): the model
  for a read-only file system type.

## Contract

### `web/src/mount.ts`
```ts
export const MOUNT_POINTS: { zh: "/GeneralsZH"; generals: "/Generals" };
export function mountArchives(FS: any, bridge: FileBridge, files: StoredFile[]): void;
```
* For each kind with at least one stored file: create the mount point
  directory if missing and `FS.mount` a read-only file system type (shaped
  like WORKERFS) listing exactly that kind's files.
* `getattr`/`stat`: regular files with the stored size, mode `0o444 | S_IFREG`;
  the root is a directory. `readdir` returns `.`, `..` and the file names.
  `lookup` of an unknown name throws `FS.ErrnoError(44)` (ENOENT).
* `read(stream, buffer, offset, length, position)`: reads through
  `bridge.readSync` into `buffer.subarray(offset, offset + length)` and
  returns the byte count. `llseek` supports SEEK_SET/CUR/END. Any write,
  create, rename or unlink throws `FS.ErrnoError(63)` (EPERM in Emscripten's
  errno numbering).

### `web/src/engine.ts`
```ts
export function prepareEngineOptions<T extends object>(options: T): Promise<T & { preRun: ((m: any) => void)[] }>;
```
* Reads `listStored()`, starts a `FileBridge` for those files, and returns a
  copy of `options` whose `preRun` (appended to any existing ones) calls
  `mountArchives(module.FS, bridge, files)`.

### `web/smoke/smoke.js`
* When the page URL has `archives=opfs`, import `/dist/engine.js` and pass the
  factory options through `prepareEngineOptions` before calling the factory.
  Without it, behaviour is unchanged.

### Build
* Add `src/engine.ts` to the esbuild entry points in `web/package.json`'s
  `build` script.

## Check
From `web/`: `npx playwright test` exits 0 (all specs, both browsers).

## Allowed paths
* `web/src/mount.ts`
* `web/src/engine.ts`
* `web/smoke/smoke.js`
* `web/package.json` (the `build` script only)
