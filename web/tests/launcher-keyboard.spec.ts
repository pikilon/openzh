import { test, expect, type Page } from "@playwright/test";
import { installZip } from "./helpers/install-zip";

// Issue #202: the launcher's hamburger holds a Keyboard dialog for the four
// camera keys the port adds (default W/S/A/D) and the two original shortcuts
// that used to sit on W/S (Select all aircraft and Stop, default Y/Z). The
// recording fake (`module` query parameter) reports every six-scancode call in
// window.__keyMapCalls; `&export=missing` resolves an engine without the bridge.

const SHELL = "/app/index.html";
const KEYBOARD_FAKE = "/harness/keyboard/records.js";
const NO_EXPORT_FAKE = "/harness/keyboard/no-export.js";
const WAIT = 15_000;
const START_WAIT = 40_000;

type KeyboardWindow = Window &
  typeof globalThis & {
    __keyMapCalls?: number[][];
    __fakeEngineLoaded?: string;
    __unhandledRejections?: string[];
  };

// W, S, A, D, Y, Z as SDL scancodes: the defaults the page must send.
const DEFAULTS = [26, 22, 4, 7, 28, 29];
// I (scancode 12) replaces W in the assignment tests.
const WITH_I = [12, 22, 4, 7, 28, 29];

async function startPlaying(page: Page, dir: string, module: string = KEYBOARD_FAKE): Promise<void> {
  await page.goto(`${SHELL}?module=${encodeURIComponent(module)}`);
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets", { timeout: WAIT });
  await page.locator("#zip-input").setInputFiles(await installZip(dir));
  await expect(page.locator("body")).toHaveAttribute("data-state", "playing", { timeout: START_WAIT });
  await expect(page.locator("#canvas")).toBeVisible();
}

async function openMenu(page: Page): Promise<void> {
  await page.locator("#menu-button").click();
  await expect(page.locator("#menu")).toHaveAttribute("open", "");
}

async function openKeyboard(page: Page): Promise<void> {
  await page.locator("#keyboard-settings").click();
  const dialog = page.locator("#keyboard-dialog");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog).toBeVisible();
}

function binding(page: Page, slot: string) {
  return page.locator(`#keyboard-dialog [data-key-slot="${slot}"]`);
}

async function keyMapCalls(page: Page): Promise<number[][]> {
  return page.evaluate(() =>
    ((window as unknown as KeyboardWindow).__keyMapCalls ?? []).map((call) => [...call]),
  );
}

async function lastKeyMapCall(page: Page): Promise<number[] | undefined> {
  const calls = await keyMapCalls(page);
  return calls.length === 0 ? undefined : calls[calls.length - 1];
}

async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function activeElementId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return "";
    return active.id !== "" ? active.id : active.tagName;
  });
}

async function storedBindings(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("openzh.keyboard");
    return raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
  });
}

test("1: the hamburger opens the Keyboard dialog with the six defaults", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await openMenu(page);
  await openKeyboard(page);

  await expect(binding(page, "cameraUp")).toHaveText("W");
  await expect(binding(page, "cameraDown")).toHaveText("S");
  await expect(binding(page, "cameraLeft")).toHaveText("A");
  await expect(binding(page, "cameraRight")).toHaveText("D");
  await expect(binding(page, "selectAllAircraft")).toHaveText("Y");
  await expect(binding(page, "stop")).toHaveText("Z");
  await expect(page.locator("#keyboard-hint")).toContainText(/arrow/i);

  await page.locator("#keyboard-close").click();
  await expect(page.locator("#keyboard-dialog")).not.toHaveAttribute("open", "");
  await expect.poll(() => activeElementId(page), { timeout: WAIT }).toBe("keyboard-settings");
});

test("2: the automatic start sends the default camera and moved-shortcut keys", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());

  await expect.poll(() => lastKeyMapCall(page), { timeout: WAIT }).toEqual(DEFAULTS);
  expect((await keyMapCalls(page))[0]).toEqual(DEFAULTS);
});

test("3: assigning I to Move up stores and sends the new scancode", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await openMenu(page);
  await openKeyboard(page);
  await expect.poll(() => lastKeyMapCall(page), { timeout: WAIT }).toEqual(DEFAULTS);

  await binding(page, "cameraUp").click();
  await expect(binding(page, "cameraUp")).toHaveText("Press a key…");
  await page.keyboard.press("i");

  await expect(binding(page, "cameraUp")).toHaveText("I");
  await expect.poll(() => lastKeyMapCall(page), { timeout: WAIT }).toEqual(WITH_I);
  expect(await storedBindings(page)).toMatchObject({ cameraUp: "KeyI" });
});

test("4: a duplicate key is refused and leaves the bindings alone", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await openMenu(page);
  await openKeyboard(page);
  await expect.poll(() => lastKeyMapCall(page), { timeout: WAIT }).toEqual(DEFAULTS);
  const callsBefore = (await keyMapCalls(page)).length;

  await binding(page, "cameraUp").click();
  await page.keyboard.press("s");

  await expect(page.locator("#keyboard-status")).toBeVisible();
  await expect(page.locator("#keyboard-status")).toContainText(/already|assigned/i);
  await expect(binding(page, "cameraUp")).toHaveText("Press a key…");
  expect((await keyMapCalls(page)).length).toBe(callsBefore);

  await page.keyboard.press("Escape");
  await expect(binding(page, "cameraUp")).toHaveText("W");
});

test("5: unsupported keys and Ctrl combinations are refused", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await openMenu(page);
  await openKeyboard(page);

  await binding(page, "cameraLeft").click();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#keyboard-status")).toContainText(/letter|number|supported/i);
  await expect(binding(page, "cameraLeft")).toHaveText("Press a key…");

  await page.keyboard.press("Escape");
  await binding(page, "cameraLeft").click();
  await page.keyboard.press("Control+i");
  await expect(page.locator("#keyboard-status")).toContainText(/Ctrl|Alt|Command|modifier/i);
  await expect(binding(page, "cameraLeft")).toHaveText("Press a key…");

  await page.keyboard.press("Escape");
  await expect(binding(page, "cameraLeft")).toHaveText("A");
});

test("6: Escape cancels capture without closing the dialog; a second Escape closes it", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await openMenu(page);
  await openKeyboard(page);
  const dialog = page.locator("#keyboard-dialog");

  await binding(page, "cameraRight").click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(binding(page, "cameraRight")).toHaveText("D");

  await page.keyboard.press("Escape");
  await expect(dialog).not.toHaveAttribute("open", "");
});

test("7: Reset restores the defaults, stores them and sends them to the engine", async ({
  page,
}, info) => {
  await startPlaying(page, info.outputPath());
  await openMenu(page);
  await openKeyboard(page);

  await binding(page, "cameraUp").click();
  await page.keyboard.press("i");
  await expect.poll(() => lastKeyMapCall(page), { timeout: WAIT }).toEqual(WITH_I);

  await page.locator("#keyboard-reset").click();

  await expect(binding(page, "cameraUp")).toHaveText("W");
  await expect(binding(page, "cameraDown")).toHaveText("S");
  await expect(binding(page, "cameraLeft")).toHaveText("A");
  await expect(binding(page, "cameraRight")).toHaveText("D");
  await expect(binding(page, "selectAllAircraft")).toHaveText("Y");
  await expect(binding(page, "stop")).toHaveText("Z");
  await expect.poll(() => lastKeyMapCall(page), { timeout: WAIT }).toEqual(DEFAULTS);
  expect(await storedBindings(page)).toEqual({
    cameraUp: "KeyW",
    cameraDown: "KeyS",
    cameraLeft: "KeyA",
    cameraRight: "KeyD",
    selectAllAircraft: "KeyY",
    stop: "KeyZ",
  });
});

test("8: a reload applies the stored bindings to the new engine", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await openMenu(page);
  await openKeyboard(page);
  await binding(page, "cameraUp").click();
  await page.keyboard.press("i");
  await expect.poll(() => lastKeyMapCall(page), { timeout: WAIT }).toEqual(WITH_I);

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-state", "playing", { timeout: START_WAIT });
  await expect(page.locator("#canvas")).toBeVisible();
  await expect.poll(() => lastKeyMapCall(page), { timeout: WAIT }).toEqual(WITH_I);

  await openMenu(page);
  await openKeyboard(page);
  await expect(binding(page, "cameraUp")).toHaveText("I");
});

test("9: an engine without _GeneralsXSetKeyMap keeps playing", async ({ page }, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const rejections: string[] = [];
    (window as unknown as KeyboardWindow).__unhandledRejections = rejections;
    window.addEventListener("unhandledrejection", (event) => {
      rejections.push(String(event.reason));
    });
  });

  await startPlaying(page, info.outputPath(), NO_EXPORT_FAKE);
  await page.waitForFunction(
    () => (window as unknown as KeyboardWindow).__fakeEngineLoaded === "keyboard-no-export",
    null,
    { timeout: WAIT },
  );

  await openMenu(page);
  await openKeyboard(page);
  await binding(page, "cameraUp").click();
  await page.keyboard.press("i");
  await expect(binding(page, "cameraUp")).toHaveText("I");
  await nextFrame(page);

  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeHidden();
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as KeyboardWindow).__unhandledRejections)).toEqual([]);
});

test("10: a damaged or duplicate stored set falls back to the defaults", async ({ page }, info) => {
  // Read before the page module runs: cameraUp and cameraDown cannot share W.
  await page.addInitScript(() => {
    localStorage.setItem(
      "openzh.keyboard",
      JSON.stringify({
        cameraUp: "KeyW",
        cameraDown: "KeyW",
        cameraLeft: "KeyA",
        cameraRight: "KeyD",
        selectAllAircraft: "KeyY",
        stop: "KeyZ",
      }),
    );
  });
  await startPlaying(page, info.outputPath());

  await expect.poll(() => lastKeyMapCall(page), { timeout: WAIT }).toEqual(DEFAULTS);
  await openMenu(page);
  await openKeyboard(page);
  await expect(binding(page, "cameraUp")).toHaveText("W");
  await expect(binding(page, "cameraDown")).toHaveText("S");
});
