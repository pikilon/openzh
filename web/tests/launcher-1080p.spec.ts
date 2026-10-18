import { test, expect, type Page } from "@playwright/test";
import { importInstall, openLauncher, START_TIMEOUT } from "./helpers/launcher";

// Issue #173: a fresh web install opens with a 1920x1080 drawing buffer. The
// page and its layout code are unchanged (#97): while the game runs windowed,
// the canvas is the largest 16:9 box that fits between the bottom of #topbar
// and the bottom of the window, horizontally centred, without page scroll. The
// fake engine (`module` query parameter) sets the 1920x1080 buffer the real web
// engine now uses; the page only scales the displayed box, never the buffer.

const FAKE = "/harness/canvas/hd.js";
const BUFFER = { width: 1920, height: 1080 };
const SMALL_VIEWPORT = { width: 1280, height: 800 };
const LARGE_VIEWPORT = { width: 1920, height: 1080 };
const ONE_PX = 1;
const ASPECT_TOLERANCE = 0.01;
// The brief's 16:9 display of a 1920x1080 buffer below the 56 px top bar.
const LARGE_DISPLAYED_WIDTH = 1820;
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
// install (which auto-starts the fake engine) and waits for its 1920x1080
// drawing buffer and the resulting windowed fit. On return the canvas is shown
// and playing, without Play.
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

test("3: at 1280x800 the page shows the 1920x1080 buffer as a 1280 px wide 16:9 canvas at the top bar's bottom, without scrolling", async ({
  page,
}, info) => {
  await startPlaying(page, SMALL_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  // The state the criteria describe: the fake engine's 1080p drawing buffer.
  expect(metrics.innerWidth).toBe(SMALL_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(SMALL_VIEWPORT.height);
  expect(metrics.bufferWidth).toBe(BUFFER.width);
  expect(metrics.bufferHeight).toBe(BUFFER.height);
  // The page fits the window: no vertical and no horizontal scrolling.
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight + ONE_PX);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + ONE_PX);
  // Width-limited: the canvas is the window's width, within 1 px.
  expect(Math.abs(metrics.canvas.width - metrics.innerWidth)).toBeLessThanOrEqual(ONE_PX);
  // It keeps the drawing buffer's 16:9 shape, within 1%.
  const ratio = bufferRatio(metrics);
  const shownRatio = metrics.canvas.width / metrics.canvas.height;
  expect(Math.abs(shownRatio - ratio) / ratio).toBeLessThanOrEqual(ASPECT_TOLERANCE);
  // The canvas starts at the bottom of #topbar, within 1 px.
  expect(Math.abs(metrics.canvas.top - metrics.topbarBottom)).toBeLessThanOrEqual(ONE_PX);
  // The two side gaps are the same, within 1 px: horizontally centred.
  expect(Math.abs(metrics.canvas.left - (metrics.innerWidth - metrics.canvas.right))).toBeLessThanOrEqual(
    ONE_PX,
  );
});

test("4: at 1920x1080 the page height-limits the 1920x1080 buffer to the space below the top bar, centred and without scrolling", async ({
  page,
}, info) => {
  await startPlaying(page, LARGE_VIEWPORT, info.outputPath());
  const metrics = await measure(page);

  // The drawing buffer is still the engine's 1920x1080; only the displayed box
  // is scaled (the top bar leaves 1024 px at this window size).
  expect(metrics.innerWidth).toBe(LARGE_VIEWPORT.width);
  expect(metrics.innerHeight).toBe(LARGE_VIEWPORT.height);
  expect(metrics.bufferWidth).toBe(BUFFER.width);
  expect(metrics.bufferHeight).toBe(BUFFER.height);
  expect(metrics.attrWidth).toBe(String(BUFFER.width));
  expect(metrics.attrHeight).toBe(String(BUFFER.height));
  // The page fits the window: no vertical and no horizontal scrolling.
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight + ONE_PX);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + ONE_PX);
  // Height-limited: the canvas is exactly as tall as the space #topbar leaves
  // (1024 px at this window), within 1 px.
  const availableHeight = metrics.innerHeight - metrics.topbarBottom;
  expect(Math.abs(metrics.canvas.height - availableHeight)).toBeLessThanOrEqual(ONE_PX);
  // It keeps the drawing buffer's 16:9 shape, within 1%: about 1820 px wide.
  const ratio = bufferRatio(metrics);
  const shownRatio = metrics.canvas.width / metrics.canvas.height;
  expect(Math.abs(shownRatio - ratio) / ratio).toBeLessThanOrEqual(ASPECT_TOLERANCE);
  expect(
    Math.abs(metrics.canvas.width - LARGE_DISPLAYED_WIDTH) / LARGE_DISPLAYED_WIDTH,
  ).toBeLessThanOrEqual(ASPECT_TOLERANCE);
  // The canvas starts at the bottom of #topbar, within 1 px.
  expect(Math.abs(metrics.canvas.top - metrics.topbarBottom)).toBeLessThanOrEqual(ONE_PX);
  // The two side gaps are the same, within 1 px: horizontally centred.
  expect(Math.abs(metrics.canvas.left - (metrics.innerWidth - metrics.canvas.right))).toBeLessThanOrEqual(
    ONE_PX,
  );
});
