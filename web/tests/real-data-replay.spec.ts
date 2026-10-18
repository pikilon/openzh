import { gameZips } from "./helpers/real-game";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { inflateSync } from "node:zlib";

// Issue #34: with the owner's real game files and one real Zero Hour replay,
// the windowed engine plays the replay in Brave. Local only: skipped unless
// ZHWP_GAME_ZIPS lists the game ZIPs and ZHWP_REPLAY to one .rep file.
// Nothing from the game is copied into the repository; the screenshot goes to
// the system temp folder.
const gameZipPaths = gameZips();
const replayFile = process.env.ZHWP_REPLAY;
const DATA = "/home/web_user/.local/share/GeneralsX";

test.skip(
  gameZipPaths === null || !replayFile || !existsSync(replayFile),
  "set ZHWP_GAME_ZIPS and ZHWP_REPLAY to run against real game data",
);

// The four criteria describe one run: import the game files, play the replay
// from the smoke page for 45 s, then check the file system, the log and the
// screenshot of that run.
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

test.describe("a real replay in the browser", () => {
  let context: BrowserContext;
  let page: Page;
  let smoke: Page;
  let replayName = "";
  let replayBytes = Buffer.alloc(0);
  let log: string[] = [];
  let done: { status?: string; code?: number; message?: string } | undefined;
  let screenshotPath = "";
  let screenshot = Buffer.alloc(0);

  test.beforeAll(async ({ browser }) => {
    const gamePath = gameZipPaths as string[];
    const replayPath = replayFile as string;
    replayName = basename(replayPath);
    replayBytes = readFileSync(replayPath);

    context = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.ZHWP_PORT ?? 4173}` });
    page = await context.newPage();
    // Import the game files exactly as tests/real-data.spec.ts does: the
    // launcher stores the archives in OPFS, which the smoke page mounts.
    await page.goto("/app/index.html");
    await page.locator("#clear").click();
    await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

    await page.locator("#zip-input").setInputFiles(gamePath);
    await expect(page.locator("#status")).toContainText("Ready", { timeout: 10 * 60_000 });
    await expect(page.locator("#play")).toBeEnabled();

    // Same browser context as the launcher, so the smoke page sees the same
    // OPFS. Serve only the replay's path; matching on URL.pathname keeps the
    // page's own URL (which contains replay=/replays/<name>) untouched.
    smoke = await context.newPage();
    await smoke.route(
      (url) => url.pathname === `/replays/${encodeURIComponent(replayName)}`,
      (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: replayBytes }),
    );
    const encodedName = encodeURIComponent(replayName);
    await smoke.goto(
      `/smoke/index.html?archives=opfs&replay=/replays/${encodedName}&arg=-win&arg=-replay&arg=${encodedName}`,
    );

    // The preRun that applies the replay and exposes the module runs before
    // main; wait for it (or for an early failure) before the fixed 45 s.
    await smoke.waitForFunction(
      () => {
        const w = window as unknown as { __zhwpModule?: unknown; __zhwpDone?: unknown };
        return w.__zhwpModule !== undefined || w.__zhwpDone !== undefined;
      },
      null,
      { timeout: 5 * 60_000 },
    );
    await smoke.waitForTimeout(45_000);

    log = await smoke.evaluate(() => [...((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? [])]);
    done = await smoke.evaluate(() => (window as unknown as { __zhwpDone?: { status?: string; code?: number; message?: string } }).__zhwpDone);
    screenshotPath = join(tmpdir(), "zhwp-real-replay.png");
    screenshot = await smoke.locator("#canvas").screenshot({ path: screenshotPath });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("3: the replay is in the engine's file system at GeneralsZH/Replays/<name>", async () => {
    const path = `${DATA}/GeneralsZH/Replays/${replayName}`;
    const stored = await smoke.evaluate((filePath) => {
      const module = (window as unknown as { __zhwpModule?: any }).__zhwpModule;
      if (!module) return { exists: false, bytes: [] as number[] };
      const exists = module.FS.analyzePath(filePath).exists;
      return { exists, bytes: exists ? (Array.from(module.FS.readFile(filePath)) as number[]) : [] };
    }, path);
    expect(stored.exists, `the replay must exist at ${path}`).toBe(true);
    expect(Buffer.from(stored.bytes).equals(replayBytes), `bytes at ${path} must be the replay's`).toBe(true);
  });

  test("4: after 45 s the log has no WebGPU failure or abort and __zhwpDone is not an error", () => {
    expect(done?.status, `smoke page reported: ${done?.message ?? ""}`).not.toBe("error");
    const failures = log.filter((line) => /GENERALSX_WEBGPU_\w+_FAILED|RuntimeError|Aborted\(/.test(line));
    expect(failures, `failures in the engine log:\n${failures.slice(0, 5).join("\n")}`).toEqual([]);
  });

  test("5: the canvas screenshot has at least 5000 distinct colours", () => {
    const colours = distinctColours(screenshot);
    expect(colours, `only ${colours} distinct colours in ${screenshotPath}`).toBeGreaterThanOrEqual(5000);
  });

  test("6: the screenshot path is printed and is in the system temp folder", () => {
    console.log(`real replay screenshot: ${screenshotPath}`);
    expect(screenshotPath.startsWith(tmpdir())).toBe(true);
    expect(existsSync(screenshotPath), `screenshot must exist at ${screenshotPath}`).toBe(true);
  });
});
