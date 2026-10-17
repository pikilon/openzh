# 13: Time limit on the file bridge's main-thread wait

Issue #13. Tests exist (`web/tests/bridge-watchdog.spec.ts`) and fail.

## Read first
* `web/src/bridge.ts`, D-03 in `docs/decisions.md`
* `web/tests/bridge-watchdog.spec.ts`, `web/tests/harness/stuck-worker.js`

## Contract (additions to `FileBridge`)
```ts
static readonly DEFAULT_READ_TIMEOUT_MS = 10_000;
static start(files: StoredFile[], workerUrl?: string | URL, options?: { readTimeoutMs?: number }): Promise<FileBridge>;
```
* Every wait for the worker (each block of `readSync`, and `close`) gives up
  after `readTimeoutMs` (default `DEFAULT_READ_TIMEOUT_MS`), measured with
  `performance.now()` checked inside the spin loop (not on every iteration
  if that is costly; every ~1024 iterations is fine).
* On time-out `readSync` throws an `Error` whose message contains "timed out"
  and the file and position; the bridge is then unusable (later reads throw
  at once) and its worker is terminated.
* `close` that times out terminates the worker and resolves.
* After `close()`, `readSync` throws immediately without touching the worker.
* Existing behaviour and tests stay as they are.

## Check
From `web/`: `npx playwright test` exits 0 (all specs).

## Allowed paths
* `web/src/bridge.ts`
