# 70: The storage estimate must warn, not refuse the import

Issue #70. Phase 1. Size s. Found by #33: with the owner's real install
(2.1 GB of archives) the launcher refused the import with `Not enough
storage: need 2.1 GB, available 2.0 GB`, although the disk had 227 GiB free
and the same import had succeeded before #31. Brave reports a fixed
`navigator.storage.estimate()` quota (anti-fingerprinting), so the estimate
is not a limit. This brief replaces the refusal of #31 with a warning; the
rest of #31 stays.

## Read first
* `docs/briefs/31-storage-quota.md` (what stays: `#storage`, `persist()`,
  `formatBytes`, `bytesNeeded`, `available`)
* `web/src/main.ts`, `web/app/index.html`, `web/src/opfs-store.ts`
* `web/tests/launcher-storage.spec.ts`

## Contract
* New element `<p id="storage-warning" role="status" hidden>` in `#picker`.
* On a complete folder pick, when `available(estimate)` is defined and
  smaller than `bytesNeeded(...)`: `#storage-warning` is shown with text
  `The browser reports <formatBytes(available)> available; the import needs
  <formatBytes(needed)>.` and the import goes on as usual. Otherwise
  `#storage-warning` is hidden. A later pick or a clear hides it again before
  deciding anew.
* `#status` never reads `Not enough storage` any more.
* When `storeFiles` rejects (for example with a `QuotaExceededError`),
  `#status` reads `Import failed: <error name>: <message>`, the progress bar
  is hidden, and `#stored-summary` and Play show what is stored after the
  failure.
* Everything else from #31 is unchanged.

## Acceptance criteria
1. When the estimate leaves less space than the picked archives need, the import still finishes with `#status` containing `Ready` and `#stored-summary` counting the archives.
2. In that case `#storage-warning` is visible and contains both formatted sizes.
3. When the estimate leaves enough space, `#storage-warning` stays hidden.
4. After a warning, a clear hides `#storage-warning`.
5. When storing fails with a `QuotaExceededError`, `#status` starts with `Import failed: QuotaExceededError` and the progress bar is hidden.
6. No path of the page writes `Not enough storage` into `#status`.

## Test paths
* `web/tests/launcher-storage.spec.ts` (replace the test of #31's criterion
  7, which asserted the refusal; keep the others)

## Allowed paths
* `web/src/main.ts`
* `web/app/index.html`

## Check command
`cd web && npm ci && npx playwright test`
