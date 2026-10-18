import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { clearStored, launcherUrl, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { installZip } from "./helpers/install-zip";

// Issue #29: the launcher shows engine failures on the page, and its outcome is
// readable as window.__zhwpDone like on the smoke page. Since #159 the import
// of a complete install starts the engine automatically; the failure is shown
// in #error-panel (#engine-error and #retry). A `module` query parameter
// selects a fake engine, so no test starts the real one.

const FAKE = "/harness/errors";
const DEFAULT_ENGINE = "/engine/GeneralsXZH.js";
const DEFAULT_ENGINE_FAKE = fileURLToPath(new URL("./harness/errors/default-engine.js", import.meta.url));

type Done = { status: "resolved" | "error"; message?: string };

// Opens the launcher with the optional `module` query parameter, then imports
// a complete synthetic install, which starts the engine by itself. On return
// the engine attempt has finished: `playing` or `error`.
async function prepareLauncher(page: Page, dir: string, module?: string): Promise<void> {
  await clearStored(page);
  await page.goto(launcherUrl(module));
  await expect(page.locator("#stored-summary")).toHaveText(/^Stored: \d+ archives$/);
  await waitForState(page, "no-assets");
  await page.locator("#zip-input").setInputFiles(await installZip(dir));
  await expect(page.locator("body")).toHaveAttribute("data-state", /^(playing|error)$/, {
    timeout: START_TIMEOUT,
  });
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

// The visible failure surface #159 defines: the panel and its retry button.
async function expectErrorPanel(page: Page): Promise<void> {
  await expect(page.locator("#error-panel")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeVisible();
  await expect(page.locator("#retry")).toBeVisible();
  await expect(page.locator("#loading")).toBeHidden();
}

async function errorIsBeforeCanvas(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const error = document.getElementById("engine-error");
    const canvas = document.getElementById("canvas");
    if (error === null || canvas === null) return false;
    return (error.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
}

test("1: a fake module that resolves sets __zhwpDone resolved and keeps #engine-error hidden", async ({
  page,
}, info) => {
  await prepareLauncher(page, info.outputPath(), `${FAKE}/resolves.js`);
  await waitForState(page, "playing");
  await expectErrorElement(page);
  // The document-order rule from #29 still holds in the new shell.
  expect(await errorIsBeforeCanvas(page)).toBe(true);
  await expect(page.locator("#engine-error")).toBeHidden();
  await expect(page.locator("#error-panel")).toBeHidden();

  expect(await doneWhen(page, "resolved")).toEqual({ status: "resolved" });
  expect(await page.evaluate(() => (window as unknown as { __fakeEngineLoaded?: string }).__fakeEngineLoaded)).toBe(
    "resolves",
  );
  await expect(page.locator("#engine-error")).toBeHidden();
  await expect(page.locator("#canvas")).toBeVisible();
});

test("2: an abort during the factory is an error and shows its message", async ({ page }, info) => {
  await prepareLauncher(page, info.outputPath(), `${FAKE}/abort.js`);
  await waitForState(page, "error");
  await expectErrorElement(page);

  const done = await doneWhen(page, "error");
  expect(done?.message ?? "").toContain("boom");
  await expectErrorPanel(page);
  await expect(page.locator("#engine-error")).toContainText("boom");
});

test("3: a rejecting factory is an error and shows its message", async ({ page }, info) => {
  await prepareLauncher(page, info.outputPath(), `${FAKE}/rejects.js`);
  await waitForState(page, "error");
  await expectErrorElement(page);

  await doneWhen(page, "error");
  await expectErrorPanel(page);
  await expect(page.locator("#engine-error")).toContainText("nope");
});

test("4: a module URL that does not exist is an error with a non-empty message", async ({ page }, info) => {
  await prepareLauncher(page, info.outputPath(), "/engine/does-not-exist.js");
  await waitForState(page, "error");
  await expectErrorElement(page);

  const done = await doneWhen(page, "error");
  expect(done?.message ?? "").not.toBe("");
  await expectErrorPanel(page);
  expect((await page.locator("#engine-error").textContent())?.trim() ?? "").not.toBe("");
});

test("5: a module without a default-exported function is an error with a non-empty message", async ({
  page,
}, info) => {
  await prepareLauncher(page, info.outputPath(), `${FAKE}/not-a-function.js`);
  await waitForState(page, "error");
  await expectErrorElement(page);

  const done = await doneWhen(page, "error");
  expect(done?.message ?? "").not.toBe("");
  await expectErrorPanel(page);
  expect((await page.locator("#engine-error").textContent())?.trim() ?? "").not.toBe("");
});

test("6: an abort after the factory resolved replaces the outcome with the error", async ({ page }, info) => {
  // The abort lands one second after the factory resolved, so the page can
  // already hold the resolved outcome; record every assignment to prove the
  // error really replaced it instead of racing a poll.
  await page.addInitScript(() => {
    const log: unknown[] = [];
    (window as unknown as { __zhwpDoneLog?: unknown[] }).__zhwpDoneLog = log;
    let value: unknown;
    Object.defineProperty(window, "__zhwpDone", {
      configurable: true,
      get: () => value,
      set: (next: unknown) => {
        value = next;
        log.push(next);
      },
    });
  });
  await prepareLauncher(page, info.outputPath(), `${FAKE}/abort-late.js`);
  await expectErrorElement(page);

  await waitForState(page, "error", 15_000);
  const transitions = await page.evaluate(
    () => (window as unknown as { __zhwpDoneLog?: Done[] }).__zhwpDoneLog ?? [],
  );
  expect(transitions.some((outcome) => outcome?.status === "resolved")).toBe(true);
  const done = await doneWhen(page, "error", 15_000);
  expect(done?.message ?? "").toContain("late boom");
  await expectErrorPanel(page);
  await expect(page.locator("#engine-error")).toContainText("late boom");
});

test("7: without the module parameter the launcher still loads /engine/GeneralsXZH.js", async ({ page }, info) => {
  let requested = false;
  await page.route(`**${DEFAULT_ENGINE}`, async (route) => {
    requested = true;
    await route.fulfill({ path: DEFAULT_ENGINE_FAKE, contentType: "text/javascript" });
  });
  await prepareLauncher(page, info.outputPath());
  await waitForState(page, "playing");
  await expectErrorElement(page);

  expect(await doneWhen(page, "resolved")).toEqual({ status: "resolved" });
  expect(requested).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __defaultEngineLoaded?: boolean }).__defaultEngineLoaded)).toBe(
    true,
  );
});
