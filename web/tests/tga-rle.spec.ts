import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeTgaRle } from "../scripts/lib/tga-rle.mjs";

// Contract of scripts/lib/tga-rle.mjs (docs/briefs/164-tga-rle.md).
//
// Node-side tests: the encoder is a dependency-free ES module imported
// directly. Inputs are synthetic TGA files built here; outputs are parsed and
// decoded by the independent reference RLE decoder below, and (criterion 10)
// by ffmpeg when it is on PATH. No real game data is used.

const HEADER_BYTES = 18;
const FOOTER_BYTES = 26;
const FOOTER_SIGNATURE = "TRUEVISION-XFILE.";
const EXTENSION_AREA_BYTES = 495;
const IMAGE_TYPE_UNCOMPRESSED = 2;
const IMAGE_TYPE_RLE = 10;
const MAX_PACKET_PIXELS = 128;

interface TgaHeader {
  idLength: number;
  colorMapType: number;
  imageType: number;
  colorMapFirstIndex: number;
  colorMapLength: number;
  colorMapEntrySize: number;
  xOrigin: number;
  yOrigin: number;
  width: number;
  height: number;
  pixelDepth: number;
  descriptor: number;
}

interface TgaOptions {
  width: number;
  height: number;
  pixelDepth?: number;
  imageType?: number;
  colorMapType?: number;
  colorMapFirstIndex?: number;
  colorMapLength?: number;
  colorMapEntrySize?: number;
  colorMapData?: Buffer;
  xOrigin?: number;
  yOrigin?: number;
  descriptor?: number;
  imageId?: Buffer;
  pixels?: Buffer;
  footer?: boolean;
  extensionArea?: Buffer;
  developerArea?: Buffer;
}

function readTgaHeader(tga: Buffer): TgaHeader {
  if (tga.length < HEADER_BYTES) {
    throw new Error(`TGA is ${tga.length} bytes, shorter than the 18-byte header`);
  }
  return {
    idLength: tga.readUInt8(0),
    colorMapType: tga.readUInt8(1),
    imageType: tga.readUInt8(2),
    colorMapFirstIndex: tga.readUInt16LE(3),
    colorMapLength: tga.readUInt16LE(5),
    colorMapEntrySize: tga.readUInt8(7),
    xOrigin: tga.readUInt16LE(8),
    yOrigin: tga.readUInt16LE(10),
    width: tga.readUInt16LE(12),
    height: tga.readUInt16LE(14),
    pixelDepth: tga.readUInt8(16),
    descriptor: tga.readUInt8(17),
  };
}

function defaultExtensionArea(): Buffer {
  const area = Buffer.alloc(EXTENSION_AREA_BYTES);
  area.writeUInt16LE(EXTENSION_AREA_BYTES, 0);
  area.write("ZHWP synthetic TGA 2.0 extension area", 2, "ascii");
  return area;
}

function defaultDeveloperArea(): Buffer {
  const area = Buffer.alloc(20);
  for (let i = 0; i < area.length; i++) area[i] = (i * 23 + 5) & 0xff;
  return area;
}

// Builds a whole TGA file. The defaults describe an eligible uncompressed
// true-colour image; every header field can be overridden so the ineligible
// cases can be built from the same code. With footer: true the extension and
// developer areas follow the pixels and the TGA 2.0 footer points at them.
function buildTga(options: TgaOptions): Buffer {
  const width = options.width;
  const height = options.height;
  const pixelDepth = options.pixelDepth ?? 24;
  const imageType = options.imageType ?? IMAGE_TYPE_UNCOMPRESSED;
  const colorMapType = options.colorMapType ?? 0;
  const colorMapFirstIndex = options.colorMapFirstIndex ?? 0;
  const colorMapEntrySize = options.colorMapEntrySize ?? 0;
  const colorMapData = options.colorMapData;
  const colorMapLength =
    options.colorMapLength ??
    (colorMapData && colorMapEntrySize > 0
      ? colorMapData.length / Math.ceil(colorMapEntrySize / 8)
      : 0);
  const xOrigin = options.xOrigin ?? 0;
  const yOrigin = options.yOrigin ?? 0;
  const descriptor = options.descriptor ?? 0x20;
  const imageId = options.imageId ?? Buffer.alloc(0);
  const pixels =
    options.pixels ?? Buffer.alloc(width * height * Math.ceil(pixelDepth / 8));

  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt8(imageId.length & 0xff, 0);
  header.writeUInt8(colorMapType, 1);
  header.writeUInt8(imageType, 2);
  header.writeUInt16LE(colorMapFirstIndex, 3);
  header.writeUInt16LE(colorMapLength, 5);
  header.writeUInt8(colorMapEntrySize, 7);
  header.writeUInt16LE(xOrigin, 8);
  header.writeUInt16LE(yOrigin, 10);
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header.writeUInt8(pixelDepth, 16);
  header.writeUInt8(descriptor, 17);

  const parts: Buffer[] = [header, imageId];
  if (colorMapData) parts.push(colorMapData);
  parts.push(pixels);

  if (options.footer) {
    const extensionArea = options.extensionArea ?? defaultExtensionArea();
    const developerArea = options.developerArea ?? defaultDeveloperArea();
    const bodyLength =
      HEADER_BYTES + imageId.length + (colorMapData?.length ?? 0) + pixels.length;
    const extensionOffset = bodyLength;
    const developerOffset = extensionOffset + extensionArea.length;
    parts.push(extensionArea, developerArea);
    const footer = Buffer.alloc(FOOTER_BYTES);
    footer.writeUInt32LE(extensionOffset, 0);
    footer.writeUInt32LE(developerOffset, 4);
    footer.write(FOOTER_SIGNATURE, 8, "ascii");
    parts.push(footer);
  }

  return Buffer.concat(parts);
}

type Color = readonly number[];

function bgr(red: number, green: number, blue: number): Color {
  return [blue, green, red];
}

function bgra(red: number, green: number, blue: number, alpha: number): Color {
  return [blue, green, red, alpha];
}

function makePixels(
  width: number,
  height: number,
  pixelDepth: number,
  colorAt: (x: number, y: number) => Color,
): Buffer {
  const bytesPerPixel = Math.ceil(pixelDepth / 8);
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colorAt(x, y);
      const offset = (y * width + x) * bytesPerPixel;
      for (let channel = 0; channel < bytesPerPixel; channel++) {
        pixels[offset + channel] = color[channel] ?? 0;
      }
    }
  }
  return pixels;
}

interface DecodedTga {
  header: TgaHeader;
  pixels: Buffer;
  // Absolute offset of the first byte after the encoded pixel data.
  dataEnd: number;
}

// Independent reference decoder for a standard TGA type 10 file. Packets are
// read in order; a packet that would cross a scanline is an error, because the
// contract (and the TGA spec) forbid it.
function decodeTgaRle(tga: Buffer): DecodedTga {
  const header = readTgaHeader(tga);
  if (header.imageType !== IMAGE_TYPE_RLE) {
    throw new Error(`expected a type 10 TGA, got image type ${header.imageType}`);
  }
  if (header.pixelDepth !== 24 && header.pixelDepth !== 32) {
    throw new Error(`expected 24 or 32 bits per pixel, got ${header.pixelDepth}`);
  }
  const bytesPerPixel = header.pixelDepth / 8;
  const totalPixels = header.width * header.height;
  const pixels = Buffer.alloc(totalPixels * bytesPerPixel);
  let at = HEADER_BYTES + header.idLength;
  let decoded = 0;

  while (decoded < totalPixels) {
    if (at >= tga.length) throw new Error("truncated RLE pixel data");
    const packet = tga[at++];
    const count = (packet & 0x7f) + 1;
    const column = decoded % header.width;
    if (column + count > header.width) {
      throw new Error(
        `packet of ${count} pixels crosses the scanline at pixel ${decoded} (row ${Math.floor(decoded / header.width)}, column ${column})`,
      );
    }
    if (decoded + count > totalPixels) throw new Error("RLE packet runs past the image");

    if (packet & 0x80) {
      if (at + bytesPerPixel > tga.length) throw new Error("truncated run packet");
      for (let i = 0; i < count; i++) {
        tga.copy(pixels, (decoded + i) * bytesPerPixel, at, at + bytesPerPixel);
      }
      at += bytesPerPixel;
    } else {
      const bytes = count * bytesPerPixel;
      if (at + bytes > tga.length) throw new Error("truncated raw packet");
      tga.copy(pixels, decoded * bytesPerPixel, at, at + bytes);
      at += bytes;
    }
    decoded += count;
  }

  return { header, pixels, dataEnd: at };
}

interface RlePacket {
  offset: number;
  kind: "run" | "raw";
  count: number;
  row: number;
  column: number;
}

// Walks the packet headers without decoding pixels, for the scanline checks.
function readRlePackets(tga: Buffer): RlePacket[] {
  const header = readTgaHeader(tga);
  if (header.imageType !== IMAGE_TYPE_RLE) {
    throw new Error(`expected a type 10 TGA, got image type ${header.imageType}`);
  }
  const bytesPerPixel = Math.ceil(header.pixelDepth / 8);
  const totalPixels = header.width * header.height;
  const packets: RlePacket[] = [];
  let at = HEADER_BYTES + header.idLength;
  let decoded = 0;

  while (decoded < totalPixels) {
    if (at >= tga.length) throw new Error("truncated RLE packet headers");
    const offset = at;
    const packet = tga[at++];
    const count = (packet & 0x7f) + 1;
    const column = decoded % header.width;
    if (column + count > header.width) {
      throw new Error(
        `packet of ${count} pixels crosses the scanline at pixel ${decoded} (row ${Math.floor(decoded / header.width)}, column ${column})`,
      );
    }
    if (decoded + count > totalPixels) throw new Error("RLE packet runs past the image");
    packets.push({
      offset,
      kind: packet & 0x80 ? "run" : "raw",
      count,
      row: Math.floor(decoded / header.width),
      column,
    });
    at += packet & 0x80 ? bytesPerPixel : count * bytesPerPixel;
    if (at > tga.length) throw new Error("RLE packet runs past the file");
    decoded += count;
  }

  return packets;
}

function expectSameHeaderExceptType(input: Buffer, output: Buffer, label: string): void {
  expect(output.length, `${label}: output has a header`).toBeGreaterThanOrEqual(HEADER_BYTES);
  const inputHeader = input.subarray(0, HEADER_BYTES);
  const outputHeader = output.subarray(0, HEADER_BYTES);
  expect(outputHeader[2], `${label}: image type`).toBe(IMAGE_TYPE_RLE);
  for (let i = 0; i < HEADER_BYTES; i++) {
    if (i === 2) continue;
    expect(outputHeader[i], `${label}: header byte ${i}`).toBe(inputHeader[i]);
  }
}

function readFooter(tga: Buffer): {
  extensionOffset: number;
  developerOffset: number;
} {
  expect(tga.length, "file holds a TGA 2.0 footer").toBeGreaterThanOrEqual(FOOTER_BYTES);
  const footer = tga.subarray(tga.length - FOOTER_BYTES);
  expect(footer.toString("ascii", 8, 8 + FOOTER_SIGNATURE.length), "footer signature").toBe(
    FOOTER_SIGNATURE,
  );
  expect(footer.readUInt8(FOOTER_BYTES - 1), "footer signature terminator").toBe(0);
  return {
    extensionOffset: footer.readUInt32LE(0),
    developerOffset: footer.readUInt32LE(4),
  };
}

function ffmpegToRgba(inputPath: string, outputPath: string): Buffer {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-v",
      "error",
      "-y",
      // Force the image2 demuxer: the mpegts probe otherwise false-positives on
      // some 32-bit pixel patterns and the TGA file never reaches the decoder.
      "-f",
      "image2",
      "-i",
      inputPath,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, `ffmpeg failed: ${result.stderr}`).toBe(0);
  return readFileSync(outputPath);
}

// Criterion 10 only runs when ffmpeg can decode TGA files.
const FFMPEG_AVAILABLE = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("1: a 64x64 24-bit image with large flat areas becomes a smaller type 10 file with the same pixels", () => {
  const pixels = makePixels(64, 64, 24, (x, y) => {
    if (x < 24 && y < 24) return bgr(220, 30, 40);
    if (x >= 40 && y >= 40) return bgr(20, 210, 60);
    return bgr(30, 60, 190);
  });
  const input = buildTga({ width: 64, height: 64, pixelDepth: 24, pixels });
  const encoded = encodeTgaRle(input);

  expect(encoded, "eligible true-colour input is encoded").not.toBeNull();
  expect(encoded!.length, "RLE output is smaller than the input").toBeLessThan(input.length);
  const decoded = decodeTgaRle(encoded!);
  expect(decoded.header.imageType, "output image type").toBe(IMAGE_TYPE_RLE);
  expect(decoded.pixels, "decoded pixels match the input bit for bit").toEqual(pixels);
});

test("2: a 32-bit image with random alpha in one half and flat alpha in the other round-trips bit exactly", () => {
  const random = (() => {
    let state = 1;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (value ^ (value >>> 14)) >>> 0;
    };
  })();
  const pixels = makePixels(64, 64, 32, (x) => {
    if (x < 32) {
      const value = random();
      return bgra(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24);
    }
    return bgra(10, 20, 30, 40);
  });
  const input = buildTga({ width: 64, height: 64, pixelDepth: 32, pixels });
  const encoded = encodeTgaRle(input);

  expect(encoded, "eligible 32-bit input is encoded").not.toBeNull();
  const decoded = decodeTgaRle(encoded!);
  expect(decoded.pixels, "every RGB and alpha byte round-trips").toEqual(pixels);

  const alphaAt = (buffer: Buffer, x: number, y: number): number => buffer[(y * 64 + x) * 4 + 3];
  const randomAlphas = new Set<number>();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) randomAlphas.add(alphaAt(pixels, x, y));
  expect(randomAlphas.size, "the random half really has random alpha").toBeGreaterThan(1);
  for (let y = 0; y < 64; y++) for (let x = 32; x < 64; x++) {
    expect(alphaAt(decoded.pixels, x, y), `flat alpha at ${x},${y}`).toBe(40);
  }
});

test("3: a noisy image that RLE would enlarge returns null", () => {
  const pixels = makePixels(64, 64, 24, (x, y) => {
    const pixel = y * 64 + x;
    return [(pixel * 73 + 11) & 0xff, (pixel * 151 + 29) & 0xff, (pixel * 199 + 47) & 0xff];
  });
  const input = buildTga({ width: 64, height: 64, pixelDepth: 24, pixels });

  expect(() => encodeTgaRle(input), "noisy input must not throw").not.toThrow();
  expect(encodeTgaRle(input), "noisy input returns null").toBeNull();
});

test("4: runs and rows longer than 128 pixels split into several packets and never cross a scanline", () => {
  // Every row is one flat run of 300 pixels, so it must be split into at least
  // three packets (128 is the packet maximum) and no packet may cross a row.
  const flatPixels = makePixels(300, 6, 24, () => bgr(40, 80, 120));
  const flatInput = buildTga({ width: 300, height: 6, pixelDepth: 24, pixels: flatPixels });
  const flatEncoded = encodeTgaRle(flatInput);

  expect(flatEncoded, "a flat 300x6 image is encoded").not.toBeNull();
  expect(flatEncoded!.length, "flat output is smaller").toBeLessThan(flatInput.length);
  expect(decodeTgaRle(flatEncoded!).pixels, "flat 300x6 round-trips").toEqual(flatPixels);

  const flatPackets = readRlePackets(flatEncoded!);
  expect(
    flatPackets.every((packet) => packet.count >= 1 && packet.count <= MAX_PACKET_PIXELS),
    "every packet holds 1..128 pixels",
  ).toBe(true);
  for (let row = 0; row < 6; row++) {
    const rowPackets = flatPackets.filter((packet) => packet.row === row);
    expect(rowPackets.length, `flat row ${row} splits into several packets`).toBeGreaterThanOrEqual(
      Math.ceil(300 / MAX_PACKET_PIXELS),
    );
    expect(
      rowPackets.reduce((total, packet) => total + packet.count, 0),
      `packets of row ${row} cover exactly the row`,
    ).toBe(300);
  }

  // A long non-run stretch after a flat run: each row still needs several
  // packets, and the reference decoder rejects any packet crossing a scanline.
  const mixedPixels = makePixels(300, 6, 24, (x) => {
    if (x < 100) return bgr(200, 10, 10);
    return (x - 100) % 2 === 0 ? bgr(0, 200, 0) : bgr(0, 0, 200);
  });
  const mixedInput = buildTga({ width: 300, height: 6, pixelDepth: 24, pixels: mixedPixels });
  const mixedEncoded = encodeTgaRle(mixedInput);

  expect(mixedEncoded, "a mixed 300x6 image is encoded").not.toBeNull();
  expect(mixedEncoded!.length, "mixed output is smaller").toBeLessThan(mixedInput.length);
  const mixedDecoded = decodeTgaRle(mixedEncoded!);
  expect(mixedDecoded.pixels, "mixed 300x6 round-trips").toEqual(mixedPixels);
  const mixedPackets = readRlePackets(mixedEncoded!);
  for (let row = 0; row < 6; row++) {
    expect(
      mixedPackets.filter((packet) => packet.row === row).length,
      `mixed row ${row} splits into several packets`,
    ).toBeGreaterThanOrEqual(Math.ceil(300 / MAX_PACKET_PIXELS));
  }
});

test("5: a 1x1 and a 1xN image return null because RLE would grow, and an Nx1 image round-trips", () => {
  const onePixel = makePixels(1, 1, 24, () => bgr(1, 2, 3));
  const oneByOne = buildTga({ width: 1, height: 1, pixelDepth: 24, pixels: onePixel });
  expect(() => encodeTgaRle(oneByOne), "1x1 must not throw").not.toThrow();
  expect(encodeTgaRle(oneByOne), "1x1 would grow").toBeNull();

  const oneByMany = makePixels(1, 300, 24, () => bgr(5, 6, 7));
  const oneByN = buildTga({ width: 1, height: 300, pixelDepth: 24, pixels: oneByMany });
  expect(() => encodeTgaRle(oneByN), "1x300 must not throw").not.toThrow();
  expect(encodeTgaRle(oneByN), "1x300 would grow").toBeNull();

  const manyByOnePixels = makePixels(300, 1, 24, () => bgr(5, 6, 7));
  const nByOne = buildTga({ width: 300, height: 1, pixelDepth: 24, pixels: manyByOnePixels });
  const encoded = encodeTgaRle(nByOne);
  expect(encoded, "300x1 flat row is encoded").not.toBeNull();
  expect(encoded!.length, "300x1 output is smaller").toBeLessThan(nByOne.length);
  expect(decodeTgaRle(encoded!).pixels, "300x1 round-trips").toEqual(manyByOnePixels);
});

test("6: an image ID and a TGA 2.0 footer with extension and developer areas survive with rewritten offsets", () => {
  const pixels = makePixels(32, 16, 24, (x, y) =>
    y < 8 ? bgr(10, 20, 30) : bgr(200, 100 + x, 50),
  );
  const imageId = Buffer.from("ZHWP-164-TGA", "ascii");
  const extensionArea = defaultExtensionArea();
  extensionArea.write("criterion 6 marker", 60, "ascii");
  const developerArea = defaultDeveloperArea();
  const input = buildTga({
    width: 32,
    height: 16,
    pixelDepth: 24,
    imageId,
    footer: true,
    extensionArea,
    developerArea,
    pixels,
  });
  const encoded = encodeTgaRle(input);

  expect(encoded, "a file with an image ID and footer is encoded").not.toBeNull();
  const decoded = decodeTgaRle(encoded!);
  expect(decoded.pixels, "pixels round-trip with the image ID present").toEqual(pixels);

  expect(encoded!.readUInt8(0), "image ID length").toBe(imageId.length);
  expect(
    encoded!.subarray(HEADER_BYTES, HEADER_BYTES + imageId.length),
    "image ID bytes",
  ).toEqual(imageId);

  const footer = readFooter(encoded!);
  const dataEnd = decoded.dataEnd;
  expect(footer.extensionOffset, "extension area follows the encoded pixels").toBe(dataEnd);
  expect(footer.developerOffset, "developer area follows the extension area").toBe(
    dataEnd + extensionArea.length,
  );
  expect(
    footer.extensionOffset,
    "the extension area really moved from its input offset",
  ).not.toBe(HEADER_BYTES + imageId.length + pixels.length);
  expect(
    encoded!.subarray(dataEnd, dataEnd + extensionArea.length),
    "extension area bytes are copied unchanged",
  ).toEqual(extensionArea);
  expect(
    encoded!.subarray(footer.developerOffset, footer.developerOffset + developerArea.length),
    "developer area bytes are copied unchanged",
  ).toEqual(developerArea);
  expect(encoded!.length, "footer is the last 26 bytes").toBe(
    footer.developerOffset + developerArea.length + FOOTER_BYTES,
  );

  // A file without a footer must not grow one.
  const plainPixels = makePixels(8, 8, 24, () => bgr(9, 9, 9));
  const plainInput = buildTga({ width: 8, height: 8, pixelDepth: 24, pixels: plainPixels });
  const plainEncoded = encodeTgaRle(plainInput);
  expect(plainEncoded, "a plain file is encoded").not.toBeNull();
  const plainDecoded = decodeTgaRle(plainEncoded!);
  expect(plainDecoded.dataEnd, "no footer is appended when the input has none").toBe(
    plainEncoded!.length,
  );
});

test("7: other image types, 16-bit, a colour map, truncated, random and empty inputs return null without throwing", () => {
  const flatPixels = makePixels(16, 16, 24, () => bgr(1, 2, 3));
  const valid = buildTga({ width: 16, height: 16, pixelDepth: 24, pixels: flatPixels });
  const random = Buffer.alloc(300);
  for (let i = 0; i < random.length; i++) random[i] = (i * 37 + 11) & 0xff;

  const colourMapped = {
    width: 16,
    height: 16,
    pixelDepth: 8,
    colorMapType: 1,
    colorMapEntrySize: 24,
    colorMapData: Buffer.alloc(256 * 3),
    pixels: Buffer.alloc(16 * 16),
  } as const;
  const trueColourWithMap = {
    width: 16,
    height: 16,
    pixelDepth: 24,
    colorMapType: 1,
    colorMapEntrySize: 24,
    colorMapData: Buffer.alloc(256 * 3),
    pixels: flatPixels,
  } as const;

  const cases: [string, Buffer][] = [
    ["image type 1 (colour-mapped)", buildTga({ ...colourMapped, imageType: 1 })],
    ["image type 3 (greyscale)", buildTga({ width: 16, height: 16, pixelDepth: 8, imageType: 3 })],
    ["image type 9 (colour-mapped RLE)", buildTga({ ...colourMapped, imageType: 9 })],
    ["image type 10 (true-colour RLE)", buildTga({ width: 16, height: 16, pixelDepth: 24, imageType: 10, pixels: flatPixels })],
    ["image type 11 (greyscale RLE)", buildTga({ width: 16, height: 16, pixelDepth: 8, imageType: 11 })],
    ["16 bits per pixel", buildTga({ width: 16, height: 16, pixelDepth: 16 })],
    ["a colour map", buildTga({ ...trueColourWithMap })],
    ["width 0", buildTga({ width: 0, height: 8, pixelDepth: 24 })],
    ["height 0", buildTga({ width: 8, height: 0, pixelDepth: 24 })],
    ["truncated pixel data", valid.subarray(0, valid.length - 1)],
    ["random bytes", random],
    ["empty buffer", Buffer.alloc(0)],
  ];

  for (const [label, input] of cases) {
    expect(() => encodeTgaRle(input), `${label}: must not throw`).not.toThrow();
    expect(encodeTgaRle(input), `${label}: returns null`).toBeNull();
  }
});

test("8: the descriptor and every header field except the image type are identical", () => {
  const variants = [
    {
      label: "24-bit bottom-left with origins and image ID",
      pixelDepth: 24,
      descriptor: 0x00,
      xOrigin: 7,
      yOrigin: 9,
      imageId: Buffer.from("HDR", "ascii"),
    },
    {
      label: "32-bit top-left with alpha-depth bits",
      pixelDepth: 32,
      descriptor: 0x28,
      xOrigin: 0,
      yOrigin: 0,
      imageId: Buffer.alloc(0),
    },
    {
      label: "24-bit right-to-left",
      pixelDepth: 24,
      descriptor: 0x10,
      xOrigin: 3,
      yOrigin: 5,
      imageId: Buffer.from("ID", "ascii"),
    },
  ];

  for (const variant of variants) {
    const pixels = makePixels(12, 10, variant.pixelDepth, (x, y) =>
      (x + y) % 3 === 0 ? bgr(1, 2, 3) : bgr(250, 240, 230),
    );
    const input = buildTga({
      width: 12,
      height: 10,
      pixelDepth: variant.pixelDepth,
      descriptor: variant.descriptor,
      xOrigin: variant.xOrigin,
      yOrigin: variant.yOrigin,
      imageId: variant.imageId,
      pixels,
    });
    const encoded = encodeTgaRle(input);

    expect(encoded, `${variant.label}: is encoded`).not.toBeNull();
    expectSameHeaderExceptType(input, encoded!, variant.label);
    expect(encoded!.readUInt8(17), `${variant.label}: descriptor`).toBe(variant.descriptor);
    expect(decodeTgaRle(encoded!).pixels, `${variant.label}: pixels round-trip`).toEqual(pixels);
  }
});

test("9: two calls on the same input return byte-identical buffers and do not mutate the input", () => {
  const pixels = makePixels(64, 64, 24, (x, y) =>
    (x >> 4) % 2 === 0 ? bgr(255, 0, 0) : bgr(0, 0, 255),
  );
  const input = buildTga({ width: 64, height: 64, pixelDepth: 24, pixels });
  const before = Buffer.from(input);
  const first = encodeTgaRle(input);
  const second = encodeTgaRle(input);

  expect(first, "first call is encoded").not.toBeNull();
  expect(second, "second call is encoded").not.toBeNull();
  expect(Buffer.compare(first!, second!), "both outputs are byte-identical").toBe(0);
  expect(Buffer.compare(input, before), "the input is not mutated").toBe(0);
});

test("10: ffmpeg decodes the output to the same raw RGBA frames as the input", () => {
  test.skip(!FFMPEG_AVAILABLE, "ffmpeg is not on PATH");

  const cases = [
    {
      label: "24-bit",
      input: buildTga({
        width: 64,
        height: 48,
        pixelDepth: 24,
        descriptor: 0x20,
        pixels: makePixels(64, 48, 24, (x, y) =>
          x < 20 ? bgr(240, 10, 20) : bgr(30, 40 + (y & 0x3f), 200),
        ),
      }),
    },
    {
      label: "32-bit",
      input: buildTga({
        width: 48,
        height: 48,
        pixelDepth: 32,
        descriptor: 0x28,
        pixels: makePixels(48, 48, 32, (x, y) =>
          x < 16 ? bgra(10, 20, 30, 128) : bgra(40 + (x & 0x3f), 60, 80, 200 + (y & 0x1f)),
        ),
      }),
    },
  ];

  const dir = mkdtempSync(join(tmpdir(), "zhwp-tga-rle-"));
  try {
    for (const { label, input } of cases) {
      const encoded = encodeTgaRle(input);
      expect(encoded, `${label}: input is encoded`).not.toBeNull();
      const inputPath = join(dir, `${label}-input.tga`);
      const outputPath = join(dir, `${label}-output.tga`);
      writeFileSync(inputPath, input);
      writeFileSync(outputPath, encoded!);
      const inputRgba = ffmpegToRgba(inputPath, join(dir, `${label}-input.rgba`));
      const outputRgba = ffmpegToRgba(outputPath, join(dir, `${label}-output.rgba`));
      expect(outputRgba.length, `${label}: ffmpeg frame bytes`).toBe(inputRgba.length);
      expect(Buffer.compare(outputRgba, inputRgba), `${label}: ffmpeg RGBA frames`).toBe(0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
