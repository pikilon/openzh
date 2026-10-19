import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { entryStream, openZip, type ZipEntry } from "../src/zip";
import { installZip } from "./helpers/install-zip";
import { seedInstall } from "./helpers/launcher";

// Issues #189 and #190: the engine's saved games live in the IDBFS database
// below /home/web_user/.local/share/GeneralsX, while the ZIP importer rewrites
// only the OPFS archive tree. The tests seed synthetic IDBFS entries, replace
// the install, and then read the same entries back. The export test drives the
// real menu and downloads the ZIP through the browser.

const DB = "/home/web_user/.local/share/GeneralsX";
const STORE = "FILE_DATA";
// The engine keeps Zero Hour data in GeneralsX/GeneralsZH (GlobalData.cpp).
const SAVE_DIR = `${DB}/GeneralsZH/Save`;
const WAIT = 30_000;

type Seed = {
  path: string;
  text?: string;
  bytes?: number[];
  timestamp: number;
  // POSIX file mode; a directory uses 0o040755 and no contents.
  mode: number;
  directory?: boolean;
};

type RawEntry = {
  key: string;
  timestamp: number;
  mode: number;
  contents: number[] | null;
};

const FILES: Seed[] = [
  { path: "GeneralsZH/Save/Test A.SAV", text: "save-one", timestamp: 1_700_000_000_000, mode: 0o100644 },
  {
    path: "GeneralsZH/Save/campaign/B.sav",
    bytes: [0, 1, 2, 255, 10, 13],
    timestamp: 1_700_000_001_000,
    mode: 0o100644,
  },
  { path: "GeneralsZH/Save/empty.sav", text: "", timestamp: 1_700_000_002_000, mode: 0o100644 },
  { path: "GeneralsZH/Save", timestamp: 1_700_000_003_000, mode: 0o040755, directory: true },
  { path: "GeneralsZH/Save/campaign", timestamp: 1_700_000_004_000, mode: 0o040755, directory: true },
  { path: "GeneralsZH/Options.ini", text: "not a save", timestamp: 1_700_000_005_000, mode: 0o100644 },
];

async function openHarness(page: Page): Promise<void> {
  await page.goto("/harness/index.html");
  await page.waitForFunction(
    () => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true,
  );
}

async function seedSaves(page: Page, saves: readonly Seed[]): Promise<void> {
  await openHarness(page);
  await page.evaluate(
    async ({ db, store, saves }) => {
      const request = indexedDB.open(db, 21);
      request.onupgradeneeded = () => {
        const handle = request.result;
        if (!handle.objectStoreNames.contains(store)) {
          const objectStore = handle.createObjectStore(store);
          objectStore.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
      const handle = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = handle.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      const encoder = new TextEncoder();
      for (const save of saves) {
        objectStore.put(
          {
            timestamp: save.timestamp,
            mode: save.mode,
            contents: save.directory
              ? undefined
              : save.bytes !== undefined
                ? new Uint8Array(save.bytes)
                : encoder.encode(save.text ?? ""),
          },
          `${db}/${save.path}`,
        );
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      handle.close();
    },
    { db: DB, store: STORE, saves },
  );
}

async function readRaw(page: Page): Promise<RawEntry[]> {
  const entries = await page.evaluate(
    async ({ db, store }) => {
      const request = indexedDB.open(db, 21);
      const handle = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = handle.transaction(store, "readonly");
        const objectStore = transaction.objectStore(store);
        return await new Promise<
          { key: string; timestamp: number; mode: number; contents: number[] | null }[]
        >((resolve, reject) => {
          const rows: { key: string; timestamp: number; mode: number; contents: number[] | null }[] =
            [];
          const cursorRequest = objectStore.openCursor();
          cursorRequest.onerror = () => reject(cursorRequest.error);
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor === null) {
              resolve(rows);
              return;
            }
            const value = cursor.value as {
              timestamp?: number;
              mode?: number;
              contents?: Uint8Array;
            };
            rows.push({
              key: String(cursor.key),
              timestamp: value.timestamp ?? 0,
              mode: value.mode ?? 0,
              contents: value.contents === undefined ? null : Array.from(value.contents),
            });
            cursor.continue();
          };
        });
      } finally {
        handle.close();
      }
    },
    { db: DB, store: STORE },
  );
  return entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

async function deleteAllDatabases(page: Page): Promise<void> {
  await openHarness(page);
  await page.evaluate(async () => {
    for (const database of await indexedDB.databases()) {
      if (database.name === undefined) continue;
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(database.name as string);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    }
  });
}

async function listSaves(page: Page): Promise<{ path: string; timestamp: number; data: number[] }[]> {
  return page.evaluate(async () => {
    const api = (window as unknown as {
      zhwp: { listSavedGames(): Promise<{ path: string; timestamp: number; data: Uint8Array }[]> };
    }).zhwp;
    const games = await api.listSavedGames();
    return games.map((game) => ({
      path: game.path,
      timestamp: game.timestamp,
      data: Array.from(game.data),
    }));
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    length += chunk.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

test("1: replacing the install leaves every IDBFS save and timestamp in place", async ({
  page,
}, info) => {
  await seedSaves(page, FILES);
  const before = await readRaw(page);
  expect(before.length).toBeGreaterThanOrEqual(3);

  const first = await installZip(info.outputPath("first"));
  await seedInstall(page, first);
  expect(await readRaw(page)).toEqual(before);

  const second = await installZip(info.outputPath("second"), undefined, {
    sizes: { "INIZH.big": 6_000 },
  });
  await seedInstall(page, second);
  expect(await readRaw(page)).toEqual(before);
});

test("2: clearing the stored archives leaves the saves and their timestamps", async ({ page }) => {
  await seedSaves(page, FILES);
  const before = await readRaw(page);

  await openHarness(page);
  await page.evaluate(async () => {
    const api = (window as unknown as { zhwp: { clearStored(): Promise<void> } }).zhwp;
    await api.clearStored();
  });

  expect(await readRaw(page)).toEqual(before);
});

test("3: listSavedGames returns only Save files, sorted, with exact bytes and timestamps", async ({
  page,
}) => {
  await seedSaves(page, FILES);
  await openHarness(page);

  const games = await listSaves(page);
  expect(games.map((game) => game.path)).toEqual([
    "Test A.SAV",
    "campaign/B.sav",
    "empty.sav",
  ]);
  expect(games[0].data).toEqual(Array.from(new TextEncoder().encode("save-one")));
  expect(games[1].data).toEqual([0, 1, 2, 255, 10, 13]);
  expect(games[2].data).toEqual([]);
  expect(games.map((game) => game.timestamp)).toEqual([
    1_700_000_000_000,
    1_700_000_001_000,
    1_700_000_002_000,
  ]);
});

test("4: a fresh profile lists zero saves and creates no database", async ({ page }) => {
  await deleteAllDatabases(page);
  const result = await page.evaluate(
    async (dbName: string) => {
      const api = (window as unknown as {
        zhwp: { listSavedGames(): Promise<unknown[]> };
      }).zhwp;
      const games = await api.listSavedGames();
      const databases = await indexedDB.databases();
      return {
        count: games.length,
        present: databases.some((database) => database.name === dbName),
      };
    },
    DB,
  );

  expect(result.count).toBe(0);
  expect(result.present).toBe(false);
});

test("5: the menu exports exactly the saved games as one ZIP", async ({ page }, info: TestInfo) => {
  await seedSaves(page, FILES);
  const expected = await listSaves(page);

  await page.goto("/app/index.html");
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets", { timeout: WAIT });
  await page.locator("#menu-button").click();
  await expect(page.locator("#menu")).toHaveAttribute("open", "");
  await expect(page.locator("#saves-summary")).toHaveText("Saved games: 3", { timeout: WAIT });

  const button = page.locator("#export-saves");
  await expect(button).toBeEnabled({ timeout: WAIT });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: WAIT }),
    button.click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^openzh-saves-\d{4}-\d{2}-\d{2}\.zip$/);
  const target = info.outputPath("saves-export.zip");
  await download.saveAs(target);
  const bytes = new Uint8Array(readFileSync(target));
  const entries = await openZip(new Blob([bytes]));

  expect(entries.map((entry) => entry.path)).toEqual(expected.map((game) => game.path));
  expect(entries.every((entry) => entry.method === 0)).toBe(true);
  for (let i = 0; i < entries.length; i++) {
    const data = await collect(entryStream(new Blob([bytes]), entries[i] as ZipEntry));
    expect(Array.from(data), entries[i].path).toEqual(expected[i].data);
  }
  await expect(page.locator("#saves-status")).toHaveText("Exported 3 saved games.");
});

test("6: with no saves the export button is disabled and nothing downloads", async ({ page }) => {
  await deleteAllDatabases(page);
  await page.goto("/app/index.html");
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets", { timeout: WAIT });
  await page.locator("#menu-button").click();

  await expect(page.locator("#saves-summary")).toHaveText("Saved games: none", { timeout: WAIT });
  await expect(page.locator("#export-saves")).toBeDisabled();
  await expect(page.locator("#saves-status")).toBeHidden();
});
