import { gameZips } from "./helpers/real-game";
import { openLauncher, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// Issue #78: with the owner's real game data, every mip level of a
// block-compressed (DXT/BC) texture must upload as a full 4x4 block, so WebGPU
// does not reject the small levels. Local only: skipped unless ZHWP_GAME_ZIPS
// points to a folder that contains both game installs. Nothing from the game is
// copied into the repository.
const gameZipPaths = gameZips();

test.skip(gameZipPaths === null, "set ZHWP_GAME_ZIPS to run against real game data");

// Criterion 1 describes one run from the automatic engine start until 20 s
// after GENERALSX_LOAD_DONE; the run happens once in beforeAll.
test.describe.configure({ timeout: 15 * 60_000 });

test.describe("compressed texture mip uploads on the real engine", () => {
  let context: BrowserContext;
  let page: Page;
  let log: string[] = [];

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.ZHWP_PORT ?? 4173}` });
    page = await context.newPage();
    await openLauncher(page);
    await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

    await page.locator("#zip-input").setInputFiles(gameZipPaths as string[]);
    // Issue #159: the completed import starts the engine by itself; there is
    // no Play click any more.
    await waitForState(page, "playing", 10 * 60_000);
    await expect(page.locator("#status")).toContainText("Ready", { timeout: START_TIMEOUT });

    // The shell map loads behind the main menu; its end is GENERALSX_LOAD_DONE.
    await page.waitForFunction(
      () => ((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? []).some((line) => line.includes("GENERALSX_LOAD_DONE")),
      null,
      { timeout: 5 * 60_000 },
    );
    // Criterion 1 covers the run until 20 s after GENERALSX_LOAD_DONE.
    await page.waitForTimeout(20_000);
    log = await page.evaluate(() => [...((window as unknown as { __zhwpLog: string[] }).__zhwpLog)]);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("1: __zhwpLog has no 'is not a multiple of compressed texture format block' line", () => {
    const rejected = log.filter((line) => line.includes("is not a multiple of compressed texture format block"));
    expect(rejected, `WebGPU rejected compressed texture mip uploads:\n${rejected.slice(0, 5).join("\n")}`).toEqual([]);
  });
});
