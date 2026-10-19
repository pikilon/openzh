import { test, expect, type Page } from "@playwright/test";
import { installZip } from "./helpers/install-zip";

// Issue #159: the launcher is a game-styled shell. The top bar is the only
// chrome above the game, the engine starts by itself as soon as the required
// archives are stored, and a failed start is retried from the stored archives.
// The fake engine (`module` query parameter) counts its own factory calls; the
// synthetic install is the only game data involved.

const SHELL = "/app/index.html";
const COUNTS_FAKE = "/harness/shell/counts.js";
const FAIL_ONCE_FAKE = "/harness/shell/fail-once.js";
const REJECTS_FAKE = "/harness/errors/rejects.js";
// Waiting for the page's own states, never for a fixed delay.
const WAIT = 15_000;
const START_WAIT = 40_000;
// The shell's markup is in the document as soon as it loads.
const SHELL_WAIT = 5_000;

type ShellWindow = Window &
  typeof globalThis & {
    __factoryCalls?: number;
    __fakeEngineLoaded?: string;
  };

// Opens the launcher and first asserts the new shell: on the old page this is
// what makes every test in this file fail, for the missing top bar.
async function openShell(page: Page, module?: string): Promise<void> {
  const query = module === undefined ? "" : `?module=${encodeURIComponent(module)}`;
  await page.goto(`${SHELL}${query}`);
  await expectShell(page);
}

// The shell contract every state keeps: the top bar is always there.
async function expectShell(page: Page): Promise<void> {
  await expect(page.locator("#topbar")).toBeVisible({ timeout: SHELL_WAIT });
}

async function expectState(page: Page, state: string, timeout = START_WAIT): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-state", state, { timeout });
}

// Picks a complete synthetic install (the four required archives) from a page
// that has finished reading storage, so the change event has its listener.
async function chooseInstall(page: Page, dir: string): Promise<void> {
  await expectState(page, "no-assets");
  await page.locator("#zip-input").setInputFiles(await installZip(dir));
}

async function factoryCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as ShellWindow).__factoryCalls ?? 0);
}

test("1: the top bar holds only the title and four icon buttons", async ({ page }) => {
  await openShell(page);
  const topbar = page.locator("#topbar");

  const height = await topbar.evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(0);
  expect(height).toBeLessThanOrEqual(64);

  await expect(page.locator("#title")).toBeVisible();
  await expect(page.locator("#title")).toHaveText("OpenZH");

  // Three icon-only buttons, each with an inline SVG and both labels.
  for (const id of ["donate", "fullscreen", "mute", "menu-button"]) {
    const button = page.locator(`#${id}`);
    await expect(button).toBeVisible();
    expect(await button.locator("svg").count()).toBeGreaterThanOrEqual(1);
    await expect(button).toHaveAttribute("aria-label", /\S/);
    await expect(button).toHaveAttribute("title", /\S/);
  }
  expect(await page.locator("#topbar img").count()).toBe(0);

  // Nothing else is visible in the top bar: no other control and no text
  // outside #title (the labels of the icon buttons live in aria-label/title).
  const visibleControls = await topbar.evaluate((element) =>
    [
      ...element.querySelectorAll(
        "button, input, select, textarea, a, progress, [role='button'], [role='link'], [role='switch']",
      ),
    ]
      .filter((item) => {
        const style = window.getComputedStyle(item);
        const rect = item.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((item) => item.id),
  );
  expect(visibleControls.sort()).toEqual(["donate", "fullscreen", "menu-button", "mute"]);

  const strayText = await topbar.evaluate((element) => {
    const title = document.getElementById("title");
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if ((node.textContent ?? "").trim() === "") continue;
      if (title !== null && title.contains(node)) continue;
      const parent = node.parentElement;
      // An SVG <title> is accessibility metadata, never rendered text.
      if (parent !== null && parent.closest("svg") !== null) continue;
      parts.push((node.textContent ?? "").trim());
    }
    return parts;
  });
  expect(strayText).toEqual([]);

  // Title first, then the buttons in contract order.
  const order = await topbar.evaluate((element) =>
    [...element.querySelectorAll("#title, #donate, #fullscreen, #mute, #menu-button")].map((item) => item.id),
  );
  expect(order).toEqual(["title", "donate", "fullscreen", "mute", "menu-button"]);
});

test("2: with no stored archives the loader is shown and the playing elements are hidden", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);

  await expect(page.locator("#loader")).toBeVisible();
  // The game view, its loading overlay and the error panel are in the page but
  // hidden, never removed.
  for (const id of ["canvas", "loading", "error-panel"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
    await expect(page.locator(`#${id}`)).toBeHidden();
  }
  expect(await page.locator("#play").count()).toBe(0);
});

test("3: stored required archives make a page load start the engine and show the canvas without a click", async ({
  page,
}, info) => {
  await openShell(page, COUNTS_FAKE);
  // The first load imports the synthetic install; the import auto-starts it.
  await chooseInstall(page, info.outputPath());
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();

  // The next page load finds the four archives stored and starts by itself.
  await page.reload();
  await expectShell(page);
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  expect(await page.evaluate(() => (window as unknown as ShellWindow).__fakeEngineLoaded)).toBe("shell-counts");
});

test("4: importing a complete ZIP starts the engine without a click", async ({ page }, info) => {
  await openShell(page, COUNTS_FAKE);
  await chooseInstall(page, info.outputPath());

  await expect(page.locator("#status")).toContainText("Ready", { timeout: START_WAIT });
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
  expect(await factoryCalls(page)).toBe(1);
});

test("5: a page load that auto-starts the engine invokes the factory exactly once", async ({ page }, info) => {
  await openShell(page, COUNTS_FAKE);
  await chooseInstall(page, info.outputPath());
  await expectState(page, "playing");

  // A new page load with the archives already stored starts on its own. The
  // fake counts factory calls in the fresh window: the page must ask once.
  await page.reload();
  await expectShell(page);
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
  expect(await factoryCalls(page)).toBe(1);
});

test("6: a rejecting engine shows the error panel and keeps the menu button usable", async ({ page }, info) => {
  await openShell(page, REJECTS_FAKE);
  await chooseInstall(page, info.outputPath());

  await expectState(page, "error", START_WAIT);
  await expect(page.locator("#error-panel")).toBeVisible();
  await expect(page.locator("#engine-error")).toBeVisible();
  await expect(page.locator("#engine-error")).toContainText("nope");
  await expect(page.locator("#loading")).toBeHidden();

  // The failure must not lock the player out of the shell's menu.
  const menuButton = page.locator("#menu-button");
  await expect(menuButton).toBeVisible();
  await expect(menuButton).toBeEnabled();
  await menuButton.click();
  await expect(page.locator("#menu")).toHaveAttribute("open", "");
});

test("7: retry starts a second engine attempt and leaves the error state", async ({ page }, info) => {
  await openShell(page, FAIL_ONCE_FAKE);
  await chooseInstall(page, info.outputPath());

  await expectState(page, "error", START_WAIT);
  await expect(page.locator("#retry")).toBeVisible();
  expect(await factoryCalls(page)).toBe(1);

  await page.locator("#retry").click();

  await expect(page.locator("body")).not.toHaveAttribute("data-state", "error", { timeout: WAIT });
  await expectState(page, "playing", START_WAIT);
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#error-panel")).toBeHidden();
  // The retry came from the stored archives and called the factory again.
  expect(await factoryCalls(page)).toBe(2);
});

test("23: the page title and headings name no EA trademark", async ({ page }) => {
  await openShell(page);
  const title = await page.title();
  const headings = await page.locator("h1, h2").allInnerTexts();
  for (const text of [title, ...headings]) {
    expect(text).not.toMatch(/Command\s*&\s*Conquer/i);
    expect(text).not.toMatch(/Generals|Zero Hour/i);
  }
});

test("27: no play, clear or play-controls element exists", async ({ page }) => {
  await openShell(page);
  for (const id of ["play", "clear", "play-controls"]) {
    expect(await page.locator(`#${id}`).count()).toBe(0);
  }
});
