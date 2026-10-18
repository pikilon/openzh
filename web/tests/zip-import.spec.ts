import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { buildZip, corrupt, type BuildZipEntry } from "./helpers/zip";

// Page tests through /harness/index.html, like store.spec.ts: importZips,
// listStored, listExtra and clearStored are the real wrapper code loaded by the
// harness page. ZIP fixtures are built in Node with the #126 helper and handed
// to the page as File inputs, so no fixture bytes travel through
// page.evaluate.

const encoder = new TextEncoder();

interface RequiredFile {
  kind: "zh" | "generals";
  name: string;
  path: string;
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

function requiredFiles(sizes: number[] = [4096, 8192, 2048, 16384]): RequiredFile[] {
  return REQUIRED_LAYOUT.map((entry, index) => ({
    ...entry,
    path: entry.name,
    data: bytes(sizes[index], index + 1),
  }));
}

function zipEntries(files: RequiredFile[]): BuildZipEntry[] {
  return files.map((file) => ({ path: file.path, data: file.data, method: "store" }));
}

function sortedStored(files: RequiredFile[]): { kind: string; name: string; size: number }[] {
  return [...files]
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name),
    )
    .map((file) => ({ kind: file.kind, name: file.name, size: file.data.length }));
}

function sortedArchives(files: RequiredFile[]): { kind: string; name: string; size: number }[] {
  return sortedStored(files);
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function expectedBytes(files: RequiredFile[]): { size: number; sha256: string }[] {
  return files.map((file) => ({ size: file.data.length, sha256: sha256(file.data) }));
}

interface ZipFixture {
  name: string;
  bytes?: Uint8Array;
  path?: string; // for fixtures over Playwright's 50 MB buffer limit
}

async function open(page: Page): Promise<void> {
  await page.goto("/harness/index.html");
  await page.waitForFunction(
    () => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true,
  );
}

// A file input is the cheapest way to hand a Blob of any size to the page:
// page.evaluate arguments are JSON, but setInputFiles transfers bytes.
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

async function readStored(
  page: Page,
  files: RequiredFile[],
): Promise<{ size: number; sha256: string }[]> {
  return page.evaluate(async (items) => {
    const t = (window as any).__zipTest;
    const out: { size: number; sha256: string }[] = [];
    for (const item of items) out.push(await t.fileAt(item));
    return out;
  }, files.map((file) => ["zhwp", file.kind, file.name]));
}

function extraParts(...segments: string[]): string[] {
  return ["zhwp", "extra", ...segments];
}

function splitPath(path: string): string[] {
  return path.split("/");
}

// listExtra's path is the entry path under extra/; accept the stored prefix
// "extra/" too because the brief leaves that representation open.
function extraRelative(path: string): string {
  return path.startsWith("extra/") ? path.slice("extra/".length) : path;
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
  await open(page);
  await page.evaluate(() => (window as any).zhwp.clearStored());
});

test("1: one ZIP stores the four REQUIRED archives at zhwp/<kind>/<name> and listStored lists only them", async ({
  page,
}) => {
  const files = requiredFiles();
  await attachZips(page, [{ name: "game.zip", bytes: await buildZip(zipEntries(files)) }]);

  const result = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    return z.importZips(Array.from(input.files ?? []));
  });
  expect(result).toEqual({
    written: 4,
    skipped: 0,
    extra: 0,
    removed: 0,
    freedBytes: 0,
    archives: sortedArchives(files),
  });

  expect(await page.evaluate(() => (window as any).zhwp.listStored())).toEqual(
    sortedStored(files),
  );
  expect(await readStored(page, files)).toEqual(expectedBytes(files));
});

test("2: non-.big files, nested folders included, go under extra/ and listExtra is sorted", async ({
  page,
}) => {
  const files = requiredFiles();
  const extras = [
    { path: "Data/English/strings.csv", data: encoder.encode("name,value\nlord,1\n") },
    { path: "readme.txt", data: encoder.encode("synthetic game data\n") },
  ];
  const zip = await buildZip([
    ...zipEntries(files),
    { path: "Data/", data: new Uint8Array(0), method: "store" },
    { path: "Data/English/", data: new Uint8Array(0), method: "store" },
    ...extras.map((extra) => ({ path: extra.path, data: extra.data, method: "store" as const })),
  ]);
  await attachZips(page, [{ name: "game.zip", bytes: zip }]);

  const result = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    return z.importZips(Array.from(input.files ?? []));
  });
  expect(result).toEqual({
    written: 6,
    skipped: 0,
    extra: 2,
    removed: 0,
    freedBytes: 0,
    archives: sortedArchives(files),
  });
  expect(await page.evaluate(() => (window as any).zhwp.listStored())).toEqual(
    sortedStored(files),
  );

  const listed = await page.evaluate(() => (window as any).zhwp.listExtra());
  const paths = listed.map((entry: { path: string }) => entry.path);
  expect(paths).toEqual([...paths].sort());
  expect(
    listed.map((entry: { path: string; size: number }) => ({
      path: extraRelative(entry.path),
      size: entry.size,
    })),
  ).toEqual(
    extras
      .map((extra) => ({ path: extra.path, size: extra.data.length }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  );

  const stored = await page.evaluate(async (items) => {
    const t = (window as any).__zipTest;
    const out: { size: number; sha256: string }[] = [];
    for (const item of items) out.push(await t.fileAt(item));
    return out;
  }, extras.map((extra) => extraParts(...splitPath(extra.path))));
  expect(stored).toEqual(
    extras.map((extra) => ({ size: extra.data.length, sha256: sha256(extra.data) })),
  );
  const shape = await page.evaluate(async () => {
    const t = (window as any).__zipTest;
    return {
      dataIsDirectory: await t.hasDirectory(["zhwp", "extra", "Data"]),
      dataIsFile: await t.hasFile(["zhwp", "extra", "Data"]),
    };
  });
  expect(shape).toEqual({ dataIsDirectory: true, dataIsFile: false });
});

test("3: two ZIPs, one per game, import as one install and the first duplicate path wins", async ({
  page,
}) => {
  const zh = requiredFiles().filter((file) => file.kind === "zh");
  const generals = requiredFiles().filter((file) => file.kind === "generals");
  const firstInizh = bytes(4096, 41);
  const secondInizh = bytes(5000, 42);
  const firstExtra = encoder.encode("first copy\n");
  const secondExtra = encoder.encode("second copy, longer\n");

  const firstZip = await buildZip([
    { path: "Zero Hour/INIZH.big", data: firstInizh, method: "store" },
    { path: "Zero Hour/W3DZH.big", data: zh[1].data, method: "store" },
    { path: "shared/config.ini", data: firstExtra, method: "store" },
  ]);
  const secondZip = await buildZip([
    ...generals.map((file) => ({ path: `Generals/${file.name}`, data: file.data, method: "store" as const })),
    { path: "Other/INIZH.big", data: secondInizh, method: "store" },
    { path: "shared/config.ini", data: secondExtra, method: "store" },
  ]);
  await attachZips(page, [
    { name: "zero-hour.zip", bytes: firstZip },
    { name: "generals.zip", bytes: secondZip },
  ]);

  const result = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    return z.importZips(Array.from(input.files ?? []));
  });
  expect(result.written).toBe(5);
  expect(result.archives).toEqual([
    { kind: "zh", name: "INIZH.big", size: firstInizh.length },
    { kind: "zh", name: "W3DZH.big", size: zh[1].data.length },
    { kind: "generals", name: "INI.big", size: generals[0].data.length },
    { kind: "generals", name: "W3D.big", size: generals[1].data.length },
  ]);
  expect(await page.evaluate(() => (window as any).zhwp.listStored())).toEqual([
    { kind: "zh", name: "INIZH.big", size: firstInizh.length },
    { kind: "zh", name: "W3DZH.big", size: zh[1].data.length },
    { kind: "generals", name: "INI.big", size: generals[0].data.length },
    { kind: "generals", name: "W3D.big", size: generals[1].data.length },
  ]);

  const stored = await page.evaluate(async () => {
    const t = (window as any).__zipTest;
    return {
      inizh: await t.fileAt(["zhwp", "zh", "INIZH.big"]),
      extra: await t.fileAt(["zhwp", "extra", "shared", "config.ini"]),
      listedExtra: await (window as any).zhwp.listExtra(),
    };
  });
  expect(stored.inizh).toEqual({
    size: firstInizh.length,
    sha256: sha256(firstInizh),
  });
  expect(stored.extra).toEqual({
    size: firstExtra.length,
    sha256: sha256(firstExtra),
  });
  expect(
    stored.listedExtra.map((entry: { path: string; size: number }) => ({
      path: extraRelative(entry.path),
      size: entry.size,
    })),
  ).toEqual([{ path: "shared/config.ini", size: firstExtra.length }]);
});

test("4: a set missing a REQUIRED archive throws missing-archives and stores nothing", async ({
  page,
}) => {
  const zip = await buildZip([
    { path: "INIZH.big", data: bytes(512, 51), method: "store" },
    { path: "readme.txt", data: encoder.encode("other files must not be stored\n"), method: "store" },
    { path: "Data/", data: new Uint8Array(0), method: "store" },
  ]);
  await attachZips(page, [{ name: "incomplete.zip", bytes: zip }]);

  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const t = (window as any).__zipTest;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const captured = await t.capture(() => z.importZips(Array.from(input.files ?? [])));
    return captured.error === undefined ? null : t.errorOf(captured.error);
  });
  expect(outcome).not.toBeNull();
  expect(outcome.name).toBe("ImportError");
  expect(outcome.code).toBe("missing-archives");
  expect(outcome.detail).toEqual({ missing: ["W3DZH.big", "INI.big", "W3D.big"] });

  expect(await page.evaluate(() => (window as any).zhwp.listStored())).toEqual([]);
  expect(await page.evaluate(() => (window as any).zhwp.listExtra())).toEqual([]);
});

test("5: importing the same ZIP again writes nothing and skips every file", async ({ page }) => {
  const files = requiredFiles();
  const extras = [
    { path: "readme.txt", data: encoder.encode("read me\n") },
    { path: "Data/notes.txt", data: encoder.encode("notes\n") },
  ];
  const zip = await buildZip([
    ...zipEntries(files),
    { path: "Data/", data: new Uint8Array(0), method: "store" },
    ...extras.map((extra) => ({ path: extra.path, data: extra.data, method: "store" as const })),
  ]);
  await attachZips(page, [{ name: "game.zip", bytes: zip }]);

  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const first = await z.importZips(Array.from(input.files ?? []));
    const second = await z.importZips(Array.from(input.files ?? []));
    return { first, second, stored: await z.listStored(), extra: await z.listExtra() };
  });
  expect(outcome.first).toEqual({
    written: 6,
    skipped: 0,
    extra: 2,
    removed: 0,
    freedBytes: 0,
    archives: sortedArchives(files),
  });
  expect(outcome.second).toEqual({
    written: 0,
    skipped: 6,
    extra: 2,
    removed: 0,
    freedBytes: 0,
    archives: sortedArchives(files),
  });
  expect(outcome.stored).toEqual(sortedStored(files));
  expect(outcome.extra).toHaveLength(2);
});

test("6: onProgress is monotonic and ends at totalBytes and filesTotal with currentFile and speed", async ({
  page,
}) => {
  const files = requiredFiles();
  const extras = [{ path: "readme.txt", data: encoder.encode("extra file\n") }];
  const zip = await buildZip([
    ...zipEntries(files),
    ...extras.map((extra) => ({ path: extra.path, data: extra.data, method: "store" as const })),
  ]);
  await attachZips(page, [{ name: "game.zip", bytes: zip }]);

  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const progress: any[] = [];
    const result = await z.importZips(Array.from(input.files ?? []), {
      onProgress: (value: any) => progress.push({ ...value }),
    });
    return { result, progress };
  });

  const totalBytes =
    files.reduce((sum, file) => sum + file.data.length, 0) +
    extras.reduce((sum, extra) => sum + extra.data.length, 0);
  const filesTotal = files.length + extras.length;
  const entryPaths = [...files.map((file) => file.name), ...extras.map((extra) => extra.path)];

  expect(outcome.result.written).toBe(filesTotal);
  expect(outcome.progress.length).toBeGreaterThan(1);
  for (let i = 0; i < outcome.progress.length; i++) {
    const value = outcome.progress[i];
    expect(Number.isFinite(value.doneBytes), `doneBytes at ${i}`).toBe(true);
    expect(Number.isFinite(value.totalBytes), `totalBytes at ${i}`).toBe(true);
    expect(value.totalBytes).toBe(totalBytes);
    expect(value.doneBytes).toBeGreaterThanOrEqual(0);
    expect(value.doneBytes).toBeLessThanOrEqual(totalBytes);
    expect(value.filesDone).toBeGreaterThanOrEqual(0);
    expect(value.filesDone).toBeLessThanOrEqual(filesTotal);
    expect(value).toHaveProperty("filesTotal", filesTotal);
    expect(typeof value.currentFile).toBe("string");
    if (value.currentFile !== "") {
      // The brief leaves the path form open (entry path or basename).
      expect(
        entryPaths.some(
          (path) =>
            value.currentFile === path ||
            value.currentFile.endsWith(`/${path}`) ||
            path.endsWith(`/${value.currentFile}`),
        ),
        `currentFile ${value.currentFile} names an entry`,
      ).toBe(true);
    }
    expect(Number.isFinite(value.bytesPerSecond), `bytesPerSecond at ${i}`).toBe(true);
    expect(value.bytesPerSecond).toBeGreaterThanOrEqual(0);
    if (i > 0) {
      expect(value.doneBytes).toBeGreaterThanOrEqual(outcome.progress[i - 1].doneBytes);
      expect(value.filesDone).toBeGreaterThanOrEqual(outcome.progress[i - 1].filesDone);
    }
  }
  const last = outcome.progress[outcome.progress.length - 1];
  expect(last.doneBytes).toBe(totalBytes);
  expect(last.filesDone).toBe(filesTotal);
  expect(outcome.progress.some((value) => value.currentFile !== "")).toBe(true);
  for (let done = 1; done <= filesTotal; done++) {
    expect(
      outcome.progress.some((value) => value.filesDone === done),
      `a progress call at the end of file ${done}`,
    ).toBe(true);
  }
});

test("7: etaSeconds is null at the first call and a non-negative number later in a 40 MB import", async ({
  page,
}) => {
  const megabyte = 1024 * 1024;
  const files = requiredFiles([10 * megabyte, 10 * megabyte, 10 * megabyte, 10 * megabyte]);
  await attachZips(page, [
    { name: "large.zip", bytes: await buildZip(zipEntries(files)) },
  ]);

  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const file = (input.files ?? [])[0];

    // Slow down the slice reads so the 40 MiB import lasts well past 1 s even
    // on a fast disk; the code under test sees an ordinary Blob.
    class SlowBlob extends Blob {
      delay: number;
      constructor(parts: BlobPart[], delay: number) {
        super(parts);
        this.delay = delay;
      }
      override slice(start?: number, end?: number, contentType?: string): Blob {
        return new SlowBlob([super.slice(start, end, contentType)], this.delay);
      }
      override async arrayBuffer(): Promise<ArrayBuffer> {
        await new Promise((resolve) => setTimeout(resolve, this.delay));
        return super.arrayBuffer();
      }
    }

    const progress: any[] = [];
    const result = await z.importZips([new SlowBlob([file], 50)], {
      onProgress: (value: any) =>
        progress.push({ ...value, at: performance.now() }),
    });
    return { result, progress };
  });

  expect(outcome.result.written).toBe(4);
  expect(outcome.progress.length).toBeGreaterThan(1);
  expect(outcome.progress[0].etaSeconds).toBeNull();
  const origin = outcome.progress[0].at;
  const late = outcome.progress.filter((value) => value.at - origin >= 1500);
  expect(late.length).toBeGreaterThan(0);
  for (const value of late) {
    expect(typeof value.etaSeconds).toBe("number");
    expect(value.etaSeconds).toBeGreaterThanOrEqual(0);
  }
  const last = outcome.progress[outcome.progress.length - 1];
  expect(typeof last.etaSeconds).toBe("number");
  expect(last.etaSeconds).toBeGreaterThanOrEqual(0);
});

test("8: aborting midway throws aborted, keeps completed files, leaves no partial file and resumes", async ({
  page,
}) => {
  const megabyte = 1024 * 1024;
  const files = requiredFiles([3000, 8 * megabyte, 2048, 16384]);
  await attachZips(page, [{ name: "game.zip", bytes: await buildZip(zipEntries(files)) }]);

  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const t = (window as any).__zipTest;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const file = (input.files ?? [])[0];
    const controller = new AbortController();
    const proto = FileSystemFileHandle.prototype as any;
    const original = proto.createWritable;
    let patched = false;
    let writesAfterAbort = 0;
    try {
      proto.createWritable = async function (options: any) {
        const stream = await original.call(this, options);
        if (this.name !== "W3DZH.big") return stream;
        patched = true;
        const writer = stream.getWriter();
        const note = () => {
          if (!controller.signal.aborted) controller.abort();
          else writesAfterAbort++;
        };
        const custom: any = new WritableStream({
          async write(chunk: any) {
            note();
            await writer.write(chunk);
          },
          async close() {
            await writer.close();
          },
          async abort(reason: any) {
            await writer.abort(reason);
          },
        });
        custom.write = async (chunk: any) => {
          note();
          await writer.write(chunk);
        };
        custom.close = async () => {
          await writer.close();
        };
        custom.abort = async (reason: any) => {
          await writer.abort(reason);
        };
        return custom;
      };
      const captured = await t.capture(() => z.importZips([file], { signal: controller.signal }));
      proto.createWritable = original;
      const failure = captured.error === undefined ? null : t.errorOf(captured.error);
      const stored = await z.listStored();
      const extra = await z.listExtra();
      const resumed = await z.importZips([file]);
      const finalStored = await z.listStored();
      return { patched, writesAfterAbort, failure, stored, extra, resumed, finalStored };
    } finally {
      proto.createWritable = original;
    }
  });

  expect(outcome.patched).toBe(true);
  expect(outcome.failure).not.toBeNull();
  expect(outcome.failure.name).toBe("ImportError");
  expect(outcome.failure.code).toBe("aborted");
  expect(outcome.writesAfterAbort).toBeLessThanOrEqual(1);
  expect(outcome.stored).toEqual([
    { kind: "zh", name: "INIZH.big", size: files[0].data.length },
  ]);
  expect(outcome.extra).toEqual([]);
  expect(outcome.resumed).toEqual({
    written: 3,
    skipped: 1,
    extra: 0,
    removed: 0,
    freedBytes: 0,
    archives: sortedArchives(files),
  });
  expect(outcome.finalStored).toEqual(sortedStored(files));
  expect(await readStored(page, files)).toEqual(expectedBytes(files));
});

test("9: a corrupt entry throws bad-crc with detail.file and the replace rule keeps only the earlier new files", async ({
  page,
}) => {
  const validFiles = requiredFiles([100, 200, 300, 400]);
  const newFiles = requiredFiles([101, 201, 301, 401]);
  const validZip = await buildZip(zipEntries(validFiles));
  const corruptZip = corrupt.flipDataByte(
    await buildZip(zipEntries(newFiles)),
    newFiles.findIndex((file) => file.name === "W3D.big"),
    10,
  );
  await attachZips(page, [
    { name: "valid.zip", bytes: validZip },
    { name: "corrupt.zip", bytes: corruptZip },
  ]);

  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const t = (window as any).__zipTest;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const [valid, broken] = Array.from(input.files ?? []);
    await z.importZips([valid]);
    const captured = await t.capture(() => z.importZips([broken]));
    return {
      failure: captured.error === undefined ? null : t.errorOf(captured.error),
      stored: await z.listStored(),
      oldContent: await t.hasFile(["zhwp", "generals", "W3D.big"]),
      newContent: await t.fileAt(["zhwp", "zh", "INIZH.big"]),
    };
  });

  expect(outcome.failure).not.toBeNull();
  expect(outcome.failure.name).toBe("ImportError");
  expect(outcome.failure.code).toBe("bad-crc");
  expect(outcome.failure.detail).toEqual({ file: "W3D.big" });
  // The new sizes differ, so the replace rule removed the old install before
  // writing; the three files committed before the corrupt one are the new ones.
  expect(outcome.stored).toEqual([
    { kind: "zh", name: "INIZH.big", size: 101 },
    { kind: "zh", name: "W3DZH.big", size: 201 },
    { kind: "generals", name: "INI.big", size: 301 },
  ]);
  expect(outcome.oldContent).toBe(false);
  expect(outcome.newContent).toEqual({
    size: newFiles[0].data.length,
    sha256: sha256(newFiles[0].data),
  });
});

test("10: a truncated ZIP throws truncated and a non-ZIP blob throws not-a-zip", async ({ page }) => {
  const valid = await buildZip(zipEntries(requiredFiles()));
  const cases = [
    { label: "truncated.zip", bytes: corrupt.cutCentralDirectory(valid), code: "truncated" },
    {
      label: "plain.zip",
      bytes: encoder.encode("this is not a zip archive, only plain bytes and more bytes"),
      code: "not-a-zip",
    },
  ];

  for (const testCase of cases) {
    await page.evaluate(() => (window as any).zhwp.clearStored());
    await attachZips(page, [{ name: testCase.label, bytes: testCase.bytes }]);
    const outcome = await page.evaluate(async () => {
      const z = (window as any).zhwp;
      const t = (window as any).__zipTest;
      const input = document.getElementById("zip-fixtures") as HTMLInputElement;
      const captured = await t.capture(() => z.importZips(Array.from(input.files ?? [])));
      return captured.error === undefined ? null : t.errorOf(captured.error);
    });
    expect(outcome, testCase.label).not.toBeNull();
    expect(outcome.name, testCase.label).toBe("ImportError");
    expect(outcome.code, testCase.label).toBe(testCase.code);
  }
  expect(await page.evaluate(() => (window as any).zhwp.listStored())).toEqual([]);
  expect(await page.evaluate(() => (window as any).zhwp.listExtra())).toEqual([]);
});

test("11: a forced QuotaExceededError becomes quota-exceeded and keeps the earlier files", async ({
  page,
}) => {
  const validFiles = requiredFiles([100, 200, 300, 400]);
  const newFiles = requiredFiles([101, 201, 301, 401]);
  const validZip = await buildZip(zipEntries(validFiles));
  const quotaZip = await buildZip(zipEntries(newFiles));
  await attachZips(page, [
    { name: "valid.zip", bytes: validZip },
    { name: "quota.zip", bytes: quotaZip },
  ]);

  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const t = (window as any).__zipTest;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const [valid, quota] = Array.from(input.files ?? []);
    await z.importZips([valid]);
    const proto = FileSystemFileHandle.prototype as any;
    const original = proto.createWritable;
    let attempts = 0;
    try {
      proto.createWritable = async function (options: any) {
        if (this.name !== "INI.big") return original.call(this, options);
        attempts++;
        const fail = () => {
          throw new DOMException("forced quota", "QuotaExceededError");
        };
        const custom: any = new WritableStream({
          write() {
            fail();
          },
          close() {},
          abort() {},
        });
        custom.write = async () => fail();
        custom.close = async () => {};
        custom.abort = async () => {};
        return custom;
      };
      const captured = await t.capture(() => z.importZips([quota]));
      proto.createWritable = original;
      const failure = captured.error === undefined ? null : t.errorOf(captured.error);
      return {
        attempts,
        failure,
        stored: await z.listStored(),
        files: await t.fileAt(["zhwp", "zh", "INIZH.big"]).then(async (inizh: any) => ({
          inizh,
          w3dzh: await t.fileAt(["zhwp", "zh", "W3DZH.big"]),
          ini: await t.hasFile(["zhwp", "generals", "INI.big"]),
          w3d: await t.hasFile(["zhwp", "generals", "W3D.big"]),
        })),
      };
    } finally {
      proto.createWritable = original;
    }
  });

  expect(outcome.attempts).toBeGreaterThan(0);
  expect(outcome.failure).not.toBeNull();
  expect(outcome.failure.name).toBe("ImportError");
  expect(outcome.failure.code).toBe("quota-exceeded");
  expect(typeof outcome.failure.detail.needed).toBe("number");
  expect(outcome.failure.detail.needed).toBeGreaterThan(0);

  // The new sizes differ, so the old install was removed first. INIZH.big and
  // W3DZH.big completed before the quota failure; INI.big and W3D.big were
  // removed and never rewritten.
  expect(outcome.stored).toEqual([
    { kind: "zh", name: "INIZH.big", size: 101 },
    { kind: "zh", name: "W3DZH.big", size: 201 },
  ]);
  expect(outcome.files.inizh).toEqual({
    size: newFiles[0].data.length,
    sha256: sha256(newFiles[0].data),
  });
  expect(outcome.files.w3dzh).toEqual({
    size: newFiles[1].data.length,
    sha256: sha256(newFiles[1].data),
  });
  expect(outcome.files.ini).toBe(false);
  expect(outcome.files.w3d).toBe(false);
});

test("12: a 64 MiB stored entry keeps JS heap growth under 48 MiB", async ({
  page,
}, testInfo) => {
  const megabyte = 1024 * 1024;
  const huge = bytes(64 * megabyte, 61);
  const files = requiredFiles();
  const zip = await buildZip([
    ...zipEntries(files),
    { path: "Data/huge.bin", data: huge, method: "store" },
  ]);
  // Playwright refuses buffer payloads above 50 MB, so this fixture goes
  // through a file in the test output directory.
  const zipPath = testInfo.outputPath("huge.zip");
  writeFileSync(zipPath, zip);
  await attachZips(page, [{ name: "huge.zip", path: zipPath }]);

  const outcome = await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    const file = (input.files ?? [])[0];
    const memory = (performance as any).memory;
    const usable = memory !== undefined && memory !== null;
    const before = usable ? memory.usedJSHeapSize : 0;
    let peak = before;
    const result = await z.importZips([file], {
      onProgress: () => {
        if (usable) peak = Math.max(peak, memory.usedJSHeapSize);
      },
    });
    const after = usable ? memory.usedJSHeapSize : 0;
    return { usable, before, peak, after, result };
  });

  expect(outcome.usable, "performance.memory is available in Brave").toBe(true);
  expect(outcome.peak - outcome.before).toBeLessThan(48 * 1024 * 1024);
  expect(outcome.result.written).toBe(5);
  expect(outcome.result.extra).toBe(1);
  expect(outcome.result.archives).toEqual(sortedArchives(files));

  const storedHuge = await page.evaluate(async () => {
    const t = (window as any).__zipTest;
    return {
      file: await t.fileAt(["zhwp", "extra", "Data", "huge.bin"]),
      extra: await (window as any).zhwp.listExtra(),
    };
  });
  expect(storedHuge.file).toEqual({ size: huge.length, sha256: sha256(huge) });
  expect(
    storedHuge.extra.map((entry: { path: string; size: number }) => ({
      path: extraRelative(entry.path),
      size: entry.size,
    })),
  ).toEqual([{ path: "Data/huge.bin", size: huge.length }]);
});

test("13: clearStored removes the extra files too", async ({ page }) => {
  const files = requiredFiles();
  const extras = [
    { path: "readme.txt", data: encoder.encode("read me\n") },
    { path: "Data/English/strings.csv", data: encoder.encode("name,value\n") },
  ];
  const zip = await buildZip([
    ...zipEntries(files),
    ...extras.map((extra) => ({ path: extra.path, data: extra.data, method: "store" as const })),
  ]);
  await attachZips(page, [{ name: "game.zip", bytes: zip }]);

  await page.evaluate(async () => {
    const z = (window as any).zhwp;
    const input = document.getElementById("zip-fixtures") as HTMLInputElement;
    await z.importZips(Array.from(input.files ?? []));
    await z.clearStored();
  });

  expect(await page.evaluate(() => (window as any).zhwp.listStored())).toEqual([]);
  expect(await page.evaluate(() => (window as any).zhwp.listExtra())).toEqual([]);
  const shape = await page.evaluate(async () => {
    const t = (window as any).__zipTest;
    return {
      extraDirectory: await t.hasDirectory(["zhwp", "extra"]),
      readme: await t.hasFile(["zhwp", "extra", "readme.txt"]),
      strings: await t.hasFile(["zhwp", "extra", "Data", "English", "strings.csv"]),
    };
  });
  expect(shape).toEqual({ extraDirectory: false, readme: false, strings: false });
});

test("contract: test-api re-exports importZips and listExtra", async ({ page }) => {
  const exported = await page.evaluate(() => {
    const z = (window as any).zhwp;
    return {
      importZips: typeof z.importZips,
      listExtra: typeof z.listExtra,
    };
  });
  expect(exported).toEqual({ importZips: "function", listExtra: "function" });
});
