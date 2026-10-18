// Lossless TGA RLE encoder (docs/briefs/164-tga-rle.md).
//
// encodeTgaRle re-encodes an uncompressed true-colour TGA (image type 2, 24 or
// 32 bits per pixel) as a standard type 10 TGA whose decoded pixels are the
// same bytes. RLE packets hold at most 128 pixels and never cross a scanline.
// Ineligible input, or input that RLE would not shrink, returns null, never a
// throw; the caller keeps the original bytes.

const HEADER_BYTES = 18;
const FOOTER_BYTES = 26;
const FOOTER_SIGNATURE = "TRUEVISION-XFILE.";
const IMAGE_TYPE_UNCOMPRESSED = 2;
const IMAGE_TYPE_RLE = 10;
const MAX_PACKET_PIXELS = 128;

function bytesPerPixel(pixelDepth) {
  if (pixelDepth === 24) return 3;
  if (pixelDepth === 32) return 4;
  return 0;
}

function samePixel(pixels, a, b, bytes) {
  const at = a * bytes;
  const other = b * bytes;
  for (let i = 0; i < bytes; i++) {
    if (pixels[at + i] !== pixels[other + i]) return false;
  }
  return true;
}

// Run of identical pixels starting at `start` within the row, capped at the
// packet maximum.
function runLength(pixels, start, rowEnd, bytes) {
  let length = 1;
  while (
    length < MAX_PACKET_PIXELS &&
    start + length < rowEnd &&
    samePixel(pixels, start, start + length, bytes)
  ) {
    length += 1;
  }
  return length;
}

// Returns the TGA 2.0 footer of a file whose pixel data ends at `dataEnd`, or
// null when the file has none.
function readFooter(tga, dataEnd) {
  if (tga.length < dataEnd + FOOTER_BYTES) return null;
  const at = tga.length - FOOTER_BYTES;
  const signature = tga.toString("latin1", at + 8, at + 8 + FOOTER_SIGNATURE.length);
  if (signature !== FOOTER_SIGNATURE || tga[at + FOOTER_BYTES - 1] !== 0) return null;
  return {
    extensionOffset: tga.readUInt32LE(at),
    developerOffset: tga.readUInt32LE(at + 4),
  };
}

/**
 * Re-encodes an uncompressed true-colour TGA as RLE.
 * @param {Buffer} tga a whole .tga file
 * @returns {Buffer | null} the RLE file, or null when the input is not eligible
 *   or the encoded file would not be smaller
 */
export function encodeTgaRle(tga) {
  if (!Buffer.isBuffer(tga) || tga.length < HEADER_BYTES) return null;
  if (tga[1] !== 0 || tga[2] !== IMAGE_TYPE_UNCOMPRESSED) return null;

  const bytes = bytesPerPixel(tga[16]);
  if (bytes === 0) return null;

  const width = tga.readUInt16LE(12);
  const height = tga.readUInt16LE(14);
  if (width === 0 || height === 0) return null;

  const idLength = tga[0];
  const pixelStart = HEADER_BYTES + idLength;
  const pixelBytes = width * height * bytes;
  const dataEnd = pixelStart + pixelBytes;
  if (tga.length < dataEnd) return null;

  const footer = readFooter(tga, dataEnd);
  const tail = tga.subarray(dataEnd);

  // The result must be strictly smaller than the whole input, so the input
  // length is a safe capacity: a packet that runs past it can only mean null.
  const out = Buffer.allocUnsafe(tga.length);
  tga.copy(out, 0, 0, HEADER_BYTES);
  out[2] = IMAGE_TYPE_RLE;
  let at = HEADER_BYTES;
  if (idLength > 0) {
    tga.copy(out, at, HEADER_BYTES, pixelStart);
    at += idLength;
  }

  const pixels = tga.subarray(pixelStart, dataEnd);
  let pixel = 0;
  for (let row = 0; row < height; row++) {
    const rowEnd = pixel + width;
    while (pixel < rowEnd) {
      const run = runLength(pixels, pixel, rowEnd, bytes);
      if (run >= 2) {
        if (at + 1 + bytes > out.length) return null;
        out[at++] = 0x80 | (run - 1);
        pixels.copy(out, at, pixel * bytes, (pixel + 1) * bytes);
        at += bytes;
        pixel += run;
      } else {
        // A raw packet runs until the next repeated pixel or the packet limit.
        const start = pixel;
        pixel += 1;
        while (pixel < rowEnd && pixel - start < MAX_PACKET_PIXELS) {
          if (runLength(pixels, pixel, rowEnd, bytes) >= 2) break;
          pixel += 1;
        }
        const count = pixel - start;
        if (at + 1 + count * bytes > out.length) return null;
        out[at++] = count - 1;
        pixels.copy(out, at, start * bytes, pixel * bytes);
        at += count * bytes;
      }
    }
  }

  if (at + tail.length >= tga.length) return null;
  const encoded = out.subarray(0, at);
  if (tail.length === 0) return encoded;

  // Everything after the pixel data keeps its bytes and its relative position;
  // only the footer's offsets move with the new end of the pixel data.
  const after = Buffer.from(tail);
  if (footer !== null) {
    const shift = at - dataEnd;
    const footerAt = after.length - FOOTER_BYTES;
    const extension =
      footer.extensionOffset >= dataEnd ? footer.extensionOffset + shift : footer.extensionOffset;
    const developer =
      footer.developerOffset >= dataEnd ? footer.developerOffset + shift : footer.developerOffset;
    after.writeUInt32LE(extension >>> 0, footerAt);
    after.writeUInt32LE(developer >>> 0, footerAt + 4);
  }
  return Buffer.concat([encoded, after]);
}
