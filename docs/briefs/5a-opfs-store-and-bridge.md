# 5a: Classify the install, store it in OPFS, read it synchronously

Part of issue #5, following D-03 in `docs/decisions.md`. Tests exist and
fail; implement the modules they import. TypeScript, bundled by esbuild
(`npm run build`), no new dependencies.

## Read first
* `web/AGENTS.md`, D-03 in `docs/decisions.md`
* `web/tests/install.spec.ts`, `web/tests/store.spec.ts`, `web/tests/bridge.spec.ts`
* `web/src/test-api.ts` (the exports the tests use)

## Contract

### `web/src/install.ts` (pure, no DOM)
```ts
export type GameKind = "zh" | "generals";
export interface ArchiveEntry { kind: GameKind; name: string; path: string }
export interface InstallReport { archives: ArchiveEntry[]; missing: string[] }
export const REQUIRED: { zh: readonly string[]; generals: readonly string[] };
export function classifyArchives(paths: string[]): InstallReport;
```
* `paths` are relative paths from a folder picker (`/` separated). `name` is
  the basename exactly as given; `path` is the input path.
* Only basenames ending in `.big` (case-insensitive, with a non-empty stem)
  count. `kind` is `"zh"` when the basename ends in `zh.big`
  (case-insensitive), otherwise `"generals"`.
* Duplicates (same kind, same lower-cased name): the first in input order wins.
* `archives` sorted: `zh` before `generals`, then by lower-cased name.
* `REQUIRED = { zh: ["INIZH.big", "W3DZH.big"], generals: ["INI.big", "W3D.big"] }`;
  `missing` lists required names absent (case-insensitive), zh first, in
  `REQUIRED` order.

### `web/src/opfs-store.ts`
```ts
export interface StoredFile { kind: GameKind; name: string; size: number }
export function storeFiles(
  entries: { kind: GameKind; name: string; file: Blob }[],
  onProgress?: (doneBytes: number, totalBytes: number) => void,
): Promise<{ written: number; skipped: number }>;
export function listStored(): Promise<StoredFile[]>;
export function clearStored(): Promise<void>;
```
* Layout: OPFS root → directory `zhwp` → directory `<kind>` → file `<name>`.
* An entry whose stored file already has the same size is skipped (counts as
  done for progress); otherwise it is (re)written with a writable stream,
  replacing the old content.
* `onProgress` is called with non-decreasing `doneBytes`; the last call is
  `(total, total)` where `total` is the sum of all entry sizes.
* `listStored` sorts `zh` first, then by name; `clearStored` removes `zhwp`
  (no error when it does not exist).

### `web/src/bridge.ts` + `web/src/bridge-worker.ts`
```ts
export class FileBridge {
  static start(files: StoredFile[], workerUrl?: string | URL): Promise<FileBridge>;
  size(kind: GameKind, name: string): number;            // throws for unknown files
  readSync(kind: GameKind, name: string, position: number, target: Uint8Array): number;
  close(): Promise<void>;
}
```
* `start` spawns a module worker (`dist/bridge-worker.js`; default URL
  `new URL("./bridge-worker.js", import.meta.url)`), which opens every
  listed file with `createSyncAccessHandle()` and reports sizes back.
* Requests travel through one `SharedArrayBuffer`: an `Int32Array` control
  area (request flag, status, file index, length) plus a `Float64Array` for
  the position, and a 4 MiB data area. The worker blocks with
  `Atomics.wait`; the main thread, where `Atomics.wait` is forbidden, spins on
  `Atomics.load` until the worker marks the request done.
* `readSync` loops over 4 MiB blocks so any `target.length` works; returns
  the number of bytes read; `0` at or past the end; throws for unknown files
  or a worker error.
* `close` closes the handles and terminates the worker.

## Check
From `web/`: `npx playwright test tests/install.spec.ts tests/store.spec.ts tests/bridge.spec.ts`
exits 0 (both browser projects).

## Allowed paths
* `web/src/install.ts`
* `web/src/opfs-store.ts`
* `web/src/bridge.ts`
* `web/src/bridge-worker.ts`
