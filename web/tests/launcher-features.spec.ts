import { test, expect, type Page } from "@playwright/test";
import {
  clearStored,
  importInstall,
  launcherUrl,
  RESOLVES,
  waitForState,
} from "./helpers/launcher";
import { installZip } from "./helpers/install-zip";

// Issue #30: before a player spends minutes importing several GB, the launcher
// must name the browser features it needs: WebGPU, cross-origin isolation (for
// SharedArrayBuffer) and OPFS. Element ids are part of the page's contract.
// Issue #159: with a feature missing the page is `unsupported`, the picker is
// disabled and the engine never starts, even with a stored install.

type MissingFeature = "gpu" | "isolation" | "opfs";

// Overrides the page's environment before any page script runs, which is the
// only way to simulate a browser that lacks these features in Brave. The store
// is reset first, with the real environment, so the harness can reach OPFS.
async function openLauncher(
  page: Page,
  missing: MissingFeature[] = [],
  module?: string,
): Promise<void> {
  await clearStored(page);
  await page.addInitScript((features: MissingFeature[]) => {
    if (features.includes("gpu")) {
      Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    }
    if (features.includes("isolation")) {
      Object.defineProperty(window, "crossOriginIsolated", { value: false, configurable: true });
    }
    if (features.includes("opfs")) {
      Object.defineProperty(navigator.storage, "getDirectory", { value: undefined, configurable: true });
    }
  }, missing);
  await page.goto(launcherUrl(module));
  await expect(page.locator("#stored-summary")).toHaveText(/^Stored: \d+ archives$/);
  await waitForState(page, missing.length > 0 ? "unsupported" : "no-assets");
}

test("1: with every feature present, #unsupported stays hidden and import starts the game", async ({
  page,
}, info) => {
  await openLauncher(page, [], RESOLVES);

  const unsupported = page.locator("#loader #unsupported");
  await expect(unsupported).toHaveCount(1);
  await expect(unsupported).toHaveAttribute("role", "alert");
  await expect(unsupported).toBeHidden();

  await expect(page.locator("#zip-input")).toBeEnabled();
  await importInstall(page, info.outputPath());
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(unsupported).toBeHidden();
});

test("2: without navigator.gpu, #unsupported is visible and contains WebGPU", async ({ page }) => {
  await openLauncher(page, ["gpu"]);

  const unsupported = page.locator("#unsupported");
  await expect(unsupported).toBeVisible();
  await expect(unsupported).toContainText("WebGPU");
});

test("3: without navigator.storage.getDirectory, #unsupported contains Origin private file system", async ({
  page,
}) => {
  await openLauncher(page, ["opfs"]);

  const unsupported = page.locator("#unsupported");
  await expect(unsupported).toBeVisible();
  await expect(unsupported).toContainText("Origin private file system");
});

test("4: when a feature is missing, #zip-input is disabled and the engine never starts", async ({
  page,
}, info) => {
  // Store a complete install first: after the reload it would start the engine
  // if the launcher ignored the missing feature.
  await openLauncher(page, [], RESOLVES);
  await importInstall(page, info.outputPath());
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");

  // A start would fetch the module the query parameter selects; count those
  // requests across the reload.
  let moduleRequests = 0;
  await page.route(`**${RESOLVES}`, async (route) => {
    moduleRequests += 1;
    await route.continue();
  });
  moduleRequests = 0;

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
  });
  await page.goto(launcherUrl(RESOLVES));
  await waitForState(page, "unsupported");

  await expect(page.locator("#unsupported")).toBeVisible();
  await expect(page.locator("#unsupported")).toContainText("WebGPU");
  await expect(page.locator("#zip-input")).toBeDisabled();
  // Nothing was started: no canvas, no loading ring and not one module request.
  await expect(page.locator("#canvas")).toBeHidden();
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute("data-state", "unsupported");
  expect(moduleRequests, "the unsupported page requested the engine module").toBe(0);
});

test("5: several missing features appear in contract order separated by ', '", async ({ page }) => {
  await openLauncher(page, ["gpu", "isolation", "opfs"]);

  await expect(page.locator("#unsupported")).toHaveText(
    "Missing browser features: WebGPU, Cross-origin isolation, Origin private file system",
  );
});

test("6: when not cross-origin isolated, #unsupported contains Cross-origin isolation", async ({
  page,
}) => {
  await openLauncher(page, ["isolation"]);

  const unsupported = page.locator("#unsupported");
  await expect(unsupported).toBeVisible();
  await expect(unsupported).toContainText("Cross-origin isolation");
});
