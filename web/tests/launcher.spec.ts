import { test, expect, type Page } from "@playwright/test";
import { installZip } from "./helpers/install-zip";

// The launcher page (/app/index.html): pick the install ZIP, import into OPFS,
// play. Element ids are part of the contract (docs/briefs/5c-launcher.md).

async function openLauncher(page: Page) {
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
}

test.beforeEach(async ({ page }) => {
  await openLauncher(page);
  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
});

test("an incomplete ZIP is rejected and nothing is stored", async ({ page }, info) => {
  const zip = await installZip(info.outputPath(), ["INIZH.big"]);
  await page.locator("#zip-input").setInputFiles(zip);
  await expect(page.locator("#status")).toContainText("Import failed");
  await expect(page.locator("#import-error")).toContainText("missing required archives");
  for (const name of ["W3DZH.big", "INI.big", "W3D.big"]) {
    await expect(page.locator("#import-error")).toContainText(name);
  }
  await expect(page.locator("#play")).toBeDisabled();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
});

test("a complete ZIP is imported, survives a reload and starts the engine", async ({ page }, info) => {
  const zip = await installZip(info.outputPath());
  await page.locator("#zip-input").setInputFiles(zip);
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();

  await openLauncher(page);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();

  await page.locator("#play").click();
  await page.waitForFunction(
    () => ((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? []).some((l) => l.includes("[ASSET_ROOT] Selected")),
    null,
    { timeout: 60_000 },
  );
  const log = await page.evaluate(() => (window as unknown as { __zhwpLog: string[] }).__zhwpLog);
  expect(log.some((l) => l.includes("[ASSET_ROOT] Selected source=env path='/GeneralsZH'"))).toBe(true);
  await expect(page.locator("#canvas")).toBeVisible();
});

test("the page names no EA trademark in its title or headings", async ({ page }) => {
  const text = (await page.title()) + " " + (await page.locator("h1, h2").allInnerTexts()).join(" ");
  expect(text).not.toMatch(/Command\s*&\s*Conquer|Generals|Zero Hour/i);
});
