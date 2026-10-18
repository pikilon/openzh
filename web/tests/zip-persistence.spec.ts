import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { buildBig } from "./helpers/big";
import { buildZip, type BuildZipEntry } from "./helpers/zip";

// Issue #129: a stored install survives reloads and browser restarts, and an
// interrupted import resumes. The launcher is driven through /app/index.html,
// in one browser context per test, so a reload keeps the same OPFS profile.

const REQUIRED = ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"] as const;
const MB = 1024 * 1024;

interface ExpectedFile {
  path: string;
  data: Uint8Array;
}

function archiveData(label: string, padding = 0): Uint8Array {
  const entries = [{ path: `Data\\INI\\Default\\${label}.ini`, data: `${label}\nEnd\n` }];
  if (padding > 0) {
    entries.push({ path: `Data\\Padding\\${label}.bin`, data: new Uint8Array(padding) });
  }
  return buildBig(entries);
}

function archiveFile(name: string, padding = 0): ExpectedFile {
  const kind = name.toLowerCase().endsWith("zh.big") ? "zh" : "generals";
  return { path: `${kind}/${name}`, data: archiveData(name.replace(/\.big$/i, ""), padding) };
}

function smallEntries(): BuildZipEntry[] {
  return REQUIRED.map((name) => ({
    path: name,
    data: archiveFile(name).data,
    method: "store" as const,
  }));
}

async function smallZip(): Promise<Uint8Array> {
  return buildZip(smallEntries());
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function expectedArchives(): Map<string, { size: number; sha256: string }> {
  return new Map(
    REQUIRED.map((name) => {
      const file = archiveFile(name);
      return [file.path, { size: file.data.length, sha256: sha256(file.data) }];
    }),
  );
}

async function openLauncher(page: Page): Promise<void> {
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
}

async function pickZips(page: Page, files: { name: string; bytes: Uint8Array }[]): Promise<void> {
  await page.locator("#zip-input").setInputFiles(
    files.map((file) => ({
      name: file.name,
      mimeType: "application/zip",
      buffer: Buffer.from(file.bytes),
    })),
  );
}

interface StoredEntry {
  path: string;
  size: number;
  sha256: string;
}

// Every file stored under zhwp, as paths relative to it ("zh/INIZH.big",
// "extra/Data/notes.txt"), with its bytes hashed in the page.
async function storedEntries(page: Page): Promise<StoredEntry[]> {
  return page.evaluate(async () => {
    const digestOf = async (file: File): Promise<string> => {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    };
    const entries: { path: string; size: number; sha256: string }[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of (dir as any).entries()) {
        const path = prefix === "" ? name : `${prefix}/${name}`;
        if (handle.kind === "directory") {
          await walk(handle as FileSystemDirectoryHandle, path);
        } else {
          const file = await (handle as FileSystemFileHandle).getFile();
          entries.push({ path, size: file.size, sha256: await digestOf(file) });
        }
      }
    };
    try {
      const root = await navigator.storage.getDirectory();
      let zhwp: FileSystemDirectoryHandle;
      try {
        zhwp = await root.getDirectoryHandle("zhwp");
      } catch {
        return entries;
      }
      await walk(zhwp, "");
    } catch {
      // No storage at all: nothing is stored.
    }
    return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  });
}

// Paths and sizes only: cheap enough to poll while a 40 MB import runs.
async function storedSizes(page: Page): Promise<{ path: string; size: number }[]> {
  return page.evaluate(async () => {
    const entries: { path: string; size: number }[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of (dir as any).entries()) {
        const path = prefix === "" ? name : `${prefix}/${name}`;
        if (handle.kind === "directory") {
          await walk(handle as FileSystemDirectoryHandle, path);
        } else {
          const file = await (handle as FileSystemFileHandle).getFile();
          entries.push({ path, size: file.size });
        }
      }
    };
    try {
      const root = await navigator.storage.getDirectory();
      let zhwp: FileSystemDirectoryHandle;
      try {
        zhwp = await root.getDirectoryHandle("zhwp");
      } catch {
        return entries;
      }
      await walk(zhwp, "");
    } catch {
      // No storage at all: nothing is stored.
    }
    return entries;
  });
}

function archivesOf(entries: StoredEntry[]): StoredEntry[] {
  return entries.filter((entry) => entry.path.endsWith(".big"));
}

// The real listExtra from the wrapper, not a re-implementation of it.
async function listExtra(page: Page): Promise<{ path: string; size: number }[]> {
  return page.evaluate(async () => {
    const api = (await import("/dist/test-api.js")) as {
      listExtra(): Promise<{ path: string; size: number }[]>;
    };
    return api.listExtra();
  });
}

test("1: a stored install survives a reload with no ZIP request", async ({ page }) => {
  const zipRequests: string[] = [];
  page.on("request", (request) => {
    if (/\.zip(?:$|\?)/i.test(request.url())) zipRequests.push(request.url());
  });

  await openLauncher(page);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");

  zipRequests.length = 0;
  await page.reload();

  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
  await expect(page.locator("#status")).not.toHaveText("Importing");
  expect(zipRequests).toEqual([]);
});

test("2: after a forced failure on the third file, a second import writes only the other files and ends Ready", async ({
  page,
}) => {
  // Fail the third archive's write, so its writable is discarded and the
  // fourth is aborted: the first two are the completed imports.
  await page.addInitScript(() => {
    const pageWindow = window as unknown as {
      __createWritable: (this: FileSystemFileHandle, options?: unknown) => Promise<FileSystemWritableFileStream>;
      __failThird: boolean;
      __calls: number;
      __writes: Record<string, number>;
    };
    pageWindow.__createWritable = FileSystemFileHandle.prototype.createWritable;
    pageWindow.__failThird = true;
    pageWindow.__calls = 0;
    pageWindow.__writes = {};
    FileSystemFileHandle.prototype.createWritable = async function (options?: unknown) {
      const stream = await pageWindow.__createWritable.call(this, options);
      if (pageWindow.__failThird) {
        pageWindow.__calls += 1;
        if (pageWindow.__calls === 3) {
          stream.write = async () => {
            throw new DOMException("forced failure", "NotAllowedError");
          };
        }
        return stream;
      }
      const name = this.name;
      pageWindow.__writes[name] = 0;
      const write = stream.write.bind(stream);
      stream.write = async (chunk: unknown) => {
        pageWindow.__writes[name] += 1;
        return write(chunk as Blob);
      };
      return stream;
    };
  });

  await openLauncher(page);
  const zip = await smallZip();
  await pickZips(page, [{ name: "game.zip", bytes: zip }]);

  await expect(page.locator("#status")).toHaveText("Import failed", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 2 archives");
  const expected = expectedArchives();
  const first = archivesOf(await storedEntries(page));
  expect(first.map((entry) => entry.path)).toEqual(["zh/INIZH.big", "zh/W3DZH.big"]);
  for (const entry of first) {
    expect(entry.sha256, entry.path).toBe((expected.get(entry.path) as { sha256: string }).sha256);
  }

  // The same ZIP again: only the two missing archives are written.
  await page.evaluate(() => {
    const pageWindow = window as unknown as {
      __failThird: boolean;
      __calls: number;
      __writes: Record<string, number>;
    };
    pageWindow.__failThird = false;
    pageWindow.__calls = 0;
    pageWindow.__writes = {};
  });
  await pickZips(page, [{ name: "game.zip", bytes: zip }]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();

  const writes = await page.evaluate(
    () => (window as unknown as { __writes: Record<string, number> }).__writes,
  );
  expect(writes["INIZH.big"]).toBe(0);
  expect(writes["W3DZH.big"]).toBe(0);
  expect(writes["INI.big"]).toBeGreaterThan(0);
  expect(writes["W3D.big"]).toBeGreaterThan(0);
  expect(Object.values(writes).filter((count) => count === 0)).toHaveLength(2);

  const stored = archivesOf(await storedEntries(page));
  expect(stored).toHaveLength(4);
  for (const entry of stored) {
    const wanted = expected.get(entry.path);
    expect(wanted, entry.path).toBeDefined();
    expect(entry.size, entry.path).toBe((wanted as { size: number }).size);
    expect(entry.sha256, entry.path).toBe((wanted as { sha256: string }).sha256);
  }
});

test("3: a reload midway through a 40 MB import leaves only complete archives, and a new import completes the rest", async ({
  page,
}, info) => {
  // Four padded archives make the ZIP ~40 MB; the expected bytes are the
  // padded ones, so a partial write cannot pass for a complete archive.
  const padding = [2 * MB, 12 * MB, 12 * MB, 14 * MB];
  const expected = new Map(
    REQUIRED.map((name, index) => {
      const file = archiveFile(name, padding[index]);
      return [file.path, { size: file.data.length, sha256: sha256(file.data) }];
    }),
  );
  const padded: BuildZipEntry[] = REQUIRED.map((name, index) => ({
    path: name,
    data: archiveFile(name, padding[index]).data,
    method: "store",
  }));
  const zipPath = info.outputPath("large-game.zip");
  writeFileSync(zipPath, await buildZip(padded));

  // Slow the second archive's close so the reload reliably lands while the
  // import is still running, after the first archive is committed.
  await page.addInitScript(() => {
    const pageWindow = window as unknown as {
      __createWritable: (this: FileSystemFileHandle, options?: unknown) => Promise<FileSystemWritableFileStream>;
      __calls: number;
    };
    pageWindow.__createWritable = FileSystemFileHandle.prototype.createWritable;
    pageWindow.__calls = 0;
    FileSystemFileHandle.prototype.createWritable = async function (options?: unknown) {
      const stream = await pageWindow.__createWritable.call(this, options);
      pageWindow.__calls += 1;
      if (pageWindow.__calls === 2) {
        const close = stream.close.bind(stream);
        stream.close = async () => {
          await new Promise((resolve) => setTimeout(resolve, 6000));
          return close();
        };
      }
      return stream;
    };
  });

  await openLauncher(page);
  await page.locator("#zip-input").setInputFiles(zipPath);

  // Wait for the first archive to be complete (its expected size), then reload
  // while the second one is still open.
  await expect
    .poll(
      async () => {
        const entries = (await storedSizes(page)).filter((entry) =>
          entry.path.endsWith(".big"),
        );
        return entries.filter(
          (entry) => entry.size === (expected.get(entry.path) as { size: number }).size,
        ).length;
      },
      { timeout: 60_000, intervals: [100, 200, 500] },
    )
    .toBeGreaterThanOrEqual(1);

  await page.reload();
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);

  const afterReload = archivesOf(await storedEntries(page));
  expect(afterReload.length).toBeGreaterThanOrEqual(1);
  // Soft: a partial import must still be shown by the byte checks below.
  expect.soft(afterReload.length).toBeLessThan(4);
  const completeAfterReload = afterReload.filter((entry) => {
    const wanted = expected.get(entry.path) as { size: number; sha256: string };
    return entry.size === wanted.size && entry.sha256 === wanted.sha256;
  });
  for (const entry of afterReload) {
    const wanted = expected.get(entry.path) as { size: number; sha256: string };
    expect.soft(entry.size, entry.path).toBe(wanted.size);
    expect.soft(entry.sha256, entry.path).toBe(wanted.sha256);
  }
  // Incomplete placeholders must not be counted as stored archives.
  await expect
    .soft(page.locator("#stored-summary"))
    .toHaveText(`Stored: ${completeAfterReload.length} archives`);

  // Picking the same ZIP again writes the missing archives and nothing else.
  await page.locator("#zip-input").setInputFiles(zipPath);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");

  const complete = archivesOf(await storedEntries(page));
  expect(complete).toHaveLength(4);
  for (const entry of complete) {
    const wanted = expected.get(entry.path) as { size: number; sha256: string };
    expect(entry.size, entry.path).toBe(wanted.size);
    expect(entry.sha256, entry.path).toBe(wanted.sha256);
  }
});

test("4: persist() is called once per import and before the first OPFS write", async ({ page }) => {
  await page.addInitScript(() => {
    const pageWindow = window as unknown as { __events: string[] };
    pageWindow.__events = [];
    Object.defineProperty(navigator.storage, "persist", {
      value: async () => {
        pageWindow.__events.push("persist");
        return true;
      },
      configurable: true,
    });
    const createWritable = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (options?: unknown) {
      pageWindow.__events.push("write");
      return createWritable.call(this, options);
    };
  });

  await openLauncher(page);
  await page.evaluate(() => {
    (window as unknown as { __events: string[] }).__events.length = 0;
  });
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });

  const events = await page.evaluate(
    () => (window as unknown as { __events: string[] }).__events,
  );
  expect(events.filter((event) => event === "persist")).toHaveLength(1);
  const firstPersist = events.indexOf("persist");
  const firstWrite = events.indexOf("write");
  expect(firstPersist).toBeGreaterThanOrEqual(0);
  expect(firstWrite).toBeGreaterThan(firstPersist);
  expect(events.filter((event) => event === "write").length).toBeGreaterThanOrEqual(4);
});

test("5: when persist() resolves false the import ends Ready and the storage line says the browser may clear it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "persist", {
      value: async () => false,
      configurable: true,
    });
    Object.defineProperty(navigator.storage, "persisted", {
      value: async () => false,
      configurable: true,
    });
  });

  await openLauncher(page);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
  await expect(page.locator("#import-error")).toBeHidden();
  await expect(page.locator("#storage")).toContainText(
    /may be cleared by the browser when space is low/i,
  );
});

test("6: #clear removes archives and extras, and a reload shows nothing stored", async ({ page }) => {
  const extras = [
    { path: "readme.txt", data: new TextEncoder().encode("synthetic install notes\n") },
    { path: "Data/English/strings.csv", data: new TextEncoder().encode("name,value\nlord,1\n") },
  ];
  await openLauncher(page);
  await pickZips(page, [
    {
      name: "game.zip",
      bytes: await buildZip([
        ...smallEntries(),
        ...extras.map((extra) => ({ path: extra.path, data: extra.data, method: "store" as const })),
      ]),
    },
  ]);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  expect((await listExtra(page)).map((entry) => entry.path)).toHaveLength(2);

  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
  await expect(page.locator("#play")).toBeDisabled();

  await page.reload();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
  await expect(page.locator("#play")).toBeDisabled();
  expect(await listExtra(page)).toEqual([]);
  expect(await storedEntries(page)).toEqual([]);
});

test("7: extra files survive a reload and listExtra still returns them", async ({ page }) => {
  const encoder = new TextEncoder();
  const extras = [
    { path: "readme.txt", data: encoder.encode("synthetic install notes\n") },
    { path: "Data/English/strings.csv", data: encoder.encode("name,value\nlord,1\n") },
    { path: "Data/English/deeper/notes.txt", data: encoder.encode("nested extra\n") },
  ];
  await openLauncher(page);
  await pickZips(page, [
    {
      name: "game.zip",
      bytes: await buildZip([
        ...smallEntries(),
        ...extras.map((extra) => ({ path: extra.path, data: extra.data, method: "store" as const })),
      ]),
    },
  ]);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");

  await page.reload();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();

  const listed = await listExtra(page);
  expect(
    listed.map((entry) => ({ path: entry.path, size: entry.size })),
  ).toEqual(
    extras
      .map((extra) => ({ path: extra.path, size: extra.data.length }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  );
  const bytes = await storedEntries(page);
  for (const extra of extras) {
    const stored = bytes.find((entry) => entry.path === `extra/${extra.path}`);
    expect(stored, extra.path).toBeDefined();
    expect(stored?.size, extra.path).toBe(extra.data.length);
    expect(stored?.sha256, extra.path).toBe(sha256(extra.data));
  }
});
