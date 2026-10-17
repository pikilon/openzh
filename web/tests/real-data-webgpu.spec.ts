import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

// Issue #77: with the owner's real game data, every WebGPU render pass must get
// no depth-stencil attachment or a real depth/depth-stencil one, so the frame
// is not dropped and the shell map behind the main menu is drawn. Local only:
// skipped unless ZHWP_GAME_DIR points to a folder that contains both game
// installs. Nothing from the game is copied into the repository; the screenshot
// goes to the system temp folder.
const gameDir = process.env.ZHWP_GAME_DIR;

test.skip(!gameDir || !existsSync(gameDir), "set ZHWP_GAME_DIR to run against real game data");

// The three criteria describe one run from Play until 20 s after
// GENERALSX_LOAD_DONE, so the run happens once in beforeAll and each test
// checks its own criterion against the same log and screenshot.
test.describe.configure({ timeout: 15 * 60_000 });

// Minimal PNG reader for the screenshot: only what Chromium's screenshot
// encoder emits (8-bit, non-interlaced). Counting in Node keeps the game page
// untouched between the screenshot and the assertions.
function distinctColours(png: Buffer): number {
  const signature = "89504e470d0a1a0a";
  if (png.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("screenshot is not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  let palette: Buffer | undefined;
  const idat: Buffer[] = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0) {
    throw new Error(`unsupported screenshot PNG: ${width}x${height} depth=${bitDepth} interlace=${interlace}`);
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colourType];
  if (!channels || (colourType === 3 && !palette)) {
    throw new Error(`unsupported screenshot PNG colour type ${colourType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++];
    const source = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : undefined;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= channels ? previous[x - channels] : 0;
      let value = source[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += Math.floor((left + up) / 2);
          break;
        case 4: {
          const estimate = left + up - upLeft;
          const leftDistance = Math.abs(estimate - left);
          const upDistance = Math.abs(estimate - up);
          const upLeftDistance = Math.abs(estimate - upLeft);
          value += leftDistance <= upDistance && leftDistance <= upLeftDistance ? left : upDistance <= upLeftDistance ? up : upLeft;
          break;
        }
        default:
          throw new Error(`unsupported screenshot PNG filter ${filter}`);
      }
      row[x] = value & 0xff;
    }
  }
  const colours = new Set<string>();
  for (let index = 0; index < width * height; index++) {
    const pixel = index * channels;
    if (colourType === 0 || colourType === 4) {
      const grey = pixels[pixel];
      colours.add(`${grey},${grey},${grey}`);
    } else if (colourType === 3) {
      const entry = pixels[pixel] * 3;
      colours.add(`${palette![entry]},${palette![entry + 1]},${palette![entry + 2]}`);
    } else {
      colours.add(`${pixels[pixel]},${pixels[pixel + 1]},${pixels[pixel + 2]}`);
    }
  }
  return colours.size;
}

test.describe("depth-stencil format on the real engine", () => {
  let context: BrowserContext;
  let page: Page;
  let log: string[] = [];
  let browserLog: string[] = [];
  let screenshotPath = "";
  let screenshot = Buffer.alloc(0);

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.ZHWP_PORT ?? 4173}` });
    page = await context.newPage();
    browserLog = [];
    page.on("console", (message) => browserLog.push(message.text()));
    page.on("pageerror", (error) => browserLog.push(error.message));
    await page.goto("/app/index.html");
    await page.locator("#clear").click();
    await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

    await page.locator("#folder-input").setInputFiles(gameDir as string);
    await expect(page.locator("#status")).toContainText("Ready", { timeout: 10 * 60_000 });
    await expect(page.locator("#play")).toBeEnabled();

    await page.locator("#play").click();
    // The shell map loads behind the main menu; its end is GENERALSX_LOAD_DONE.
    await page.waitForFunction(
      () => ((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? []).some((line) => line.includes("GENERALSX_LOAD_DONE")),
      null,
      { timeout: 5 * 60_000 },
    );
    // Criterion 3 fixes the screenshot at 20 s after GENERALSX_LOAD_DONE.
    await page.waitForTimeout(20_000);
    log = await page.evaluate(() => [...((window as unknown as { __zhwpLog: string[] }).__zhwpLog)]);
    browserLog = [...browserLog];
    screenshotPath = join(tmpdir(), "zhwp-depth-stencil-77.png");
    screenshot = await page.locator("#canvas").screenshot({ path: screenshotPath });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("1: __zhwpLog has no 'is not a depth stencil format' line", () => {
    const rejected = log.filter((line) => line.includes("is not a depth stencil format"));
    expect(rejected, `WebGPU rejected render passes:\n${rejected.slice(0, 5).join("\n")}`).toEqual([]);
  });

  test("2: the run has no '[Invalid CommandBuffer]' line", () => {
    const invalid = [...log, ...browserLog].filter((line) => line.includes("[Invalid CommandBuffer]"));
    expect(invalid, `invalid command buffers:\n${invalid.slice(0, 5).join("\n")}`).toEqual([]);
  });

  test("3: the canvas screenshot has at least 16 distinct colours", () => {
    const colours = distinctColours(screenshot);
    expect(colours, `only ${colours} distinct colours in ${screenshotPath}`).toBeGreaterThanOrEqual(16);
  });
});
