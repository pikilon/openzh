import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBig } from "./helpers/big";

// Issue #29: the launcher shows engine failures on the page, and its outcome is
// readable as window.__zhwpDone like on the smoke page. A `module` query
// parameter selects a fake engine, so no test starts the real one.

const FAKE = "/harness/errors";
const DEFAULT_ENGINE = "/engine/GeneralsXZH.js";
const DEFAULT_ENGINE_FAKE = fileURLToPath(new URL("./harness/errors/default-engine.js", import.meta.url));

type Done = { status: "resolved" | "error"; message?: string };

function makeInstall(dir: string): string {
  const root = join(dir, "install");
  mkdirSync(root, { recursive: true });
  for (const name of ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"]) {
    writeFileSync(join(root, name), buildBig([{ path: "Data\\INI\\Default\\GameData.ini", data: "GameData\nEnd\n" }]));
  }
  return root;
}

// Opens the launcher with the optional `module` query parameter and imports a
// complete synthetic install, which is what enables Play.
async function prepareLauncher(page: Page, dir: string, module?: string): Promise<void> {
  const query = module === undefined ? "" : `?module=${encodeURIComponent(module)}`;
  await page.goto(`/app/index.html${query}`);
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
  await page.locator("#folder-input").setInputFiles(makeInstall(dir));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#play")).toBeEnabled();
}

async function doneWhen(page: Page, status: Done["status"], timeout = 20_000): Promise<Done | undefined> {
  await page.waitForFunction(
    (wanted) => (window as unknown as { __zhwpDone?: { status?: string } }).__zhwpDone?.status === wanted,
    status,
    { timeout },
  );
  return page.evaluate(() => (window as unknown as { __zhwpDone?: Done }).__zhwpDone);
}

async function expectErrorElement(page: Page): Promise<void> {
  await expect(page.locator("#engine-error")).toHaveCount(1);
  await expect(page.locator("#engine-error")).toHaveAttribute("role", "alert");
}

async function errorIsBeforeCanvas(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const error = document.getElementById("engine-error");
    const canvas = document.getElementById("canvas");
    if (error === null || canvas === null) return false;
    return (error.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
}

test("1: a fake module that resolves sets __zhwpDone resolved and keeps #engine-error hidden", async ({ page }, info) => {
  await prepareLauncher(page, info.outputPath(), `${FAKE}/resolves.js`);
  await expectErrorElement(page);
  expect(await errorIsBeforeCanvas(page)).toBe(true);
  await expect(page.locator("#engine-error")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __zhwpDone?: unknown }).__zhwpDone)).toBeUndefined();

  await page.locator("#play").click();
  expect(await doneWhen(page, "resolved")).toEqual({ status: "resolved" });
  expect(await page.evaluate(() => (window as unknown as { __fakeEngineLoaded?: string }).__fakeEngineLoaded)).toBe(
    "resolves",
  );
  await expect(page.locator("#engine-error")).toBeHidden();
  await expect(page.locator("#canvas")).toBeVisible();
});

test("2: an abort during the factory is an error and shows its message", async ({ page }, info) => {
  await prepareLauncher(page, info.outputPath(), `${FAKE}/abort.js`);
  await expectErrorElement(page);

  await page.locator("#play").click();
  const done = await doneWhen(page, "error");
  expect(done?.message ?? "").toContain("boom");
  await expect(page.locator("#engine-error")).toBeVisible();
  await expect(page.locator("#engine-error")).toContainText("boom");
  await expect(page.locator("#status")).toContainText("Engine failed:");
  await expect(page.locator("#status")).toContainText("boom");
  await expect(page.locator("#canvas")).toBeVisible();
});

test("3: a rejecting factory is an error and shows its message", async ({ page }, info) => {
  await prepareLauncher(page, info.outputPath(), `${FAKE}/rejects.js`);
  await expectErrorElement(page);

  await page.locator("#play").click();
  await doneWhen(page, "error");
  await expect(page.locator("#engine-error")).toBeVisible();
  await expect(page.locator("#engine-error")).toContainText("nope");
});

test("4: a module URL that does not exist is an error with a non-empty message", async ({ page }, info) => {
  await prepareLauncher(page, info.outputPath(), "/engine/does-not-exist.js");
  await expectErrorElement(page);

  await page.locator("#play").click();
  const done = await doneWhen(page, "error");
  expect(done?.message ?? "").not.toBe("");
  await expect(page.locator("#engine-error")).toBeVisible();
  expect((await page.locator("#engine-error").textContent())?.trim() ?? "").not.toBe("");
});

test("5: a module without a default-exported function is an error with a non-empty message", async ({ page }, info) => {
  await prepareLauncher(page, info.outputPath(), `${FAKE}/not-a-function.js`);
  await expectErrorElement(page);

  await page.locator("#play").click();
  const done = await doneWhen(page, "error");
  expect(done?.message ?? "").not.toBe("");
  await expect(page.locator("#engine-error")).toBeVisible();
  expect((await page.locator("#engine-error").textContent())?.trim() ?? "").not.toBe("");
});

test("6: an abort after the factory resolved replaces the outcome with the error", async ({ page }, info) => {
  await prepareLauncher(page, info.outputPath(), `${FAKE}/abort-late.js`);
  await expectErrorElement(page);

  await page.locator("#play").click();
  expect(await doneWhen(page, "resolved")).toEqual({ status: "resolved" });
  const done = await doneWhen(page, "error", 15_000);
  expect(done?.message ?? "").toContain("late boom");
  await expect(page.locator("#engine-error")).toBeVisible();
  await expect(page.locator("#engine-error")).toContainText("late boom");
});

test("7: without the module parameter the launcher still loads /engine/GeneralsXZH.js", async ({ page }, info) => {
  let requested = false;
  await page.route(`**${DEFAULT_ENGINE}`, async (route) => {
    requested = true;
    await route.fulfill({ path: DEFAULT_ENGINE_FAKE, contentType: "text/javascript" });
  });
  await prepareLauncher(page, info.outputPath());
  await expectErrorElement(page);

  await page.locator("#play").click();
  expect(await doneWhen(page, "resolved")).toEqual({ status: "resolved" });
  expect(requested).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __defaultEngineLoaded?: boolean }).__defaultEngineLoaded)).toBe(
    true,
  );
});
