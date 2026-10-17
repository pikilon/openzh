import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

// Issue #79: with the owner's real game data, the browser build must resolve the
// game's font faces to the bundled Liberation files, so the main menu text is
// drawn and no "[Font] WARNING: Unable to resolve font" line is logged. Local
// only: skipped unless ZHWP_GAME_DIR points to a folder that contains both game
// installs. Nothing from the game is copied into the repository; the screenshot
// goes to the system temp folder.
const gameDir = process.env.ZHWP_GAME_DIR;

test.skip(!gameDir || !existsSync(gameDir), "set ZHWP_GAME_DIR to run against real game data");

// Criteria 1 and 3 describe one run from Play until 20 s after
// GENERALSX_LOAD_DONE, so the run happens once in beforeAll; criterion 2 reads
// the Emscripten file system of the same build right after it.
test.describe.configure({ timeout: 15 * 60_000 });

// The right-hand panel of the main menu, with the title above it: the stacked
// menu buttons whose labels are missing before this change. Fractions rather
// than pixels keep the region on the panel if the canvas is laid out at another
// size.
const BUTTON_COLUMN = { x0: 0.65, y0: 0.2, x1: 0.94, y1: 0.6 };

// Distinct colours measured on the current (pre-change) engine at 20 s after
// GENERALSX_LOAD_DONE, in the region above: 5496, 5547, 5563, 5587 and 5604
// over five runs (about 1% run-to-run rendering variation). 5800 clears that
// variation; the six button labels add antialiased blends on the nearly flat
// dark button interiors.
const BUTTON_COLUMN_BEFORE = 5604;
const BUTTON_COLUMN_THRESHOLD = 5800;

// Files the browser build must preload from assets/fonts/ (the brief's four
// Liberation fonts and their licence). Anything else from that directory
// (fontawesome) must not be preloaded.
const PRELOADED_FONTS = ["arial.ttf", "arialbold.ttf", "couriernew.ttf", "timesnewroman.ttf", "LICENSE.liberation"];
const NOT_PRELOADED_FONTS = ["fa-brands-400.ttf", "LICENSE.fontawesome"];

// Minimal PNG reader for the screenshot: only what Chromium's screenshot
// encoder emits (8-bit, non-interlaced). Counting in Node keeps the game page
// untouched between the screenshot and the assertions.
function distinctColours(
  png: Buffer,
  region: { x0: number; y0: number; x1: number; y1: number },
): number {
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
  const x0 = Math.floor(width * region.x0);
  const y0 = Math.floor(height * region.y0);
  const x1 = Math.ceil(width * region.x1);
  const y1 = Math.ceil(height * region.y1);
  if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 <= x0 || y1 <= y0) {
    throw new Error(`button column region is outside the ${width}x${height} screenshot`);
  }
  const colours = new Set<string>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const pixel = (y * width + x) * channels;
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
  }
  return colours.size;
}

test.describe("fonts on the real engine", () => {
  let context: BrowserContext;
  let page: Page;
  let log: string[] = [];
  let screenshotPath = "";
  let screenshot = Buffer.alloc(0);
  let preloadedFonts: string[] = [];
  let fsError = "";

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.ZHWP_PORT ?? 4173}` });
    page = await context.newPage();
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
    // The criteria cover the run until 20 s after GENERALSX_LOAD_DONE and fix
    // the screenshot at the same moment.
    await page.waitForTimeout(20_000);
    log = await page.evaluate(() => [...((window as unknown as { __zhwpLog: string[] }).__zhwpLog)]);
    screenshotPath = join(tmpdir(), "zhwp-web-fonts-79-main-menu.png");
    screenshot = await page.locator("#canvas").screenshot({ path: screenshotPath });

    // Criterion 2: read the preloaded files through window.__zhwpModule.FS. The
    // launcher does not expose the module, so the kernel of the same build is
    // started again on the smoke page, with the archives the launcher stored in
    // OPFS. Closing the launcher page first releases its OPFS access handles.
    try {
      await page.close();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const smoke = await context.newPage();
      // The smoke page awaits the whole engine, so wait for the navigation
      // itself and then for preRun to expose the module, not for "load".
      await smoke.goto("/smoke/index.html?archives=opfs", { waitUntil: "commit" });
      await smoke.waitForFunction(
        () => (window as unknown as { __zhwpModule?: { FS?: unknown } }).__zhwpModule?.FS !== undefined,
        null,
        { timeout: 2 * 60_000 },
      );
      preloadedFonts = await smoke.evaluate(() => {
        const module = (window as unknown as { __zhwpModule: { FS: any } }).__zhwpModule;
        const FS = module.FS;
        const files: string[] = [];
        // /proc, /dev and dangling links are not preloaded game files; Emscripten
        // throws on some of their nodes, so each entry is guarded.
        const walk = (path: string): void => {
          let entries: string[];
          try {
            entries = FS.readdir(path) as string[];
          } catch {
            return;
          }
          for (const name of entries) {
            if (name === "." || name === "..") continue;
            const child = path === "/" ? `/${name}` : `${path}/${name}`;
            try {
              const stat = FS.lstat(child);
              if (FS.isDir(stat.mode)) walk(child);
              else if (!FS.isLink(stat.mode)) files.push(child);
            } catch {
              // Ignore nodes this file system cannot stat.
            }
          }
        };
        walk("/");
        return files;
      });
      await smoke.close();
    } catch (error) {
      fsError = error instanceof Error ? error.message : String(error);
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("1: __zhwpLog has no 'Unable to resolve font' line", () => {
    const unresolved = log.filter((line) => line.includes("Unable to resolve font"));
    expect(unresolved.length, `unresolved font faces:\n${unresolved.slice(0, 5).join("\n")}`).toBe(0);
  });

  test("2: the engine file system has exactly the preloaded Liberation files", () => {
    expect(fsError, `could not read window.__zhwpModule.FS: ${fsError}`).toBe("");
    const names = new Set(preloadedFonts.map((path) => path.split("/").pop() as string));
    for (const font of PRELOADED_FONTS) {
      expect(names.has(font), `${font} is not preloaded; files: ${preloadedFonts.join(", ")}`).toBe(true);
    }
    for (const font of NOT_PRELOADED_FONTS) {
      expect(names.has(font), `${font} must not be preloaded`).toBe(false);
    }
  });

  test("3: the main menu's button column has more distinct colours than before", () => {
    const colours = distinctColours(screenshot, BUTTON_COLUMN);
    console.log(
      `button column distinct colours: before=${BUTTON_COLUMN_BEFORE} threshold=${BUTTON_COLUMN_THRESHOLD} now=${colours}`,
    );
    expect(
      colours,
      `button column has ${colours} distinct colours (before=${BUTTON_COLUMN_BEFORE}, threshold=${BUTTON_COLUMN_THRESHOLD}) in ${screenshotPath}`,
    ).toBeGreaterThan(BUTTON_COLUMN_THRESHOLD);
  });
});
