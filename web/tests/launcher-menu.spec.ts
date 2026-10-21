import { test, expect, type Page } from "@playwright/test";
import { installZip } from "./helpers/install-zip";

// Issue #159: the launcher's modal menu holds the game-data management and the
// player's audio choice. The menu is a native <dialog> opened by #menu-button;
// its close routes return focus to that button. #reload only ever deletes the
// stored archives after #reload-confirm. The recording mute fake (`module`
// query parameter) reports every value the page sends to the engine.

const SHELL = "/app/index.html";
const COUNTS_FAKE = "/harness/shell/counts.js";
const MUTE_FAKE = "/harness/mute/records.js";
// Waiting for the page's own states, never for a fixed delay.
const WAIT = 15_000;
const START_WAIT = 40_000;
// The shell's markup is in the document as soon as it loads.
const SHELL_WAIT = 5_000;

type MenuWindow = Window &
  typeof globalThis & {
    __muteCalls?: number[];
    __fakeEngineLoaded?: string;
  };

async function openShell(page: Page, module?: string): Promise<void> {
  const query = module === undefined ? "" : `?module=${encodeURIComponent(module)}`;
  await page.goto(`${SHELL}${query}`);
  await expect(page.locator("#topbar")).toBeVisible({ timeout: SHELL_WAIT });
}

async function expectShell(page: Page): Promise<void> {
  await expect(page.locator("#topbar")).toBeVisible({ timeout: SHELL_WAIT });
}

async function expectState(page: Page, state: string, timeout = START_WAIT): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-state", state, { timeout });
}

// Imports a complete synthetic install from a settled loader; with a fake
// engine the automatic start ends in playing and the canvas.
async function startPlaying(page: Page, dir: string, module: string = COUNTS_FAKE): Promise<void> {
  await openShell(page, module);
  await expectState(page, "no-assets");
  await page.locator("#zip-input").setInputFiles(await installZip(dir));
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
}

// Opens the menu with a trusted click and waits for the dialog's own state.
async function openMenu(page: Page): Promise<void> {
  const button = page.locator("#menu-button");
  await button.click();
  await expect(page.locator("#menu")).toHaveAttribute("open", "");
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

async function dialogIsClosed(page: Page): Promise<void> {
  await expect(page.locator("#menu")).not.toHaveAttribute("open", "");
  await expect(page.locator("#menu")).toBeHidden();
  await expect(page.locator("#menu-button")).toHaveAttribute("aria-expanded", "false");
}

async function activeElementId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return "";
    return active.id !== "" ? active.id : active.tagName;
  });
}

async function focusIsInsideMenu(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const menu = document.getElementById("menu");
    const active = document.activeElement;
    return menu !== null && active !== null && menu.contains(active);
  });
}

// A click whose target is the dialog itself: the backdrop of the modal. The
// point lies left of the right-side .menu-panel, where the dialog's backdrop
// receives the click; the page must close on that target and nothing else.
async function clickMenuBackdrop(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const menu = document.getElementById("menu");
    if (menu === null) throw new Error("missing #menu");
    const panel = menu.matches(".menu-panel") ? menu : menu.querySelector(".menu-panel");
    const rect = panel === null ? menu.getBoundingClientRect() : panel.getBoundingClientRect();
    return {
      x: rect.left > 8 ? Math.floor(rect.left / 2) : 4,
      y: Math.floor(window.innerHeight / 2),
    };
  });
  await page.mouse.click(point.x, point.y);
}

async function muteCalls(page: Page): Promise<number[]> {
  return page.evaluate(() => [...((window as unknown as MenuWindow).__muteCalls ?? [])]);
}

async function lastMuteCall(page: Page): Promise<number | undefined> {
  const calls = await muteCalls(page);
  return calls.length === 0 ? undefined : calls[calls.length - 1];
}

async function firstMuteCall(page: Page): Promise<number | undefined> {
  return (await muteCalls(page))[0];
}

async function waitForLastMuteCall(page: Page, value: number): Promise<void> {
  await expect.poll(() => lastMuteCall(page), { timeout: WAIT }).toBe(value);
}

// Waits for a call the test's action caused: the array must have grown since
// `since` and the new last value is the one the criterion names.
async function waitForNewMuteCall(page: Page, since: number, value: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const calls = await muteCalls(page);
        return calls.length > since ? calls[calls.length - 1] : undefined;
      },
      { timeout: WAIT },
    )
    .toBe(value);
}

async function storedMuted(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("openzh.muted"));
}

// The recording fake creates the array when its factory runs; the page applies
// the mute once it holds the engine object. Waiting for that first value keeps
// the later blur/focus steps deterministic.
async function waitForMuteEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => Array.isArray((window as unknown as MenuWindow).__muteCalls), null, {
    timeout: WAIT,
  });
  await expect.poll(async () => (await muteCalls(page)).length, { timeout: WAIT }).toBeGreaterThanOrEqual(1);
}

test("8: #menu-button opens #menu, moves focus inside and #menu-close returns focus", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);
  const button = page.locator("#menu-button");
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await button.click();

  const menu = page.locator("#menu");
  await expect(menu).toHaveAttribute("open", "");
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(button).toHaveAttribute("aria-controls", "menu");
  await expect.poll(() => focusIsInsideMenu(page), { timeout: WAIT }).toBe(true);

  await page.locator("#menu-close").click();
  await dialogIsClosed(page);
  await expect.poll(() => activeElementId(page), { timeout: WAIT }).toBe("menu-button");
});

test("8: Escape closes #menu and returns focus to #menu-button", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);
  await openMenu(page);
  await expect.poll(() => focusIsInsideMenu(page), { timeout: WAIT }).toBe(true);

  await page.keyboard.press("Escape");

  await dialogIsClosed(page);
  await expect.poll(() => activeElementId(page), { timeout: WAIT }).toBe("menu-button");
});

test("8: a click on the backdrop closes #menu and returns focus to #menu-button", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);
  await openMenu(page);

  await clickMenuBackdrop(page);

  await dialogIsClosed(page);
  await expect.poll(() => activeElementId(page), { timeout: WAIT }).toBe("menu-button");
});

test("9: #menu shows the stored archive count and the storage estimate", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");

  await openMenu(page);

  await expect(page.locator("#menu-stored")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#menu-storage")).toContainText("Storage:");
  await expect(page.locator("#reload")).toBeEnabled();
});

test("9: #reload is disabled while no archives are stored", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  await openMenu(page);

  await expect(page.locator("#menu-stored")).toHaveText("Stored: 0 archives");
  await expect(page.locator("#reload")).toBeDisabled();
});

test("10: #reload opens a confirmation with the archive count and Cancel keeps the data", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await openMenu(page);

  await page.locator("#reload").click();

  const dialog = page.locator("#reload-dialog");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog).toBeVisible();
  const warning = page.locator("#reload-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(/\b4\b/);
  await expect(warning).toContainText(/archive/i);
  await expect(warning).toContainText(/delet/i);
  // Opening the confirmation deletes nothing.
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");

  await page.locator("#reload-cancel").click();

  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(dialog).toBeHidden();
  // Cancel kept every stored archive and the running game.
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("body")).toHaveAttribute("data-state", "playing");
  await expect(page.locator("#canvas")).toBeVisible();
});

test("11: confirming #reload-confirm clears the archives and reloads to the loader", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await openMenu(page);
  await page.locator("#reload").click();
  await expect(page.locator("#reload-dialog")).toHaveAttribute("open", "");
  // The data is only deleted by the confirmation, never by opening the dialog.
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");

  const reloaded = page.waitForEvent("load");
  await page.locator("#reload-confirm").click();
  await reloaded;

  await expectShell(page);
  await expectState(page, "no-assets", START_WAIT);
  await expect(page.locator("#loader")).toBeVisible();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
  await expect(page.locator("#canvas")).toBeHidden();
});

// The game starts without a gesture, so the browser blocks sound and the
// first #mute press only turns it on (owner, 2026-10-19). A click on the title
// is the player's first gesture in the tests that exercise muting itself.
async function allowSound(page: Page): Promise<void> {
  await page.locator("#title").click();
  await expect(page.locator("#mute")).not.toHaveAttribute("data-blocked", "");
}

test("14: with sound still blocked, the first #mute press turns sound on and never mutes", async ({ page }, info) => {
  await startPlaying(page, info.outputPath(), MUTE_FAKE);
  await waitForMuteEngine(page);
  const mute = page.locator("#mute");
  await expect(mute).toHaveAttribute("data-blocked", "");
  await expect(mute).toHaveAttribute("aria-label", /blocked by the browser/);

  await mute.click();
  await waitForLastMuteCall(page, 0);
  await expect(mute).not.toHaveAttribute("data-blocked", "");
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await expect(mute).toHaveAttribute("aria-label", "Mute game audio");
  expect(await storedMuted(page)).not.toBe("1");
});

test("14: #mute toggles the engine and persists the choice", async ({ page }, info) => {
  await startPlaying(page, info.outputPath(), MUTE_FAKE);
  await waitForMuteEngine(page);
  await allowSound(page);
  const mute = page.locator("#mute");
  await expect(mute).toHaveAttribute("aria-pressed", "false");

  await mute.click();
  await waitForLastMuteCall(page, 1);
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  expect(await storedMuted(page)).toBe("1");

  await mute.click();
  await waitForLastMuteCall(page, 0);
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  expect(await storedMuted(page)).toBe("0");
});

test("14: after a reload the stored mute is pressed and the engine's first value is 1", async ({ page }, info) => {
  await startPlaying(page, info.outputPath(), MUTE_FAKE);
  await waitForMuteEngine(page);
  await allowSound(page);
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "false");

  await page.locator("#mute").click();
  await waitForLastMuteCall(page, 1);
  expect(await storedMuted(page)).toBe("1");

  // The next load finds the archives stored and the choice saved: it starts
  // automatically and the first value the engine receives is the user's mute.
  await page.reload();

  await expectShell(page);
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
  await expect.poll(() => firstMuteCall(page), { timeout: WAIT }).toBe(1);
});

test("15: blur and focus mute and unmute the engine, and stay muted when the user muted", async ({
  page,
}, info) => {
  await startPlaying(page, info.outputPath(), MUTE_FAKE);
  await waitForMuteEngine(page);
  await allowSound(page);

  // User unmuted, page focused: losing focus mutes and getting it back unmutes.
  let calls = await muteCalls(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await waitForNewMuteCall(page, calls.length, 1);

  calls = await muteCalls(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await waitForNewMuteCall(page, calls.length, 0);

  // The user's own mute wins over focus: both changes stay at 1.
  await page.locator("#mute").click();
  await waitForLastMuteCall(page, 1);

  calls = await muteCalls(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await waitForNewMuteCall(page, calls.length, 1);

  calls = await muteCalls(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await waitForNewMuteCall(page, calls.length, 1);
});

test("28: #about opens #about-dialog with the app details and closes to #about", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);
  await openMenu(page);

  // The menu's About action, not the top bar, opens the dialog.
  const about = page.locator("#about");
  await expect(about).toBeVisible();
  await about.click();

  const dialog = page.locator("#about-dialog");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog).toBeVisible();

  await expect(page.locator("#about-name")).toContainText("OpenZH");
  const version = page.locator("#about-version");
  await expect(version).toHaveCount(1);
  expect((await version.innerText()).trim()).not.toBe("");
  await expect(page.locator("#about-license")).toContainText("GPL-3.0-or-later");

  const source = page.locator("#about-source");
  await expect(source).toHaveAttribute("href", "https://github.com/pikilon/openzh");
  await expect(source).toHaveAttribute("target", "_blank");
  const sourceRel = (await source.getAttribute("rel")) ?? "";
  expect(sourceRel).toContain("noopener");
  expect(sourceRel).toContain("noreferrer");

  const disclaimer = page.locator("#about-disclaimer");
  await expect(disclaimer).toContainText(/unofficial/i);
  await expect(disclaimer).toContainText(/suppl/i);
  await expect(disclaimer).toContainText(/files/i);

  await page.locator("#about-close").click();

  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(dialog).toBeHidden();
  await expect.poll(() => activeElementId(page), { timeout: WAIT }).toBe("about");
});

test("29: #support holds the three tip links with their exact destinations", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);
  await openMenu(page);

  await expect(page.locator("#support")).toBeVisible();
  const tips = [
    ["tip-1", "https://paypal.me/pikilongeorgia/1"],
    ["tip-2", "https://paypal.me/pikilongeorgia/2"],
    ["tip-5", "https://paypal.me/pikilongeorgia/5"],
  ] as const;
  for (const [id, href] of tips) {
    const link = page.locator(`#support #${id}`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    const rel = (await link.getAttribute("rel")) ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  }
  // The test only reads the attributes: none of the links is activated, so
  // the page never leaves the dev server.
  expect(new URL(page.url()).pathname).toBe("/app/index.html");
});

test("30: the title, headings and menu/about text name no EA trademark", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);

  const texts: string[] = [await page.title(), ...(await page.locator("h1, h2").allInnerTexts())];

  await openMenu(page);
  texts.push(await page.locator("#menu").innerText());

  await page.locator("#about").click();
  await expect(page.locator("#about-dialog")).toHaveAttribute("open", "");
  texts.push(await page.locator("#about-dialog").innerText());

  for (const text of texts) {
    expect(text).not.toMatch(/Command\s*&\s*Conquer/i);
    expect(text).not.toMatch(/Generals|Zero Hour/i);
  }
});

// Issue #201: the hamburger menu owns a plain page reload. Unlike #reload,
// which deletes the stored archives, this action keeps all stored data.

test("201: the hamburger menu holds an enabled Refresh page button", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);
  // The owner asked for the menu, not the top bar.
  await expect(page.locator("#topbar #refresh-page")).toHaveCount(0);

  await openMenu(page);

  const refresh = page.locator("#menu #refresh-page");
  await expect(refresh).toHaveCount(1);
  await expect(refresh).toBeVisible();
  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveAttribute("type", "button");
  await expect(refresh).toHaveText("Refresh page");
  await expect(refresh).toHaveAccessibleName("Refresh page");
});

test("201: #refresh-page reloads the page", async ({ page }) => {
  await openShell(page);
  await expectState(page, "no-assets", WAIT);
  await openMenu(page);
  await page.evaluate(() => {
    (window as unknown as { __refreshMarker?: boolean }).__refreshMarker = true;
  });

  const loaded = page.waitForEvent("load");
  await page.locator("#refresh-page").click();
  await loaded;

  await expectShell(page);
  await expectState(page, "no-assets", START_WAIT);
  const marker = await page.evaluate(
    () => (window as unknown as { __refreshMarker?: boolean }).__refreshMarker,
  );
  expect(marker).toBeUndefined();
});

test("201: #refresh-page keeps the stored game data and returns to the game", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await openMenu(page);

  const loaded = page.waitForEvent("load");
  await page.locator("#refresh-page").click();
  await loaded;

  await expectShell(page);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
});
