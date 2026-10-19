import { test, expect, type Page } from "@playwright/test";

// Issue #191: the About dialog explains the project instead of only listing
// three facts. The item is text and layout only: no engine and no game data.

const SHELL = "/app/index.html";

async function openAbout(page: Page, viewport = { width: 1280, height: 800 }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(SHELL);
  await expect(page.locator("#topbar")).toBeVisible();
  await page.locator("#menu-button").click();
  await expect(page.locator("#menu")).toHaveAttribute("open", "");
  await page.locator("#about").click();
  await expect(page.locator("#about-dialog")).toHaveAttribute("open", "");
  await expect(page.locator("#about-dialog")).toBeVisible();
}

function aboutText(page: Page): Promise<string> {
  return page.locator("#about-dialog").innerText();
}

test("1: About explains the browser port, the source release and the renderer", async ({ page }) => {
  await openAbout(page);
  const text = await aboutText(page);

  expect(text).toMatch(/browser port/i);
  expect(text).toMatch(/2003/);
  expect(text).toMatch(/source release/i);
  expect(text).toMatch(/WebAssembly/i);
  expect(text).toMatch(/WebGPU/i);

  // The explanation lives outside the fact grid, not in a single line.
  const paragraphs = page.locator("#about-dialog .about-lede, #about-dialog .about-sections p");
  expect(await paragraphs.count()).toBeGreaterThanOrEqual(4);
  const lengths = await paragraphs.evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? "").trim().length),
  );
  expect(lengths.reduce((total, length) => total + length, 0)).toBeGreaterThan(400);
});

test("2: About says the player's files stay in the browser and are never uploaded", async ({ page }) => {
  await openAbout(page);
  const text = await aboutText(page);

  expect(text).toMatch(/game data ZIP files/i);
  expect(text).toMatch(/this browser's private storage/i);
  expect(text).toMatch(/never uploaded/i);
  expect(text).toMatch(/included in this project/i);
});

test("3: About states the project is unofficial and the player supplies the game data", async ({
  page,
}) => {
  await openAbout(page);
  const text = await aboutText(page);

  expect(text).toMatch(/unofficial/i);
  expect(text).toMatch(/not affiliated with or endorsed by Electronic Arts/i);
  expect(text).toMatch(/supply your own copy/i);
  expect(text).toMatch(/belongs to its owners/i);
});

test("4: About describes the current scope and the rough edges", async ({ page }) => {
  await openAbout(page);
  const text = await aboutText(page);

  expect(text).toMatch(/skirmish/i);
  expect(text).toMatch(/campaign/i);
  expect(text).toMatch(/rough edges/i);
  expect(text).toMatch(/issue tracker/i);
});

test("5: the existing facts and both GitHub links are present", async ({ page }) => {
  await openAbout(page);

  await expect(page.locator("#about-name")).toHaveText("OpenZH");
  await expect(page.locator("#about-version")).toHaveText(/\S+/);
  await expect(page.locator("#about-license")).toHaveText("GPL-3.0-or-later");

  const source = page.locator("#about-source");
  await expect(source).toHaveAttribute("href", "https://github.com/pikilon/openzh");
  await expect(source).toHaveAttribute("target", "_blank");
  const sourceRel = (await source.getAttribute("rel")) ?? "";
  expect(sourceRel).toContain("noopener");
  expect(sourceRel).toContain("noreferrer");

  const issues = page.locator("#about-issues");
  await expect(issues).toHaveText(/problem|suggest/i);
  await expect(issues).toHaveAttribute("href", "https://github.com/pikilon/openzh/issues");
  await expect(issues).toHaveAttribute("target", "_blank");
  const issuesRel = (await issues.getAttribute("rel")) ?? "";
  expect(issuesRel).toContain("noopener");
  expect(issuesRel).toContain("noreferrer");

  const disclaimer = page.locator("#about-disclaimer");
  await expect(disclaimer).toContainText(/unofficial/i);
  await expect(disclaimer).toContainText(/suppl/i);
  await expect(disclaimer).toContainText(/files/i);
});

test("6: on a phone the dialog fits, scrolls and closes back to #about", async ({ page }) => {
  await openAbout(page, { width: 375, height: 812 });

  const metrics = await page.evaluate(() => {
    const dialog = document.getElementById("about-dialog") as HTMLDialogElement;
    const rect = dialog.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: dialog.scrollWidth,
      clientWidth: dialog.clientWidth,
    };
  });

  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.innerHeight);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

  // The close button is reachable: the dialog scrolls to it if needed.
  await expect(page.locator("#about-close")).toBeVisible();
  await page.locator("#about-close").click();
  await expect(page.locator("#about-dialog")).not.toHaveAttribute("open", "");
  await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? null)).toBe("about");
});

test("7: the About text names no EA trademark", async ({ page }) => {
  await openAbout(page);
  const text = await aboutText(page);
  expect(text).not.toMatch(/Command\s*&\s*Conquer/i);
  expect(text).not.toMatch(/Generals|Zero Hour/i);
});
