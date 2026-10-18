import { test, expect } from "@playwright/test";
import { openLauncher } from "./helpers/launcher";
import { gameZips } from "./helpers/real-game";

// Issue #173 criterion 2: with the owner's real game data the engine renders at
// 1920x1080, so the canvas drawing buffer is 1920x1080, and it still logs the
// fresh-profile graphics defaults exactly once. Local only: skipped unless
// ZHWP_GAME_ZIPS lists the game ZIPs (make-game-zip.mjs --split), which hold
// both installs. Nothing from the game is copied into the repository.
//
// The synthetic-install spec (launcher-graphics-defaults.spec.ts) proves the
// log line without game data. It cannot check the buffer: the synthetic
// assets fail before display init, which is the only place the canvas backing
// size is written for a windowed game.
const gameZipPaths = gameZips();

test.skip(gameZipPaths === null, "set ZHWP_GAME_ZIPS to run against real game data");

const LOG_PREFIX = "GENERALSX_GRAPHICS ";
const EXPECTED_LINE =
  "GENERALSX_GRAPHICS xres=1920 yres=1080 lod=VeryHigh aa=4 filter=4 anisotropy=16 dynamicLOD=0";
const BUFFER = { width: 1920, height: 1080 };

// A real import, engine start and display init are slow.
test.describe.configure({ timeout: 15 * 60_000 });

test("2: with real game data the canvas drawing buffer is 1920x1080 and the 1080p VeryHigh line is logged once", async ({
  page,
}) => {
  await openLauncher(page);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  // Issue #159: the completed import starts the engine by itself.
  await page.locator("#zip-input").setInputFiles(gameZipPaths as string[]);

  // The line is printed during engine initialization, before the main menu.
  await page.waitForFunction(
    (prefix) =>
      ((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? []).some((line) =>
        line.startsWith(prefix),
      ),
    LOG_PREFIX,
    { timeout: 10 * 60_000 },
  );
  const lines = await page.evaluate(
    (prefix) =>
      [...((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? [])].filter((line) =>
        line.startsWith(prefix),
      ),
    LOG_PREFIX,
  );
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe(EXPECTED_LINE);

  // The drawing buffer is the engine's own render resolution, written during
  // display init: wait for the observable buffer instead of a fixed delay.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
          return canvas === null ? null : { width: canvas.width, height: canvas.height };
        }),
      { timeout: 5 * 60_000 },
    )
    .toEqual(BUFFER);
});
