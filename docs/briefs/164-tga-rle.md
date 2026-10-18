# 164: Tool lib: lossless TGA RLE encoder

Issue #164. Phase 1. Size s. Owner request 2026-10-19: compression experiments
that do not damage quality, one by one. The game's 780 `.tga` textures are all
uncompressed true-colour (image type 2), 265 MB. The engine's own Targa class
(`Core/Libraries/Source/WWVegas/WWLib/TARGA.cpp`, `DecodeImage`) reads
RLE-encoded true-colour TGAs (type 10), which is lossless. Measured on the real
files: about 150 MB after RLE (114 MB saved), pixel for pixel identical.

## Goal
A dependency-free Node module that re-encodes an uncompressed true-colour TGA
as a standard RLE TGA with exactly the same pixels.

## Read first
`web/AGENTS.md`, `web/scripts/lib/ima-adpcm.mjs` and `web/scripts/lib/big-archive.mjs`
(module style), `web/tests/ima-adpcm.spec.ts` (Node-side tests)

## Contract
New file `web/scripts/lib/tga-rle.mjs`, ES module, no dependencies.

```js
// tga: a whole .tga file. Returns the RLE-encoded file, or null when the input
// is not eligible or the result would not be smaller (the caller keeps the
// original bytes). Never throws on bad input.
export function encodeTgaRle(tga /* Buffer */) /* Buffer | null */;
```

* Eligible input: image type 2 (true-colour, uncompressed), 24 or 32 bits per
  pixel, no colour map (colour-map type 0), width and height both at least 1,
  and the file holds at least `width * height * bytesPerPixel` pixel bytes
  after the 18-byte header and the image-ID field. Anything else (types 1, 3,
  9, 10, 11, 16-bit, a colour map, a truncated file, non-TGA bytes, an empty
  buffer) returns `null`.
* Output is a standard TGA RLE file (image type 10): the 18-byte header with
  only the image-type byte changed to 10, the same image-ID field, then the
  pixel data as RLE packets (run packet: header byte `0x80 | (n-1)` followed
  by one pixel, `n` in 1..128; raw packet: header byte `n-1` followed by `n`
  pixels, `n` in 1..128). Packets never cross a scanline, as the TGA spec
  says. Everything after the pixel data (the optional extension area, the
  developer area and the footer, including the `TRUEVISION-XFILE.` signature)
  is copied unchanged after the encoded pixels; the footer's offsets are
  rewritten if and only if the file had a footer, so they point at the moved
  areas.
* Pixel bytes decode to exactly the same bytes as the input (bit exact,
  alpha included). The orientation bits of the descriptor byte are untouched.
* Deterministic and pure.

## Acceptance criteria
1. A 64x64 24-bit image with large flat areas encodes to image type 10, is smaller than the input, and decodes (by a reference decoder in the test) to the input's exact pixel bytes.
2. A 32-bit image with alpha (random alpha in one half, flat in the other) round-trips bit exactly.
3. A noisy image that RLE would enlarge returns `null`.
4. Runs longer than 128 pixels and rows wider than 128 pixels split into several packets, and no packet crosses a scanline (checked by decoding row by row).
5. A 1x1 image and a 1xN / Nx1 image behave (round trip or `null` because it is not smaller).
6. A file with an image-ID field keeps the ID bytes; a file with a TGA 2.0 footer and extension area keeps them and the footer offsets point at the moved areas.
7. Types 1, 3, 9, 10, 11, a 16-bit image, a file with a colour map, a truncated file, random bytes and an empty buffer return `null` without throwing.
8. The descriptor byte (orientation and alpha-depth bits) and the other header fields except the image type are identical in the output.
9. Two calls on the same input return identical buffers.
10. When `ffmpeg` is on the PATH, it decodes the output to the same pixels as the input (compare the raw RGBA frames of both files); skipped when `ffmpeg` is absent.

## Test paths
`web/tests/tga-rle.spec.ts`

## Allowed paths
`web/scripts/lib/tga-rle.mjs`

## Check
`cd web && npm ci && npx playwright test tests/tga-rle.spec.ts`
