import { test, expect, type Page } from "@playwright/test";
import { installZip } from "./helpers/install-zip";

// Issue #159: the launcher stores a performance-overlay (FPS) choice under
// openzh.performanceOverlay and tells the engine through
// _GeneralsXSetDebugOverlay after every start and every toggle. The recording
// fake (`module` query parameter) reports every value in window.__overlayCalls;
// with `&export=missing` it resolves to an engine object without the export.

const SHELL = "/app/index.html";
const OVERLAY_FAKE = "/harness/overlay/records.js";
// Waiting for the page's own states, never for a fixed delay.
const WAIT = 15_000;
const START_WAIT = 40_000;
// The shell's markup is in the document as soon as it loads.
const SHELL_WAIT = 5_000;

type OverlayWindow = Window &
  typeof globalThis & {
    __overlayCalls?: number[];
    __fakeEngineLoaded?: string;
    __unhandledRejections?: string[];
  };

async function openShell(page: Page, module: string, suffix = ""): Promise<void> {
  await page.goto(`${SHELL}?module=${encodeURIComponent(module)}${suffix}`);
  await expect(page.locator("#topbar")).toBeVisible({ timeout: SHELL_WAIT });
}

async function expectShell(page: Page): Promise<void> {
  await expect(page.locator("#topbar")).toBeVisible({ timeout: SHELL_WAIT });
}

async function expectState(page: Page, state: string, timeout = START_WAIT): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-state", state, { timeout });
}

// Imports a complete synthetic install from a settled loader. The automatic
// start resolves through the recording fake.
async function startPlaying(page: Page, dir: string, suffix = ""): Promise<void> {
  await openShell(page, OVERLAY_FAKE, suffix);
  await expectState(page, "no-assets");
  await page.locator("#zip-input").setInputFiles(await installZip(dir));
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
}

async function openMenu(page: Page): Promise<void> {
  const button = page.locator("#menu-button");
  await button.click();
  await expect(page.locator("#menu")).toHaveAttribute("open", "");
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

async function overlayCalls(page: Page): Promise<number[]> {
  return page.evaluate(() => [...((window as unknown as OverlayWindow).__overlayCalls ?? [])]);
}

async function firstOverlayCall(page: Page): Promise<number | undefined> {
  return (await overlayCalls(page))[0];
}

async function lastOverlayCall(page: Page): Promise<number | undefined> {
  const calls = await overlayCalls(page);
  return calls.length === 0 ? undefined : calls[calls.length - 1];
}

async function storedOverlay(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("openzh.performanceOverlay"));
}

// One task boundary: a rejected promise surfaces as an unhandledrejection in
// the task after the one that rejected it.
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

test("12: the FPS overlay starts unchecked and the engine receives 0", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());

  const toggle = page.locator("#fps-toggle");
  await expect(toggle).toHaveAttribute("role", "switch");
  await expect(toggle).not.toBeChecked();

  // The default setting is hidden: the engine is told 0 once it is available.
  await expect.poll(() => firstOverlayCall(page), { timeout: WAIT }).toBe(0);
  expect((await overlayCalls(page)).every((value) => value === 0)).toBe(true);
});

test("12: an engine without _GeneralsXSetDebugOverlay keeps playing with no error", async ({ page }, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const rejections: string[] = [];
    (window as unknown as OverlayWindow).__unhandledRejections = rejections;
    window.addEventListener("unhandledrejection", (event) => {
      rejections.push(String(event.reason));
    });
  });

  await startPlaying(page, info.outputPath(), "&export=missing");
  await page.waitForFunction(
    () => (window as unknown as OverlayWindow).__fakeEngineLoaded === "overlay",
    null,
    { timeout: WAIT },
  );

  // The page also applies the setting on every toggle: a missing export is
  // ignored there too, without an error or a rejected promise.
  await openMenu(page);
  await page.locator("#fps-toggle").check();
  await expect(page.locator("#fps-toggle")).toBeChecked();
  await page.locator("#fps-toggle").uncheck();
  await expect(page.locator("#fps-toggle")).not.toBeChecked();
  await nextFrame(page);

  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeHidden();
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as OverlayWindow).__unhandledRejections)).toEqual([]);
});

test("13: checking #fps-toggle calls 1 and a reload applies the stored choice", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await expect.poll(() => firstOverlayCall(page), { timeout: WAIT }).toBe(0);

  await openMenu(page);
  await page.locator("#fps-toggle").check();

  await expect(page.locator("#fps-toggle")).toBeChecked();
  await expect.poll(() => lastOverlayCall(page), { timeout: WAIT }).toBe(1);
  expect(await storedOverlay(page)).toBe("1");

  // A reload starts the engine again from the stored archives; the saved
  // toggled state is applied to the new engine object.
  await page.reload();
  await expectShell(page);
  await expect(page.locator("#fps-toggle")).toBeChecked();
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
  await expect.poll(() => firstOverlayCall(page), { timeout: WAIT }).toBe(1);
});

test("13: unchecking #fps-toggle calls 0 and stores 0", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await expect.poll(() => firstOverlayCall(page), { timeout: WAIT }).toBe(0);

  await openMenu(page);
  await page.locator("#fps-toggle").check();
  await expect.poll(() => lastOverlayCall(page), { timeout: WAIT }).toBe(1);

  await page.locator("#fps-toggle").uncheck();

  await expect(page.locator("#fps-toggle")).not.toBeChecked();
  await expect.poll(() => lastOverlayCall(page), { timeout: WAIT }).toBe(0);
  expect(await storedOverlay(page)).toBe("0");
});
