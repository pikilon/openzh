import { test, expect, type Page } from "@playwright/test";
import { importInstall, openLauncher, START_TIMEOUT, WIDE_LAYOUT } from "./helpers/launcher";

// Issue #97: while the game runs windowed, the canvas is the largest rectangle
// with the drawing buffer's aspect ratio that fits below the top bar, inside
// the window, and the page does not scroll. Issue #159 replaced
// #play-controls with #topbar and removed Play: the import starts the engine.
// The fake engine (`module` query parameter) sets a 1280x720 drawing buffer,
// the shape a wide window has to show; the page only scales it.

const FAKE = WIDE_LAYOUT;
const BUFFER = { width: 1280, height: 720 };
const SMALL_VIEWPORT = { width: 1280, height: 800 };
const LARGE_VIEWPORT = { width: 1920, height: 1080 };
const ONE_PX = 1;
const ASPECT_TOLERANCE = 0.01;
const WAIT = START_TIMEOUT;

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

type Metrics = {
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  // The space the brief gives the game: the whole window below #topbar.
  topbarBottom: number;
  canvas: Rect;
  bufferWidth: number;
  bufferHeight: number;
  attrWidth: string | null;
  attrHeight: string | null;
};

// Everything the criteria measure, read from the page's own layout: element
// boxes, never a scroll offset or a guessed size.
async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const topbar = document.getElementById("topbar") as HTMLElement;
    const rect = canvas.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      topbarBottom: topbar.getBoundingClientRect().bottom,
      canvas: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
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
          metrics.topbarBottom,
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
// install (which auto-starts the fake engine) and waits for its 1280x720
// drawing buffer. On return the canvas is shown and playing, without Play.
async function startPlaying(
  page: Page,
  viewport: { width: number; height: number },
  dir: string,
): Promise<void> {
  await page.setViewportSize(viewport);
  await openLauncher(page, FAKE);
  await importInstall(page, dir);
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

// The drawing buffer's aspect ratio the displayed canvas has to keep.
function bufferRatio(metrics: Metrics): number {
  return metrics.bufferWidth / metrics.bufferHeight;
}

// The vertical space the brief gives the game: from the bottom of #topbar to
// the bottom of the viewport.
function spaceBelowTopbar(metrics: Metrics): number {
  return metrics.innerHeight - metrics.topbarBottom;
}

test("1: at 1280x800 the playing page does not scroll and the canvas is inside the viewport", async ({
  page,
}, info) => {
  await startPlaying(page, SMALL_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  // The state the criterion describes: a 1280x720 buffer after the import.
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

test("2: at 1280x800 the canvas is the largest 16:9 rectangle below #topbar", async ({ page }, info) => {
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
  // It is the largest such rectangle: as tall as the space below #topbar, or
  // as wide as the window.
  const availableHeight = spaceBelowTopbar(metrics);
  const availableWidth = metrics.innerWidth;
  const fillsHeight = Math.abs(metrics.canvas.height - availableHeight) <= ONE_PX;
  const fillsWidth = Math.abs(metrics.canvas.width - availableWidth) <= ONE_PX;
  expect(
    fillsHeight || fillsWidth,
    `the canvas is ${metrics.canvas.width}x${metrics.canvas.height}, ` +
      `neither ${availableWidth} wide nor ${availableHeight} tall`,
  ).toBe(true);
  // The canvas starts at the bottom of #topbar, within 1 px.
  expect(Math.abs(metrics.canvas.top - metrics.topbarBottom)).toBeLessThanOrEqual(ONE_PX);
});

test("3: at 1280x800 the canvas is horizontally centred in the window", async ({ page }, info) => {
  await startPlaying(page, SMALL_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.innerWidth).toBe(SMALL_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(SMALL_VIEWPORT.height);
  expect(metrics.bufferWidth).toBe(BUFFER.width);
  expect(metrics.bufferHeight).toBe(BUFFER.height);
  // The two side gaps are the same, within 1 px.
  expect(Math.abs(metrics.canvas.left - (metrics.innerWidth - metrics.canvas.right))).toBeLessThanOrEqual(
    ONE_PX,
  );
});

test("4: at 1920x1080 the canvas fills the height below #topbar without scrolling", async ({
  page,
}, info) => {
  await startPlaying(page, LARGE_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.innerWidth).toBe(LARGE_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(LARGE_VIEWPORT.height);
  expect(metrics.bufferWidth).toBe(BUFFER.width);
  expect(metrics.bufferHeight).toBe(BUFFER.height);
  // A wide window is height-limited: the canvas is exactly as tall as the
  // space #topbar leaves, within 1 px.
  const availableHeight = spaceBelowTopbar(metrics);
  expect(Math.abs(metrics.canvas.height - availableHeight)).toBeLessThanOrEqual(ONE_PX);
  // It keeps the drawing buffer's aspect ratio, within 1%.
  const ratio = bufferRatio(metrics);
  const shownRatio = metrics.canvas.width / metrics.canvas.height;
  expect(Math.abs(shownRatio - ratio) / ratio).toBeLessThanOrEqual(ASPECT_TOLERANCE);
  // No page scrollbar from the larger window either.
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight + ONE_PX);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + ONE_PX);
});

test("5: at 1920x1080 the canvas is horizontally centred in the window", async ({ page }, info) => {
  await startPlaying(page, LARGE_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.innerWidth).toBe(LARGE_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(LARGE_VIEWPORT.height);
  // The letterbox gaps on the left and on the right are the same, within 1 px.
  expect(Math.abs(metrics.canvas.left - (metrics.innerWidth - metrics.canvas.right))).toBeLessThanOrEqual(
    ONE_PX,
  );
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
