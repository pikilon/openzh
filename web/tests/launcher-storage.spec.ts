import { test, expect, type Page } from "@playwright/test";
import { statSync } from "node:fs";
import {
  importInstall,
  launcherUrl,
  openLauncher,
  removeStoredArchive,
  RESOLVES,
  seedInstall,
  START_TIMEOUT,
  storedPaths,
  waitForState,
  warningSamples,
  watchWarning,
} from "./helpers/launcher";
import { installZip } from "./helpers/install-zip";

// Issue #31: persistent storage and a storage estimate before import. Issue
// #70: the estimate warns instead of refusing the import. Issue #157: an import
// replaces the previous install. Issue #159: the import starts the engine by
// itself, so no test presses Play and a clean store is reset through the
// harness page instead of the removed "Clear stored archives" button. The pure
// helpers are exercised through the harness page; the launcher through stubbed
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

test("1: formatBytes uses 1024-based B, KB, MB and GB with one decimal", async ({ page }) => {
  await openHarness(page);
  const formatted = await page.evaluate(() => {
    const z = (window as unknown as { zhwp: { formatBytes(bytes: number): string } }).zhwp;
    return [0, 1023, 1024, 1.5 * 1024 * 1024, 2 * 1024 * 1024 * 1024].map((bytes) => z.formatBytes(bytes));
  });
  expect(formatted).toEqual(["0 B", "1023 B", "1.0 KB", "1.5 MB", "2.0 GB"]);
});

test("2: bytesNeeded skips only entries with the same kind, case-insensitive name and size", async ({
  page,
}) => {
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

test("3: available is quota minus usage, missing usage counts as 0 and no quota is undefined", async ({
  page,
}) => {
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
  await openLauncher(page, RESOLVES);

  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
  await expect(page.locator("#loader #storage")).toHaveText("Storage: 512.0 MB of 2.0 GB");
});

test("5: when persisted resolves true, #storage ends with (persistent)", async ({ page }) => {
  await mockStorage(page, {
    estimate: { usage: 512 * MB, quota: 2 * GB },
    persisted: true,
    persist: false,
  });
  await openLauncher(page, RESOLVES);

  await expect(page.locator("#loader #storage")).toHaveText(
    /^Storage: 512\.0 MB of 2\.0 GB \(persistent\)$/,
  );
});

test("6: when estimate rejects, #storage reads Storage: unknown and import still works", async ({
  page,
}, info) => {
  await mockStorage(page, { estimate: "reject", persisted: false, persist: false });
  await openLauncher(page, RESOLVES);

  await expect(page.locator("#loader #storage")).toHaveText("Storage: unknown");

  await importInstall(page, info.outputPath());
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#canvas")).toBeVisible();
});

test("70.1: when the estimate is smaller than needed, the import finishes and counts the archives", async ({
  page,
}, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 16 },
    persisted: false,
    persist: false,
  });
  await openLauncher(page, RESOLVES);

  await importInstall(page, info.outputPath());

  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#canvas")).toBeVisible();
});

test("70.2: when the estimate is smaller than needed, #storage-warning shows both formatted sizes", async ({
  page,
}, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 16 },
    persisted: false,
    persist: false,
  });
  await openLauncher(page, RESOLVES);
  const zip = await installZip(info.outputPath());
  const needed = zipBytes(zip);
  await watchWarning(page);

  await page.locator("#zip-input").setInputFiles(zip);

  const warning = page.locator("#loader #storage-warning");
  await expect(warning).toHaveAttribute("role", "status");
  const expected = `The browser reports 16 B available; the import needs ${needed} B.`;
  await expect
    .poll(
      async () =>
        (await warningSamples(page)).some((sample) => sample.visible && sample.text === expected),
      { timeout: START_TIMEOUT },
    )
    .toBe(true);
  await waitForState(page, "playing");
});

test("70.3: when the estimate leaves enough space, #storage-warning stays hidden", async ({
  page,
}, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 2 * GB },
    persisted: false,
    persist: false,
  });
  await openLauncher(page, RESOLVES);
  const warning = page.locator("#loader #storage-warning");
  await expect(warning).toHaveCount(1);
  await expect(warning).toBeHidden();
  await watchWarning(page);

  await importInstall(page, info.outputPath());

  const shown = (await warningSamples(page)).filter((sample) => sample.visible);
  expect(shown).toEqual([]);
});

test("70.4: after a warning, reloading the game data shows a clean loader with no warning", async ({
  page,
}, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 16 },
    persisted: false,
    persist: false,
  });
  await openLauncher(page, RESOLVES);
  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await waitForState(page, "playing");
  await expect(page.locator("#loader")).toBeHidden();

  // #159 removed "Clear stored archives"; the menu's "Reload game data" is the
  // player's replacement, and the reloaded loader must not keep the warning.
  await page.locator("#menu-button").click();
  await expect(page.locator("#menu")).toHaveAttribute("open", "");
  await page.locator("#reload").click();
  await expect(page.locator("#reload-dialog")).toHaveAttribute("open", "");
  await page.locator("#reload-confirm").click();

  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets", {
    timeout: START_TIMEOUT,
  });
  await expect(page.locator("#loader")).toBeVisible();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
  await expect(page.locator("#storage-warning")).toBeHidden();
});

test("70.5: a QuotaExceededError during storing leaves only the files committed before it", async ({
  page,
}, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 2 * GB },
    persisted: false,
    persist: false,
  });

  // The previous install also has a file the second ZIPs do not bring. It is
  // seeded through the harness so no engine holds its files open, and one
  // required archive is removed: the launcher then shows the loader instead of
  // starting the game.
  const previous = await installZip(info.outputPath("previous"), undefined, {
    extraFiles: [{ path: "old/notes.txt", data: "previous install\n" }],
  });
  await seedInstall(page, previous);
  await removeStoredArchive(page, "generals/INI.big");
  await page.goto(launcherUrl(RESOLVES));
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 3 archives");
  await waitForState(page, "no-assets");

  // Fail only INI.big's writable, as a full disk would after the first two
  // archives committed. The new sizes force the replace rule to remove the
  // previous install before the first write.
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

  // The old-only extra and the old archives are gone; only the two archives
  // committed before the failure remain, with the new sizes.
  expect(await storedPaths(page)).toEqual(["zh/INIZH.big", "zh/W3DZH.big"]);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 2 archives");
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
});

test("70.6: no path of the page writes Not enough storage into #status", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 16 },
    persisted: false,
    persist: false,
  });
  await openLauncher(page, RESOLVES);
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
  await waitForState(page, "playing");

  const seen = await page.evaluate(() => (window as unknown as { __statusSeen: string[] }).__statusSeen);
  expect(seen.some((text) => text.includes("Not enough storage"))).toBe(false);
});

test("8: a complete ZIP pick calls navigator.storage.persist() once", async ({ page }, info) => {
  await mockStorage(page, {
    estimate: { usage: 0, quota: 2 * GB },
    persisted: false,
    persist: "count",
  });
  await openLauncher(page, RESOLVES);

  // Ignore anything the page did while loading: the pick must call it.
  await page.evaluate(() => {
    (window as unknown as { __persistCalls: number }).__persistCalls = 0;
  });
  await importInstall(page, info.outputPath());

  const calls = await page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls);
  expect(calls).toBe(1);
});
