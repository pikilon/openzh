import { test, expect } from "@playwright/test";

// Issue #18: elements the launcher hides must really be invisible.

test("progress bar and canvas are hidden on load", async ({ page }) => {
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await expect(page.locator("#import-progress")).toBeHidden();
  await expect(page.locator("#canvas")).toBeHidden();
});

test("any element with the hidden attribute is not displayed", async ({ page }) => {
  await page.goto("/app/index.html");
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[hidden]")]
      .filter((el) => getComputedStyle(el).display !== "none")
      .map((el) => el.id || el.tagName),
  );
  expect(shown).toEqual([]);
});
