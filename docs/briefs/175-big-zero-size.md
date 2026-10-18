# 175: BIG rewrite accepts zero-size entries (real PatchZH.big)

Issue #175. Phase 1. Size s. Bug found on the real game while running
`make-game-zip.mjs --tga-rle` (#167): `PatchZH.big` has three entries, one of
them `Data\*` with offset 0 and size 0. `readBigDirectory` (#150) rejects it
with `bad-header` because the offset lies inside the header. Every other real
archive reads fine; `MapsZH.big` also has zero-size entries (valid offsets).

## Read first
`web/scripts/lib/big-archive.mjs`, `docs/briefs/150-big-rewrite.md`,
`web/tests/big-archive.spec.ts`

## Contract
Changes to `web/scripts/lib/big-archive.mjs` only:
* The `bad-header` offset check (an entry offset inside the header) does not apply
  to entries whose size is 0. Such entries may carry any offset (0, inside the
  header, or past the end) and are accepted by `readBigDirectory`.
* `rewriteBig` keeps each zero-size entry's original offset value untouched
  in the rewritten entry table and writes no data for it; non-empty entries are
  laid out contiguously as before. An identity rewrite of an archive that has
  zero-size entries is byte-identical to the source when the layout of the
  non-empty entries was contiguous.
* `select` is still called for zero-size entries; if one is selected and
  `transform` returns bytes, the entry becomes non-empty with a contiguous offset.
* Nothing else changes (error codes, `truncated` and `not-big` behaviour, memory).

## Acceptance criteria
1. A synthetic archive with a zero-size entry named `Data\*` at offset 0 and two normal entries is read by `readBigDirectory` without error and lists the zero-size entry with offset 0 and size 0.
2. An identity `rewriteBig` of that archive produces a file byte-identical to the source.
3. Replacing a normal entry in that archive keeps the zero-size entry's offset 0 and size 0 and lays out the two normal entries contiguously.
4. An entry with size 0 and an offset past the end of the file is accepted; an entry with size greater than 0 and an offset inside the header still fails with `bad-header`.
5. If `transform` returns bytes for a selected zero-size entry, the rewritten archive lists it with that size and a contiguous offset.
6. The existing `big-archive` specs still pass.

## Test paths
`web/tests/big-archive.spec.ts`

## Allowed paths
`web/scripts/lib/big-archive.mjs`

## Check
`cd web && npm ci && npx playwright test tests/big-archive.spec.ts`
