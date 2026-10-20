import { test, expect } from "@playwright/test";
import { clearStored, launcherUrl, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { installZip } from "./helpers/install-zip";

// While the game plays, the top bar holds the touch toggle; the game-menu
// button moved into the touch column and still sends Escape to the engine (a
// real Esc may only leave pointer lock or fullscreen). The app asks for
// landscape in its manifest.

test.use({ hasTouch: true, viewport: { width: 812, height: 375 } });

test("18: the game menu lives in the touch column, not the top bar, and sends Escape", async ({ page }, info) => {
  await clearStored(page);
  await page.goto(launcherUrl("/harness/errors/resolves.js"));
  await waitForState(page, "no-assets");
  await expect(page.locator("#topbar #game-menu")).toHaveCount(0);
  await expect(page.locator("#touch-controls #game-menu")).toHaveCount(1);
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(page.locator("#touch-toggle")).toBeHidden();

  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await waitForState(page, "playing", START_TIMEOUT);

  await expect(page.locator("#topbar #game-menu")).toHaveCount(0);
  await expect(page.locator("#touch-controls #game-menu")).toBeVisible();
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

  // The overlay toggle takes every column control with it, game menu included.
  await page.locator("#touch-toggle").click();
  await expect(page.locator("#touch-controls")).toBeHidden();
  await expect(page.locator("#game-menu")).toBeHidden();
});

test("23: touch play hides the top-bar fullscreen; the column toggle takes over", async ({ page }, info) => {
  await clearStored(page);
  await page.goto(launcherUrl("/harness/errors/resolves.js"));
  await waitForState(page, "no-assets");
  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await waitForState(page, "playing", START_TIMEOUT);

  await expect(page.locator("#topbar #fullscreen")).toBeHidden();
  await expect(page.locator("#touch-fullscreen")).toBeVisible();
  await expect(page.locator("#touch-fullscreen")).toHaveAttribute("aria-label", "Enter fullscreen");

  await page.locator("#touch-toggle").click();
  await expect(page.locator("#touch-controls")).toBeHidden();
  await expect(page.locator("#touch-fullscreen")).toBeHidden();
  await expect(page.locator("#topbar #fullscreen")).toBeVisible();

  await page.locator("#touch-toggle").click();
  await expect(page.locator("#touch-controls")).toBeVisible();
  await expect(page.locator("#touch-fullscreen")).toBeVisible();
  await expect(page.locator("#topbar #fullscreen")).toBeHidden();
});

test("the manifest asks for landscape", async ({ request }) => {
  const manifest = await (await request.get("/app/manifest.webmanifest")).json();
  expect(manifest.orientation).toBe("landscape");
});
