import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBig } from "./helpers/big";

// Issue #91: Play launches the game fullscreen. These are its degraded paths:
// a browser that offers no fullscreen at all (criterion 7), a browser that
// refuses the request (criterion 8), and an engine that aborts while
// fullscreen is being entered or after it was entered (criterion 9). In all of
// them the player must still get a usable playing view, a refused request must
// not be shown as an error, and a failed engine must leave its message
// readable, so the page has to end out of fullscreen.
//
// `addInitScript` replaces the Fullscreen API before the page loads, which is
// the only way to test a browser that lacks it or rejects it. The `module`
// query parameter starts a fake engine instead of the real one.

const FIT = "/harness/canvas/fit.js";
const ABORT = "/harness/errors/abort.js";
const ABORT_LATE = "/harness/errors/abort-late.js";
const VIEWPORT = { width: 1280, height: 800 };

type Done = { status: "resolved" | "error"; message?: string };

function makeInstall(dir: string): string {
  const root = join(dir, "install");
  mkdirSync(root, { recursive: true });
  for (const name of ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"]) {
    writeFileSync(join(root, name), buildBig([{ path: "Data\\INI\\Default\\GameData.ini", data: "GameData\nEnd\n" }]));
  }
  return root;
}

// Opens the launcher at 1280x800, clears whatever a previous test stored and
// imports a complete synthetic install (what enables Play) in the page that
// loads the fake engine. The viewport is set before the first `goto`, so the
// windowed fit is measured at the size the criteria name.
async function prepareLauncher(page: Page, dir: string, module: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  await page.goto(`/app/index.html?module=${encodeURIComponent(module)}`);
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await page.locator("#folder-input").setInputFiles(makeInstall(dir));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#play")).toBeEnabled();
}

// Play with a trusted user gesture: the browser only grants fullscreen to one,
// so a click dispatched from `page.evaluate` would not count. On return the
// fake engine has started and set its 1024x768 drawing buffer.
async function playAndWaitForCanvas(page: Page): Promise<void> {
  await page.locator("#play").click();
  await expect(page.locator("#canvas")).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
    return canvas !== null && canvas.width === 1024 && canvas.height === 768;
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

async function fullscreenElementId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.fullscreenElement?.id ?? null);
}

// Records every fullscreenchange for the whole page load from an init script,
// so a session that ends (or is cut short by an abort) is observed as it
// happened instead of being guessed by polling the current state afterwards.
// The listener is a capture one on the document: the event is fired at the
// document and also bubbles from the element, so both ends are seen.
async function recordFullscreenEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: (string | null)[] = [];
    (window as unknown as { __zhwpFullscreenEvents?: (string | null)[] }).__zhwpFullscreenEvents = log;
    document.addEventListener(
      "fullscreenchange",
      () => {
        const element = document.fullscreenElement;
        log.push(element === null ? null : element.id);
      },
      true,
    );
  });
}

async function fullscreenEvents(page: Page): Promise<(string | null)[]> {
  return page.evaluate(
    () => (window as unknown as { __zhwpFullscreenEvents?: (string | null)[] }).__zhwpFullscreenEvents ?? [],
  );
}

type Layout = {
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  bufferWidth: number;
  bufferHeight: number;
  scrollWidth: number;
  clientWidth: number;
  viewportWidth: number;
  viewportHeight: number;
};

async function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return {
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
}

// #80's windowed playing layout, which a fallback must keep: the whole canvas
// visible inside the viewport, displayed at its drawing-buffer aspect ratio,
// below the heading and without a horizontal scrollbar.
async function expectWindowedFit(page: Page): Promise<void> {
  const layout = await measure(page);
  expect(layout.bufferWidth).toBe(1024);
  expect(layout.bufferHeight).toBe(768);
  expect(layout.rect.top).toBeGreaterThanOrEqual(0);
  expect(layout.rect.left).toBeGreaterThanOrEqual(0);
  expect(layout.rect.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.rect.bottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  const bufferRatio = layout.bufferWidth / layout.bufferHeight;
  const shownRatio = layout.rect.width / layout.rect.height;
  expect(Math.abs(shownRatio - bufferRatio) / bufferRatio).toBeLessThanOrEqual(0.01);
}

// The playing view a fallback must leave: the controls are there for the
// player, nothing is reported as an error, and nothing is in fullscreen.
async function expectPlayingViewWindowed(page: Page): Promise<void> {
  await expect(page.locator("#play-controls")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeHidden();
  expect(await fullscreenElementId(page)).toBeNull();
}

test("7: without requestFullscreen Play starts the game windowed and hides #fullscreen", async ({ page }, info) => {
  // A browser where the Fullscreen API is not a function at all.
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", { value: undefined, configurable: true });
  });
  await prepareLauncher(page, info.outputPath(), FIT);
  await playAndWaitForCanvas(page);

  await expectPlayingViewWindowed(page);
  await expectWindowedFit(page);
  // Nothing to offer the player: the button must not be there.
  await expect(page.locator("#fullscreen")).toBeHidden();
});

test("8: a refused fullscreen request starts the game windowed with #fullscreen still offered", async ({
  page,
}, info) => {
  // A browser that has the Fullscreen API but denies this request, as Safari
  // and some kiosk modes do.
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      value: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      configurable: true,
    });
  });
  await prepareLauncher(page, info.outputPath(), FIT);
  await playAndWaitForCanvas(page);

  await expectPlayingViewWindowed(page);
  await expectWindowedFit(page);
  // The refusal is not an error, and the button stays so the player can try
  // again.
  await expect(page.locator("#fullscreen")).toBeVisible();
});

test("9: an abort while fullscreen is being entered ends windowed with a visible #engine-error", async ({
  page,
}, info) => {
  await prepareLauncher(page, info.outputPath(), ABORT);
  await page.locator("#play").click();

  await doneWhen(page, "error");
  // The abort races the fullscreen request: whichever side the browser lands
  // on, the page must settle out of fullscreen so the message can be read.
  await expect.poll(() => fullscreenElementId(page), { timeout: 5_000 }).toBeNull();
  await expect(page.locator("#engine-error")).toBeVisible();
  await expect(page.locator("#play-controls")).toBeVisible();
  // Still out of fullscreen once the playing view has been read: a request
  // granted after the error must not put the page back in it.
  expect(await fullscreenElementId(page)).toBeNull();
});

test("9: a late abort after the game was fullscreen ends windowed with a visible #engine-error", async ({
  page,
}, info) => {
  await recordFullscreenEvents(page);
  await prepareLauncher(page, info.outputPath(), ABORT_LATE);
  await page.locator("#play").click();

  // Recorded from the init script while the page ran, never read from a poll
  // of the end state: the late abort fires 1 s after the engine started, so
  // this shows the game really was in fullscreen on #screen before the abort.
  await expect
    .poll(async () => (await fullscreenEvents(page)).includes("screen"), { timeout: 10_000 })
    .toBe(true);

  await doneWhen(page, "error", 20_000);
  await expect.poll(() => fullscreenElementId(page), { timeout: 5_000 }).toBeNull();
  await expect(page.locator("#engine-error")).toBeVisible();
  await expect(page.locator("#play-controls")).toBeVisible();

  // And the recorded session ended: the last fullscreenchange left fullscreen.
  await expect
    .poll(
      async () => {
        const events = await fullscreenEvents(page);
        return events.length === 0 ? "none" : events[events.length - 1];
      },
      { timeout: 5_000 },
    )
    .toBeNull();
});
