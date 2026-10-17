import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/harness/index.html");
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
  await page.evaluate(async () => {
    const z = (window as any).zhwp;
    await z.clearStored();
    await z.storeFiles([{ kind: "zh", name: "INIZH.big", file: new Blob([new Uint8Array(64)]) }]);
  });
}

test("a read from a worker that never answers throws after the time limit", async ({ page }) => {
  await open(page);
  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const bridge = await z.FileBridge.start(await z.listStored(), "/harness/stuck-worker.js", { readTimeoutMs: 300 });
    const started = performance.now();
    let message = "";
    try {
      bridge.readSync("zh", "INIZH.big", 0, new Uint8Array(8));
    } catch (error) {
      message = String((error as Error).message ?? error);
    }
    return { message, elapsed: performance.now() - started };
  });
  expect(outcome.message).toMatch(/time/i);
  expect(outcome.elapsed).toBeGreaterThanOrEqual(250);
  expect(outcome.elapsed).toBeLessThan(3000);
});

test("the default time limit is 10 seconds and fast reads are unaffected", async ({ page }) => {
  await open(page);
  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const bridge = await z.FileBridge.start(await z.listStored());
    const out = new Uint8Array(64);
    const n = bridge.readSync("zh", "INIZH.big", 0, out);
    await bridge.close();
    return { n, defaultTimeout: z.FileBridge.DEFAULT_READ_TIMEOUT_MS };
  });
  expect(outcome).toEqual({ n: 64, defaultTimeout: 10_000 });
});

test("reads after close throw at once", async ({ page }) => {
  await open(page);
  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const bridge = await z.FileBridge.start(await z.listStored());
    await bridge.close();
    const started = performance.now();
    let threw = false;
    try {
      bridge.readSync("zh", "INIZH.big", 0, new Uint8Array(8));
    } catch {
      threw = true;
    }
    return { threw, elapsed: performance.now() - started };
  });
  expect(outcome.threw).toBe(true);
  expect(outcome.elapsed).toBeLessThan(100);
});
