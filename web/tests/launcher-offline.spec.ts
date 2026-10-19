import { test, expect } from "@playwright/test";

// The top bar shows an Offline badge only while the browser has no connection.

test("the offline badge follows the browser's connection", async ({ page, context }) => {
  await page.goto("/app/index.html");
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
  const badge = page.locator("#topbar #offline");
  await expect(badge).toBeHidden();

  await context.setOffline(true);
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("Offline");

  await context.setOffline(false);
  await expect(badge).toBeHidden();
});
