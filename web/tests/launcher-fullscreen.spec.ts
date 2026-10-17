import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBig } from "./helpers/big";

// Issue #91: a Fullscreen button above the canvas. Play starts the engine
// windowed; the player presses #fullscreen and the page puts the canvas
// container (#screen) in the browser's fullscreen mode and displays the canvas
// at the largest size that fits the screen with the drawing buffer's aspect
// ratio. The fake engine (`module` query parameter) sets the 1024x768 drawing
// buffer the real engine uses at start-up.

const FAKE = "/harness/canvas/fit.js";
const VIEWPORT = { width: 1280, height: 800 };
// Criterion 3: a 1024x768 drawing buffer on a 1280x800 screen fills the height.
const FIT_HEIGHT = 800;
const FIT_WIDTH = (FIT_HEIGHT * 1024) / 768;
// The fullscreen fit and the re-fit after a drawing-buffer change are the
// page's job, so the tests wait for the displayed size, never a fixed delay.
const WAIT = 10_000;

function makeInstall(dir: string): string {
  const root = join(dir, "install");
  mkdirSync(root, { recursive: true });
  for (const name of ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"]) {
    writeFileSync(join(root, name), buildBig([{ path: "Data\\INI\\Default\\GameData.ini", data: "GameData\nEnd\n" }]));
  }
  return root;
}

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

// Opens the launcher like tests/launcher-canvas.spec.ts, imports a complete
// synthetic install (which enables Play) and presses Play with a trusted click.
// Play must start the game windowed; on return the fake engine has started and
// set its 1024x768 drawing buffer.
async function startPlaying(page: Page, dir: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  await page.goto(`/app/index.html?module=${encodeURIComponent(FAKE)}`);
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await page.locator("#folder-input").setInputFiles(makeInstall(dir));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#play")).toBeEnabled();

  await page.locator("#play").click();
  await expect(page.locator("#canvas")).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
    return canvas !== null && canvas.width === 1024 && canvas.height === 768;
  });
}

// Presses #fullscreen with a trusted click: the browser only grants fullscreen
// to a user gesture, so the click must come from page.locator(), never from a
// click dispatched in page.evaluate().
async function enterFullscreen(page: Page): Promise<void> {
  await expect(page.locator("#fullscreen")).toBeVisible({ timeout: WAIT });
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
      headingBottom: heading.getBoundingClientRect().bottom,
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
// flow, below the heading, wholly inside the viewport. `fullscreenchange` can
// be delivered after `exitFullscreen()` resolved, so the layout is what says
// the page has left fullscreen.
async function waitWindowedFit(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const metrics = await measure(page);
        return (
          metrics.rect.top >= metrics.headingBottom &&
          metrics.rect.bottom <= metrics.innerHeight &&
          metrics.rect.left >= 0 &&
          metrics.rect.right <= metrics.innerWidth
        );
      },
      { timeout: WAIT },
    )
    .toBe(true);
}

test("1: after Play the game is windowed, with #play-controls and #fullscreen shown", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());

  // Play does not ask for fullscreen: the game starts in the page.
  expect((await fullscreen(page)).id).toBeNull();
  await expect(page.locator("#canvas")).toBeVisible();
  // The controls above the canvas are what the player uses to go fullscreen.
  await expect(page.locator("#play-controls")).toBeVisible();
  await expect(page.locator("#play-controls #fullscreen")).toBeVisible();

  // #80's windowed fit still holds.
  const metrics = await measure(page);
  expect(metrics.fullscreenId).toBeNull();
  expect(metrics.bufferWidth).toBe(1024);
  expect(metrics.bufferHeight).toBe(768);
  expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.top).toBeGreaterThanOrEqual(metrics.headingBottom);
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(metrics.innerHeight);
  const bufferRatio = metrics.bufferWidth / metrics.bufferHeight;
  const shownRatio = metrics.rect.width / metrics.rect.height;
  expect(Math.abs(shownRatio - bufferRatio) / bufferRatio).toBeLessThanOrEqual(0.01);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
});

test("2: clicking #fullscreen puts #screen in fullscreen and leaves #canvas focused", async ({ page }, info) => {
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

test("6: leaving fullscreen restores the windowed playing view with #fullscreen offered", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await enterFullscreen(page);
  await waitCanvasSize(page, FIT_WIDTH, FIT_HEIGHT);

  // What the browser's Esc does: the page leaves fullscreen.
  await leaveFullscreen(page);
  await waitWindowedFit(page);

  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#play-controls")).toBeVisible();
  await expect(page.locator("#play-controls #fullscreen")).toBeVisible();

  const metrics = await measure(page);
  expect(metrics.fullscreenId).toBeNull();
  // The canvas keeps its drawing buffer.
  expect(metrics.bufferWidth).toBe(1024);
  expect(metrics.bufferHeight).toBe(768);
  // #80's windowed fit: inside the viewport, below the heading, at the
  // drawing buffer's aspect ratio, without horizontal scroll.
  expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.top).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.top).toBeGreaterThanOrEqual(metrics.headingBottom);
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(metrics.innerHeight);
  const bufferRatio = metrics.bufferWidth / metrics.bufferHeight;
  const shownRatio = metrics.rect.width / metrics.rect.height;
  expect(Math.abs(shownRatio - bufferRatio) / bufferRatio).toBeLessThanOrEqual(0.01);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
});
