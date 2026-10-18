import { gameZips } from "./helpers/real-game";
import { openLauncher, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { test, expect } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Issue #6: run the launcher against the owner's real game files. Local only:
// skipped unless ZHWP_GAME_ZIPS lists the game ZIPs (make-game-zip.mjs --split), which hold both game
// installs (the Zero Hour folder and the Generals folder, at any depth).
// Nothing from the game is copied into the repository; the screenshot goes to
// the system temp folder.
const gameZipPaths = gameZips();

test.skip(gameZipPaths === null, "set ZHWP_GAME_ZIPS to run against real game data");

test("real game data reaches the main menu", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await openLauncher(page);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  await page.locator("#zip-input").setInputFiles(gameZipPaths as string[]);
  // Issue #159: the completed import starts the engine by itself; there is no
  // Play click any more.
  await waitForState(page, "playing", 10 * 60_000);
  await expect(page.locator("#status")).toContainText("Ready", { timeout: START_TIMEOUT });
  await expect(page.locator("#canvas")).toBeVisible();

  // The shell map loads behind the main menu; its end is GENERALSX_LOAD_DONE.
  await page.waitForFunction(
    () => ((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? []).some((l) => l.includes("GENERALSX_LOAD_DONE")),
    null,
    { timeout: 5 * 60_000 },
  );
  await page.waitForTimeout(3000);
  const shot = join(tmpdir(), "zhwp-main-menu.png");
  await page.locator("#canvas").screenshot({ path: shot });
  console.log(`main menu screenshot: ${shot}`);

  const log = await page.evaluate(() => (window as unknown as { __zhwpLog: string[] }).__zhwpLog);
  expect(log.filter((l) => /GENERALSX_WEBGPU_\w+_FAILED|RuntimeError|Aborted\(/.test(l))).toEqual([]);
});
