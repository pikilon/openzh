import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBig } from "./helpers/big";

// Issue #28: the canvas keeps the right mouse button and the keyboard. The
// context menu must never open over the game, and after Play the keys must
// reach the canvas without an extra click.

function makeInstall(dir: string, names: string[]): string {
  const root = join(dir, "install");
  mkdirSync(root, { recursive: true });
  for (const name of names) {
    writeFileSync(join(root, name), buildBig([{ path: "Data\\INI\\Default\\GameData.ini", data: "GameData\nEnd\n" }]));
  }
  writeFileSync(join(root, "readme.txt"), "not an archive");
  return root;
}

async function openLauncher(page: Page): Promise<void> {
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
}

// Dispatches a cancelable contextmenu event on the target and reports whether
// the page cancelled the browser's menu.
async function contextMenuPrevented(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (element === null) throw new Error(`missing ${target}`);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, selector);
}

test.beforeEach(async ({ page }) => {
  await openLauncher(page);
  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
});

test('1: #canvas has the attribute tabindex="0"', async ({ page }) => {
  await expect(page.locator("#canvas")).toHaveAttribute("tabindex", "0");
});

test("2: a contextmenu event on the hidden #canvas is cancelled", async ({ page }) => {
  await expect(page.locator("#canvas")).toBeHidden();
  expect(await contextMenuPrevented(page, "#canvas")).toBe(true);
});

test("2: a contextmenu event on the visible #canvas is cancelled", async ({ page }) => {
  await page.evaluate(() => {
    const canvas = document.getElementById("canvas");
    if (canvas === null) throw new Error("missing #canvas");
    canvas.hidden = false;
  });
  expect(await contextMenuPrevented(page, "#canvas")).toBe(true);
});

test("3: a contextmenu event elsewhere on the page is not cancelled", async ({ page }) => {
  expect(await contextMenuPrevented(page, "body")).toBe(false);
});

test("4: after Play #canvas has focus while the engine module loads", async ({ page }, info) => {
  const dir = makeInstall(info.outputPath(), ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"]);
  await page.locator("#folder-input").setInputFiles(dir);
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#play")).toBeEnabled();

  // Hold the engine module request until we have read the active element: the
  // focus must already be on the canvas before the module is imported.
  let activeAtImport: string | null = null;
  await page.route("**/engine/GeneralsXZH.js", async (route) => {
    activeAtImport = await page.evaluate(() => document.activeElement?.id ?? null);
    await route.continue();
  });

  await page.locator("#play").click();
  await expect.poll(() => activeAtImport, { timeout: 30_000 }).toBe("canvas");
  expect(await page.evaluate(() => document.activeElement?.id ?? null)).toBe("canvas");
});
