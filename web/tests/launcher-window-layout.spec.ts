import { test, expect, type Page } from "@playwright/test";
import { installZip } from "./helpers/install-zip";

// Issue #97: while the game runs windowed, the canvas is the largest rectangle
// with the drawing buffer's aspect ratio that fits below the page text and the
// playing controls, inside the window, and the page does not scroll. The fake
// engine (`module` query parameter) sets a 1280x720 drawing buffer, the shape a
// wide window has to show; the page only scales it.

const FAKE = "/harness/layout/wide.js";
const BUFFER = { width: 1280, height: 720 };
const SMALL_VIEWPORT = { width: 1280, height: 800 };
const LARGE_VIEWPORT = { width: 1920, height: 1080 };
// The launcher's readable column: 48rem at the browser's default 16 px root.
const READABLE_COLUMN = 768;
const ONE_PX = 1;
const ASPECT_TOLERANCE = 0.01;
const WAIT = 10_000;

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

type Metrics = {
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  // The space the brief gives the game: horizontally the body's content width,
  // which is the viewport minus its horizontal padding; vertically, from the
  // bottom of the playing controls to the bottom of the viewport.
  contentLeft: number;
  contentRight: number;
  contentWidth: number;
  controlsBottom: number | null;
  canvas: Rect;
  headingWidth: number;
  introWidth: number;
  bufferWidth: number;
  bufferHeight: number;
  attrWidth: string | null;
  attrHeight: string | null;
};

// Everything the criteria measure, read from the page's own layout: element
// boxes and the computed horizontal padding of the body, never a scroll offset
// or a guessed size.
async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const controls = document.getElementById("play-controls");
    const bodyStyle = getComputedStyle(document.body);
    const paddingLeft = parseFloat(bodyStyle.paddingLeft);
    const paddingRight = parseFloat(bodyStyle.paddingRight);
    const layoutWidth = document.documentElement.clientWidth;
    const rect = canvas.getBoundingClientRect();
    const heading = document.querySelector("h1") as HTMLElement;
    const intro = document.querySelector("main p.note") as HTMLElement;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      contentLeft: paddingLeft,
      contentRight: layoutWidth - paddingRight,
      contentWidth: layoutWidth - paddingLeft - paddingRight,
      controlsBottom: controls === null ? null : controls.getBoundingClientRect().bottom,
      canvas: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      headingWidth: heading.getBoundingClientRect().width,
      introWidth: intro.getBoundingClientRect().width,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      attrWidth: canvas.getAttribute("width"),
      attrHeight: canvas.getAttribute("height"),
    };
  });
}

// The page fits the canvas from the drawing buffer, so the displayed box may
// move after the buffer arrives: wait until two measurements a poll interval
// apart read the same layout, repeating until they do.
async function waitForSettledLayout(page: Page): Promise<void> {
  let previous = "";
  await expect
    .poll(
      async () => {
        const metrics = await measure(page);
        const current = JSON.stringify([
          metrics.canvas,
          metrics.scrollWidth,
          metrics.scrollHeight,
          metrics.contentWidth,
          metrics.controlsBottom,
        ]);
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { timeout: WAIT },
    )
    .toBe(true);
}

// Opens the launcher at the target viewport, imports a complete synthetic
// install (what enables Play) and starts the fake engine, exactly like
// tests/launcher-canvas.spec.ts. On return the canvas is shown and its drawing
// buffer is 1280x720.
async function startPlaying(page: Page, viewport: { width: number; height: number }, dir: string): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  await page.goto(`/app/index.html?module=${encodeURIComponent(FAKE)}`);
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await page.locator("#zip-input").setInputFiles(await installZip(dir));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#play")).toBeEnabled();

  await page.locator("#play").click();
  await expect(page.locator("#canvas")).toBeVisible();
  // Issue #91: Play may enter fullscreen, and this spec measures the windowed
  // playing view. Leave it the way the browser's Esc does, and only when the
  // page actually entered it.
  await page.evaluate(async () => {
    if (document.fullscreenElement !== null) await document.exitFullscreen();
  });
  await page.waitForFunction(() => document.fullscreenElement === null);
  // The engine writes the drawing buffer the page has to display.
  await page.waitForFunction(
    (buffer) => {
      const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
      return canvas !== null && canvas.width === buffer.width && canvas.height === buffer.height;
    },
    BUFFER,
    { timeout: WAIT },
  );
  await waitForSettledLayout(page);
}

// The vertical space the brief gives the game: from the bottom of the playing
// controls (#91's bar) to the bottom of the viewport. Without that bar there is
// no anchor above the canvas, so the space is unknown.
function spaceBelowControls(metrics: Metrics): number | null {
  return metrics.controlsBottom === null ? null : metrics.innerHeight - metrics.controlsBottom;
}

// The drawing buffer's aspect ratio the displayed canvas has to keep.
function bufferRatio(metrics: Metrics): number {
  return metrics.bufferWidth / metrics.bufferHeight;
}

test("1: at 1280x800 the playing page does not scroll and the canvas is inside the viewport", async ({ page }, info) => {
  await startPlaying(page, SMALL_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  // The state the criterion describes: a 1280x720 buffer after Play.
  expect(metrics.innerWidth).toBe(SMALL_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(SMALL_VIEWPORT.height);
  expect(metrics.bufferWidth).toBe(BUFFER.width);
  expect(metrics.bufferHeight).toBe(BUFFER.height);
  // The page fits the window: no vertical and no horizontal scrolling.
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight + ONE_PX);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + ONE_PX);
  // The whole canvas lies inside the viewport.
  expect(metrics.canvas.left).toBeGreaterThanOrEqual(0);
  expect(metrics.canvas.top).toBeGreaterThanOrEqual(0);
  expect(metrics.canvas.right).toBeLessThanOrEqual(metrics.innerWidth + ONE_PX);
  expect(metrics.canvas.bottom).toBeLessThanOrEqual(metrics.innerHeight + ONE_PX);
});

test("2: at 1280x800 the canvas is the largest 16:9 rectangle below the playing controls", async ({ page }, info) => {
  await startPlaying(page, SMALL_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.innerWidth).toBe(SMALL_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(SMALL_VIEWPORT.height);
  expect(metrics.bufferWidth).toBe(BUFFER.width);
  expect(metrics.bufferHeight).toBe(BUFFER.height);
  // It keeps the drawing buffer's aspect ratio, within 1%.
  const ratio = bufferRatio(metrics);
  const shownRatio = metrics.canvas.width / metrics.canvas.height;
  expect(Math.abs(shownRatio - ratio) / ratio).toBeLessThanOrEqual(ASPECT_TOLERANCE);
  // It is the largest such rectangle: as tall as the space below the playing
  // controls, or as wide as the body's content width.
  const availableHeight = spaceBelowControls(metrics);
  const availableWidth = metrics.contentWidth;
  const fillsHeight = availableHeight !== null && Math.abs(metrics.canvas.height - availableHeight) <= ONE_PX;
  const fillsWidth = Math.abs(metrics.canvas.width - availableWidth) <= ONE_PX;
  expect(
    fillsHeight || fillsWidth,
    `the canvas is ${metrics.canvas.width}x${metrics.canvas.height}, ` +
      `neither ${availableWidth} wide nor ` +
      (availableHeight === null ? "anchored to #play-controls" : `${availableHeight} tall`),
  ).toBe(true);
  // The canvas starts at the bottom of the playing controls (#91), within 1 px.
  // Without that bar nothing takes space above the canvas, so the size rule
  // above is what the criterion leaves to check.
  if (metrics.controlsBottom !== null) {
    expect(Math.abs(metrics.canvas.top - metrics.controlsBottom)).toBeLessThanOrEqual(ONE_PX);
  }
});

test("3: at 1280x800 the canvas is horizontally centred in the body's content area", async ({ page }, info) => {
  await startPlaying(page, SMALL_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.innerWidth).toBe(SMALL_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(SMALL_VIEWPORT.height);
  expect(metrics.bufferWidth).toBe(BUFFER.width);
  expect(metrics.bufferHeight).toBe(BUFFER.height);
  // The canvas sits inside the body's content area ...
  const leftGap = metrics.canvas.left - metrics.contentLeft;
  const rightGap = metrics.contentRight - metrics.canvas.right;
  expect(leftGap).toBeGreaterThanOrEqual(-ONE_PX);
  expect(rightGap).toBeGreaterThanOrEqual(-ONE_PX);
  // ... and the two side gaps are the same, within 1 px.
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(ONE_PX);
});

test("4: at 1920x1080 the canvas fills the height below the controls and is wider than 768 px", async ({ page }, info) => {
  await startPlaying(page, LARGE_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.innerWidth).toBe(LARGE_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(LARGE_VIEWPORT.height);
  expect(metrics.bufferWidth).toBe(BUFFER.width);
  expect(metrics.bufferHeight).toBe(BUFFER.height);
  // A wide window is not capped by the launcher's readable column.
  expect(metrics.canvas.width).toBeGreaterThan(READABLE_COLUMN);
  // It keeps the drawing buffer's aspect ratio, within 1%.
  const ratio = bufferRatio(metrics);
  const shownRatio = metrics.canvas.width / metrics.canvas.height;
  expect(Math.abs(shownRatio - ratio) / ratio).toBeLessThanOrEqual(ASPECT_TOLERANCE);
  // It fills the height the playing controls leave (#91's bar above the
  // canvas); without that bar, the width and aspect rules above are the ones
  // the criterion leaves to check.
  const availableHeight = spaceBelowControls(metrics);
  if (availableHeight !== null) {
    expect(Math.abs(metrics.canvas.height - availableHeight)).toBeLessThanOrEqual(ONE_PX);
  }
});

test("5: at 1920x1080 the heading and the intro paragraph stay within 768 px", async ({ page }, info) => {
  await startPlaying(page, LARGE_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.innerWidth).toBe(LARGE_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(LARGE_VIEWPORT.height);
  // The text keeps its readable column while the game gets the window.
  expect(metrics.headingWidth).toBeLessThanOrEqual(READABLE_COLUMN);
  expect(metrics.introWidth).toBeLessThanOrEqual(READABLE_COLUMN);
});

test("6: at 1920x1080 the canvas drawing buffer is still 1280x720", async ({ page }, info) => {
  await startPlaying(page, LARGE_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.innerWidth).toBe(LARGE_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(LARGE_VIEWPORT.height);
  // CSS scaling must never rewrite the drawing buffer the engine set.
  expect(metrics.attrWidth).toBe(String(BUFFER.width));
  expect(metrics.attrHeight).toBe(String(BUFFER.height));
  expect(metrics.bufferWidth).toBe(BUFFER.width);
  expect(metrics.bufferHeight).toBe(BUFFER.height);
});
