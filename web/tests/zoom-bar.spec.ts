import { test, expect, type Page } from "@playwright/test";
import { importInstall, openLauncher, START_TIMEOUT } from "./helpers/launcher";

// Issue #195: the touch zoom bar. The fake engine records the direct zoom calls
// (and, for an engine without the export, the wheel events the page synthesises
// on the canvas), plus pointer and pan events so a touch on the bar cannot be
// mistaken for a map interaction. No game data and no engine build are involved.

const FAKE = "/harness/touch/records.js";
const WAIT = START_TIMEOUT;

type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };

type Probe = Window &
  typeof globalThis & {
    __touchPointer?: { type: string; pointerType: string; button: number; buttons: number; x: number; y: number }[];
    __panCalls?: [number, number][];
    __zoomCalls?: number[];
    __wheelEvents?: { deltaY: number; deltaMode: number; defaultPrevented: boolean }[];
    __noZoomExport?: boolean;
  };

async function startPlaying(page: Page, dir: string): Promise<void> {
  await openLauncher(page, FAKE);
  await importInstall(page, dir);
  await expect(page.locator("#touch-toggle")).toBeVisible({ timeout: WAIT });
}

async function pointerEvents(page: Page): Promise<NonNullable<Probe["__touchPointer"]>> {
  return page.evaluate(() => [...((window as unknown as Probe).__touchPointer ?? [])]);
}

async function panCalls(page: Page): Promise<[number, number][]> {
  return page.evaluate(() => [...((window as unknown as Probe).__panCalls ?? [])]);
}

async function wheelEvents(page: Page): Promise<NonNullable<Probe["__wheelEvents"]>> {
  return page.evaluate(() => [...((window as unknown as Probe).__wheelEvents ?? [])]);
}

async function zoomCalls(page: Page): Promise<number[]> {
  return page.evaluate(() => [...((window as unknown as Probe).__zoomCalls ?? [])]);
}

async function thumbOffset(page: Page): Promise<number> {
  const value = await page
    .locator("#touch-zoom-thumb")
    .evaluate((element) => element.style.getPropertyValue("--zoom-thumb") || "0px");
  return Number.parseFloat(value);
}

// Dispatches a touch pointer on the bar, `dy` CSS px from its centre.
async function barTouch(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  dy: number,
): Promise<boolean> {
  return page.evaluate(
    ({ type, dy }) => {
      const bar = document.getElementById("touch-zoom") as HTMLElement;
      const rect = bar.getBoundingClientRect();
      return bar.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 41,
          pointerType: "touch",
          isPrimary: true,
          button: type === "pointermove" ? -1 : 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2 + dy,
        }),
      );
    },
    { type, dy },
  );
}

async function gripTouch(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  dx: number,
  dy: number,
): Promise<void> {
  await page.evaluate(
    ({ type, dx, dy }) => {
      const grip = document.getElementById("touch-joystick-grip") as HTMLElement;
      const rect = grip.getBoundingClientRect();
      grip.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 51,
          pointerType: "touch",
          isPrimary: true,
          button: type === "pointermove" ? -1 : 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: rect.left + rect.width / 2 + (type === "pointerdown" ? 0 : dx),
          clientY: rect.top + rect.height / 2 + (type === "pointerdown" ? 0 : dy),
        }),
      );
    },
    { type, dx, dy },
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

type Layout = {
  screen: Rect;
  bar: Rect;
  joystick: Rect;
  grip: Rect;
  dock: Rect;
  innerWidth: number;
  innerHeight: number;
  scrollY: number;
  touchAction: string;
  elementAtCentre: boolean;
};

async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const rect = (id: string): Rect => {
      const r = document.getElementById(id)!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const bar = rect("touch-zoom");
    const at = document.elementFromPoint((bar.left + bar.right) / 2, (bar.top + bar.bottom) / 2);
    const element = document.getElementById("touch-zoom")!;
    return {
      screen: rect("screen"),
      bar,
      joystick: rect("touch-joystick"),
      grip: rect("touch-joystick-grip"),
      dock: rect("touch-joystick-dock"),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      touchAction: getComputedStyle(element).touchAction,
      elementAtCentre: at !== null && at.closest("#touch-zoom") !== null,
    };
  });
}

test.describe("touch zoom bar", () => {
  test.use({ hasTouch: true, viewport: { width: 812, height: 375 } });

  test("1: the bar sits on the right edge, above the joystick, inside #screen", async ({
    page,
  }, info) => {
    await startPlaying(page, info.outputPath());
    await expect(page.locator("#touch-zoom")).toBeVisible();
    await expect(page.locator("#screen #touch-zoom")).toHaveCount(1);

    const box = await layout(page);
    expect(box.bar.width).toBeGreaterThanOrEqual(29);
    expect(box.bar.height).toBeGreaterThanOrEqual(140);
    expect(box.bar.top).toBeGreaterThanOrEqual(box.screen.top);
    expect(box.bar.bottom).toBeLessThanOrEqual(box.screen.bottom);
    expect(box.screen.right - box.bar.right).toBeGreaterThanOrEqual(4);
    expect(box.screen.right - box.bar.right).toBeLessThanOrEqual(10);
    expect(box.touchAction).toBe("none");
    expect(box.scrollY).toBe(0);
    expect(box.elementAtCentre).toBe(true);

    // No part of the joystick, its grip or its 16 px landing ring overlaps.
    const landing = {
      left: box.joystick.left - 16,
      right: box.joystick.right + 16,
      top: box.joystick.top - 16,
      bottom: box.joystick.bottom + 16,
    };
    for (const other of [box.joystick, box.grip, box.dock, landing]) {
      expect(overlaps(box.bar, other)).toBe(false);
    }
    expect(box.bar.bottom).toBeLessThanOrEqual(box.grip.top - 7);
  });

  test("2: a thin line at rest that widens on press, with nine ticks and a bigger grip", async ({
    page,
  }, info) => {
    await startPlaying(page, info.outputPath());
    const zoom = page.locator("#touch-zoom");
    const ticks = zoom.locator(".touch-zoom-tick");
    const ticksLayer = page.locator(".touch-zoom-ticks");
    await expect(ticks).toHaveCount(9);

    const rail = () =>
      zoom.evaluate((element) => parseFloat(getComputedStyle(element, "::after").width));
    const ticksOpacity = () =>
      ticksLayer.evaluate((element) => parseFloat(getComputedStyle(element).opacity));
    const thumbWidth = async () => (await page.locator("#touch-zoom-thumb").boundingBox())!.width;

    // At rest: a 2 px line, no ticks, a small thumb.
    expect(await rail()).toBeLessThanOrEqual(4);
    expect(await ticksOpacity()).toBe(0);
    expect(await thumbWidth()).toBeLessThanOrEqual(10);
    expect(await thumbOffset(page)).toBe(0);
    const triangle = await page.locator("#touch-zoom-thumb").evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return parseFloat(style.borderRightWidth);
    });
    expect(triangle).toBeGreaterThanOrEqual(6);

    // Pressed: the plate, the ticks and the grip. Headless Brave keeps CSS
    // transitions at time zero without frames, so finish them before measuring.
    await barTouch(page, "pointerdown", 0);
    await expect(zoom).toHaveClass(/is-active/);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        try {
          animation.finish();
        } catch {
          // An infinite animation has no end to reach.
        }
      }
    });
    expect(await rail()).toBeGreaterThanOrEqual(29);
    expect(await ticksOpacity()).toBe(1);
    expect(await thumbWidth()).toBeGreaterThanOrEqual(24);
    const widths = await ticks.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
    expect(widths[4]).toBeGreaterThan(widths[0]);

    // Released: back to the line.
    await barTouch(page, "pointerup", 0);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        try {
          animation.finish();
        } catch {
          // An infinite animation has no end to reach.
        }
      }
    });
    expect(await rail()).toBeLessThanOrEqual(4);
    expect(await ticksOpacity()).toBe(0);
    expect(await thumbWidth()).toBeLessThanOrEqual(10);
    expect(await thumbOffset(page)).toBe(0);
  });

  test("3: dragging up zooms in and the thumb stays where the camera is", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    const before = (await zoomCalls(page)).length;

    expect(await barTouch(page, "pointerdown", 0)).toBe(false);
    await barTouch(page, "pointermove", -48);
    await expect.poll(async () => (await zoomCalls(page)).length, { timeout: WAIT }).toBeGreaterThan(
      before,
    );

    const calls = (await zoomCalls(page)).slice(before);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((notches) => notches > 0)).toBe(true);
    expect(await thumbOffset(page)).toBeLessThan(-10);

    const afterMove = calls.length;
    await barTouch(page, "pointerup", -48);
    await page.waitForTimeout(250);
    expect(await thumbOffset(page)).toBeLessThan(-10);
    expect((await zoomCalls(page)).length).toBe(before + afterMove);
  });

  test("3b: the thumb sits at the top at maximum zoom and glows", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    await expect(page.locator("#touch-zoom")).not.toHaveAttribute("data-zoom-end", /.+/);

    await barTouch(page, "pointerdown", 0);
    for (let y = -20; y >= -200; y -= 20) await barTouch(page, "pointermove", y);
    await expect(page.locator("#touch-zoom")).toHaveAttribute("data-zoom-end", "in", {
      timeout: WAIT,
    });
    const top = await thumbOffset(page);
    await barTouch(page, "pointerup", -200);
    expect(await thumbOffset(page)).toBeCloseTo(top, 0);
    expect(top).toBeLessThan(-30);

    await barTouch(page, "pointerdown", 0);
    for (let y = 20; y <= 400; y += 20) await barTouch(page, "pointermove", y);
    await expect(page.locator("#touch-zoom")).toHaveAttribute("data-zoom-end", "out", {
      timeout: WAIT,
    });
    expect(await thumbOffset(page)).toBeGreaterThan(30);
    await barTouch(page, "pointerup", 400);
  });

  test("4: dragging down zooms out", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    const before = (await zoomCalls(page)).length;

    await barTouch(page, "pointerdown", 0);
    await barTouch(page, "pointermove", 48);
    await expect.poll(async () => (await zoomCalls(page)).length, { timeout: WAIT }).toBeGreaterThan(
      before,
    );
    const calls = (await zoomCalls(page)).slice(before);
    expect(calls.every((notches) => notches < 0)).toBe(true);
    expect(await thumbOffset(page)).toBeGreaterThan(10);
    await barTouch(page, "pointerup", 48);
  });

  test("5: touching the bar never reaches the map or scrolls the page", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    const pointers = (await pointerEvents(page)).length;
    const pans = (await panCalls(page)).length;

    expect(await barTouch(page, "pointerdown", 0)).toBe(false);
    await barTouch(page, "pointermove", -60);
    await barTouch(page, "pointerup", -60);

    expect((await pointerEvents(page)).length).toBe(pointers);
    expect((await panCalls(page)).length).toBe(pans);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
    expect((await zoomCalls(page)).length).toBeGreaterThan(0);
  });

  test("6: hiding the overlay hides the bar and the thumb still shows the camera zoom", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    await barTouch(page, "pointerdown", 0);
    await barTouch(page, "pointermove", -40);
    await barTouch(page, "pointerup", -40);

    await page.locator("#touch-toggle").click();
    await expect(page.locator("#touch-zoom")).toBeHidden();

    await page.locator("#touch-toggle").click();
    await expect(page.locator("#touch-zoom")).toBeVisible();
    expect(await thumbOffset(page)).toBeLessThan(-5);
  });

  test("7: the joystick cannot be moved onto the bar", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());

    await gripTouch(page, "pointerdown", 0, 0);
    await gripTouch(page, "pointermove", 600, 600);
    await gripTouch(page, "pointerup", 600, 600);

    const box = await layout(page);
    const landing = {
      left: box.joystick.left - 16,
      right: box.joystick.right + 16,
      top: box.joystick.top - 16,
      bottom: box.joystick.bottom + 16,
    };
    expect(overlaps(box.bar, landing)).toBe(false);
    expect(landing.right).toBeLessThanOrEqual(box.bar.left - 7);
    expect(box.elementAtCentre).toBe(true);
  });

  test("9: an engine without the zoom export falls back to the wheel path", async ({ page }, info) => {
    await page.addInitScript(() => {
      (window as unknown as Probe).__noZoomExport = true;
    });
    await startPlaying(page, info.outputPath());
    const before = (await wheelEvents(page)).length;

    await barTouch(page, "pointerdown", 0);
    await barTouch(page, "pointermove", -48);
    await expect.poll(async () => (await wheelEvents(page)).length, { timeout: WAIT }).toBeGreaterThan(
      before,
    );
    expect((await zoomCalls(page)).length).toBe(0);
    await barTouch(page, "pointerup", -48);
  });
});

test.describe("desktop", () => {
  test.use({ hasTouch: false, viewport: { width: 1280, height: 800 } });

  test("8: the bar stays hidden with the desktop overlay", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    await expect(page.locator("#touch-controls")).toBeHidden();
    await expect(page.locator("#touch-zoom")).toBeHidden();
  });
});
