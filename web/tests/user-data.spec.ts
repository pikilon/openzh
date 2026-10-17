import { test, expect, type Page } from "@playwright/test";
import { buildBig } from "./helpers/big";

// Issue #19: the engine's user data directories persist across reloads (IDBFS).
const DATA = "/home/web_user/.local/share/GeneralsX";
const CONFIG = "/home/web_user/.config/GeneralsX";

async function startEngine(page: Page) {
  await page.goto("/smoke/index.html?archives=opfs");
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __zhwpLog?: string[]; __zhwpDone?: { status: string } };
      return w.__zhwpDone?.status === "error" || (w.__zhwpLog ?? []).some((l) => l.includes("[ASSET_ROOT] Selected"));
    },
    null,
    { timeout: 60_000 },
  );
  const done = await page.evaluate(() => (window as any).__zhwpDone);
  expect(done?.status, done?.message).not.toBe("error");
}

test.beforeEach(async ({ page }) => {
  const big = buildBig([{ path: "Data\\INI\\Default\\GameData.ini", data: "GameData\nEnd\n" }]);
  await page.goto("/harness/index.html");
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
  await page.evaluate(async (bytes) => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name);
    const z = (window as any).zhwp;
    await z.clearStored();
    await z.storeFiles([{ kind: "zh", name: "INIZH.big", file: new Blob([new Uint8Array(bytes)]) }]);
  }, Array.from(big));
});

test("both user data directories are IDBFS mounts", async ({ page }) => {
  await startEngine(page);
  const types = await page.evaluate(({ data, config }) => {
    const m = (window as any).__zhwpModule;
    const idbfs = m.FS.filesystems.IDBFS;
    return [data, config].map((dir) => m.FS.lookupPath(dir).node.mount.type === idbfs);
  }, { data: DATA, config: CONFIG });
  expect(types).toEqual([true, true]);
});

test("files written there survive a reload", async ({ page }) => {
  await startEngine(page);
  await page.evaluate(async ({ data, config }) => {
    const m = (window as any).__zhwpModule;
    m.FS.writeFile(`${data}/zhwp-marker.txt`, "kept");
    m.FS.writeFile(`${config}/zhwp-config.txt`, "cfg");
    await (window as any).__zhwpSaveUserData();
  }, { data: DATA, config: CONFIG });

  await startEngine(page);
  const read = await page.evaluate(({ data, config }) => {
    const m = (window as any).__zhwpModule;
    return [
      m.FS.readFile(`${data}/zhwp-marker.txt`, { encoding: "utf8" }),
      m.FS.readFile(`${config}/zhwp-config.txt`, { encoding: "utf8" }),
    ];
  }, { data: DATA, config: CONFIG });
  expect(read).toEqual(["kept", "cfg"]);
});

test("files written but not saved are lost on reload", async ({ page }) => {
  await startEngine(page);
  await page.evaluate((data) => {
    (window as any).__zhwpModule.FS.writeFile(`${data}/zhwp-unsaved.txt`, "gone");
  }, DATA);
  await startEngine(page);
  const exists = await page.evaluate((data) => (window as any).__zhwpModule.FS.analyzePath(`${data}/zhwp-unsaved.txt`).exists, DATA);
  expect(exists).toBe(false);
});
