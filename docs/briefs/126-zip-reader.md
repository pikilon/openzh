# 126: ZIP reader: streaming parse of a game ZIP (ZIP64, deflate, CRC)

Issue #126. Phase 1. Size m. Depends on #125. Owner request 2026-10-18: the
game is loaded from ZIP files, several GB in total, so a ZIP is never read
into memory as a whole.

## Goal
A dependency-free reader that lists a ZIP's entries from its central directory
and streams one entry's bytes, verified.

## Read first
* `web/AGENTS.md`, `web/src/import-error.ts` (from #125), `web/src/install.ts`
* `web/tests/install.spec.ts` (pure logic runs in Node; `Blob` and
  `DecompressionStream` exist in Node 18+ and in Brave)

## Contract
New file `web/src/zip.ts`. No new dependencies; inflate with
`DecompressionStream("deflate-raw")`; CRC-32 computed in the module.

```ts
export interface ZipEntry {
  path: string;            // "/" separated, UTF-8, as stored
  size: number;            // uncompressed bytes
  compressedSize: number;
  method: 0 | 8;           // stored | deflate
  crc32: number;           // unsigned
  isDirectory: boolean;    // path ends with "/"
  offset: number;          // of the local header (internal; opaque to callers)
}
export function openZip(blob: Blob): Promise<ZipEntry[]>;
export function entryStream(blob: Blob, entry: ZipEntry): ReadableStream<Uint8Array>;
```

* `openZip` reads only the end of the blob (end-of-central-directory, ZIP64
  locator and record when present) and the central directory, using
  `blob.slice`. It never reads entry data. Entries keep archive order.
  ZIP64 sizes and offsets (extra field 0x0001) are supported; values above
  2^32 are plain JS numbers (safe below 2^53).
* Names use UTF-8 when general-purpose flag bit 11 is set, otherwise CP437
  is not needed: decode as UTF-8 anyway.
* `entryStream` reads the local header at `entry.offset` (its own name and
  extra lengths, which may differ from the central ones), then streams the
  data in chunks of at most 1 MiB using `blob.slice`, inflating when
  `method` is 8. Memory stays bounded by a few chunks, whatever the entry
  size. Entries written with a data descriptor (flag bit 3) take size and CRC
  from the central directory.
* When the stream ends, the produced length must equal `entry.size` and the
  CRC-32 must equal `entry.crc32`; otherwise the stream errors.
* Failures are `ImportError`s (#125): no end-of-central-directory, or a
  blob shorter than 22 bytes → `not-a-zip`; central directory or entry data
  runs past the end of the blob, or inflate input ends early → `truncated`;
  a disk number other than 0 → `multi-disk`; general-purpose flag bit 0 →
  `encrypted`; a method other than 0 or 8 → `unsupported-method`; size or
  CRC mismatch → `bad-crc`; a path that is absolute, contains a `..`
  segment, a backslash, or a NUL → `unsafe-path` (checked in `openZip`, for
  non-directory and directory entries alike). `detail.file` carries the
  entry path when one is involved.
* `web/src/test-api.ts` re-exports `openZip` and `entryStream`.
* Test support (test paths): `web/tests/helpers/zip.ts` exports
  `buildZip(entries, options?)` returning a `Uint8Array` ZIP:
  entries `{ path, data, method?: "store" | "deflate", dataDescriptor?: boolean }`;
  options `{ zip64?: boolean }` writes ZIP64 records even for small data. It
  also exports `corrupt` helpers as the tests need. Deflate may use
  `CompressionStream("deflate-raw")`.

## Acceptance criteria
1. `openZip` lists path, size, compressedSize, method and crc32 for stored and deflated entries, in archive order, and marks directory entries.
2. `openZip` of a ZIP64 archive (forced by the helper) returns the same entries as the non-ZIP64 one.
3. `openZip` on a blob whose `slice` is instrumented never reads an entry's data bytes, only the tail and the central directory.
4. `entryStream` yields the exact bytes of a stored entry and of a deflated entry, including an empty entry and one with a data descriptor.
5. `entryStream` of a 64 MiB stored entry never holds more than 8 MiB of the blob at once (instrumented `slice` sizes are all at most 1 MiB).
6. A blob that is not a ZIP, and one shorter than 22 bytes, fail `openZip` with code `not-a-zip`.
7. A ZIP cut in the middle of the central directory fails `openZip` with `truncated`; one cut in the middle of an entry fails that entry's stream with `truncated`.
8. A flipped data byte fails the stream with `bad-crc`; a wrong stored size fails with `bad-crc`.
9. An encrypted entry fails `openZip` with `encrypted`; method 12 (bzip2) fails with `unsupported-method`; a non-zero disk number fails with `multi-disk`.
10. Entries named `/etc/x`, `a/../b`, `a\b` and one containing NUL fail `openZip` with `unsafe-path` and `detail.file` set.
11. Non-ASCII UTF-8 names round-trip.

## Test paths
`web/tests/zip.spec.ts`, `web/tests/helpers/zip.ts`

## Allowed paths
`web/src/zip.ts`, `web/src/test-api.ts`

## Check
`cd web && npx playwright test tests/zip.spec.ts tests/import-error.spec.ts`
