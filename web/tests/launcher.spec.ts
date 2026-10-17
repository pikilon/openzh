import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBig } from "./helpers/big";

// The launcher page (/app/index.html): pick the install folder, import into
// OPFS, play. Element ids are part of the contract (docs/briefs/5c-launcher.md).

function makeInstall(dir: string, names: string[]): string {
  const root = join(dir, "install");
  mkdirSync(root, { recursive: true });
  for (const name of names) {
    writeFileSync(join(root, name), buildBig([{ path: "Data\\INI\\Default\\GameData.ini", data: "GameData\nEnd\n" }]));
  }
  writeFileSync(join(root, "readme.txt"), "not an archive");
  return root;
}

async function openLauncher(page: Page) {
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
}

test.beforeEach(async ({ page }) => {
  await openLauncher(page);
  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
});

test("an incomplete folder is rejected and nothing is stored", async ({ page }, info) => {
  const dir = makeInstall(info.outputPath(), ["INIZH.big"]);
  await page.locator("#folder-input").setInputFiles(dir);
  await expect(page.locator("#status")).toContainText("Missing");
  for (const name of ["W3DZH.big", "INI.big", "W3D.big"]) {
    await expect(page.locator("#status")).toContainText(name);
  }
  await expect(page.locator("#play")).toBeDisabled();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
});

test("a complete folder is imported, survives a reload and starts the engine", async ({ page }, info) => {
  const dir = makeInstall(info.outputPath(), ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"]);
  await page.locator("#folder-input").setInputFiles(dir);
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
