# 130: ZIP import speed: at most 1.25x the time of a plain copy

Issue #130. Phase 1. Size s. Depends on #127. Owner request 2026-10-18: "we
do not want to spend twice the time". Loading from a ZIP must not be
meaningfully slower than the folder copy that exists today.

## Goal
Measure the ZIP import against the existing `storeFiles` copy of the same
bytes, and tune the import until it is within bounds.

## Read first
* `web/AGENTS.md`, `web/src/zip-import.ts`, `web/src/zip.ts`,
  `web/src/opfs-store.ts`, `web/tests/helpers/zip.ts`,
  `web/playwright.bench.config.ts`, `web/bench/`

## Contract
* A benchmark spec in `web/bench/` (run by `npm run bench`, not by
  `npm test`) builds in the page a synthetic install of about 256 MiB made of
  four large archives (pseudo-random bytes, stored method, as the real game
  archives would be) plus 200 small files, then times, in one browser session
  and alternating order to cancel cache effects:
  1. `storeFiles` of the same bytes as blobs (the folder path), and
  2. `importZips` of the stored-method ZIP built from them.
  Each is run 3 times after a warm-up; the median wall time is compared.
* The bound: ZIP median ≤ 1.25 × folder median.
* A second case with the same data deflated: the ZIP median ≤ 2 × folder
  median (inflate costs real CPU), reported but with that looser bound.
* Both medians and the ratio are printed in the test output.
* Tuning is allowed inside `zip.ts`, `zip-import.ts` and `opfs-store.ts`:
  chunk size, avoiding copies, writing stored entries with
  `Blob.slice` piped straight into the writable, skipping the CRC pass cost
  with a table-driven or slice-by-8 implementation, parallelising small
  files. Output bytes, error behaviour and progress contract do not change;
  every spec from #126 and #127 keeps passing.

## Acceptance criteria
1. The bench spec exists, builds the 256 MiB synthetic install and the stored-method ZIP, and prints folder median, ZIP median and ratio.
2. The stored-method ZIP median is at most 1.25 times the folder median.
3. The deflated ZIP median is at most 2 times the folder median.
4. After the tuning, `tests/zip.spec.ts` and `tests/zip-import.spec.ts` still pass.

## Test paths
`web/bench/zip-import.bench.ts`

## Allowed paths
`web/src/zip.ts`, `web/src/zip-import.ts`, `web/src/opfs-store.ts`

## Check
`cd web && npm ci && npx playwright test --config playwright.bench.config.ts bench/zip-import.bench.ts && npx playwright test tests/zip.spec.ts tests/zip-import.spec.ts`
