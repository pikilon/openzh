import { test, expect } from "@playwright/test";
import {
  fakeEngineLoaded,
  importInstall,
  openLauncher,
  RESOLVES,
  waitForState,
  START_TIMEOUT,
} from "./helpers/launcher";
import { installZip } from "./helpers/install-zip";

// The launcher page (/app/index.html): pick the install ZIP, import into OPFS,
// and the engine starts by itself once the four required archives are stored.
// Element ids and `body[data-state]` are part of the contract
// (docs/briefs/159-launcher-shell.md). #159 removed #play and #clear.

test("an incomplete ZIP is rejected and nothing is stored", async ({ page }, info) => {
  await openLauncher(page, RESOLVES);
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");

  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath(), ["INIZH.big"]));
  await expect(page.locator("#status")).toContainText("Import failed");
  await expect(page.locator("#import-error")).toContainText("missing required archives");
  for (const name of ["W3DZH.big", "INI.big", "W3D.big"]) {
    await expect(page.locator("#import-error")).toContainText(name);
  }
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
  // A failed import never starts the engine.
  expect(await fakeEngineLoaded(page)).toBeUndefined();
});

test("a complete ZIP is imported and the stored install starts the engine after a reload", async ({
  page,
}, info) => {
  await openLauncher(page, RESOLVES);
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  // No Play click: the successful import itself starts the engine.
  await importInstall(page, info.outputPath());
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  expect(await fakeEngineLoaded(page)).toBe("resolves");

  // The stored install is all the next load needs: the page starts the engine
  // by itself, with no click and no loader.
  await page.reload();
  await waitForState(page, "playing", START_TIMEOUT);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeHidden();
  expect(await fakeEngineLoaded(page)).toBe("resolves");
});

test("the page names no EA trademark in its title or headings", async ({ page }) => {
  await page.goto("/app/index.html");
  const text = (await page.title()) + " " + (await page.locator("h1, h2").allInnerTexts()).join(" ");
  expect(text).not.toMatch(/Command\s*&\s*Conquer|Generals|Zero Hour/i);
});
