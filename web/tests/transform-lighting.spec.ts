import { test, expect, type Page } from "@playwright/test";
import { clearStored, launcherUrl, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { installZip } from "./helpers/install-zip";

// Transform and lighting run on the GPU everywhere, Android included (its
// white canvas came from mirror buffers piling up, fixed 2026-10-22);
// ?cputnl=1 forces the CPU.

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";

async function choiceAfterStart(page: Page, outputPath: string, query = ""): Promise<boolean | undefined> {
  await clearStored(page);
  await page.goto(launcherUrl("/harness/webgpu/request-device.js") + query);
  await waitForState(page, "no-assets");
  await page.locator("#zip-input").setInputFiles(await installZip(outputPath));
  await waitForState(page, "playing", START_TIMEOUT);
  return page.evaluate(() => (globalThis as { zhwpCpuTnl?: boolean }).zhwpCpuTnl);
}

test("desktop keeps transform and lighting on the GPU", async ({ page }, info) => {
  expect(await choiceAfterStart(page, info.outputPath())).toBe(false);
});

test.describe("on Android", () => {
  test.use({ userAgent: ANDROID });

  test("transform and lighting default to the GPU", async ({ page }, info) => {
    expect(await choiceAfterStart(page, info.outputPath())).toBe(false);
  });

  test("?cputnl=1 forces the CPU", async ({ page }, info) => {
    expect(await choiceAfterStart(page, info.outputPath(), "&cputnl=1")).toBe(true);
  });
});
