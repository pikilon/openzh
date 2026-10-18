# 150: Tool lib: read and rewrite BIG archives with replaced entries

Issue #150. Phase 1. Size m. Part of the audio recoding epic (owner request
2026-10-18). The voices live inside `SpeechEnglish*.big` archives, so the tool
must be able to rebuild a `.big` with some entries replaced.

## Goal
A dependency-free Node module that lists a BIG archive and writes a copy in
which chosen entries have new bytes.

## Read first
`web/AGENTS.md`, `web/tests/helpers/big.ts` (the BIGF layout: `"BIGF"`, u32 LE
archive size, u32 BE entry count, u32 BE header size, then per entry u32 BE
offset, u32 BE size, NUL-terminated path; then data), `web/scripts/make-game-zip.mjs`

## Contract
New file `web/scripts/lib/big-archive.mjs`, ES module, no dependencies.

```js
export async function readBigDirectory(path)
  // -> { entries: [{ name, offset, size }], headerSize, tail: Buffer }
  // `tail`: the header bytes after the last entry record, up to headerSize
  // (usually empty or a few bytes), kept verbatim.

export async function rewriteBig(srcPath, dstPath, options)
  // options.select(entry) -> boolean: only selected entries are read into
  //   memory and passed on; options.transform(entry, data /* Buffer */)
  //   -> Buffer | null (null keeps the original bytes).
  // -> { replaced: number, savedBytes: number }  // savedBytes may be negative
```

* Memory stays bounded: the source is read entry by entry with positioned
  reads; only the selected entries are held at once (one at a time). The
  destination is written sequentially.
* The output keeps the magic, the entry order, every entry name byte for byte,
  the `tail` bytes, and gives each entry a new offset in a contiguous layout
  after the (unchanged-size) header. The u32 LE archive size and each entry
  size are recomputed. Unselected and kept entries are copied byte for byte.
* With a transform that returns `null` for everything, the output file is
  byte-identical to the source when the source has a contiguous layout.
* Errors are `Error`s with a `code` property: `"not-big"` (magic is not
  `BIGF` or the file is shorter than 16 bytes), `"truncated"` (the entry table
  or an entry's data runs past the end of the file), `"bad-header"` (an
  entry offset lies inside the header, or `headerSize` is smaller than the
  entry table). `rewriteBig` removes a partially written destination on any
  error and never modifies the source.
* Names are returned as `latin1` strings and written back as `latin1`.

## Acceptance criteria
1. `readBigDirectory` of a synthetic archive (built with the `buildBig` helper) lists every name, offset and size in order, with an empty `tail`.
2. A hand-built archive whose header has extra bytes after the entry table reports them in `tail`, and `rewriteBig` preserves them.
3. `rewriteBig` with `transform` returning `null` for every selected entry produces a file byte-identical to the source.
4. Replacing one entry with longer bytes and another with shorter bytes yields an archive whose directory lists the new sizes, contiguous offsets and the same names and order, whose total size field equals the file length, and whose other entries are byte-identical.
5. `select` is called for every entry, and `transform` only for selected ones; with `select` always false the output equals the source and `replaced` is 0.
6. The return value reports `replaced` and `savedBytes` (old total minus new total of the replaced entries, negative when larger).
7. A file with a wrong magic and a file shorter than 16 bytes fail with code `not-big`.
8. An archive cut inside its data and one cut inside its entry table fail with code `truncated`, and no destination file is left behind.
9. An entry whose offset points inside the header fails with `bad-header`.
10. Rewriting a 120 MB synthetic archive (many 1 MB entries, a few selected) keeps the process RSS growth under 150 MB (measured in-process with `process.memoryUsage().rss`, not with `ps`).
11. The source file is unchanged (same bytes and modification time) after `rewriteBig`, success or failure.

## Test paths
`web/tests/big-archive.spec.ts`

## Allowed paths
`web/scripts/lib/big-archive.mjs`

## Check
`cd web && npm ci && npx playwright test tests/big-archive.spec.ts`
