import { test, expect, type Page } from "@playwright/test";
import { importInstall, openLauncher, START_TIMEOUT } from "./helpers/launcher";

// Issue #91: the Fullscreen button above the canvas is a progressive
// enhancement. These are its degraded paths: a browser that offers no
// fullscreen at all (criterion 7), a browser that refuses the request
// (criterion 8), and an engine that aborts after the page asked for fullscreen
// (criterion 9). Since #159 the import starts the engine and #fullscreen is an
// icon button in #topbar. In every fallback the playing view must stay usable,
// a refused request must not be shown as an error, and a failed engine must end
// out of fullscreen with its message readable and no button offered.
//
// `addInitScript` replaces the Fullscreen API before the page loads, which is
// the only way to test a browser that lacks it or rejects it. The `module`
// query parameter starts a fake engine instead of the real one.

const FIT = "/harness/canvas/fit.js";
const ABORT_LATE = "/harness/errors/abort-late.js";
const VIEWPORT = { width: 1280, height: 800 };
const WAIT = START_TIMEOUT;

type Done = { status: "resolved" | "error"; message?: string };

// Opens the launcher at 1280x800 with a clean store, imports a complete
// synthetic install (the import auto-starts the fake engine) and waits until
// the game is playing. The viewport is set before the first `goto`, so the
// windowed fit is measured at the size the criteria name.
async function prepareLauncher(page: Page, dir: string, module: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await openLauncher(page, module);
  await importInstall(page, dir);
}

// Presses #fullscreen with a trusted click: the browser only grants fullscreen
// to a user gesture, so a click dispatched from page.evaluate() would not count.
async function pressFullscreen(page: Page): Promise<void> {
  await expect(page.locator("#fullscreen")).toBeVisible({ timeout: WAIT });
  await expect(page.locator("#fullscreen")).toBeEnabled({ timeout: WAIT });
  await page.locator("#fullscreen").click({ timeout: WAIT });
}

// The late-abort fake aborts one second after its factory resolved. With the
// automatic engine start there is no Play click before the fullscreen request
// any more, so the test defers that one timer and releases it when the page is
// already fullscreen: the scenario is exact instead of racing a one-second
// window. The fake itself is the module the `module` query parameter selects.
async function deferAbortIfNeeded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.setTimeout;
    const delayed: (() => void)[] = [];
    (window as unknown as { __releaseDelayedTimers?: () => void }).__releaseDelayedTimers = () => {
      for (const callback of delayed.splice(0)) callback();
    };
    Object.defineProperty(window, "setTimeout", {
      configurable: true,
      writable: true,
      value: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 1000 && typeof handler === "function") {
          delayed.push(() => (handler as (...values: unknown[]) => void)(...args));
          return 0;
        }
        return original.call(window, handler, timeout, ...args);
      },
    });
  });
}

async function releaseDelayedTimers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const release = (window as unknown as { __releaseDelayedTimers?: () => void }).__releaseDelayedTimers;
    if (release === undefined) throw new Error("the test never installed the timer gate");
    release();
  });
}

async function doneWhen(page: Page, status: Done["status"], timeout = 20_000): Promise<Done | undefined> {
  await page.waitForFunction(
    (wanted) => (window as unknown as { __zhwpDone?: { status?: string } }).__zhwpDone?.status === wanted,
    status,
    { timeout },
  );
  return page.evaluate(() => (window as unknown as { __zhwpDone?: Done }).__zhwpDone);
}

async function fullscreenElementId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.fullscreenElement?.id ?? null);
}

// The element the page last asked the browser to put in fullscreen; the stubs
// below record it so a test knows the click really made the request.
async function requestedElement(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (window as unknown as { __zhwpRequestedElement?: string }).__zhwpRequestedElement ?? null,
  );
}

// Records every fullscreenchange for the whole page load from an init script,
// so a session that ends (or is cut short by an abort) is observed as it
// happened instead of being guessed by polling the current state afterwards.
// The listener is a capture one on the document: the event is fired at the
// document and also bubbles from the element, so both ends are seen.
async function recordFullscreenEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: (string | null)[] = [];
    (window as unknown as { __zhwpFullscreenEvents?: (string | null)[] }).__zhwpFullscreenEvents = log;
    document.addEventListener(
      "fullscreenchange",
      () => {
        const element = document.fullscreenElement;
        log.push(element === null ? null : element.id);
      },
      true,
    );
  });
}

async function fullscreenEvents(page: Page): Promise<(string | null)[]> {
  return page.evaluate(
    () => (window as unknown as { __zhwpFullscreenEvents?: (string | null)[] }).__zhwpFullscreenEvents ?? [],
  );
}

async function fullscreenGrants(page: Page): Promise<(string | null)[]> {
  return page.evaluate(
    () => (window as unknown as { __zhwpFullscreenGrants?: (string | null)[] }).__zhwpFullscreenGrants ?? [],
  );
}

type Layout = {
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  topbarBottom: number;
  bufferWidth: number;
  bufferHeight: number;
  scrollWidth: number;
  clientWidth: number;
  viewportWidth: number;
  viewportHeight: number;
};

async function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const topbar = document.getElementById("topbar") as HTMLElement;
    const rect = canvas.getBoundingClientRect();
    return {
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
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
}

// #80's windowed playing layout, which a fallback must keep: the whole canvas
// visible inside the viewport, displayed at its drawing-buffer aspect ratio,
// below #topbar and without a horizontal scrollbar.
async function expectWindowedFit(page: Page): Promise<void> {
  const layout = await measure(page);
  expect(layout.bufferWidth).toBe(1024);
  expect(layout.bufferHeight).toBe(768);
  expect(layout.rect.top).toBeGreaterThanOrEqual(layout.topbarBottom);
  expect(layout.rect.left).toBeGreaterThanOrEqual(0);
  expect(layout.rect.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.rect.bottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  const bufferRatio = layout.bufferWidth / layout.bufferHeight;
  const shownRatio = layout.rect.width / layout.rect.height;
  expect(Math.abs(shownRatio - bufferRatio) / bufferRatio).toBeLessThanOrEqual(0.01);
}

test("7: without requestFullscreen the auto-started game is windowed and #fullscreen is hidden", async ({
  page,
}, info) => {
  // A browser where the Fullscreen API is not a function at all.
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", { value: undefined, configurable: true });
  });
  await prepareLauncher(page, info.outputPath(), FIT);

  // The game plays windowed, with nothing offered that the browser cannot do:
  // the button is part of the top bar either way and must stay hidden.
  expect(await fullscreenElementId(page)).toBeNull();
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeHidden();
  await expect(page.locator("#topbar #fullscreen")).toHaveCount(1);
  await expect(page.locator("#fullscreen")).toBeHidden();
  await expectWindowedFit(page);
});

test("8: a refused fullscreen request leaves the game windowed with #fullscreen still offered", async ({
  page,
}, info) => {
  // A browser that has the Fullscreen API but denies this request, as Safari
  // and some kiosk modes do.
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: function (this: Element) {
        (window as unknown as { __zhwpRequestedElement?: string }).__zhwpRequestedElement = this.id;
        return Promise.reject(new DOMException("denied", "NotAllowedError"));
      },
    });
  });
  await prepareLauncher(page, info.outputPath(), FIT);

  await pressFullscreen(page);
  // The click really asked the browser for #screen, and the refusal changed
  // nothing: the game keeps playing windowed and the button stays so the
  // player can retry.
  await expect.poll(() => requestedElement(page), { timeout: WAIT }).toBe("screen");
  expect(await fullscreenElementId(page)).toBeNull();
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeHidden();
  await expect(page.locator("#fullscreen")).toBeVisible();
  await expect(page.locator("#fullscreen")).toBeEnabled();
  await expectWindowedFit(page);
});

test("9: an abort after the game was fullscreen ends with a visible #engine-error and no #fullscreen", async ({
  page,
}, info) => {
  await recordFullscreenEvents(page);
  await deferAbortIfNeeded(page);
  await prepareLauncher(page, info.outputPath(), ABORT_LATE);
  // The automatic start leaves the game windowed; the player presses the
  // button and the page is fullscreen before the engine aborts.
  await pressFullscreen(page);
  await expect.poll(() => fullscreenElementId(page), { timeout: WAIT }).toBe("screen");
  // Recorded from the init script while the page ran, never read from a poll
  // of the end state: this shows the game really was in fullscreen on #screen.
  await expect
    .poll(async () => (await fullscreenEvents(page)).includes("screen"), { timeout: WAIT })
    .toBe(true);

  await releaseDelayedTimers(page);
  await doneWhen(page, "error", 20_000);
  // The abort must leave fullscreen so the message stays readable, and the
  // button goes away with it.
  await expect.poll(() => fullscreenElementId(page), { timeout: WAIT }).toBeNull();
  await expect(page.locator("#error-panel")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeVisible();
  await expect(page.locator("#engine-error")).toContainText("late boom");
  await expect(page.locator("#fullscreen")).toBeHidden();

  // And the recorded session ended: the last fullscreenchange left fullscreen.
  await expect
    .poll(
      async () => {
        const events = await fullscreenEvents(page);
        return events.length === 0 ? "none" : events[events.length - 1];
      },
      { timeout: WAIT },
    )
    .toBeNull();
});

test("9: a fullscreen grant that lands after the abort also ends with no #fullscreen", async ({
  page,
}, info) => {
  // A browser that grants fullscreen only when the test releases it: the page
  // asks for #screen, the engine aborts while the request is still pending,
  // and the grant lands afterwards.
  await page.addInitScript(() => {
    const changes: (string | null)[] = [];
    (window as unknown as { __zhwpFullscreenEvents?: (string | null)[] }).__zhwpFullscreenEvents = changes;
    document.addEventListener(
      "fullscreenchange",
      () => {
        const element = document.fullscreenElement;
        changes.push(element === null ? null : element.id);
      },
      true,
    );

    // The grant itself is recorded when the browser delivers it, before the
    // page can react: a page that gives the fullscreen straight back may leave
    // no fullscreenchange that ever observes it.
    const grants: (string | null)[] = [];
    (window as unknown as { __zhwpFullscreenGrants?: (string | null)[] }).__zhwpFullscreenGrants = grants;

    const original = Element.prototype.requestFullscreen;
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: function (this: Element) {
        const element = this;
        const pending = window as unknown as {
          __zhwpRequestedElement?: string;
          __zhwpReleaseFullscreen?: () => Promise<void>;
        };
        pending.__zhwpRequestedElement = element.id;
        return new Promise<void>((resolve, reject) => {
          pending.__zhwpReleaseFullscreen = () => {
            const granted = original.call(element);
            granted.then(
              () => {
                const current = document.fullscreenElement;
                grants.push(current === null ? null : current.id);
                resolve();
              },
              reject,
            );
            return granted;
          };
        });
      },
    });
  });
  await deferAbortIfNeeded(page);
  await prepareLauncher(page, info.outputPath(), ABORT_LATE);
  await pressFullscreen(page);
  // The page asked the browser on #screen and is still waiting for the grant.
  await expect.poll(() => requestedElement(page), { timeout: WAIT }).toBe("screen");

  // The abort arrives first.
  await releaseDelayedTimers(page);
  await doneWhen(page, "error", 20_000);
  expect(await fullscreenElementId(page)).toBeNull();

  // Release the browser's grant now, after the abort: the page must give back
  // the fullscreen it just received.
  await page.evaluate(() => {
    const release = (window as unknown as { __zhwpReleaseFullscreen?: () => Promise<void> }).__zhwpReleaseFullscreen;
    if (release === undefined) throw new Error("the page never requested fullscreen");
    return release();
  });
  // The recorded grant proves the browser put #screen in fullscreen after the
  // abort; the page must give it back and end with the message readable and no
  // button offered.
  await expect
    .poll(async () => (await fullscreenGrants(page)).includes("screen"), { timeout: WAIT })
    .toBe(true);
  await expect.poll(() => fullscreenElementId(page), { timeout: WAIT }).toBeNull();
  await expect(page.locator("#error-panel")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeVisible();
  await expect(page.locator("#engine-error")).toContainText("late boom");
  await expect(page.locator("#fullscreen")).toBeHidden();
});
