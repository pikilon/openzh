import { test, expect } from "@playwright/test";
import { buildBig } from "./helpers/big";

// End to end: a synthetic archive stored in OPFS is mounted into the engine's
// file system and the engine accepts /GeneralsZH as its asset root.

test("the engine finds archives stored in OPFS", async ({ page }) => {
  const big = buildBig([{ path: "Data\\INI\\Default\\GameData.ini", data: "GameData\nEnd\n" }]);
  await page.goto("/harness/index.html");
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
  await page.evaluate(async (bytes) => {
    const z = (window as any).zhwp;
    await z.clearStored();
    await z.storeFiles([{ kind: "zh", name: "INIZH.big", file: new Blob([new Uint8Array(bytes)]) }]);
  }, Array.from(big));

  await page.goto("/smoke/index.html?archives=opfs");
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __zhwpLog?: string[]; __zhwpDone?: { status: string } };
      return w.__zhwpDone?.status === "error" || (w.__zhwpLog ?? []).some((l) => l.includes("[ASSET_ROOT] Selected"));
    },
    null,
    { timeout: 60_000 },
  );
  const { log, done } = await page.evaluate(() => {
    const w = window as unknown as { __zhwpLog: string[]; __zhwpDone?: { status: string; message?: string } };
    return { log: [...w.__zhwpLog], done: w.__zhwpDone };
  });
  expect(done?.status, done?.message).not.toBe("error");
  expect(log.some((l) => l.includes("[ASSET_ROOT] Selected source=env path='/GeneralsZH'")), log.slice(-20).join("\n")).toBe(true);
  expect(log.some((l) => l.includes("did not provide BIG files"))).toBe(false);
});

test("without archives=opfs the smoke page behaves as before", async ({ page }) => {
  await page.goto("/smoke/index.html");
  await page.waitForFunction(
    () => ((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? []).some((l) => l.includes("did not provide BIG files")),
    null,
    { timeout: 60_000 },
  );
});
