import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Owner request 2026-10-19: the player's settings (engine options, launcher
// choices) export to a ZIP and import back; "everything" also carries the
// saved games. The touch controls choice belongs to the device and never
// travels. The launcher runs without game data here, so no engine flushes.

const SHARE = "/home/web_user/.local/share/GeneralsX";
const CONFIG = "/home/web_user/.config/GeneralsX";
const WAIT = 30_000;

type Seed = { db: string; path: string; text?: string; dir?: boolean };

const SEEDS: Seed[] = [
  { db: SHARE, path: "GeneralsZH", dir: true },
  { db: SHARE, path: "GeneralsZH/Options.ini", text: "Resolution = 1280 768\nAntiAliasing = 4\n" },
  { db: SHARE, path: "GeneralsZH/Save", dir: true },
  { db: SHARE, path: "GeneralsZH/Save/00000001.sav", text: "a saved game" },
  { db: CONFIG, path: "registry.ini", text: "[x]\nKey = 1\n" },
];

async function seed(page: Page, seeds: readonly Seed[]): Promise<void> {
  await page.evaluate(async (seeds) => {
    for (const db of [...new Set(seeds.map((s) => s.db))]) {
      const open = indexedDB.open(db, 21);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("FILE_DATA")) {
          open.result.createObjectStore("FILE_DATA").createIndex("timestamp", "timestamp", { unique: false });
        }
      };
      const handle = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const tx = handle.transaction("FILE_DATA", "readwrite");
      for (const s of seeds.filter((item) => item.db === db)) {
        tx.objectStore("FILE_DATA").put(
          s.dir
            ? { timestamp: new Date(1_700_000_000_000), mode: 0o40777 }
            : { timestamp: new Date(1_700_000_000_000), mode: 0o100644, contents: new TextEncoder().encode(s.text ?? "") },
          `${db}/${s.path}`,
        );
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      handle.close();
    }
  }, seeds);
}

async function readFile(page: Page, db: string, path: string): Promise<{ text: string; mode: number; dated: boolean } | null> {
  return page.evaluate(
    async ({ db, path }) => {
      const open = indexedDB.open(db, 21);
      const handle = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      if (!handle.objectStoreNames.contains("FILE_DATA")) {
        handle.close();
        return null;
      }
      const value = await new Promise<{ mode: number; contents?: Uint8Array; timestamp: unknown } | undefined>((resolve) => {
        const get = handle.transaction("FILE_DATA").objectStore("FILE_DATA").get(`${db}/${path}`);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => resolve(undefined);
      });
      handle.close();
      if (value === undefined) return null;
      return {
        text: value.contents ? new TextDecoder().decode(value.contents) : "",
        mode: value.mode,
        dated: value.timestamp instanceof Date,
      };
    },
    { db, path },
  );
}

async function openLauncherMenu(page: Page): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets", { timeout: WAIT });
  await page.locator("#menu-button").click();
  await expect(page.locator("#menu")).toHaveAttribute("open", "");
}

async function download(page: Page, button: string, info: TestInfo, name: string): Promise<string> {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: WAIT }), page.locator(button).click()]);
  const target = info.outputPath(name);
  await file.saveAs(target);
  return target;
}

function zipList(path: string): string[] {
  return execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n").sort();
}

function zipText(path: string, entry: string): string {
  return execFileSync("unzip", ["-p", path, entry], { encoding: "utf8" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/app/index.html");
  await page.evaluate(async () => {
    for (const name of ["/home/web_user/.local/share/GeneralsX", "/home/web_user/.config/GeneralsX"]) {
      await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
      });
    }
    localStorage.clear();
  });
});

test("settings export holds options, config and launcher choices, but no saves and no touch choice", async ({ page }, info) => {
  await seed(page, SEEDS);
  await page.evaluate(() => {
    localStorage.setItem("openzh.muted", "1");
    localStorage.setItem("openzh.touchControls", "1");
  });
  await page.reload();
  await openLauncherMenu(page);

  const settings = await download(page, "#export-settings", info, "settings.zip");
  expect(zipList(settings)).toEqual([
    "config/registry.ini",
    "launcher.json",
    "openzh-backup.json",
    "share/GeneralsZH/Options.ini",
  ]);
  expect(zipText(settings, "share/GeneralsZH/Options.ini")).toBe("Resolution = 1280 768\nAntiAliasing = 4\n");
  expect(JSON.parse(zipText(settings, "launcher.json"))).toEqual({ "openzh.muted": "1" });
  expect(JSON.parse(zipText(settings, "openzh-backup.json")).kind).toBe("settings");

  const everything = await download(page, "#export-everything", info, "everything.zip");
  expect(zipList(everything)).toContain("share/GeneralsZH/Save/00000001.sav");
  expect(zipText(everything, "share/GeneralsZH/Save/00000001.sav")).toBe("a saved game");
});

test("importing a backup restores the files and launcher choices, keeps the device's touch choice", async ({ page }, info) => {
  await seed(page, SEEDS);
  await page.evaluate(() => localStorage.setItem("openzh.muted", "1"));
  await page.reload();
  await openLauncherMenu(page);
  const everything = await download(page, "#export-everything", info, "everything.zip");

  // A different browser: nothing stored, touch controls chosen off here.
  await page.evaluate(async () => {
    for (const name of ["/home/web_user/.local/share/GeneralsX", "/home/web_user/.config/GeneralsX"]) {
      await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
      });
    }
    localStorage.clear();
    localStorage.setItem("openzh.touchControls", "0");
  });
  await page.reload();
  await openLauncherMenu(page);

  await Promise.all([
    page.waitForEvent("load", { timeout: WAIT }),
    page.locator("#import-settings-input").setInputFiles(everything),
  ]);
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets", { timeout: WAIT });

  expect(await readFile(page, SHARE, "GeneralsZH/Options.ini")).toEqual({
    text: "Resolution = 1280 768\nAntiAliasing = 4\n",
    mode: 0o100644,
    dated: true,
  });
  expect((await readFile(page, SHARE, "GeneralsZH/Save/00000001.sav"))?.text).toBe("a saved game");
  expect((await readFile(page, SHARE, "GeneralsZH/Save"))?.mode).toBe(0o40777);
  expect((await readFile(page, CONFIG, "registry.ini"))?.text).toBe("[x]\nKey = 1\n");
  expect(await page.evaluate(() => localStorage.getItem("openzh.muted"))).toBe("1");
  expect(await page.evaluate(() => localStorage.getItem("openzh.touchControls"))).toBe("0");
});

test("a ZIP that is not a backup is refused with a message and changes nothing", async ({ page }, info) => {
  await openLauncherMenu(page);
  const other = info.outputPath("other.zip");
  writeFileSync(info.outputPath("x.txt"), "x");
  execFileSync("zip", ["-q", "-j", other, info.outputPath("x.txt")]);
  await page.locator("#import-settings-input").setInputFiles(other);
  await expect(page.locator("#settings-status")).toHaveText("This ZIP is not an OpenZH settings backup.");
  expect(await readFile(page, SHARE, "GeneralsZH/Options.ini")).toBeNull();
});
