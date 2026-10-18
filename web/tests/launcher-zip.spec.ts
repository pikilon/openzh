import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBig } from "./helpers/big";
import { buildZip, corrupt, type BuildZipEntry } from "./helpers/zip";

// Issue #128: the launcher loads the game from one or more ZIP files. The
// element ids are the contract (docs/briefs/128-launcher-zip.md).

const REQUIRED = ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"];
const ZH = ["INIZH.big", "W3DZH.big"];
const GENERALS = ["INI.big", "W3D.big"];

// "<doneMB> MB of <totalMB> MB · <filesDone> of <filesTotal> files · <speed> MB/s · <eta> left"
const DETAIL =
  /^\d+(?:\.\d+)? MB of \d+(?:\.\d+)? MB · \d+ of \d+ files · \d+(?:\.\d+)? MB\/s · (?:calculating…|\d+:\d{2}(?::\d{2})?) left$/;
const ETA = /· \d+:\d{2}(?::\d{2})? left$/;

interface FixtureFile {
  name: string;
  bytes: Uint8Array;
}

interface Sample {
  at: number;
  detail: string | null;
  detailVisible: boolean;
  current: string | null;
  currentVisible: boolean;
  cancelVisible: boolean;
  playDisabled: boolean;
  clearDisabled: boolean;
  zipDisabled: boolean;
  progressHidden: boolean;
  progressValue: number;
  progressMax: number;
  status: string;
  errorVisible: boolean;
  errorCode: string | null;
}

function archiveData(label: string): Uint8Array {
  return buildBig([
    { path: `Data\\INI\\Default\\${label}.ini`, data: `${label}\nEnd\n` },
  ]);
}

function smallZipEntries(): BuildZipEntry[] {
  return REQUIRED.map((name) => ({
    path: name,
    data: archiveData(name.replace(/\.big$/i, "")),
    method: "store" as const,
  }));
}

async function smallZip(): Promise<Uint8Array> {
  return buildZip(smallZipEntries());
}

async function openLauncher(page: Page): Promise<void> {
  await page.goto("/app/index.html");
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await page.locator("#clear").click();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
}

async function pickZips(page: Page, files: FixtureFile[]): Promise<void> {
  await page.locator("#zip-input").setInputFiles(
    files.map((file) => ({
      name: file.name,
      mimeType: "application/zip",
      buffer: Buffer.from(file.bytes),
    })),
  );
}

async function dropFiles(page: Page, files: FixtureFile[]): Promise<void> {
  await page.evaluate(
    (items: { name: string; bytes: number[]; type: string }[]) => {
      const transfer = new DataTransfer();
      for (const item of items) {
        transfer.items.add(
          new File([new Uint8Array(item.bytes)], item.name, { type: item.type }),
        );
      }
      const zone = document.getElementById("drop-zone");
      if (zone === null) throw new Error("missing #drop-zone");
      zone.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    },
    files.map((file) => ({
      name: file.name,
      bytes: Array.from(file.bytes),
      type: file.name.toLowerCase().endsWith(".zip")
        ? "application/zip"
        : "text/plain",
    })),
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

// Records what the page shows on every DOM mutation, before the import starts:
// transient states (the detail line, disabled buttons) would otherwise race the
// assertions. It only reads the page, exactly like a player watching it.
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const byId = (id: string) => document.getElementById(id);
    const visible = (element: Element | null): boolean => {
      if (element === null) return false;
      const html = element as HTMLElement;
      if (html.hidden) return false;
      const style = getComputedStyle(html);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const valueOf = (element: Element | null): string | null => {
      if (element === null) return null;
      const text = element.textContent?.trim() ?? "";
      return text === "" ? null : text;
    };
    const disabled = (element: Element | null): boolean =>
      element instanceof HTMLInputElement || element instanceof HTMLButtonElement
        ? element.disabled
        : false;
    const samples: any[] = [];
    const record = () => {
      const detail = byId("import-detail");
      const current = byId("import-current");
      const cancel = byId("import-cancel");
      const progress = byId("import-progress") as HTMLProgressElement | null;
      const play = byId("play");
      const clear = byId("clear");
      const zip = byId("zip-input");
      const status = byId("status");
      const error = byId("import-error");
      samples.push({
        at: performance.now(),
        detail: valueOf(detail),
        detailVisible: visible(detail),
        current: valueOf(current),
        currentVisible: visible(current),
        cancelVisible: visible(cancel),
        playDisabled: disabled(play),
        clearDisabled: disabled(clear),
        zipDisabled: disabled(zip),
        progressHidden: progress === null ? true : progress.hidden,
        progressValue: progress === null ? 0 : progress.value,
        progressMax: progress === null ? 0 : progress.max,
        status: status?.textContent?.trim() ?? "",
        errorVisible: visible(error),
        errorCode: error?.getAttribute("data-code") ?? null,
      });
    };
    (window as unknown as { __zipSamples: unknown[] }).__zipSamples = samples;
    const observer = new MutationObserver(record);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    record();
  });
}

async function samples(page: Page): Promise<Sample[]> {
  return page.evaluate(
    () => (window as unknown as { __zipSamples: Sample[] }).__zipSamples,
  );
}

// One ~40 MB ZIP with the four REQUIRED archives around 2000 extra files: the
// many small writes keep the import running long enough to see the detail line,
// the ETA and the disabled controls, and to cancel halfway. It also leaves the
// first two archives stored when it is cancelled between the two games.
let bigDir: string | undefined;
let bigZip: string | undefined;

test.beforeAll(async () => {
  bigDir = mkdtempSync(join(tmpdir(), "zhwp-launcher-zip-"));
  bigZip = join(bigDir, "large-game.zip");
  const entries: BuildZipEntry[] = [];
  for (const name of ZH) {
    entries.push({
      path: name,
      data: archiveData(name.replace(/\.big$/i, "")),
      method: "store",
    });
  }
  for (let i = 0; i < 2000; i++) {
    entries.push({
      path: `Data/English/file-${String(i).padStart(4, "0")}.dat`,
      data: new Uint8Array(20 * 1024),
      method: "store",
    });
  }
  for (const name of GENERALS) {
    entries.push({
      path: name,
      data: archiveData(name.replace(/\.big$/i, "")),
      method: "store",
    });
  }
  writeFileSync(bigZip, await buildZip(entries));
});

test.afterAll(() => {
  if (bigDir !== undefined) rmSync(bigDir, { recursive: true, force: true });
});

test("1: the page offers a labelled multi-ZIP picker and a visible drop zone", async ({ page }) => {
  await page.goto("/app/index.html");

  const input = page.locator("#zip-input");
  await expect(input).toHaveCount(1);
  await expect(input).toHaveAttribute("type", "file");
  await expect(input).toHaveAttribute("accept", /\.zip/i);
  await expect(input).toHaveJSProperty("multiple", true);
  await expect(page.getByLabel("Pick the game ZIP files")).toHaveCount(1);
  await expect(
    page.locator("label", { hasText: "Pick the game ZIP files" }).first(),
  ).toBeVisible();
  await expect(page.locator("#drop-zone")).toBeVisible();

  const error = page.locator("#import-error");
  await expect(error).toHaveCount(1);
  await expect(error).toHaveAttribute("role", "alert");
  await expect(error).toBeHidden();
  await expect(page.locator("#import-detail")).toBeHidden();
  await expect(page.locator("#import-current")).toBeHidden();
  await expect(page.locator("#import-cancel")).toBeHidden();
});

test("2: one picked ZIP with the four archives ends Ready and stores four archives", async ({ page }) => {
  await openLauncher(page);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
});

test("contract: the storage warning is shown before a ZIP import that does not fit", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "estimate", {
      value: async () => ({ usage: 0, quota: 16 }),
      configurable: true,
    });
  });
  await openLauncher(page);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  const warning = page.locator("#storage-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toHaveText(
    /^The browser reports 16 B available; the import needs \d+(?:\.\d+)? (?:B|KB|MB|GB)\.$/,
  );
});

test("contract: a ZIP import requests persistent storage once, before writing", async ({ page }) => {
  await page.addInitScript(() => {
    const pageWindow = window as unknown as { __persistCalls: number };
    pageWindow.__persistCalls = 0;
    Object.defineProperty(navigator.storage, "persist", {
      value: async () => {
        pageWindow.__persistCalls += 1;
        return true;
      },
      configurable: true,
    });
  });
  await openLauncher(page);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  expect(
    await page.evaluate(
      () => (window as unknown as { __persistCalls: number }).__persistCalls,
    ),
  ).toBe(1);
});

test("3: two picked ZIPs, one per game, import as one install", async ({ page }) => {
  await openLauncher(page);
  const entries = smallZipEntries();
  const zh = entries.filter((entry) => ZH.includes(entry.path));
  const generals = entries.filter((entry) => GENERALS.includes(entry.path));
  await pickZips(page, [
    { name: "zero-hour.zip", bytes: await buildZip(zh) },
    { name: "generals.zip", bytes: await buildZip(generals) },
  ]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
  expect((await storedFiles(page)).sort()).toEqual([
    "generals/INI.big",
    "generals/W3D.big",
    "zh/INIZH.big",
    "zh/W3DZH.big",
  ]);
});

test("4: a ~40 MB ZIP shows the detail line and current file while importing and hides them when done", async ({
  page,
}) => {
  await openLauncher(page);
  await watch(page);
  await page.locator("#zip-input").setInputFiles(bigZip as string);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60_000 });

  const seen = await samples(page);
  const details = seen.filter(
    (sample) => sample.detailVisible && sample.detail !== null,
  );
  expect(details.length).toBeGreaterThan(0);
  expect(DETAIL.test((details[0].detail as string).trim())).toBe(true);
  expect(
    details.some((sample) => DETAIL.test((sample.detail as string).trim())),
  ).toBe(true);

  const currents = seen.filter(
    (sample) => sample.currentVisible && sample.current !== null,
  );
  expect(currents.length).toBeGreaterThan(0);
  expect(
    currents.some((sample) =>
      /(?:INIZH|W3DZH|INI|W3D)\.big|file-\d{4}\.dat/.test(sample.current as string),
    ),
  ).toBe(true);
  expect(
    seen.some((sample) => sample.detailVisible && sample.cancelVisible),
  ).toBe(true);
  expect(
    seen.some(
      (sample) =>
        sample.detailVisible && !sample.progressHidden && sample.progressMax > 0,
    ),
  ).toBe(true);

  await expect(page.locator("#import-detail")).toBeHidden();
  await expect(page.locator("#import-current")).toBeHidden();
  await expect(page.locator("#import-cancel")).toBeHidden();
});

test("5: the ETA reads calculating… early and m:ss later", async ({ page }) => {
  // The four archives are all that is imported now (issue #162), so slow
  // closing them enough for the ETA to appear.
  await page.addInitScript(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (options?: unknown) {
      const stream = await original.call(this, options);
      const close = stream.close.bind(stream);
      stream.close = async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return close();
      };
      return stream;
    };
  });
  await openLauncher(page);
  await watch(page);
  await page.locator("#zip-input").setInputFiles(bigZip as string);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60_000 });

  const seen = await samples(page);
  const details = seen.filter(
    (sample) => sample.detailVisible && sample.detail !== null,
  );
  expect(details.length).toBeGreaterThan(0);
  const calculating = details.findIndex((sample) =>
    (sample.detail as string).includes("calculating…"),
  );
  const eta = details.findIndex((sample) => ETA.test((sample.detail as string).trim()));
  expect(calculating).toBeGreaterThanOrEqual(0);
  expect(eta).toBeGreaterThan(calculating);
  expect(details[eta].at - details[calculating].at).toBeGreaterThanOrEqual(1000);
});

test("6: while importing #play, #clear and #zip-input are disabled", async ({
  page,
}) => {
  await openLauncher(page);
  await watch(page);
  await page.locator("#zip-input").setInputFiles(bigZip as string);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60_000 });

  const seen = await samples(page);
  const importing = seen.filter((sample) => sample.detailVisible);
  expect(importing.length).toBeGreaterThan(0);
  for (const [index, sample] of importing.entries()) {
    expect(sample.playDisabled, `play disabled at sample ${index}`).toBe(true);
    expect(sample.clearDisabled, `clear disabled at sample ${index}`).toBe(true);
    expect(sample.zipDisabled, `zip input disabled at sample ${index}`).toBe(true);
  }

  await expect(page.locator("#play")).toBeEnabled();
  await expect(page.locator("#clear")).toBeEnabled();
  await expect(page.locator("#zip-input")).toBeEnabled();
});

test("7: cancelling midway leaves Cancelled, keeps the completed archives and hides the error", async ({
  page,
}) => {
  // Hold the second archive's close so the cancel lands after the first one is
  // complete; the archives after it are never committed. Non-.big files are
  // ignored now (issue #162), so only the four archives count.
  await page.addInitScript(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (options?: unknown) {
      const stream = await original.call(this, options);
      if (this.name === "W3DZH.big") {
        const close = stream.close.bind(stream);
        stream.close = async () => {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          return close();
        };
      }
      return stream;
    };
  });
  await openLauncher(page);
  await page.locator("#zip-input").setInputFiles(bigZip as string);
  await expect(page.locator("#import-cancel")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const text = await page.locator("#import-detail").innerText();
        const match = text.match(/· (\d+) of (\d+) files ·/);
        return match === null ? 0 : Number(match[1]);
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(1);

  await page.locator("#import-cancel").click();

  await expect(page.locator("#status")).toHaveText("Cancelled", { timeout: 30_000 });
  await expect(page.locator("#import-error")).toBeHidden();
  await expect(page.locator("#import-cancel")).toBeHidden();
  await expect(page.locator("#import-detail")).toBeHidden();

  // The first two archives stay; nothing is stored under extra/.
  const paths = await storedFiles(page);
  expect(paths).toEqual(["zh/INIZH.big", "zh/W3DZH.big"]);
  expect(paths.some((path) => path.startsWith("extra/"))).toBe(false);

  await page.reload();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 2 archives");
});

test("8: a ZIP missing a REQUIRED archive shows missing-archives, names them and stores nothing", async ({
  page,
}) => {
  await openLauncher(page);
  const zip = await buildZip([
    { path: "INIZH.big", data: archiveData("INIZH"), method: "store" },
    { path: "readme.txt", data: "extra files must not be stored\n", method: "store" },
  ]);
  await pickZips(page, [{ name: "incomplete.zip", bytes: zip }]);

  const error = page.locator("#import-error");
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("data-code", "missing-archives");
  for (const name of ["W3DZH.big", "INI.big", "W3D.big"]) {
    await expect(error).toContainText(name);
  }
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
  await expect(page.locator("#play")).toBeDisabled();
  expect(await storedFiles(page)).toEqual([]);
});

test("9: a non-ZIP, a truncated ZIP and a bad CRC each show their code, message and hint", async ({
  page,
}) => {
  await openLauncher(page);
  const valid = await smallZip();
  const cases = [
    {
      code: "not-a-zip",
      name: "plain.zip",
      bytes: new TextEncoder().encode("this is not a zip archive at all"),
      message: "not a valid ZIP archive",
      hint: "Choose the ZIP file downloaded from your game installation.",
    },
    {
      code: "truncated",
      name: "truncated.zip",
      bytes: corrupt.cutCentralDirectory(valid),
      message: "truncated",
      hint: "Download or copy the ZIP again, then retry the import.",
    },
    {
      code: "bad-crc",
      name: "bad-crc.zip",
      bytes: corrupt.flipDataByte(valid, 0, 0),
      message: "checksum",
      hint: "Download or copy the ZIP again; the file is damaged.",
    },
  ] as const;

  for (const testCase of cases) {
    await pickZips(page, [{ name: testCase.name, bytes: testCase.bytes }]);
    const error = page.locator("#import-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("data-code", testCase.code);
    await expect(page.locator("#status")).toHaveText("Import failed");
    const text = await error.innerText();
    expect(text, testCase.code).toContain(testCase.message);
    expect(text, testCase.code).toContain(testCase.hint);
  }
  await expect(page.locator("#play")).toBeDisabled();
});

test("10: a forced quota failure shows data-code quota-exceeded and Import failed", async ({ page }) => {
  // The writable itself throws, as a full disk does; the import turns it into
  // the quota error the page has to show.
  await page.addInitScript(() => {
    const prototype = FileSystemFileHandle.prototype as unknown as {
      createWritable(options?: { keepExistingData?: boolean }): Promise<any>;
    };
    const original = prototype.createWritable;
    prototype.createWritable = async function (options?: { keepExistingData?: boolean }) {
      const stream = await original.call(this, options);
      return {
        async write() {
          throw new DOMException("forced quota", "QuotaExceededError");
        },
        async close() {
          await stream.close().catch(() => undefined);
        },
        async abort(reason?: unknown) {
          await stream.abort(reason).catch(() => undefined);
        },
      };
    };
  });
  await openLauncher(page);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);

  const error = page.locator("#import-error");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).toHaveAttribute("data-code", "quota-exceeded");
  await expect(page.locator("#status")).toHaveText("Import failed");
  expect((await error.innerText()).trim().length).toBeGreaterThan(0);
  expect(await storedFiles(page)).toEqual([]);
});

test("11: dropping a ZIP on #drop-zone imports it and dropping only a .txt shows not-a-zip", async ({
  page,
}) => {
  await openLauncher(page);
  const error = page.locator("#import-error");

  await dropFiles(page, [
    { name: "notes.txt", bytes: new TextEncoder().encode("plain text") },
  ]);
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("data-code", "not-a-zip");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  await dropFiles(page, [{ name: "game.zip", bytes: await smallZip() }]);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  await expect(error).toBeHidden();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
});

test("12: starting a new import hides the previous #import-error", async ({ page }) => {
  await openLauncher(page);
  const error = page.locator("#import-error");
  const incomplete = await buildZip([
    { path: "INIZH.big", data: archiveData("INIZH"), method: "store" },
  ]);
  await pickZips(page, [{ name: "incomplete.zip", bytes: incomplete }]);
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("data-code", "missing-archives");

  await pickZips(page, [{ name: "complete.zip", bytes: await smallZip() }]);
  await expect(error).toBeHidden();
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
});
