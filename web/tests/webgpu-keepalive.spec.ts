import { test, expect } from "@playwright/test";
import { clearStored, launcherUrl, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { installZip } from "./helpers/install-zip";

// The engine drops its adapter and device handles, and Chromium may then
// garbage-collect the GPUAdapter and lose the device mid-game (white canvas on
// the owner's phone, 2026-10-21). src/webgpu-keepalive.ts keeps both alive.

test("the launcher keeps the engine's WebGPU adapter and device referenced", async ({ page }, info) => {
  await clearStored(page);
  await page.goto(launcherUrl("/harness/webgpu/request-device.js"));
  await waitForState(page, "no-assets");
  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await waitForState(page, "playing", START_TIMEOUT);

  const refs = await page.evaluate(() => {
    const kept = (window as unknown as { __zhwpWebGpuRefs?: unknown[] }).__zhwpWebGpuRefs ?? [];
    return kept.map((object) => (object as object).constructor.name);
  });
  expect(refs).toEqual(["GPUAdapter", "GPUDevice"]);
});
