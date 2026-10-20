import { test, expect, type Page } from "@playwright/test";
import { importInstall, openLauncher, START_TIMEOUT } from "./helpers/launcher";

// Issue #187: the touch overlay from docs/specs/touch-controls.md. The fake
// engine records the pointer and keyboard events the page synthesises and the
// analog camera-pan calls. No game data and no engine build are involved.

const FAKE = "/harness/touch/records.js";
const WAIT = START_TIMEOUT;

type Probe = Window &
  typeof globalThis & {
    __touchPointer?: {
      type: string;
      pointerType: string;
      button: number;
      buttons: number;
      x: number;
      y: number;
    }[];
    __touchKeys?: { type: string; key: string; code: string }[];
    __panCalls?: [number, number][];
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

async function keyEvents(page: Page): Promise<NonNullable<Probe["__touchKeys"]>> {
  return page.evaluate(() => [...((window as unknown as Probe).__touchKeys ?? [])]);
}

// Dispatches a touch pointer at a fraction of the canvas box. The page listens
// in the capture phase, so this is the same path a real finger takes.
async function canvasTouch(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ({ type, x, y }) => {
      const canvas = document.getElementById("canvas") as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 11,
          pointerType: "touch",
          isPrimary: true,
          button: type === "pointermove" ? -1 : 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: rect.left + rect.width * x,
          clientY: rect.top + rect.height * y,
        }),
      );
    },
    { type, x, y },
  );
}

async function tapCanvas(page: Page, x = 0.5, y = 0.5): Promise<void> {
  await canvasTouch(page, "pointerdown", x, y);
  await canvasTouch(page, "pointerup", x, y);
}

// Dispatches a touch pointer on the joystick, expressed as an offset from its
// centre in CSS pixels.
async function joystickTouch(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  dx: number,
  dy: number,
): Promise<void> {
  await page.evaluate(
    ({ type, dx, dy }) => {
      const joystick = document.getElementById("touch-joystick") as HTMLElement;
      const rect = joystick.getBoundingClientRect();
      joystick.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 21,
          pointerType: "touch",
          isPrimary: true,
          button: type === "pointermove" ? -1 : 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: rect.left + rect.width / 2 + dx,
          clientY: rect.top + rect.height / 2 + dy,
        }),
      );
    },
    { type, dx, dy },
  );
}

async function activeId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

test.describe("touch device", () => {
  test.use({ hasTouch: true, viewport: { width: 812, height: 375 } });

  test("1: the toggle appears only while playing, and the overlay defaults on", async ({
    page,
  }, info) => {
    await openLauncher(page, FAKE);
    await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
    await expect(page.locator("#touch-toggle")).toBeHidden();
    await expect(page.locator("#touch-controls")).toBeHidden();

    await importInstall(page, info.outputPath());
    await expect(page.locator("body")).toHaveAttribute("data-state", "playing");
    await expect(page.locator("#touch-toggle")).toBeVisible();
    await expect(page.locator("#touch-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#touch-controls")).toBeVisible();
  });

  test("2: the toggle shows and hides the overlay and clears the locks", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    await page.locator("#touch-left").click();
    await expect(page.locator("#touch-left")).toHaveAttribute("aria-pressed", "true");

    await page.locator("#touch-toggle").click();
    await expect(page.locator("#touch-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#touch-controls")).toBeHidden();

    await page.locator("#touch-toggle").click();
    await expect(page.locator("#touch-controls")).toBeVisible();
    await expect(page.locator("#touch-left")).toHaveAttribute("aria-pressed", "false");
  });

  test("3: the overlay lives inside #screen and stays visible in fullscreen", async ({
    page,
  }, info) => {
    await startPlaying(page, info.outputPath());
    await expect(page.locator("#screen #touch-controls")).toHaveCount(1);
    await expect(page.locator("#screen #touch-controls")).toBeVisible();

    await page.locator("#touch-fullscreen").click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null), { timeout: WAIT })
      .toBe("screen");
    await expect(page.locator("#screen #touch-controls")).toBeVisible();
    await page.evaluate(() => document.exitFullscreen());
  });

  test("19: the column fullscreen toggle enters and leaves fullscreen", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    const toggle = page.locator("#touch-fullscreen");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-label", "Enter fullscreen");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle.locator("span")).toHaveText("Full");
    // The column adds a thumb-reachable toggle; the top-bar button stays
    // visible too (owner, 2026-10-20: it must not move with the overlay).
    await expect(page.locator("#topbar #fullscreen")).toBeVisible();

    await toggle.click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null), { timeout: WAIT })
      .toBe("screen");
    await expect(toggle).toHaveAttribute("aria-label", "Exit fullscreen");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle.locator("span")).toHaveText("Exit");

    const layout = await page.evaluate(() => {
      const ids = ["game-menu", "touch-left", "touch-right", "touch-multi", "touch-fullscreen"];
      return {
        innerWidth: window.innerWidth,
        boxes: ids.map((id) => {
          const rect = document.getElementById(id)!.getBoundingClientRect();
          return { id, left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        }),
      };
    });
    const [gameMenu, left, right, multi, fullscreen] = layout.boxes;
    expect(left.top).toBeGreaterThan(gameMenu.top);
    expect(right.top).toBeGreaterThan(left.top);
    expect(multi.top).toBeGreaterThan(right.top);
    expect(fullscreen.top).toBeGreaterThanOrEqual(multi.bottom - 1);
    expect(fullscreen.width).toBeCloseTo(56 * 0.7, 1);
    expect(fullscreen.height).toBeCloseTo(54 * 0.7, 1);
    expect(fullscreen.left).toBeLessThan(layout.innerWidth / 4);

    await toggle.click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null), { timeout: WAIT })
      .toBeNull();
    await expect(toggle).toHaveAttribute("aria-label", "Enter fullscreen");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle.locator("span")).toHaveText("Full");
    // The overlay is still shown, so both fullscreen controls are visible.
    await expect(page.locator("#topbar #fullscreen")).toBeVisible();
  });

  test("4: the column shrinks to 70 % top to bottom; the joystick sits bottom right", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    await expect(page.locator("#topbar #fullscreen")).toBeVisible();

    const layout = await page.evaluate(() => {
      const ids = ["game-menu", "touch-left", "touch-right", "touch-multi", "touch-fullscreen", "touch-joystick"];
      const boxes = ids.map((id) => {
        const rect = document.getElementById(id)!.getBoundingClientRect();
        return { id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      return { boxes, innerWidth: window.innerWidth, innerHeight: window.innerHeight };
    });
    const [gameMenu, left, right, multi, fullscreen, joystick] = layout.boxes;
    expect(gameMenu.top).toBeLessThan(left.top);
    expect(right.top).toBeGreaterThanOrEqual(left.bottom - 1);
    expect(multi.top).toBeGreaterThanOrEqual(right.bottom - 1);
    expect(fullscreen.top).toBeGreaterThanOrEqual(multi.bottom - 1);
    // Owner's 2026-10-20 request: the whole 56 x 54 button (icon and label)
    // renders at 70 % of its size.
    for (const button of [gameMenu, left, right, multi, fullscreen]) {
      expect(button.width).toBeCloseTo(56 * 0.7, 1);
      expect(button.height).toBeCloseTo(54 * 0.7, 1);
      expect(button.left).toBeLessThan(layout.innerWidth / 4);
    }
    expect(joystick.width).toBeGreaterThanOrEqual(54);
    expect(joystick.width).toBeLessThanOrEqual(58);
    // Clear of the corner so the right thumb reaches it, but still on the right-hand bottom.
    expect(layout.innerWidth - joystick.right).toBeGreaterThanOrEqual(30);
    expect(layout.innerWidth - joystick.right).toBeLessThanOrEqual(80);
    expect(layout.innerHeight - joystick.bottom).toBeGreaterThanOrEqual(24);
    expect(layout.innerHeight - joystick.bottom).toBeLessThanOrEqual(70);
  });

  test("5: each lock toggles with aria-pressed and sends no map click", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    expect(await pointerEvents(page)).toEqual([]);

    for (const id of ["touch-left", "touch-right", "touch-multi"]) {
      const button = page.locator(`#${id}`);
      await expect(button).toHaveAttribute("aria-pressed", "false");
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "false");
    }

    expect(await pointerEvents(page)).toEqual([]);
  });

  test("6: no lock means tap is a left click and a 500 ms press is a right click", async ({
    page,
  }, info) => {
    await startPlaying(page, info.outputPath());

    await tapCanvas(page, 0.4, 0.4);
    await expect.poll(() => pointerEvents(page), { timeout: WAIT }).toHaveLength(2);
    let events = await pointerEvents(page);
    expect(events[0]).toMatchObject({ type: "pointerdown", pointerType: "mouse", button: 0, buttons: 1 });
    expect(events[1]).toMatchObject({ type: "pointerup", pointerType: "mouse", button: 0, buttons: 0 });

    const before = events.length;
    await canvasTouch(page, "pointerdown", 0.6, 0.5);
    await page.waitForTimeout(650);
    await expect
      .poll(async () => (await pointerEvents(page)).length, { timeout: WAIT })
      .toBeGreaterThan(before);
    await canvasTouch(page, "pointerup", 0.6, 0.5);

    events = (await pointerEvents(page)).slice(before);
    expect(
      events.some((event) => event.type === "pointerdown" && event.button === 2),
      "a right button down",
    ).toBe(true);
    expect(
      events.some((event) => event.type === "pointerup" && event.button === 2),
      "a right button up",
    ).toBe(true);
    expect(events.some((event) => event.type === "pointerdown" && event.button === 0)).toBe(false);
  });

  test("7: Left lock turns a one-finger drag into a left-button drag select", async ({
    page,
  }, info) => {
    await startPlaying(page, info.outputPath());
    await page.locator("#touch-left").click();
    const before = (await pointerEvents(page)).length;

    await canvasTouch(page, "pointerdown", 0.3, 0.4);
    await canvasTouch(page, "pointermove", 0.5, 0.5);
    await canvasTouch(page, "pointermove", 0.65, 0.6);
    await canvasTouch(page, "pointerup", 0.65, 0.6);

    await expect
      .poll(async () => (await pointerEvents(page)).length, { timeout: WAIT })
      .toBeGreaterThanOrEqual(before + 4);
    const events = (await pointerEvents(page)).slice(before);
    expect(events[0]).toMatchObject({ type: "pointerdown", button: 0, buttons: 1 });
    expect(events.filter((event) => event.type === "pointermove").length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)).toMatchObject({ type: "pointerup", button: 0, buttons: 0 });
  });

  test("8: Right lock turns a tap into a right click and no selection click", async ({
    page,
  }, info) => {
    await startPlaying(page, info.outputPath());
    await page.locator("#touch-right").click();
    const before = (await pointerEvents(page)).length;
    await tapCanvas(page, 0.5, 0.5);

    await expect
      .poll(async () => (await pointerEvents(page)).length, { timeout: WAIT })
      .toBe(before + 2);
    const events = (await pointerEvents(page)).slice(before);
    expect(events[0]).toMatchObject({ type: "pointerdown", button: 2, buttons: 2 });
    expect(events[1]).toMatchObject({ type: "pointerup", button: 2, buttons: 0 });
    expect(events.some((event) => event.button === 0)).toBe(false);
  });

  test("9: Multi lock holds Shift around the click", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    await page.locator("#touch-multi").click();
    const pointerBefore = (await pointerEvents(page)).length;
    const keyBefore = (await keyEvents(page)).length;
    await tapCanvas(page, 0.5, 0.5);

    await expect
      .poll(async () => (await pointerEvents(page)).length, { timeout: WAIT })
      .toBe(pointerBefore + 2);
    const keys = (await keyEvents(page)).slice(keyBefore);
    const pointers = (await pointerEvents(page)).slice(pointerBefore);
    expect(keys.map((event) => `${event.type}:${event.key}`)).toEqual([
      "keydown:Shift",
      "keyup:Shift",
    ]);
    expect(pointers.map((event) => event.type)).toEqual(["pointerdown", "pointerup"]);
  });

  test("10: the joystick pans with a vector and springs back on release", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    const before = (await panCalls(page)).length;

    await joystickTouch(page, "pointerdown", 0, 0);
    await joystickTouch(page, "pointermove", 0, -50);
    await expect
      .poll(
        async () => {
          const calls = (await panCalls(page)).slice(before);
          return calls.some(([x, y]) => Math.abs(x) < 0.05 && y < -0.9);
        },
        { timeout: WAIT },
      )
      .toBe(true);

    const knobDrag = await page.locator("#touch-knob").evaluate((element) => element.style.transform);
    expect(knobDrag).not.toBe("translate(0px, 0px)");

    await joystickTouch(page, "pointerup", 0, -50);
    await expect
      .poll(async () => (await panCalls(page)).at(-1), { timeout: WAIT })
      .toEqual([0, 0]);
    await expect
      .poll(() => page.locator("#touch-knob").evaluate((element) => element.style.transform))
      .toBe("translate(0px, 0px)");
  });

  test("11: a touch on the overlay never reaches the map", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    const before = (await pointerEvents(page)).length;

    await page.evaluate(() => {
      const button = document.getElementById("touch-left") as HTMLElement;
      const rect = button.getBoundingClientRect();
      for (const type of ["pointerdown", "pointerup"] as const) {
        button.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 31,
            pointerType: "touch",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }),
        );
      }
    });

    expect(await pointerEvents(page)).toHaveLength(before);
  });

  test("12: the toggle choice survives a reload", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    await page.locator("#touch-toggle").click();
    await expect(page.locator("#touch-controls")).toBeHidden();

    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-state", "playing", { timeout: WAIT });
    await expect(page.locator("#touch-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#touch-controls")).toBeHidden();
  });

  test("13: a blocked localStorage falls back to the device default without an error", async ({
    page,
  }, info) => {
    await startPlaying(page, info.outputPath());
    await page.locator("#touch-toggle").click();
    await expect(page.locator("#touch-controls")).toBeHidden();

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key: string) {
        if (key === "openzh.touchControls") throw new Error("storage blocked");
        return getItem.call(this, key);
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === "openzh.touchControls") throw new Error("storage blocked");
        return setItem.call(this, key, value);
      };
    });

    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-state", "playing", { timeout: WAIT });
    // The device has touch and the stored "off" is unreadable: the default is on.
    await expect(page.locator("#touch-controls")).toBeVisible();
    await expect(page.locator("#touch-toggle")).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });

  test("16: the grip drags the joystick, the spot is saved and clamped", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());
    const spot = () =>
      page.locator("#touch-joystick").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top };
      });
    const gripTouch = (type: "pointerdown" | "pointermove" | "pointerup", dx: number, dy: number) =>
      page.evaluate(
        ({ type, dx, dy }) => {
          const grip = document.getElementById("touch-joystick-grip")!;
          const r = grip.getBoundingClientRect();
          grip.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 31,
              pointerType: "touch",
              isPrimary: true,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: r.left + r.width / 2 + (type === "pointerdown" ? 0 : dx),
              clientY: r.top + r.height / 2 + (type === "pointerdown" ? 0 : dy),
            }),
          );
        },
        { type, dx, dy },
      );

    const before = await spot();
    await gripTouch("pointerdown", 0, 0);
    await gripTouch("pointermove", -200, -60);
    await gripTouch("pointerup", -200, -60);
    const moved = await spot();
    expect(Math.round(before.x - moved.x)).toBe(200);
    expect(Math.round(before.y - moved.y)).toBe(60);
    expect(await pointerEvents(page)).toEqual([]);

    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-state", "playing", { timeout: WAIT });
    const reloaded = await spot();
    expect(Math.round(reloaded.x)).toBe(Math.round(moved.x));
    expect(Math.round(reloaded.y)).toBe(Math.round(moved.y));

    // A drag past the screen edge stops at the edge.
    await gripTouch("pointerdown", 0, 0);
    await gripTouch("pointermove", 5000, 5000);
    await gripTouch("pointerup", 5000, 5000);
    const edge = await page.locator("#touch-joystick-dock").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { right: r.right, bottom: r.bottom, w: window.innerWidth, h: window.innerHeight };
    });
    expect(edge.right).toBeLessThanOrEqual(edge.w);
    expect(edge.bottom).toBeLessThanOrEqual(edge.h);
  });

  test("14: the joystick ring shrinks to the knob at rest and opens while pushed", async ({ page }, info) => {
    await startPlaying(page, info.outputPath());

    const ringOpacity = () =>
      page.locator("#touch-joystick").evaluate((el) => getComputedStyle(el, "::after").opacity);
    await expect.poll(ringOpacity).toBe("0");
    await joystickTouch(page, "pointerdown", 0, 0);
    await expect.poll(ringOpacity).toBe("0.75");
    await joystickTouch(page, "pointerup", 0, 0);
    await expect.poll(ringOpacity).toBe("0");
  });
});

test.describe("desktop", () => {
  test.use({ hasTouch: false, viewport: { width: 1280, height: 800 } });

  test("15: the overlay starts hidden, the toggle works, and mouse input is unchanged", async ({
    page,
  }, info) => {
    await startPlaying(page, info.outputPath());
    await expect(page.locator("#touch-controls")).toBeHidden();
    await expect(page.locator("#touch-toggle")).toHaveAttribute("aria-pressed", "false");

    await page.locator("#touch-toggle").click();
    await expect(page.locator("#touch-controls")).toBeVisible();
    await page.locator("#touch-toggle").click();
    await expect(page.locator("#touch-controls")).toBeHidden();

    // A mouse pointer event reaches the fake engine once, untouched by the
    // touch state machine.
    await page.evaluate(() => {
      const canvas = document.getElementById("canvas") as HTMLCanvasElement;
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const events = await pointerEvents(page);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ pointerType: "mouse", button: 0 });
    expect(await panCalls(page)).toEqual([]);

    // The keyboard keeps working: the page itself never synthesises a key.
    expect(await keyEvents(page)).toEqual([]);
    await page.locator("#canvas").click();
    await expect.poll(() => activeId(page)).toBe("canvas");
  });
});
