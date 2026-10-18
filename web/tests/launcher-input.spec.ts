import { test, expect, type Page } from "@playwright/test";
import {
  activeElementId,
  CANVAS_FIT,
  importInstall,
  openLauncher,
  RESOLVES,
} from "./helpers/launcher";

// Issue #28: the canvas keeps the right mouse button and the keyboard. The
// context menu must never open over the game, and after the automatic engine
// start (#159) the keys must reach the canvas without an extra click.

// Dispatches a cancelable contextmenu event on the target and reports whether
// the page cancelled the browser's menu.
async function contextMenuPrevented(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (element === null) throw new Error(`missing ${target}`);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, selector);
}

test('1: #canvas has the attribute tabindex="0"', async ({ page }) => {
  await openLauncher(page);
  await expect(page.locator("#canvas")).toHaveAttribute("tabindex", "0");
});

test("2: a contextmenu event on the hidden #canvas is cancelled", async ({ page }) => {
  await openLauncher(page);
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
  await expect(page.locator("#canvas")).toBeHidden();
  expect(await contextMenuPrevented(page, "#canvas")).toBe(true);
});

test("2: a contextmenu event on the visible #canvas is cancelled", async ({ page }, info) => {
  await openLauncher(page, CANVAS_FIT);
  await importInstall(page, info.outputPath());
  await expect(page.locator("#canvas")).toBeVisible();
  expect(await contextMenuPrevented(page, "#canvas")).toBe(true);
});

test("3: a contextmenu event elsewhere on the page is not cancelled", async ({ page }) => {
  await openLauncher(page);
  expect(await contextMenuPrevented(page, "body")).toBe(false);
});

test("4: the automatic start leaves #canvas focused", async ({ page }, info) => {
  await openLauncher(page, RESOLVES);
  await importInstall(page, info.outputPath());

  // The game keeps the keyboard (#28): the page focuses the canvas when the
  // engine resolves, with no click of its own.
  await expect.poll(() => activeElementId(page)).toBe("canvas");
  await expect(page.locator("#canvas")).toBeVisible();
});
