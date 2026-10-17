# 30: Detect missing browser features before import

Issue #30. Phase 1. Size s. Depends on #29 (same files).

## Goal
The port needs WebGPU, cross-origin isolation (for `SharedArrayBuffer`) and
OPFS. A browser without one of them must be told so before the player
spends minutes importing several GB.

## Read first
* `web/AGENTS.md`, D-03 in `docs/decisions.md`
* `web/src/main.ts`, `web/app/index.html`

## Contract

### `web/src/features.ts`
```ts
export interface FeatureEnv {
  gpu: unknown;                 // navigator.gpu
  crossOriginIsolated: boolean; // window.crossOriginIsolated
  getDirectory: unknown;        // navigator.storage?.getDirectory
}
export function currentEnv(): FeatureEnv;
export function missingFeatures(env: FeatureEnv): string[];
```
* `missingFeatures` returns, in this order, the names of what is missing:
  `"WebGPU"` when `gpu` is `undefined` or `null`; `"Cross-origin isolation"`
  when `crossOriginIsolated` is not `true`; `"Origin private file system"`
  when `getDirectory` is not a function. Pure: no DOM access.
* `currentEnv` reads those three values from the page.

### Launcher
* New element `<p id="unsupported" role="alert" hidden>` in `#picker`.
* On load, when `missingFeatures(currentEnv())` is not empty: `#unsupported`
  is shown with text `Missing browser features: ` + the names joined with
  `, `; `#folder-input` and `#play` are disabled and stay disabled; nothing
  else runs (no OPFS access). Otherwise the page behaves as today.
* `features.ts` is bundled through `main.ts`; no new build entry.

## Acceptance criteria
1. In Brave with the dev server (WebGPU flag on, isolated), `#unsupported` stays hidden and import works as before.
2. When `navigator.gpu` is made `undefined` before the page scripts run, `#unsupported` is visible and contains `WebGPU`.
3. When `navigator.storage.getDirectory` is removed before the page scripts run, `#unsupported` contains `Origin private file system`.
4. When a feature is missing, `#folder-input` and `#play` are disabled.
5. When several features are missing, they appear in the contract order separated by `, `.
6. When the page is not cross-origin isolated (`crossOriginIsolated` forced to `false` before the page scripts run), `#unsupported` contains `Cross-origin isolation`.

## Test paths
* `web/tests/launcher-features.spec.ts`

## Allowed paths
* `web/src/features.ts`
* `web/src/main.ts`
* `web/app/index.html`

## Check command
`cd web && npm ci && npx playwright test`
