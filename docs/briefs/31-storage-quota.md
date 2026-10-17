# 31: Persistent storage and a quota check before import

Issue #31. Phase 1. Size s. Depends on #30 (same files).

## Goal
The archives are several GB. The launcher asks the browser to keep them
(persistent storage), shows how much space is used, and refuses an import
that does not fit instead of failing halfway through.

## Read first
* `web/AGENTS.md`
* `web/src/main.ts`, `web/app/index.html`, `web/src/opfs-store.ts`
* `web/tests/launcher.spec.ts`, `web/tests/helpers/big.ts`

## Contract

### `web/src/storage.ts` (pure, no DOM)
```ts
export function formatBytes(bytes: number): string;
export function bytesNeeded(
  picked: { kind: string; name: string; size: number }[],
  stored: { kind: string; name: string; size: number }[],
): number;
export function available(estimate: { usage?: number; quota?: number }): number | undefined;
```
* `formatBytes`: under 1024 → `"<n> B"`; under 1024² → KB; under 1024³ → MB;
  otherwise GB; KB/MB/GB with one decimal (`"1.5 GB"`, `"512.0 MB"`),
  1024-based.
* `bytesNeeded`: sum of the sizes of the picked entries that are not already
  stored with the same `kind`, the same lower-cased `name` and the same
  `size` (those are skipped by `storeFiles`).
* `available`: `quota - usage` (usage missing counts as 0); `undefined` when
  `quota` is missing.

### Launcher
* New element `<p id="storage">` in `#picker`. On load and after every
  import or clear it reads `navigator.storage.estimate()` and shows
  `Storage: <formatBytes(usage)> of <formatBytes(quota)>`, plus
  ` (persistent)` when `navigator.storage.persisted()` resolves `true`.
  When `estimate` is missing or rejects: `Storage: unknown`.
* On a complete folder pick, before storing: call
  `navigator.storage.persist()` when it exists (its result does not block
  the import). If `available(estimate)` is defined and smaller than
  `bytesNeeded(picked, listStored())`, `#status` reads
  `Not enough storage: need <formatBytes(needed)>, available
  <formatBytes(available)>`, nothing is stored and Play reflects what was
  already stored.
* Everything else is unchanged.

## Acceptance criteria
1. `formatBytes` gives `"0 B"`, `"1023 B"`, `"1.0 KB"`, `"1.5 MB"` and `"2.0 GB"` for 0, 1023, 1024, 1.5·1024² and 2·1024³.
2. `bytesNeeded` excludes picked entries stored with the same kind, case-insensitive name and size, and includes those whose size differs.
3. `available` returns `quota - usage`, treats missing usage as 0 and returns `undefined` without a quota.
4. On load, `#storage` shows the formatted usage and quota from `navigator.storage.estimate()`.
5. When `navigator.storage.persisted()` resolves `true`, `#storage` ends with `(persistent)`.
6. When `estimate` rejects, `#storage` reads `Storage: unknown` and import still works.
7. When the estimate leaves less space than the picked archives need, `#status` starts with `Not enough storage: need` and `#stored-summary` still reads `Stored: 0 archives`.
8. A complete folder pick calls `navigator.storage.persist()` once.

Criteria 1 to 3 are tested through the harness page: `web/src/test-api.ts`
re-exports `formatBytes`, `bytesNeeded` and `available` (one added line).

## Test paths
* `web/tests/launcher-storage.spec.ts`

## Allowed paths
* `web/src/storage.ts`
* `web/src/main.ts`
* `web/src/test-api.ts` (one added export line)
* `web/app/index.html`

## Check command
`cd web && npm ci && npx playwright test`
