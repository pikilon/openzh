import { test, expect, type Page } from "@playwright/test";
import { installZip } from "./helpers/install-zip";

// Issue #159: the launcher adopts the visual language of the game's menus with
// CSS and inline SVG only. These tests read the page's computed style: the
// layout tokens, the decorated background, the cut panels, the reduced-motion
// fallback, the live regions and the fullscreen button. The fake engine
// (`module` query parameter) is only needed where the game has to start.

const SHELL = "/app/index.html";
const COUNTS_FAKE = "/harness/shell/counts.js";
// Waiting for the page's own states, never for a fixed delay.
const WAIT = 15_000;
const START_WAIT = 40_000;
// The shell's markup is in the document as soon as it loads.
const SHELL_WAIT = 5_000;

async function openShell(page: Page, module?: string): Promise<void> {
  const query = module === undefined ? "" : `?module=${encodeURIComponent(module)}`;
  await page.goto(`${SHELL}${query}`);
  await expect(page.locator("#topbar")).toBeVisible({ timeout: SHELL_WAIT });
}

async function expectState(page: Page, state: string, timeout = START_WAIT): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-state", state, { timeout });
}

async function startPlaying(page: Page, dir: string): Promise<void> {
  await openShell(page, COUNTS_FAKE);
  await expectState(page, "no-assets");
  await page.locator("#zip-input").setInputFiles(await installZip(dir));
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
}

// A computed colour is always rgb()/rgba() in the browser.
function rgba(value: string): [number, number, number, number] {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (match === null) throw new Error(`not a computed rgb colour: ${value}`);
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

test("16: #fullscreen is disabled before the game starts and enabled while playing", async ({ page }, info) => {
  await openShell(page, COUNTS_FAKE);
  await expectState(page, "no-assets", WAIT);

  const fullscreen = page.locator("#fullscreen");
  await expect(fullscreen).toBeVisible();
  await expect(fullscreen).toBeDisabled();

  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await expectState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(fullscreen).toBeEnabled();
});

test("16: #fullscreen is hidden when the browser has no Fullscreen API", async ({ page }) => {
  // A browser where the Fullscreen API is not a function at all.
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", { value: undefined, configurable: true });
  });

  await openShell(page);

  await expect(page.locator("#fullscreen")).toHaveCount(1);
  await expect(page.locator("#fullscreen")).toBeHidden();
});

test("16: clicking #fullscreen puts #screen in fullscreen and leaves #canvas focused", async ({ page }, info) => {
  await startPlaying(page, info.outputPath());

  const fullscreen = page.locator("#fullscreen");
  await expect(fullscreen).toBeEnabled();
  await fullscreen.click();

  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null), { timeout: WAIT })
    .toBe("screen");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id ?? null), { timeout: WAIT })
    .toBe("canvas");
});

test("19: body, title and loader type stay within the size limits", async ({ page }) => {
  await openShell(page);
  await expect(page.locator("#loader")).toBeVisible();

  const sizes = await page.evaluate(() => {
    const title = document.getElementById("title");
    const loader = document.getElementById("loader");
    if (title === null) throw new Error("missing #title");
    if (loader === null) throw new Error("missing #loader");
    const loaderFonts = [loader, ...loader.querySelectorAll("*")].map((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    return {
      body: Number.parseFloat(getComputedStyle(document.body).fontSize),
      title: Number.parseFloat(getComputedStyle(title).fontSize),
      loaderMax: Math.max(...loaderFonts),
    };
  });

  expect(sizes.body).toBeLessThanOrEqual(14);
  expect(sizes.title).toBeGreaterThanOrEqual(18);
  expect(sizes.title).toBeLessThanOrEqual(20);
  expect(sizes.loaderMax).toBeLessThanOrEqual(30);
});

test("20: the background layers, body colour and accent token are the shell's blue", async ({ page }) => {
  await openShell(page);
  await expect(page.locator("#loader")).toBeVisible();
  expect(await page.locator(".grid-layer").count()).toBeGreaterThanOrEqual(1);

  const values = await page.evaluate(() => {
    const grid = document.querySelector(".grid-layer");
    const root = getComputedStyle(document.documentElement);
    const token = root.getPropertyValue("--accent").trim();
    const probe = document.createElement("span");
    probe.style.color = token;
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      gridImage: grid === null ? "missing" : getComputedStyle(grid).backgroundImage,
      bodyColor: getComputedStyle(document.body).backgroundColor,
      token,
      tokenValid: token !== "" && CSS.supports("color", token),
      accent,
    };
  });

  // The blueprint grid is a real painted layer, not a flat colour.
  expect(values.gridImage).not.toBe("missing");
  expect(values.gridImage).not.toBe("none");

  // The body is never a pure black fill ...
  const body = rgba(values.bodyColor);
  const painted = body[3] > 0;
  expect(painted && body[0] === 0 && body[1] === 0 && body[2] === 0).toBe(false);
  // ... and the accent token resolves to a blue.
  expect(values.tokenValid).toBe(true);
  const accent = rgba(values.accent);
  expect(accent[2]).toBeGreaterThan(accent[0]);
  expect(accent[2]).toBeGreaterThan(accent[1]);
});

test("21: decorations animate, panels are cut and reduced motion removes animation and transition", async ({
  page,
}) => {
  await openShell(page);
  await expect(page.locator("#loader")).toBeVisible();

  const decorated = await page.evaluate(() => {
    const layers = [...document.querySelectorAll(".scanline, .grid-layer")];
    const panels = [...document.querySelectorAll(".panel")];
    return {
      layerAnimations: layers.map((element) => getComputedStyle(element).animationName),
      panelClips: panels.map((element) => getComputedStyle(element).clipPath),
    };
  });
  // At least one decorative layer moves ...
  expect(decorated.layerAnimations.some((name) => name !== "none" && name !== "")).toBe(true);
  // ... and the panels have a cut-corner clip path.
  expect(decorated.panelClips.some((clip) => clip !== "none" && clip !== "")).toBe(true);

  // With the player asking for less motion, nothing animates or transitions.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => {
    const selectors = [".scanline", ".grid-layer", ".panel", ".btn", ".icon-btn", "#loader", "#loading"];
    const elements = [
      ...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)])),
    ];
    return {
      animations: elements.map((element) => getComputedStyle(element).animationName),
      transitions: elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          properties: style.transitionProperty.split(",").map((part) => part.trim()),
          durations: style.transitionDuration
            .split(",")
            .map((part) => Number.parseFloat(part) || 0),
        };
      }),
      running: document.getAnimations().length,
    };
  });

  expect(reduced.running).toBe(0);
  for (const name of reduced.animations) expect(name).toBe("none");
  for (const transition of reduced.transitions) {
    const off =
      transition.properties.every((property) => property === "none") ||
      transition.durations.every((duration) => duration === 0);
    expect(off).toBe(true);
  }
});

test("22: #status is a status live region and the error messages are alerts", async ({ page }) => {
  await openShell(page);

  await expect(page.locator("#status")).toHaveCount(1);
  await expect(page.locator("#status")).toHaveAttribute("role", "status");

  for (const id of ["import-error", "unsupported", "engine-error"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
    await expect(page.locator(`#${id}`)).toHaveAttribute("role", "alert");
  }
});

test("26: loading the page makes no request outside the dev server origin", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto(SHELL, { waitUntil: "networkidle" });
  await expect(page.locator("#topbar")).toBeVisible({ timeout: SHELL_WAIT });
  await expect(page.locator("#loader")).toBeVisible();
  await expectState(page, "no-assets", WAIT);

  const origin = new URL(page.url()).origin;
  const external = requests.filter((url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.origin !== origin;
  });
  expect(external).toEqual([]);
});
