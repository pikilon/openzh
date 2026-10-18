import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { buildZip, corrupt, type BuildZipEntry } from "./helpers/zip";
import { installZip } from "./helpers/install-zip";
import {
  clearStored,
  launcherUrl,
  removeStoredArchive,
  RESOLVES,
  seedInstall,
  START_TIMEOUT,
  waitForState,
  warningSamples,
  watchWarning,
} from "./helpers/launcher";

// Issue #157: loading ZIPs replaces the previous install. Page tests go through
// /harness/index.html like zip-import.spec.ts; the launcher tests drive
// /app/index.html like launcher-zip.spec.ts. Issue #159: a complete install
// starts the engine by itself, so a stored previous install is seeded through
// the harness and one required archive removed to keep the shell on the loader
// (the same migration launcher-zip.spec.ts uses).

const encoder = new TextEncoder();

interface RequiredFile {
  kind: "zh" | "generals";
  name: string;
  data: Uint8Array;
}

const REQUIRED_LAYOUT = [
  { kind: "zh", name: "INIZH.big" },
  { kind: "zh", name: "W3DZH.big" },
  { kind: "generals", name: "INI.big" },
  { kind: "generals", name: "W3D.big" },
] as const;

const KIND_ORDER: Record<RequiredFile["kind"], number> = { zh: 0, generals: 1 };

function bytes(size: number, seed = 0): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

function requiredFiles(
  sizes: number[] = [4096, 8192, 2048, 16384],
  seedBase = 1,
): RequiredFile[] {
  return REQUIRED_LAYOUT.map((entry, index) => ({
    ...entry,
    data: bytes(sizes[index], seedBase + index),
  }));
}

function archiveEntry(file: RequiredFile): { path: string; data: Uint8Array } {
  return { path: file.name, data: file.data };
}

function zipEntries(files: RequiredFile[]): BuildZipEntry[] {
  return files.map((file) => ({
    path: file.name,
    data: file.data,
    method: "store" as const,
  }));
}

function sortedStored(files: RequiredFile[]): { kind: string; name: string; size: number }[] {
  return [...files]
    .sort(
      (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name),
    )
    .map((file) => ({ kind: file.kind, name: file.name, size: file.data.length }));
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function extraRelative(path: string): string {
  return path.startsWith("extra/") ? path.slice("extra/".length) : path;
}

interface StoredEntry {
  path: string;
  size: number;
  sha256: string;
}

// Everything under zhwp, as paths relative to it ("zh/INIZH.big",
// "extra/old/notes.txt"), with its bytes hashed in the page.
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

function storedPathOfArchive(file: { kind: string; name: string }): string {
  return `${file.kind}/${file.name}`;
}

function expectedEntries(
  archives: { kind: string; name: string; data: Uint8Array }[],
  extras: { path: string; data: Uint8Array }[] = [],
): StoredEntry[] {
  return [
    ...archives.map((file) => ({
      path: storedPathOfArchive(file),
      size: file.data.length,
      sha256: sha256(file.data),
    })),
    ...extras.map((extra) => ({
      path: `extra/${extra.path}`,
      size: extra.data.length,
      sha256: sha256(extra.data),
    })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/harness/index.html");
  await page.waitForFunction(
    () => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true,
  );
  await page.evaluate(() => (window as any).zhwp.clearStored());
}

// Stores a complete install through the harness (no engine holds its files),
// then removes one required archive so the #159 shell shows the loader instead
// of starting the game. The launcher tests below pick ZIPs from there.
const LAUNCHER_ARCHIVES = [
  "generals/INI.big",
  "generals/W3D.big",
  "zh/INIZH.big",
  "zh/W3DZH.big",
];

async function seedLauncherInstall(
  page: Page,
  entries: BuildZipEntry[],
  expectedFiles: string[],
  remainingArchives: number,
): Promise<void> {
  await openHarness(page);
  await importZips(page, entries);
  expect(await storedFiles(page)).toEqual([...expectedFiles].sort());
  await removeStoredArchive(page, "generals/INI.big");

  await page.goto(launcherUrl(RESOLVES));
  await expect(page.locator("#topbar")).toBeVisible();
  await waitForState(page, "no-assets");
  // One of the four required archives is gone, so the shell lists the rest.
  await expect(page.locator("#stored-summary")).toHaveText(
    `Stored: ${remainingArchives} archives`,
  );
}

interface ZipFixture {
  name: string;
  bytes?: Uint8Array;
  path?: string;
}

// A file input is the cheapest way to hand a Blob to the page: setInputFiles
// transfers bytes, while page.evaluate arguments are JSON.
async function attachZips(page: Page, fixtures: ZipFixture[]): Promise<void> {
  await page.evaluate(() => {
    let input = document.getElementById("zip-fixtures") as HTMLInputElement | null;
    if (input === null) {
      input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.id = "zip-fixtures";
      input.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
      document.body.append(input);
    }
  });
  await page.setInputFiles(
    "#zip-fixtures",
    fixtures.map((fixture) =>
      fixture.path === undefined
        ? {
            name: fixture.name,
            mimeType: "application/zip",
            buffer: Buffer.from(fixture.bytes as Uint8Array),
          }
        : fixture.path,
    ),
  );
}

// Imports whatever ZIPs are attached to the harness input.
async function importAttached(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    return z.importZips(Array.from(input.files ?? []));
  });
}

async function importZips(page: Page, entries: BuildZipEntry[]): Promise<any> {
  await attachZips(page, [{ name: "install.zip", bytes: await buildZip(entries) }]);
  return importAttached(page);
}

async function attemptAttached(page: Page): Promise<{ result?: any; error?: any }> {
  return page.evaluate(async () => {
    const z = (window as any).zhwp;
    const t = (window as any).__zipTest;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const captured = await t.capture(() => z.importZips(Array.from(input.files ?? [])));
    return captured.error === undefined
      ? { result: captured.value }
      : { error: t.errorOf(captured.error) };
  });
}

async function listStored(page: Page): Promise<{ kind: string; name: string; size: number }[]> {
  return page.evaluate(() => (window as any).zhwp.listStored());
}

async function listExtra(page: Page): Promise<{ path: string; size: number }[]> {
  const listed = await page.evaluate(() => (window as any).zhwp.listExtra());
  return listed.map((entry: { path: string; size: number }) => ({
    path: extraRelative(entry.path),
    size: entry.size,
  }));
}

// Records every #status value the page shows.
async function watchStatus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const status = document.getElementById("status");
    if (status === null) throw new Error("missing #status");
    const seen: string[] = [];
    (window as unknown as { __statusSeen: string[] }).__statusSeen = seen;
    const push = () => {
      const text = status.textContent?.trim() ?? "";
      if (seen[seen.length - 1] !== text) seen.push(text);
    };
    push();
    new MutationObserver(push).observe(status, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

async function statusSeen(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __statusSeen: string[] }).__statusSeen,
  );
}

// Every file stored under zhwp, as paths relative to it ("zh/INIZH.big").
async function storedFiles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const paths: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of (dir as any).entries()) {
        const path = prefix === "" ? name : `${prefix}/${name}`;
        if (handle.kind === "directory") {
          await walk(handle as FileSystemDirectoryHandle, path);
        } else {
          paths.push(path as string);
        }
      }
    };
    try {
      const root = await navigator.storage.getDirectory();
      let zhwp: FileSystemDirectoryHandle;
      try {
        zhwp = await root.getDirectoryHandle("zhwp");
      } catch {
        return paths.sort();
      }
      await walk(zhwp, "");
    } catch {
      // No storage at all: nothing is stored.
    }
    return paths.sort();
  });
}

async function pickZips(
  page: Page,
  files: { name: string; bytes: Uint8Array }[],
): Promise<void> {
  await page.locator("#zip-input").setInputFiles(
    files.map((file) => ({
      name: file.name,
      mimeType: "application/zip",
      buffer: Buffer.from(file.bytes),
    })),
  );
}

async function hasDirectory(page: Page, parts: string[]): Promise<boolean> {
  return page.evaluate(async (items) => {
    return (window as any).__zipTest.hasDirectory(items);
  }, parts);
}

async function hasFile(page: Page, parts: string[]): Promise<boolean> {
  return page.evaluate(async (items) => {
    return (window as any).__zipTest.hasFile(items);
  }, parts);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const hex = (data: Uint8Array): string =>
      Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const api = {
      async fileAt(parts: string[]): Promise<{ size: number; sha256: string }> {
        let dir: any = await navigator.storage.getDirectory();
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]);
        }
        const handle = await dir.getFileHandle(parts[parts.length - 1]);
        const file = await handle.getFile();
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        return { size: file.size, sha256: hex(new Uint8Array(digest)) };
      },
      async hasFile(parts: string[]): Promise<boolean> {
        try {
          await api.fileAt(parts);
          return true;
        } catch {
          return false;
        }
      },
      async hasDirectory(parts: string[]): Promise<boolean> {
        try {
          let dir: any = await navigator.storage.getDirectory();
          for (const part of parts) dir = await dir.getDirectoryHandle(part);
          return true;
        } catch {
          return false;
        }
      },
      async capture(fn: () => Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> {
        try {
          return { value: await fn() };
        } catch (error) {
          return { error };
        }
      },
      errorOf(error: any): any {
        return {
          name: error?.name ?? "",
          code: error?.code ?? null,
          detail: error?.detail ?? null,
          message: String(error?.message ?? error),
        };
      },
    };
    (window as any).__zipTest = api;
  });
});

test("1: importing B after A leaves only B's archives and extra files", async ({ page }) => {
  await openHarness(page);

  const required = requiredFiles();
  const aOnly: RequiredFile = {
    kind: "generals",
    name: "AONLY.big",
    data: bytes(1234, 90),
  };
  const aExtra = { path: "old/notes.txt", data: encoder.encode("old notes\n") };
  const bOnly: RequiredFile = {
    kind: "generals",
    name: "BONLY.big",
    data: bytes(2048, 91),
  };
  const bExtra = { path: "new/data.bin", data: encoder.encode("new data\n") };

  await importZips(page, [
    ...zipEntries(required),
    archiveEntry(aOnly),
    { path: aExtra.path, data: aExtra.data, method: "store" },
  ]);
  expect(await listStored(page)).toEqual(sortedStored([...required, aOnly]));

  const result = await importZips(page, [
    ...zipEntries(required),
    archiveEntry(bOnly),
    { path: bExtra.path, data: bExtra.data, method: "store" },
  ]);

  expect(await listStored(page)).toEqual(sortedStored([...required, bOnly]));
  expect(await listExtra(page)).toEqual([]);
  expect(await hasFile(page, ["zhwp", "generals", "AONLY.big"])).toBe(false);
  expect(await hasFile(page, ["zhwp", "extra", "old", "notes.txt"])).toBe(false);
  expect(await storedEntries(page)).toEqual(expectedEntries([...required, bOnly]));

  expect(result.written).toBe(1);
  expect(result.skipped).toBe(4);
  expect(result.extra).toBe(0);
  expect(result.removed).toBe(1);
  expect(result.freedBytes).toBe(aOnly.data.length);
});

test("2: a file with the same size is kept and skipped, a different size is replaced", async ({
  page,
}) => {
  await openHarness(page);

  const aRequired: RequiredFile[] = requiredFiles([100, 200, 300, 400], 1);
  const bRequired: RequiredFile[] = requiredFiles([100, 250, 300, 400], 1);
  // Same size, different bytes: the replace rule keeps the stored copy.
  bRequired[0] = { ...bRequired[0], data: bytes(100, 99) };
  const keepA = { path: "common/keep.bin", data: bytes(500, 30) };
  const keepB = { path: "common/keep.bin", data: bytes(500, 31) };
  const changeA = { path: "common/change.bin", data: bytes(600, 40) };
  const changeB = { path: "common/change.bin", data: bytes(700, 41) };

  await importZips(page, [
    ...zipEntries(aRequired),
    { path: keepA.path, data: keepA.data, method: "store" },
    { path: changeA.path, data: changeA.data, method: "store" },
  ]);
  await attachZips(page, [
    {
      name: "install-b.zip",
      bytes: await buildZip([
        ...zipEntries(bRequired),
        { path: keepB.path, data: keepB.data, method: "store" },
        { path: changeB.path, data: changeB.data, method: "store" },
      ]),
    },
  ]);

  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const proto = FileSystemFileHandle.prototype as any;
    const original = proto.createWritable;
    const writes: Record<string, number> = {};
    try {
      proto.createWritable = async function (options: any) {
        const stream = await original.call(this, options);
        const name = this.name;
        writes[name] = writes[name] ?? 0;
        const write = stream.write.bind(stream);
        stream.write = async (chunk: any) => {
          writes[name] += 1;
          return write(chunk);
        };
        return stream;
      };
      const input = document.getElementById("zip-fixtures") as HTMLInputElement;
      const result = await z.importZips(Array.from(input.files ?? []));
      return {
        result,
        writes,
        stored: await z.listStored(),
        files: {
          inizh: await (window as any).__zipTest.fileAt(["zhwp", "zh", "INIZH.big"]),
          w3dzh: await (window as any).__zipTest.fileAt(["zhwp", "zh", "W3DZH.big"]),
          keep: await (window as any).__zipTest.hasFile([
            "zhwp",
            "extra",
            "common",
            "keep.bin",
          ]),
          change: await (window as any).__zipTest.hasFile([
            "zhwp",
            "extra",
            "common",
            "change.bin",
          ]),
        },
      };
    } finally {
      proto.createWritable = original;
    }
  });

  // INIZH.big, INI.big and W3D.big kept by key and size; the extra files are
  // ignored (issue #162).
  expect(outcome.result.skipped).toBe(3);
  expect(outcome.result.written).toBe(1);
  expect(outcome.result.extra).toBe(0);
  expect(outcome.result.removed).toBe(1);
  expect(outcome.result.freedBytes).toBe(200);

  expect(outcome.writes["INIZH.big"] ?? 0).toBe(0);
  expect(outcome.writes["INI.big"] ?? 0).toBe(0);
  expect(outcome.writes["W3D.big"] ?? 0).toBe(0);
  expect(outcome.writes["keep.bin"] ?? 0).toBe(0);
  expect(outcome.writes["W3DZH.big"]).toBeGreaterThan(0);
  expect(outcome.writes["change.bin"] ?? 0).toBe(0);

  expect(outcome.stored).toEqual(sortedStored(bRequired));
  expect(outcome.files.inizh).toEqual({
    size: aRequired[0].data.length,
    sha256: sha256(aRequired[0].data),
  });
  expect(outcome.files.w3dzh).toEqual({
    size: bRequired[1].data.length,
    sha256: sha256(bRequired[1].data),
  });
  expect(outcome.files.keep).toBe(false);
  expect(outcome.files.change).toBe(false);
});

test("3: the result reports removed and freedBytes for A's files that were not kept", async ({
  page,
}) => {
  await openHarness(page);

  const required = requiredFiles([100, 200, 300, 400], 1);
  const aOnly: RequiredFile = {
    kind: "generals",
    name: "AONLY.big",
    data: bytes(1111, 50),
  };
  const aExtras = [
    { path: "old/a.txt", data: bytes(20, 51) },
    { path: "old/deeper/b.bin", data: bytes(30, 52) },
  ];
  const bOnly: RequiredFile = {
    kind: "generals",
    name: "BONLY.big",
    data: bytes(2222, 53),
  };
  const bExtra = { path: "new/c.txt", data: bytes(10, 54) };

  await importZips(page, [
    ...zipEntries(required),
    archiveEntry(aOnly),
    ...aExtras.map((extra) => ({
      path: extra.path,
      data: extra.data,
      method: "store" as const,
    })),
  ]);

  const result = await importZips(page, [
    ...zipEntries(required),
    archiveEntry(bOnly),
    { path: bExtra.path, data: bExtra.data, method: "store" },
  ]);

  expect(result.removed).toBe(1);
  expect(result.freedBytes).toBe(aOnly.data.length);
  expect(result.written).toBe(1);
  expect(result.skipped).toBe(4);
  expect(result.extra).toBe(0);
  expect(await storedEntries(page)).toEqual(expectedEntries([...required, bOnly]));
});

test("4: a missing archive, a non-ZIP and a truncated ZIP leave install A unchanged", async ({
  page,
}) => {
  await openHarness(page);

  const required = requiredFiles([100, 200, 300, 400], 1);
  const aOnly: RequiredFile = {
    kind: "generals",
    name: "AONLY.big",
    data: bytes(99, 60),
  };
  const aExtra = { path: "old/keep.txt", data: bytes(20, 61) };
  const aEntries: BuildZipEntry[] = [
    ...zipEntries(required),
    archiveEntry(aOnly),
    { path: aExtra.path, data: aExtra.data, method: "store" },
  ];

  const missing = await buildZip([
    { path: "INIZH.big", data: required[0].data, method: "store" },
    { path: "readme.txt", data: encoder.encode("not required\n"), method: "store" },
  ]);
  const plain = encoder.encode("this is not a ZIP archive at all, only plain bytes");
  const truncated = corrupt.cutCentralDirectory(
    await buildZip([
      ...zipEntries(required),
      { path: "new/other.txt", data: bytes(10, 62), method: "store" },
    ]),
  );

  const cases = [
    { label: "missing.zip", bytes: missing, code: "missing-archives" },
    { label: "plain.zip", bytes: plain, code: "not-a-zip" },
    { label: "truncated.zip", bytes: truncated, code: "truncated" },
  ];

  for (const testCase of cases) {
    await page.evaluate(() => (window as any).zhwp.clearStored());
    await importZips(page, aEntries);
    const before = await storedEntries(page);
    expect(before, testCase.label).toEqual(expectedEntries([...required, aOnly]));

    await attachZips(page, [{ name: testCase.label, bytes: testCase.bytes }]);
    const outcome = await attemptAttached(page);

    expect(outcome.error, testCase.label).not.toBeUndefined();
    expect(outcome.error.name, testCase.label).toBe("ImportError");
    expect(outcome.error.code, testCase.label).toBe(testCase.code);
    expect(await storedEntries(page), testCase.label).toEqual(before);
  }
});

test("5: an already aborted signal writes nothing, and aborting during removal leaves the unremoved files", async ({
  page,
}) => {
  await openHarness(page);

  const required = requiredFiles([100, 200, 300, 400], 1);
  const oldArchives: RequiredFile[] = ["OLD1.big", "OLD2.big", "OLD3.big"].map(
    (name, index) => ({
      kind: "generals" as const,
      name,
      data: bytes(300 + index, 70 + index),
    }),
  );
  const oldExtras = [
    { path: "old/one.txt", data: bytes(11, 74) },
    { path: "old/two.txt", data: bytes(12, 75) },
  ];
  const newArchive: RequiredFile = {
    kind: "generals",
    name: "NEW.big",
    data: bytes(900, 76),
  };
  const newExtra = { path: "new/only.txt", data: bytes(13, 77) };

  const aEntries: BuildZipEntry[] = [
    ...zipEntries(required),
    ...oldArchives.map(archiveEntry),
    ...oldExtras.map((extra) => ({
      path: extra.path,
      data: extra.data,
      method: "store" as const,
    })),
  ];
  const bEntries: BuildZipEntry[] = [
    ...zipEntries(required),
    archiveEntry(newArchive),
    { path: newExtra.path, data: newExtra.data, method: "store" },
  ];

  await importZips(page, aEntries);
  const before = await storedEntries(page);

  // Part 1: the signal is already aborted, so the call fails before opening
  // and before removing anything.
  await attachZips(page, [
    { name: "install-b.zip", bytes: await buildZip(bEntries) },
  ]);
  const aborted = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const t = (window as any).__zipTest;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const controller = new AbortController();
    controller.abort();
    const captured = await t.capture(() =>
      z.importZips(Array.from(input.files ?? []), { signal: controller.signal }),
    );
    return captured.error === undefined ? null : t.errorOf(captured.error);
  });
  expect(aborted).not.toBeNull();
  expect(aborted.name).toBe("ImportError");
  expect(aborted.code).toBe("aborted");
  expect(await storedEntries(page)).toEqual(before);

  // Part 2: abort while the stored install is being removed. The first
  // removal happens, then the import stops before opening any file for writing.
  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const t = (window as any).__zipTest;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const dirProto = FileSystemDirectoryHandle.prototype as any;
    const fileProto = FileSystemFileHandle.prototype as any;
    const originalRemove = dirProto.removeEntry;
    const originalWritable = fileProto.createWritable;
    const controller = new AbortController();
    const writes: Record<string, number> = {};
    let removals = 0;
    dirProto.removeEntry = async function (name: string, options?: any) {
      const result = await originalRemove.call(this, name, options);
      removals += 1;
      if (removals === 1) controller.abort();
      return result;
    };
    fileProto.createWritable = async function (options: any) {
      writes[this.name] = (writes[this.name] ?? 0) + 1;
      return originalWritable.call(this, options);
    };
    try {
      const captured = await t.capture(() =>
        z.importZips(Array.from(input.files ?? []), { signal: controller.signal }),
      );
      return {
        removals,
        writes,
        error: captured.error === undefined ? null : t.errorOf(captured.error),
        stored: await z.listStored(),
        extra: await z.listExtra(),
      };
    } finally {
      dirProto.removeEntry = originalRemove;
      fileProto.createWritable = originalWritable;
    }
  });

  expect(outcome.error).not.toBeNull();
  expect(outcome.error.name).toBe("ImportError");
  expect(outcome.error.code).toBe("aborted");
  expect(outcome.removals).toBeGreaterThanOrEqual(1);
  expect(outcome.writes).toEqual({});
  expect(outcome.stored.some((file: { name: string }) => file.name === "NEW.big")).toBe(
    false,
  );
  expect(
    outcome.extra.some((file: { path: string }) => extraRelative(file.path) === newExtra.path),
  ).toBe(false);

  // Whatever was not removed stays byte-identical; nothing new was written.
  const after = await storedEntries(page);
  expect(after.length).toBeLessThan(before.length);
  const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));
  for (const entry of after) expect(entry).toEqual(beforeByPath.get(entry.path));
});

test("6: a re-import after an interrupted import keeps the completed files and removes leftovers", async ({
  page,
}) => {
  await openHarness(page);

  const target = requiredFiles([100, 200, 300, 400], 1);
  const targetZip = await buildZip(zipEntries(target));
  await attachZips(page, [{ name: "install.zip", bytes: targetZip }]);

  // Fail the third write: the first two archives are the completed import.
  await page.evaluate(() => {
    const w = window as unknown as {
      __failThird: boolean;
      __calls: number;
      __writes: Record<string, number>;
      __createWritable: (this: FileSystemFileHandle, options?: any) => Promise<any>;
    };
    w.__failThird = true;
    w.__calls = 0;
    w.__writes = {};
    w.__createWritable = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (options?: any) {
      const stream = await w.__createWritable.call(this, options);
      if (w.__failThird) {
        w.__calls += 1;
        if (w.__calls === 3) {
          stream.write = async () => {
            throw new DOMException("forced failure", "NotAllowedError");
          };
        }
        return stream;
      }
      const name = this.name;
      w.__writes[name] = 0;
      const write = stream.write.bind(stream);
      stream.write = async (chunk: any) => {
        w.__writes[name] += 1;
        return write(chunk);
      };
      return stream;
    };
  });

  const interrupted = await attemptAttached(page);
  expect(interrupted.error).not.toBeUndefined();
  expect(interrupted.error.name).toBe("ImportError");
  const partial = await page.evaluate(() => (window as any).zhwp.listStored());
  expect(partial.map((file: { name: string }) => file.name)).toEqual([
    "INIZH.big",
    "W3DZH.big",
  ]);

  // Leftovers a previous import could have left behind, which these ZIPs do
  // not contain.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const zhwp = await root.getDirectoryHandle("zhwp", { create: true });
    const generals = await zhwp.getDirectoryHandle("generals", { create: true });
    const archive = await generals.getFileHandle("LEFTOVER.big", { create: true });
    const archiveWriter = await archive.createWritable();
    await archiveWriter.write(new Uint8Array(777));
    await archiveWriter.close();
    const extra = await zhwp.getDirectoryHandle("extra", { create: true });
    const leftover = await extra.getDirectoryHandle("Leftover", { create: true });
    const deep = await leftover.getDirectoryHandle("Deep", { create: true });
    const stale = await deep.getFileHandle("stale.bin", { create: true });
    const staleWriter = await stale.createWritable();
    await staleWriter.write(new Uint8Array(123));
    await staleWriter.close();
  });

  const outcome = await page.evaluate(async () => {
    const w = window as unknown as {
      __failThird: boolean;
      __calls: number;
      __writes: Record<string, number>;
    };
    w.__failThird = false;
    w.__calls = 0;
    w.__writes = {};
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const result = await z.importZips(Array.from(input.files ?? []));
    return {
      result,
      writes: w.__writes,
      stored: await z.listStored(),
      extra: await z.listExtra(),
    };
  });

  expect(outcome.result.written).toBe(2);
  expect(outcome.result.skipped).toBe(2);
  expect(outcome.result.removed).toBe(2);
  expect(outcome.result.freedBytes).toBe(777 + 123);
  expect(outcome.writes["INIZH.big"] ?? 0).toBe(0);
  expect(outcome.writes["W3DZH.big"] ?? 0).toBe(0);
  expect(outcome.writes["INI.big"]).toBeGreaterThan(0);
  expect(outcome.writes["W3D.big"]).toBeGreaterThan(0);
  expect(outcome.stored).toEqual(sortedStored(target));
  expect(outcome.extra).toEqual([]);
  expect(await storedEntries(page)).toEqual(expectedEntries(target));
});

test("7: a legacy extra/ tree is removed by the next import, empty directories included", async ({
  page,
}) => {
  await openHarness(page);

  const required = requiredFiles([100, 200, 300, 400], 1);
  await importZips(page, zipEntries(required));

  const legacy = [
    { path: "Old/keep.txt", data: bytes(20, 80) },
    { path: "Old/Deep/file.txt", data: bytes(30, 81) },
    { path: "Gone/only.txt", data: bytes(40, 82) },
  ];
  // An extra/ tree left by an import from before issue #162.
  await page.evaluate(async (items) => {
    const root = await navigator.storage.getDirectory();
    const zhwp = await root.getDirectoryHandle("zhwp", { create: true });
    const extra = await zhwp.getDirectoryHandle("extra", { create: true });
    for (const item of items) {
      const parts = item.path.split("/");
      let dir = extra;
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const writer = await file.createWritable();
      await writer.write(new Uint8Array(item.size));
      await writer.close();
    }
  }, legacy.map((entry) => ({ path: entry.path, size: entry.data.length })));

  const result = await importZips(page, zipEntries(required));

  expect(result.removed).toBe(3);
  expect(result.freedBytes).toBe(
    legacy.reduce((sum, entry) => sum + entry.data.length, 0),
  );
  expect(result.written).toBe(0);
  expect(result.skipped).toBe(4);
  expect(await listExtra(page)).toEqual([]);
  expect(await hasDirectory(page, ["zhwp", "extra", "Old"])).toBe(false);
  expect(await hasDirectory(page, ["zhwp", "extra", "Old", "Deep"])).toBe(false);
  expect(await hasDirectory(page, ["zhwp", "extra", "Gone"])).toBe(false);
  expect(await hasFile(page, ["zhwp", "extra", "Old", "keep.txt"])).toBe(false);
  expect(await hasFile(page, ["zhwp", "extra", "Old", "Deep", "file.txt"])).toBe(false);
  expect(await hasFile(page, ["zhwp", "extra", "Gone", "only.txt"])).toBe(false);
  expect(await storedEntries(page)).toEqual(expectedEntries(required));
});

test("8: picking ZIPs after an install replaces it and #status shows the removal first", async ({
  page,
}) => {
  const required = requiredFiles();
  const aOnly: RequiredFile = {
    kind: "generals",
    name: "AONLY.big",
    data: bytes(400, 90),
  };
  const aExtra = { path: "old/notes.txt", data: encoder.encode("old install\n") };
  const aEntries: BuildZipEntry[] = [
    ...zipEntries(required),
    archiveEntry(aOnly),
    { path: aExtra.path, data: aExtra.data, method: "store" },
  ];
  // The complete previous install A already fills the store; one required
  // archive is removed only so the #159 shell stays on the loader for the
  // second pick instead of starting A by itself.
  await seedLauncherInstall(
    page,
    aEntries,
    [
      ...required.map((file) => storedPathOfArchive(file)),
      storedPathOfArchive(aOnly),
    ],
    4,
  );

  const bArchives: RequiredFile[] = [
    { kind: "generals", name: "BONLY1.big", data: bytes(500, 91) },
    { kind: "generals", name: "BONLY2.big", data: bytes(600, 92) },
  ];
  const bExtra = { path: "new/notes.txt", data: encoder.encode("new install\n") };
  const bEntries: BuildZipEntry[] = [
    ...zipEntries(required),
    ...bArchives.map(archiveEntry),
    { path: bExtra.path, data: bExtra.data, method: "store" },
  ];

  await watchStatus(page);
  await pickZips(page, [{ name: "install-b.zip", bytes: await buildZip(bEntries) }]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await waitForState(page, "playing");
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 6 archives");

  const files = await storedFiles(page);
  expect(files).toEqual(
    [
      "generals/BONLY1.big",
      "generals/BONLY2.big",
      "generals/INI.big",
      "generals/W3D.big",
      "zh/INIZH.big",
      "zh/W3DZH.big",
    ].sort(),
  );
  expect(files.some((path) => path.endsWith("AONLY.big"))).toBe(false);
  expect(files.some((path) => path === "extra/old/notes.txt")).toBe(false);

  const seen = await statusSeen(page);
  const removing = seen.indexOf("Removing the previous install");
  const importing = seen.indexOf("Importing", removing + 1);
  const ready = seen.indexOf("Ready", importing + 1);
  expect(removing).toBeGreaterThanOrEqual(0);
  expect(importing).toBeGreaterThan(removing);
  expect(ready).toBeGreaterThan(importing);
});

test("9: picking a bad ZIP after an install shows the error and keeps the stored install", async ({
  page,
}) => {
  const required = requiredFiles();
  await seedLauncherInstall(
    page,
    zipEntries(required),
    required.map((file) => storedPathOfArchive(file)),
    3,
  );
  const before = await storedFiles(page);

  const bad = await buildZip([
    { path: "INIZH.big", data: required[0].data, method: "store" },
    { path: "readme.txt", data: encoder.encode("incomplete\n"), method: "store" },
  ]);
  await pickZips(page, [{ name: "incomplete.zip", bytes: bad }]);

  const error = page.locator("#import-error");
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("data-code", "missing-archives");
  await expect(page.locator("#status")).toHaveText("Import failed");
  // #159 removed #play: the failed pick leaves the shell on the loader and the
  // stored install untouched, so the player can pick a complete set instead.
  await waitForState(page, "no-assets");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 3 archives");
  expect(await storedFiles(page)).toEqual(before);
});

test("10: the storage warning is hidden when free space plus the bytes to remove covers the import", async ({
  page,
}, info) => {
  const bigSizes = {
    "INIZH.big": 60000,
    "W3DZH.big": 60000,
    "INI.big": 60000,
    "W3D.big": 60000,
  };
  const smallSizes = {
    "INIZH.big": 30000,
    "W3DZH.big": 30000,
    "INI.big": 30000,
    "W3D.big": 30000,
  };
  const aPath = await installZip(info.outputPath("hidden-a"), undefined, {
    sizes: bigSizes,
  });
  const bPath = await installZip(info.outputPath("hidden-b"), undefined, {
    sizes: smallSizes,
  });
  const aBytes = statSync(aPath).size;
  const bBytes = statSync(bPath).size;
  // Free space alone cannot cover B; the 240 kB A leaves behind can.
  expect(aBytes).toBeGreaterThan(bBytes);
  expect(1 + aBytes).toBeGreaterThan(bBytes);

  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "estimate", {
      value: async () => ({ usage: 0, quota: 1 }),
      configurable: true,
    });
  });
  // #159: seed the complete previous install through the harness, remove one
  // required archive so the shell shows the loader, then pick B. The automatic
  // start would otherwise hide the loader before the pick.
  await clearStored(page);
  await seedInstall(page, aPath);
  expect(await storedFiles(page)).toEqual([...LAUNCHER_ARCHIVES].sort());
  await removeStoredArchive(page, "generals/INI.big");

  await page.goto(launcherUrl(RESOLVES));
  await expect(page.locator("#topbar")).toBeVisible();
  await waitForState(page, "no-assets");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 3 archives");
  await watchWarning(page);

  await page.locator("#zip-input").setInputFiles(bPath);
  await waitForState(page, "playing");
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  // The loader hides with the auto-started game, so the recorded samples prove
  // the warning never appeared instead of a visibility check on a hidden panel.
  const shown = (await warningSamples(page)).filter((sample) => sample.visible);
  expect(shown).toEqual([]);
  expect(await storedFiles(page)).toEqual([...LAUNCHER_ARCHIVES].sort());
});

test("10: the storage warning is shown when free space plus the bytes to remove does not cover it", async ({
  page,
}, info) => {
  const smallSizes = {
    "INIZH.big": 2000,
    "W3DZH.big": 2000,
    "INI.big": 2000,
    "W3D.big": 2000,
  };
  const bigSizes = {
    "INIZH.big": 80000,
    "W3DZH.big": 80000,
    "INI.big": 80000,
    "W3D.big": 80000,
  };
  const aPath = await installZip(info.outputPath("shown-a"), undefined, {
    sizes: smallSizes,
  });
  const bPath = await installZip(info.outputPath("shown-b"), undefined, {
    sizes: bigSizes,
  });
  const aBytes = statSync(aPath).size;
  const bBytes = statSync(bPath).size;
  expect(1 + aBytes).toBeLessThan(bBytes);

  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "estimate", {
      value: async () => ({ usage: 0, quota: 1 }),
      configurable: true,
    });
  });
  // Same #159 setup as the hidden case: seed A through the harness, leave the
  // shell on the loader and pick B.
  await clearStored(page);
  await seedInstall(page, aPath);
  expect(await storedFiles(page)).toEqual([...LAUNCHER_ARCHIVES].sort());
  await removeStoredArchive(page, "generals/INI.big");

  await page.goto(launcherUrl(RESOLVES));
  await expect(page.locator("#topbar")).toBeVisible();
  await waitForState(page, "no-assets");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 3 archives");
  await watchWarning(page);

  await page.locator("#zip-input").setInputFiles(bPath);
  await waitForState(page, "playing");
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");

  const warning = page.locator("#storage-warning");
  await expect(warning).toHaveText(
    /^The browser reports 1 B available; the import needs \d+(?:\.\d+)? (?:B|KB|MB|GB)\.$/,
  );
  // The warning is shown before the writes; the auto-started game then hides
  // the loader, so the samples are what proves it appeared.
  await expect
    .poll(
      async () =>
        (await warningSamples(page)).some(
          (sample) =>
            sample.visible &&
            /^The browser reports 1 B available; the import needs \d+(?:\.\d+)? (?:B|KB|MB|GB)\.$/.test(
              sample.text,
            ),
        ),
      { timeout: START_TIMEOUT },
    )
    .toBe(true);
});
