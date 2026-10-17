import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/harness/index.html");
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
}

test.beforeEach(async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as any).zhwp.clearStored());
});

test("stores picked files in OPFS, reports progress and lists them", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const progress: [number, number][] = [];
    const written = await z.storeFiles(
      [
        { kind: "zh", name: "INIZH.big", file: new Blob([new Uint8Array(1000).fill(7)]) },
        { kind: "generals", name: "INI.big", file: new Blob([new Uint8Array(3000).fill(9)]) },
      ],
      (done: number, total: number) => progress.push([done, total]),
    );
    return { written, progress, list: await z.listStored() };
  });
  expect(result.written).toEqual({ written: 2, skipped: 0 });
  expect(result.list).toEqual([
    { kind: "zh", name: "INIZH.big", size: 1000 },
    { kind: "generals", name: "INI.big", size: 3000 },
  ]);
  const last = result.progress[result.progress.length - 1];
  expect(last).toEqual([4000, 4000]);
  for (let i = 1; i < result.progress.length; i++) {
    expect(result.progress[i][0]).toBeGreaterThanOrEqual(result.progress[i - 1][0]);
  }
});

test("storing the same files again skips them; a different size replaces", async ({ page }) => {
  const again = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const files = [{ kind: "zh", name: "INIZH.big", file: new Blob([new Uint8Array(10)]) }];
    await z.storeFiles(files);
    const second = await z.storeFiles(files);
    const third = await z.storeFiles([{ kind: "zh", name: "INIZH.big", file: new Blob([new Uint8Array(20)]) }]);
    return { second, third, list: await z.listStored() };
  });
  expect(again.second).toEqual({ written: 0, skipped: 1 });
  expect(again.third).toEqual({ written: 1, skipped: 0 });
  expect(again.list).toEqual([{ kind: "zh", name: "INIZH.big", size: 20 }]);
});

test("stored files survive a page reload", async ({ page }) => {
  await page.evaluate(async () => {
    await (window as any).zhwp.storeFiles([{ kind: "generals", name: "W3D.big", file: new Blob([new Uint8Array(42)]) }]);
  });
  await open(page);
  expect(await page.evaluate(() => (window as any).zhwp.listStored())).toEqual([
    { kind: "generals", name: "W3D.big", size: 42 },
  ]);
});
