import { test, expect, type Page } from "@playwright/test";
import { installZip } from "./helpers/install-zip";

// Issue #80: while the game runs, the whole canvas is visible without
// scrolling at 1280x800, keeping its drawing-buffer aspect ratio. The fake
// engine (`module` query parameter) sizes the canvas to 1024x768 like the real
// engine, so the page has to fit it; the engine never resizes it back.

const FAKE = "/harness/canvas/fit.js";
const VIEWPORT = { width: 1280, height: 800 };

// Opens the launcher at the target viewport, imports a complete synthetic
// install (what enables Play) and starts the fake engine. On return the canvas
// is shown and its drawing buffer is 1024x768.
async function startCanvas(page: Page, dir: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
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
  await page.waitForFunction(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
    return canvas !== null && canvas.width === 1024 && canvas.height === 768;
  });
}

type Metrics = {
  scrollWidth: number;
  viewportWidth: number;
  clientWidth: number;
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  headingBottom: number;
  bufferWidth: number;
  bufferHeight: number;
  attrWidth: string | null;
  attrHeight: string | null;
};

async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const heading = document.querySelector("h1") as HTMLElement;
    const rect = canvas.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      headingBottom: heading.getBoundingClientRect().bottom,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      attrWidth: canvas.getAttribute("width"),
      attrHeight: canvas.getAttribute("height"),
    };
  });
}

test("1: the page does not scroll sideways while the 1024x768 canvas is shown", async ({ page }, info) => {
  await startCanvas(page, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.bufferWidth).toBe(1024);
  expect(metrics.bufferHeight).toBe(768);
  // The canvas is displayed at most as wide and as tall as the viewport.
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(VIEWPORT.height);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  // No horizontal scrollbar either: the document must not be wider than the
  // width the page is actually laid out in.
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
});

test("2: the canvas is fully inside a 1280x800 viewport, below the heading", async ({ page }, info) => {
  await startCanvas(page, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.bufferWidth).toBe(1024);
  expect(metrics.bufferHeight).toBe(768);
  expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.top).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(VIEWPORT.height);
  // The whole canvas fits in the area the page leaves below its heading.
  expect(metrics.rect.top).toBeGreaterThanOrEqual(metrics.headingBottom);
});

test("3: the displayed canvas keeps the drawing-buffer aspect ratio", async ({ page }, info) => {
  await startCanvas(page, info.outputPath());
  const metrics = await measure(page);

  expect(metrics.bufferWidth).toBe(1024);
  expect(metrics.bufferHeight).toBe(768);
  // The canvas is being scaled down to fit, so its aspect ratio is what the
  // scaling must preserve.
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(VIEWPORT.height);
  const bufferRatio = metrics.bufferWidth / metrics.bufferHeight;
  const shownRatio = metrics.rect.width / metrics.rect.height;
  expect(Math.abs(shownRatio - bufferRatio) / bufferRatio).toBeLessThanOrEqual(0.01);
});

test("4: the page leaves the canvas drawing-buffer size unchanged", async ({ page }, info) => {
  await startCanvas(page, info.outputPath());
  const metrics = await measure(page);

  // Displayed inside the viewport: this test runs on the fitted state.
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(VIEWPORT.height);
  // CSS scaling must never rewrite the drawing buffer the engine set.
  expect(metrics.attrWidth).toBe("1024");
  expect(metrics.attrHeight).toBe("768");
  expect(metrics.bufferWidth).toBe(1024);
  expect(metrics.bufferHeight).toBe(768);
});
