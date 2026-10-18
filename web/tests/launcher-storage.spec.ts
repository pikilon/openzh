import { test, expect, type Page } from "@playwright/test";
import { statSync } from "node:fs";
import { installZip } from "./helpers/install-zip";

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

function zipBytes(path: string): number {
  return statSync(path).size;
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

  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
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

  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));

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
  const zip = await installZip(info.outputPath());
  const needed = zipBytes(zip);

  await page.locator("#zip-input").setInputFiles(zip);

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

  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
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
  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  const warning = page.locator("#picker #storage-warning");
  await expect(warning).toBeVisible();

  await page.locator("#clear").click();

  await expect(warning).toBeHidden();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
});

test("70.5: a QuotaExceededError during storing is reported and leaves only the files committed before it", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 2 * GB },
    persisted: false,
    persist: false,
  });
  await page.goto("/app/index.html");

  // The first install also has a file the second ZIPs do not bring.
  await page.locator("#zip-input").setInputFiles(
    await installZip(info.outputPath("first"), undefined, {
      extraFiles: [{ path: "old/notes.txt", data: "previous install\n" }],
    }),
  );
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();

  // Fail only the third archive's writable, as a full disk would after the
  // first two have committed. The new sizes force the replace rule to remove
  // the previous install before the first write.
  await page.evaluate(() => {
    const prototype = FileSystemFileHandle.prototype as unknown as {
      createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
    };
    const original = prototype.createWritable;
    prototype.createWritable = function (this: FileSystemFileHandle, options?: { keepExistingData?: boolean }) {
      if (this.name !== "INI.big") return original.call(this, options);
      return Promise.reject(new DOMException("quota exceeded", "QuotaExceededError"));
    };
  });

  await page.locator("#zip-input").setInputFiles(
    await installZip(info.outputPath("second"), undefined, { data: "GameData\nEnd\nEnd\n" }),
  );

  await expect(page.locator("#status")).toHaveText("Import failed");
  await expect(page.locator("#import-error")).toHaveAttribute("data-code", "quota-exceeded");
  await expect(page.locator("#import-progress")).toBeHidden();

  // The old-only extra and the old INI.big/W3D.big are gone; only the two
  // archives committed before the failure remain.
  const stored = await page.evaluate(async () => {
    const paths: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const entry of (dir as any).entries()) {
        const [name, handle] = entry as [string, FileSystemHandle];
        const path = prefix === "" ? name : `${prefix}/${name}`;
        if (handle.kind === "directory") {
          await walk(handle as FileSystemDirectoryHandle, path);
        } else {
          paths.push(path);
        }
      }
    };
    try {
      const root = await navigator.storage.getDirectory();
      const zhwp = await root.getDirectoryHandle("zhwp");
      await walk(zhwp, "");
    } catch {
      // No stored tree at all.
    }
    return paths.sort();
  });
  expect(stored).toEqual(["zh/INIZH.big", "zh/W3DZH.big"]);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 2 archives");
  await expect(page.locator("#play")).toBeDisabled();
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

  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await expect
    .poll(async () => page.locator("#status").textContent(), { timeout: 30_000 })
    .not.toBe("Importing");

  const seen = await page.evaluate(() => (window as unknown as { __statusSeen: string[] }).__statusSeen);
  expect(seen.some((text) => text.includes("Not enough storage"))).toBe(false);
});

test("8: a complete ZIP pick calls navigator.storage.persist() once", async ({ page }, info) => {
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
  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });

  const calls = await page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls);
  expect(calls).toBe(1);
});
