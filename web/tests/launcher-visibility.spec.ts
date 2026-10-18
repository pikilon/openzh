import { test, expect } from "@playwright/test";
import { openLauncher } from "./helpers/launcher";

// Issue #18: elements the launcher hides must really be invisible.

test("progress bar and canvas are hidden on load", async ({ page }) => {
  await openLauncher(page);
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
  await expect(page.locator("#loader")).toBeVisible();
  await expect(page.locator("#import-progress")).toBeHidden();
  await expect(page.locator("#canvas")).toBeHidden();
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#error-panel")).toBeHidden();
});

test("any element with the hidden attribute is not displayed", async ({ page }) => {
  await openLauncher(page);
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[hidden]")]
      .filter((el) => getComputedStyle(el).display !== "none")
      .map((el) => el.id || el.tagName),
  );
  expect(shown).toEqual([]);
});
