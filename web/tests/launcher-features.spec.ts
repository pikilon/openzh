import { test, expect, type Page } from "@playwright/test";
import { installZip } from "./helpers/install-zip";

// Issue #30: before a player spends minutes importing several GB, the launcher
// must name the browser features it needs: WebGPU, cross-origin isolation (for
// SharedArrayBuffer) and OPFS. Element ids are part of the page's contract.

type MissingFeature = "gpu" | "isolation" | "opfs";

// Overrides the page's environment before any page script runs, which is the
// only way to simulate a browser that lacks these features in Brave.
async function openLauncher(page: Page, missing: MissingFeature[] = []): Promise<void> {
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
  await page.goto("/app/index.html");
}

test("1: with every feature present, #unsupported stays hidden and import works", async ({ page }, info) => {
  await openLauncher(page);
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);

  const unsupported = page.locator("#picker #unsupported");
  await expect(unsupported).toHaveCount(1);
  await expect(unsupported).toHaveAttribute("role", "alert");
  await expect(unsupported).toBeHidden();

  await expect(page.locator("#zip-input")).toBeEnabled();
  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
  await expect(unsupported).toBeHidden();
});

test("2: without navigator.gpu, #unsupported is visible and contains WebGPU", async ({ page }) => {
  await openLauncher(page, ["gpu"]);

  const unsupported = page.locator("#unsupported");
  await expect(unsupported).toBeVisible();
  await expect(unsupported).toContainText("WebGPU");
});

test("3: without navigator.storage.getDirectory, #unsupported contains Origin private file system", async ({ page }) => {
  await openLauncher(page, ["opfs"]);

  const unsupported = page.locator("#unsupported");
  await expect(unsupported).toBeVisible();
  await expect(unsupported).toContainText("Origin private file system");
});

test("4: when a feature is missing, #zip-input and #play are disabled and stay disabled", async ({ page }, info) => {
  // Store a complete install first: after the reload it would enable Play if
  // the launcher still read OPFS despite the missing feature.
  await openLauncher(page);
  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
  });
  await page.goto("/app/index.html");

  await expect(page.locator("#unsupported")).toBeVisible();
  await expect(page.locator("#zip-input")).toBeDisabled();
  await expect(page.locator("#play")).toBeDisabled();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
});

test("5: several missing features appear in contract order separated by ', '", async ({ page }) => {
  await openLauncher(page, ["gpu", "isolation", "opfs"]);

  await expect(page.locator("#unsupported")).toHaveText(
    "Missing browser features: WebGPU, Cross-origin isolation, Origin private file system",
  );
});

test("6: when not cross-origin isolated, #unsupported contains Cross-origin isolation", async ({ page }) => {
  await openLauncher(page, ["isolation"]);

  const unsupported = page.locator("#unsupported");
  await expect(unsupported).toBeVisible();
  await expect(unsupported).toContainText("Cross-origin isolation");
});
