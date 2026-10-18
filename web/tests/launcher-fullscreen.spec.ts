import { test, expect, type Page } from "@playwright/test";
import { CANVAS_FIT, importInstall, openLauncher, START_TIMEOUT } from "./helpers/launcher";

// Issue #91: a Fullscreen button above the canvas. Play used to start the
// engine windowed; since #159 the import starts it by itself, and #fullscreen
// is an icon button in #topbar, disabled before the game starts. The player
// presses it and the page puts the canvas container (#screen) in the browser's
// fullscreen mode and displays the canvas at the largest size that fits the
// screen with the drawing buffer's aspect ratio. The fake engine (`module`
// query parameter) sets the 1024x768 drawing buffer the real engine uses at
// start-up.

const FAKE = CANVAS_FIT;
const VIEWPORT = { width: 1280, height: 800 };
// Criterion 3: a 1024x768 drawing buffer on a 1280x800 screen fills the height.
const FIT_HEIGHT = 800;
const FIT_WIDTH = (FIT_HEIGHT * 1024) / 768;
// The fullscreen fit and the re-fit after a drawing-buffer change are the
// page's job, so the tests wait for the displayed size, never a fixed delay.
const WAIT = START_TIMEOUT;

type Fullscreen = { id: string | null; isScreen: boolean };

// What the browser has in fullscreen, and whether it is the page's #screen.
async function fullscreen(page: Page): Promise<Fullscreen> {
  return page.evaluate(() => {
    const element = document.fullscreenElement;
    return {
      id: element === null ? null : element.id !== "" ? element.id : element.tagName,
      isScreen: element !== null && element === document.getElementById("screen"),
    };
  });
}

// Opens the launcher at 1280x800 and imports a complete synthetic install,
// which auto-starts the fake engine and reaches the playing state with its
// 1024x768 drawing buffer.
async function startPlaying(page: Page, dir: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await openLauncher(page, FAKE);
  await importInstall(page, dir);
  await page.waitForFunction(
    () => {
      const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
      return canvas !== null && canvas.width === 1024 && canvas.height === 768;
    },
    null,
    { timeout: WAIT },
  );
}

// Presses #fullscreen with a trusted click: the browser only grants fullscreen
// to a user gesture, so the click must come from page.locator(), never from a
// click dispatched in page.evaluate().
async function enterFullscreen(page: Page): Promise<void> {
  await expect(page.locator("#fullscreen")).toBeVisible({ timeout: WAIT });
  await expect(page.locator("#fullscreen")).toBeEnabled({ timeout: WAIT });
  await page.locator("#fullscreen").click();
  await expect.poll(async () => (await fullscreen(page)).id, { timeout: WAIT }).toBe("screen");
}

// What the browser's Esc does: the page leaves fullscreen by itself.
async function leaveFullscreen(page: Page): Promise<void> {
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(async () => (await fullscreen(page)).id, { timeout: WAIT }).toBeNull();
}

type Metrics = {
  fullscreenId: string | null;
  fullscreenIsScreen: boolean;
  activeId: string | null;
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  clientWidth: number;
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  topbarBottom: number;
  bufferWidth: number;
  bufferHeight: number;
  attrWidth: string | null;
  attrHeight: string | null;
};

async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const topbar = document.getElementById("topbar") as HTMLElement;
    const inside = document.fullscreenElement;
    const active = document.activeElement;
    const rect = canvas.getBoundingClientRect();
    return {
      fullscreenId: inside === null ? null : inside.id !== "" ? inside.id : inside.tagName,
      fullscreenIsScreen: inside !== null && inside === document.getElementById("screen"),
      activeId: active === null ? null : active.id !== "" ? active.id : active.tagName,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      topbarBottom: topbar.getBoundingClientRect().bottom,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      attrWidth: canvas.getAttribute("width"),
      attrHeight: canvas.getAttribute("height"),
    };
  });
}

// Waits for the displayed size the criterion names, within 1 px: the fit is the
// page's job, so the wait is on the layout and never on a fixed delay.
async function waitCanvasSize(page: Page, width: number, height: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const metrics = await measure(page);
        return Math.abs(metrics.rect.width - width) <= 1 && Math.abs(metrics.rect.height - height) <= 1;
      },
      { timeout: WAIT },
    )
    .toBe(true);
}

// Waits for the windowed playing layout (#80): the canvas back in the page
// flow, below #topbar, wholly inside the viewport. `fullscreenchange` can be
// delivered after `exitFullscreen()` resolved, so the layout is what says the
// page has left fullscreen.
async function waitWindowedFit(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const metrics = await measure(page);
        return (
          metrics.rect.top >= metrics.topbarBottom &&
          metrics.rect.bottom <= metrics.innerHeight &&
          metrics.rect.left >= 0 &&
          metrics.rect.right <= metrics.innerWidth
        );
      },
      { timeout: WAIT },
    )
    .toBe(true);
}

test("1: after the automatic start the game is windowed, with #topbar and #fullscreen shown", async ({
  page,
}, info) => {
  // #fullscreen starts disabled until the canvas is visible (issue #159).
  await page.setViewportSize(VIEWPORT);
  await openLauncher(page, FAKE);
  await expect(page.locator("#fullscreen")).toBeDisabled();

  await importInstall(page, info.outputPath());
  await page.waitForFunction(
    () => {
      const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
      return canvas !== null && canvas.width === 1024 && canvas.height === 768;
    },
    null,
    { timeout: WAIT },
  );

  // The engine start does not ask for fullscreen: the game runs in the page.
  expect((await fullscreen(page)).id).toBeNull();
  await expect(page.locator("#canvas")).toBeVisible();
  // #topbar is the chrome above the game; the icon button lives in it and is
  // enabled while the game plays.
  await expect(page.locator("#topbar")).toBeVisible();
  await expect(page.locator("#topbar #fullscreen")).toBeVisible();
  await expect(page.locator("#fullscreen")).toBeEnabled();

  // #80's windowed fit still holds, with #topbar as the anchor above it.
  const metrics = await measure(page);
  expect(metrics.fullscreenId).toBeNull();
  expect(metrics.bufferWidth).toBe(1024);
  expect(metrics.bufferHeight).toBe(768);
  expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.top).toBeGreaterThanOrEqual(metrics.topbarBottom);
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(metrics.innerHeight);
  const bufferRatio = metrics.bufferWidth / metrics.bufferHeight;
  const shownRatio = metrics.rect.width / metrics.rect.height;
  expect(Math.abs(shownRatio - bufferRatio) / bufferRatio).toBeLessThanOrEqual(0.01);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
});

test("2: clicking #fullscreen puts #screen in fullscreen and leaves #canvas focused", async ({
  page,
}, info) => {
  await startPlaying(page, info.outputPath());
  await enterFullscreen(page);

  const shown = await fullscreen(page);
  expect(shown.id).toBe("screen");
  expect(shown.isScreen).toBe(true);
  await expect(page.locator("#canvas")).toBeVisible();
  // The game keeps its keyboard input (#28) without another click.
  await expect.poll(async () => (await measure(page)).activeId, { timeout: WAIT }).toBe("canvas");
});

test("3: in fullscreen the canvas fills the screen at 4:3 and is centred", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await enterFullscreen(page);
  await waitCanvasSize(page, FIT_WIDTH, FIT_HEIGHT);

  const metrics = await measure(page);
  // The state the criterion describes: a 1280x800 viewport in fullscreen.
  expect(metrics.fullscreenId).toBe("screen");
  expect(metrics.innerWidth).toBe(VIEWPORT.width);
  expect(metrics.innerHeight).toBe(VIEWPORT.height);
  // The 4:3 drawing buffer fills the screen's height, within 1 px.
  expect(Math.abs(metrics.rect.height - FIT_HEIGHT)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.rect.width - FIT_WIDTH)).toBeLessThanOrEqual(1);
  // It is centred: the gap on the left and on the right are the same.
  expect(Math.abs(metrics.rect.left - (metrics.innerWidth - metrics.rect.right))).toBeLessThanOrEqual(1);
  // It lies inside the viewport, and the page does not scroll sideways.
  expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.top).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(metrics.innerHeight + 1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
});

test("4: fullscreen leaves the canvas drawing buffer at 1024x768", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await enterFullscreen(page);

  const metrics = await measure(page);
  expect(metrics.fullscreenId).toBe("screen");
  // The page only sets the canvas's CSS size: the engine's drawing buffer and
  // its attributes stay what the engine set.
  expect(metrics.bufferWidth).toBe(1024);
  expect(metrics.bufferHeight).toBe(768);
  expect(metrics.attrWidth).toBe("1024");
  expect(metrics.attrHeight).toBe("768");
});

test("5: a drawing-buffer change while fullscreen re-fits the canvas to 16:9", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await enterFullscreen(page);
  await waitCanvasSize(page, FIT_WIDTH, FIT_HEIGHT);

  // The engine writes its render resolution into the canvas backing size.
  await page.evaluate(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    canvas.width = 1280;
    canvas.height = 720;
  });
  await waitCanvasSize(page, 1280, 720);

  const metrics = await measure(page);
  expect(metrics.fullscreenId).toBe("screen");
  expect(metrics.bufferWidth).toBe(1280);
  expect(metrics.bufferHeight).toBe(720);
  // 1280x720 fits the 1280-wide screen exactly, within 1 px.
  expect(Math.abs(metrics.rect.width - 1280)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.rect.height - 720)).toBeLessThanOrEqual(1);
  // The new aspect ratio is centred vertically: the gap above and the gap
  // below are the same.
  expect(Math.abs(metrics.rect.top - (metrics.innerHeight - metrics.rect.bottom))).toBeLessThanOrEqual(1);
});

test("6: leaving fullscreen restores the windowed playing view with #fullscreen offered", async ({
  page,
}, info) => {
  await startPlaying(page, info.outputPath());
  await enterFullscreen(page);
  await waitCanvasSize(page, FIT_WIDTH, FIT_HEIGHT);

  // What the browser's Esc does: the page leaves fullscreen.
  await leaveFullscreen(page);
  await waitWindowedFit(page);

  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#topbar")).toBeVisible();
  await expect(page.locator("#topbar #fullscreen")).toBeVisible();
  await expect(page.locator("#fullscreen")).toBeEnabled();

  const metrics = await measure(page);
  expect(metrics.fullscreenId).toBeNull();
  // The canvas keeps its drawing buffer.
  expect(metrics.bufferWidth).toBe(1024);
  expect(metrics.bufferHeight).toBe(768);
  // #80's windowed fit: inside the viewport, below #topbar, at the drawing
  // buffer's aspect ratio, without horizontal scroll.
  expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.top).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.top).toBeGreaterThanOrEqual(metrics.topbarBottom);
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(metrics.innerHeight);
  const bufferRatio = metrics.bufferWidth / metrics.bufferHeight;
  const shownRatio = metrics.rect.width / metrics.rect.height;
  expect(Math.abs(shownRatio - bufferRatio) / bufferRatio).toBeLessThanOrEqual(0.01);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
});
