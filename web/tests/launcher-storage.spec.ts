import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBig } from "./helpers/big";

// Issue #31: persistent storage and a storage estimate before import. Issue
// #70: the estimate warns instead of refusing the import. The pure helpers are
// exercised through the harness page; the launcher through stubbed
// StorageManager methods.

const MB = 1024 * 1024;
const GB = 1024 * MB;

type StorageMock = {
  estimate?: { usage?: number; quota?: number } | "reject";
  persisted?: boolean;
  persist?: boolean | "count";
};

function makeInstall(dir: string, data = "GameData\nEnd\n"): string {
  const root = join(dir, "install");
  mkdirSync(root, { recursive: true });
  for (const name of ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"]) {
    writeFileSync(join(root, name), buildBig([{ path: "Data\\INI\\Default\\GameData.ini", data }]));
  }
  return root;
}

function installBytes(root: string): number {
  return ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"]
    .map((name) => statSync(join(root, name)).size)
    .reduce((sum, size) => sum + size, 0);
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

test("70.1: when the estimate is smaller than needed, the import finishes and counts the archives", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 16 },
    persisted: false,
    persist: false,
  });
  await page.goto("/app/index.html");

  await page.locator("#folder-input").setInputFiles(makeInstall(info.outputPath()));

  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
});

test("70.2: when the estimate is smaller than needed, #storage-warning shows both formatted sizes", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 16 },
    persisted: false,
    persist: false,
  });
  await page.goto("/app/index.html");
  const root = makeInstall(info.outputPath());
  const needed = installBytes(root);

  await page.locator("#folder-input").setInputFiles(root);

  const warning = page.locator("#picker #storage-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute("role", "status");
  await expect(warning).toHaveText(`The browser reports 16 B available; the import needs ${needed} B.`);
});

test("70.3: when the estimate leaves enough space, #storage-warning stays hidden", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 2 * GB },
    persisted: false,
    persist: false,
  });
  await page.goto("/app/index.html");
  const warning = page.locator("#picker #storage-warning");
  await expect(warning).toHaveCount(1);
  await expect(warning).toBeHidden();

  await page.locator("#folder-input").setInputFiles(makeInstall(info.outputPath()));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(warning).toBeHidden();
});

test("70.4: after a warning, Clear hides #storage-warning", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 16 },
    persisted: false,
    persist: false,
  });
  await page.goto("/app/index.html");
  await page.locator("#folder-input").setInputFiles(makeInstall(info.outputPath()));
  const warning = page.locator("#picker #storage-warning");
  await expect(warning).toBeVisible();

  await page.locator("#clear").click();

  await expect(warning).toBeHidden();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
});

test("70.5: a QuotaExceededError during storing is reported and keeps what is stored", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 2 * GB },
    persisted: false,
    persist: false,
  });
  await page.goto("/app/index.html");

  await page.locator("#folder-input").setInputFiles(makeInstall(info.outputPath("first")));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();

  // Make every OPFS writable stream fail after the first import, as a full
  // disk would, and pick archives whose sizes force a rewrite.
  await page.evaluate(() => {
    Object.defineProperty(FileSystemFileHandle.prototype, "createWritable", {
      value: () => Promise.reject(new DOMException("quota exceeded", "QuotaExceededError")),
      configurable: true,
      writable: true,
    });
  });

  await page.locator("#folder-input").setInputFiles(makeInstall(info.outputPath("second"), "GameData\nEnd\nEnd\n"));

  await expect(page.locator("#status")).toHaveText(/^Import failed: QuotaExceededError: /);
  await expect(page.locator("#import-progress")).toBeHidden();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
});

test("70.6: no path of the page writes Not enough storage into #status", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 16 },
    persisted: false,
    persist: false,
  });
  await page.goto("/app/index.html");
  await page.evaluate(() => {
    const status = document.getElementById("status");
    if (status === null) throw new Error("missing #status");
    const seen: string[] = [];
    (window as unknown as { __statusSeen: string[] }).__statusSeen = seen;
    new MutationObserver(() => seen.push(status.textContent ?? "")).observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  await page.locator("#folder-input").setInputFiles(makeInstall(info.outputPath()));
  await expect
    .poll(async () => page.locator("#status").textContent(), { timeout: 30_000 })
    .not.toBe("Importing");

  const seen = await page.evaluate(() => (window as unknown as { __statusSeen: string[] }).__statusSeen);
  expect(seen.some((text) => text.includes("Not enough storage"))).toBe(false);
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
