import { test, expect } from "@playwright/test";
import { clearStored, launcherUrl, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { installZip } from "./helpers/install-zip";

// While the game plays, the top bar holds the touch toggle and a game-menu
// button that sends Escape to the engine (a real Esc may only leave pointer
// lock or fullscreen). The app asks for landscape in its manifest.

test("the playing top bar has the game menu and touch buttons; game menu sends Escape", async ({ page }, info) => {
  await clearStored(page);
  await page.goto(launcherUrl("/harness/errors/resolves.js"));
  await waitForState(page, "no-assets");
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(page.locator("#touch-toggle")).toBeHidden();

  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await waitForState(page, "playing", START_TIMEOUT);

  await expect(page.locator("#topbar #game-menu")).toBeVisible();
  await expect(page.locator("#topbar #touch-toggle")).toBeVisible();
  await expect(page.locator("#screen #touch-toggle")).toHaveCount(0);

  await page.evaluate(() => {
    (window as unknown as { __keys: string[] }).__keys = [];
    window.addEventListener("keydown", (e) => (window as unknown as { __keys: string[] }).__keys.push(`down:${e.key}:${e.keyCode}`));
    window.addEventListener("keyup", (e) => (window as unknown as { __keys: string[] }).__keys.push(`up:${e.key}:${e.keyCode}`));
  });
  await page.locator("#game-menu").click();
  expect(await page.evaluate(() => (window as unknown as { __keys: string[] }).__keys)).toEqual([
    "down:Escape:27",
    "up:Escape:27",
  ]);
});

test("the manifest asks for landscape", async ({ request }) => {
  const manifest = await (await request.get("/app/manifest.webmanifest")).json();
  expect(manifest.orientation).toBe("landscape");
});
