import { test, expect, type Page } from "@playwright/test";
import { importInstall, openLauncher, waitForState } from "./helpers/launcher";

// Issue #99: while the page is hidden or the window has lost focus the game is
// silent; when it is visible and focused again the previous volumes come back.
// The page tells the engine through `_GeneralsXSetAudioMuted`, the export of
// the module factory's result. The fake engine (`module` query parameter)
// records every value the page sends in `window.__muteCalls`; the second fake
// resolves to an engine object without that export. Since #159 the import
// starts the engine by itself: no test presses Play, and the user's own mute
// choice in #mute is T1's concern, not this spec's.

const MUTE_FAKE = "/harness/mute/records.js";
const NO_EXPORT_FAKE = "/harness/mute/no-export.js";
const VIEWPORT = { width: 1280, height: 800 };
const WAIT = 30_000;

type Probe = Window &
  typeof globalThis & {
    __muteCalls?: number[];
    __fakeEngineLoaded?: string;
    __unhandledRejections?: string[];
  };

// Opens the launcher like tests/launcher-canvas.spec.ts and imports a complete
// synthetic install with the given fake engine. The import starts the engine
// automatically, so on return the canvas is shown and the game is playing.
async function startPlaying(page: Page, dir: string, module: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await openLauncher(page, module);
  await importInstall(page, dir);
}

// The recording fake creates window.__muteCalls when its factory runs. The
// page's continuation after `await factory(...)` is a microtask, so by the time
// this task can see the array the page holds the engine object; #status is the
// page's own Ready after the factory resolved. No fixed delay is involved.
async function waitForMuteEngine(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Array.isArray((window as unknown as Probe).__muteCalls),
    null,
    { timeout: WAIT },
  );
  await waitForState(page, "playing", WAIT);
  await expect(page.locator("#status")).toContainText("Ready", { timeout: WAIT });
  await expect(page.locator("#engine-error")).toBeHidden();
}

async function muteCalls(page: Page): Promise<number[]> {
  return page.evaluate(() => [...((window as unknown as Probe).__muteCalls ?? [])]);
}

// The value the engine received last, or undefined when it never got one.
async function lastMuteCall(page: Page): Promise<number | undefined> {
  const calls = await muteCalls(page);
  return calls.length === 0 ? undefined : calls[calls.length - 1];
}

// Waits for the value the criterion names, never for a fixed delay.
async function waitForLastMuteCall(page: Page, value: number): Promise<void> {
  await expect.poll(() => lastMuteCall(page), { timeout: WAIT }).toBe(value);
}

// The fake creates __muteCalls before the page can call anything, so index 0
// is the first value the engine received.
async function firstMuteCall(page: Page): Promise<number | undefined> {
  return (await muteCalls(page))[0];
}

// One task boundary: a rejected promise surfaces as an unhandledrejection in
// the task after the one that rejected it.
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

test("1: a blur on the window after the automatic start makes the engine receive 1", async ({
  page,
}, info) => {
  await startPlaying(page, info.outputPath(), MUTE_FAKE);
  await waitForMuteEngine(page);

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await waitForLastMuteCall(page, 1);
});

test("2: after a blur, a focus on the window makes the engine receive 0", async ({ page }, info) => {
  await startPlaying(page, info.outputPath(), MUTE_FAKE);
  await waitForMuteEngine(page);

  // The state criterion 2 starts from: the window lost focus.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await waitForLastMuteCall(page, 1);

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await waitForLastMuteCall(page, 0);
});

test("3: a visibilitychange while the document is hidden mutes with 1, and visible again unmutes with 0", async ({
  page,
}, info) => {
  await startPlaying(page, info.outputPath(), MUTE_FAKE);
  await waitForMuteEngine(page);

  // From here on the window keeps focus, so only the visibility decides.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitForLastMuteCall(page, 1);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitForLastMuteCall(page, 0);
});

test("4: a page hidden before the engine starts makes the engine receive 1 as its first value", async ({
  page,
}, info) => {
  // Hidden before the first goto: the import starts the engine on a page that
  // never was visible, so the engine has to be muted as soon as the module is
  // available.
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
  });
  await startPlaying(page, info.outputPath(), MUTE_FAKE);
  await waitForMuteEngine(page);

  await expect.poll(() => firstMuteCall(page), { timeout: WAIT, message: "the engine's first value" }).toBe(1);
});

test("5: a fake engine without _GeneralsXSetAudioMuted keeps playing with no error", async ({ page }, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // A rejected promise is the other way a missing export can surface, so the
  // page must not leave one behind either.
  await page.addInitScript(() => {
    const rejections: string[] = [];
    (window as unknown as { __unhandledRejections: string[] }).__unhandledRejections = rejections;
    window.addEventListener("unhandledrejection", (event) => {
      rejections.push(String(event.reason));
    });
  });

  await startPlaying(page, info.outputPath(), NO_EXPORT_FAKE);
  await page.waitForFunction(
    () => (window as unknown as Probe).__fakeEngineLoaded === "mute-no-export",
    null,
    { timeout: WAIT },
  );

  // The focus changes reach the page; a module without the export is ignored.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await nextFrame(page);

  await waitForState(page, "playing", WAIT);
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeHidden();
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as Probe).__unhandledRejections)).toEqual([]);
});

test("6: a visible but unfocused page is muted, and a focus while hidden keeps it muted", async ({
  page,
}, info) => {
  await startPlaying(page, info.outputPath(), MUTE_FAKE);
  await waitForMuteEngine(page);

  // Visible but unfocused: the window lost focus, so the game must be silent.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await waitForLastMuteCall(page, 1);
  const callsAfterBlur = (await muteCalls(page)).length;

  // Focus comes back while the document is hidden: visibility wins, so the
  // game stays muted and every later value is still 1.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await nextFrame(page);

  const afterFocus = await muteCalls(page);
  expect(afterFocus.length).toBeGreaterThanOrEqual(callsAfterBlur);
  expect(afterFocus.slice(callsAfterBlur).every((value) => value === 1)).toBe(true);
  expect(await lastMuteCall(page)).toBe(1);
});

// Issue #186: the focus flag is seeded once, so a navigation from the address
// bar can miss the only `focus` event. These tests make `document.hasFocus()`
// lie independently of the synthetic events, which is exactly what the browser
// does when the address bar holds focus during load.
type FocusProbe = Window &
  typeof globalThis & {
    __focusStub?: boolean;
    __setFocusStub?: (focused: boolean) => void;
  };

// Installs a controllable document.hasFocus() before any page script runs.
// The page under test is opened normally afterwards.
async function stubDocumentFocus(page: Page, initially: boolean): Promise<void> {
  await page.addInitScript((focused: boolean) => {
    const probe = window as unknown as FocusProbe;
    probe.__focusStub = focused;
    probe.__setFocusStub = (next: boolean) => {
      probe.__focusStub = next;
    };
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => (window as unknown as FocusProbe).__focusStub === true,
    });
  }, initially);
}

test("7: a visible page that missed the focus event unmutes when the engine is ready", async ({
  page,
}, info) => {
  await stubDocumentFocus(page, false);
  await page.setViewportSize(VIEWPORT);
  await openLauncher(page, MUTE_FAKE);

  // The address bar releases focus; no `focus` event reaches the page.
  await page.evaluate(() => (window as unknown as FocusProbe).__setFocusStub?.(true));
  await importInstall(page, info.outputPath());
  await waitForMuteEngine(page);

  await waitForLastMuteCall(page, 0);
});

test("8: a pointerdown recovers a missed focus event, and a really unfocused page stays muted", async ({
  page,
}, info) => {
  await stubDocumentFocus(page, false);
  await page.setViewportSize(VIEWPORT);
  await openLauncher(page, MUTE_FAKE);
  await importInstall(page, info.outputPath());
  await waitForMuteEngine(page);
  await waitForLastMuteCall(page, 1);

  // Still unfocused: touching the page must not unmute it.
  await page.evaluate(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  // The next task boundary is enough for a wrong unmute to be recorded.
  await nextFrame(page);
  expect(await lastMuteCall(page)).toBe(1);

  // Now the document reports focus without a `focus` event: the first
  // interaction refreshes the flag.
  await page.evaluate(() => {
    (window as unknown as FocusProbe).__setFocusStub?.(true);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await waitForLastMuteCall(page, 0);
});

test("9: a hidden page with document focus is still muted", async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => true,
    });
  });
  await page.setViewportSize(VIEWPORT);
  await openLauncher(page, MUTE_FAKE);
  await importInstall(page, info.outputPath());
  await waitForMuteEngine(page);

  await expect
    .poll(() => firstMuteCall(page), { timeout: WAIT, message: "the engine's first value" })
    .toBe(1);
  expect(await lastMuteCall(page)).toBe(1);
});
