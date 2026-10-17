import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBig } from "./helpers/big";

// Issue #31: persistent storage and a quota check before import. The page asks
// the browser to keep the archives, shows how much space they use and refuses
// an import that does not fit. The pure helpers are exercised through the
// harness page; the launcher through stubbed StorageManager methods.

const MB = 1024 * 1024;
const GB = 1024 * MB;

type StorageMock = {
  estimate?: { usage?: number; quota?: number } | "reject";
  persisted?: boolean;
  persist?: boolean | "count";
};

function makeInstall(dir: string): string {
  const root = join(dir, "install");
  mkdirSync(root, { recursive: true });
  for (const name of ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"]) {
    writeFileSync(join(root, name), buildBig([{ path: "Data\\INI\\Default\\GameData.ini", data: "GameData\nEnd\n" }]));
  }
  return root;
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/harness/index.html");
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
}

// Overrides the page's StorageManager before its scripts run: Brave's real
// quota is too large to exercise the "does not fit" path.
async function mockStorage(page: Page, mock: StorageMock): Promise<void> {
  await page.addInitScript((options: StorageMock) => {
    const storage = navigator.storage;
    if (options.estimate === "reject") {
      Object.defineProperty(storage, "estimate", {
        value: () => Promise.reject(new Error("estimate failed")),
        configurable: true,
      });
    } else if (options.estimate !== undefined) {
      const estimate = options.estimate;
      Object.defineProperty(storage, "estimate", {
        value: async () => ({ usage: estimate.usage, quota: estimate.quota }),
        configurable: true,
      });
    }
    if (options.persisted !== undefined) {
      Object.defineProperty(storage, "persisted", {
        value: async () => options.persisted,
        configurable: true,
      });
    }
    if (options.persist === "count") {
      const page = window as unknown as { __persistCalls: number };
      page.__persistCalls = 0;
      Object.defineProperty(storage, "persist", {
        value: async () => {
          page.__persistCalls += 1;
          return true;
        },
        configurable: true,
      });
    } else if (typeof options.persist === "boolean") {
      Object.defineProperty(storage, "persist", {
        value: async () => options.persist,
        configurable: true,
      });
    }
  }, mock);
}

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => (window as unknown as { zhwp: { clearStored(): Promise<void> } }).zhwp.clearStored());
});

test("1: formatBytes uses 1024-based B, KB, MB and GB with one decimal", async ({ page }) => {
  await openHarness(page);
  const formatted = await page.evaluate(() => {
    const z = (window as unknown as { zhwp: { formatBytes(bytes: number): string } }).zhwp;
    return [0, 1023, 1024, 1.5 * 1024 * 1024, 2 * 1024 * 1024 * 1024].map((bytes) => z.formatBytes(bytes));
  });
  expect(formatted).toEqual(["0 B", "1023 B", "1.0 KB", "1.5 MB", "2.0 GB"]);
});

test("2: bytesNeeded skips only entries with the same kind, case-insensitive name and size", async ({ page }) => {
  await openHarness(page);
  const needed = await page.evaluate(() => {
    const z = (window as unknown as { zhwp: { bytesNeeded(picked: unknown[], stored: unknown[]): number } }).zhwp;
    const picked = [
      { kind: "zh", name: "INIZH.big", size: 100 },
      { kind: "generals", name: "INI.big", size: 200 },
      { kind: "zh", name: "W3DZH.big", size: 300 },
      { kind: "generals", name: "W3D.big", size: 400 },
    ];
    const stored = [
      { kind: "zh", name: "inizh.big", size: 100 },
      { kind: "zh", name: "INI.big", size: 200 },
      { kind: "zh", name: "W3DZH.big", size: 301 },
    ];
    return z.bytesNeeded(picked, stored);
  });
  expect(needed).toBe(900);
});

test("3: available is quota minus usage, missing usage counts as 0 and no quota is undefined", async ({ page }) => {
  await openHarness(page);
  const values = await page.evaluate(() => {
    const z = (window as unknown as { zhwp: { available(estimate: unknown): number | undefined } }).zhwp;
    return [
      z.available({ usage: 100, quota: 1000 }),
      z.available({ quota: 1000 }),
      z.available({ usage: 100 }),
      z.available({}),
    ];
  });
  expect(values).toEqual([900, 1000, undefined, undefined]);
});

test("4: on load, #storage shows the formatted usage and quota", async ({ page }) => {
  await mockStorage(page, {
    estimate: { usage: 512 * MB, quota: 2 * GB },
    persisted: false,
    persist: false,
  });
  await page.goto("/app/index.html");

  await expect(page.locator("#picker #storage")).toHaveText("Storage: 512.0 MB of 2.0 GB");
});

test("5: when persisted resolves true, #storage ends with (persistent)", async ({ page }) => {
  await mockStorage(page, {
    estimate: { usage: 512 * MB, quota: 2 * GB },
    persisted: true,
    persist: false,
  });
  await page.goto("/app/index.html");

  await expect(page.locator("#storage")).toHaveText(/^Storage: 512\.0 MB of 2\.0 GB \(persistent\)$/);
});

test("6: when estimate rejects, #storage reads Storage: unknown and import still works", async ({ page }, info) => {
  await mockStorage(page, { estimate: "reject", persisted: false, persist: false });
  await page.goto("/app/index.html");

  await expect(page.locator("#picker #storage")).toHaveText("Storage: unknown");

  await page.locator("#folder-input").setInputFiles(makeInstall(info.outputPath()));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
});

test("7: a pick that does not fit is refused and nothing is stored", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 16 },
    persisted: false,
    persist: false,
  });
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  await page.locator("#folder-input").setInputFiles(makeInstall(info.outputPath()));

  await expect(page.locator("#status")).toHaveText(/^Not enough storage: need /);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
});

test("8: a complete folder pick calls navigator.storage.persist() once", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 2 * GB },
    persisted: false,
    persist: "count",
  });
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);

  // Ignore anything the page did while loading: the pick must call it.
  await page.evaluate(() => {
    (window as unknown as { __persistCalls: number }).__persistCalls = 0;
  });
  await page.locator("#folder-input").setInputFiles(makeInstall(info.outputPath()));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });

  const calls = await page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls);
  expect(calls).toBe(1);
});
