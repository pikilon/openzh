import { test, expect, type Page } from "@playwright/test";

// Issue #192: support lives in the top bar, outside the hamburger menu, and
// opens a modal. The modal repeats the Red Line convention: suggestions and
// bug reports can be written in the PayPal message.

const SHELL = "/app/index.html";
const TIPS = [
  ["donate-tip-1", "https://paypal.me/pikilongeorgia/1"],
  ["donate-tip-2", "https://paypal.me/pikilongeorgia/2"],
  ["donate-tip-5", "https://paypal.me/pikilongeorgia/5"],
] as const;

async function openShell(page: Page): Promise<void> {
  await page.goto(SHELL);
  await expect(page.locator("#topbar")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
}

async function openDonate(page: Page): Promise<void> {
  await openShell(page);
  await page.locator("#donate").click();
  await expect(page.locator("#donate-dialog")).toHaveAttribute("open", "");
  await expect(page.locator("#donate-dialog")).toBeVisible();
}

async function activeId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

test("1: #donate is a top-bar icon button outside the menu, visible before play", async ({ page }) => {
  await openShell(page);

  const donate = page.locator("#topbar #donate");
  await expect(donate).toBeVisible();
  await expect(donate).toHaveCount(1);
  await expect(donate).toHaveClass(/icon-btn/);
  await expect(donate.locator("svg")).toHaveCount(1);
  await expect(donate).toHaveAttribute("aria-label", "Support OpenZH");
  await expect(donate).toHaveAttribute("title", "Support OpenZH");
  await expect(donate).toHaveAttribute("type", "button");

  // It is not inside the hamburger menu.
  await expect(page.locator("#menu #donate")).toHaveCount(0);
  // The old menu support row stays.
  await expect(page.locator("#menu #support")).toHaveCount(1);
});

test("2: clicking #donate opens the support modal with the free/optional message", async ({ page }) => {
  const paypalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("paypal.me")) paypalRequests.push(request.url());
  });

  await openDonate(page);
  const dialog = page.locator("#donate-dialog");
  await expect(dialog).toBeVisible();

  const text = await dialog.innerText();
  expect(text).toMatch(/free/i);
  expect(text).toMatch(/optional/i);
  expect(text).toMatch(/unlocks nothing/i);
  expect(text).toMatch(/suggestion/i);
  expect(text).toMatch(/bug report|bug/i);
  expect(text).toMatch(/message/i);
  expect(text).toMatch(/PayPal/i);

  // Opening the modal must not start a payment or a cross-origin request.
  expect(paypalRequests).toEqual([]);
});

test("3: the modal holds the same three tip destinations", async ({ page }) => {
  await openDonate(page);

  for (const [id, href] of TIPS) {
    const link = page.locator(`#donate-dialog #${id}`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    const rel = (await link.getAttribute("rel")) ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  }
});

test("4: the modal links the issue tracker for public suggestions", async ({ page }) => {
  await openDonate(page);

  const issues = page.locator("#donate-issues");
  await expect(issues).toHaveText(/issue/i);
  await expect(issues).toHaveAttribute("href", "https://github.com/pikilon/openzh/issues");
  await expect(issues).toHaveAttribute("target", "_blank");
  const rel = (await issues.getAttribute("rel")) ?? "";
  expect(rel).toContain("noopener");
  expect(rel).toContain("noreferrer");
});

test("5: #donate-close closes the modal and returns focus to #donate", async ({ page }) => {
  await openDonate(page);
  await page.locator("#donate-close").click();

  await expect(page.locator("#donate-dialog")).not.toHaveAttribute("open", "");
  await expect(page.locator("#donate-dialog")).toBeHidden();
  await expect.poll(() => activeId(page)).toBe("donate");
});

test("6: Escape closes the modal and returns focus to #donate", async ({ page }) => {
  await openDonate(page);
  await page.keyboard.press("Escape");

  await expect(page.locator("#donate-dialog")).not.toHaveAttribute("open", "");
  await expect(page.locator("#donate-dialog")).toBeHidden();
  await expect.poll(() => activeId(page)).toBe("donate");
});

test("7: the modal text names no EA trademark", async ({ page }) => {
  await openDonate(page);
  const text = await page.locator("#donate-dialog").innerText();
  expect(text).not.toMatch(/Command\s*&\s*Conquer/i);
  expect(text).not.toMatch(/Generals|Zero Hour/i);
});
