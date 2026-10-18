import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBig } from "./helpers/big";
import {
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
import { buildZip, corrupt, type BuildZipEntry } from "./helpers/zip";
import { installZip } from "./helpers/install-zip";

// Issue #128: the launcher loads the game from one or more ZIP files. The
// element ids are the contract (docs/briefs/128-launcher-zip.md). Issue #157: a
// new import replaces the previous install and the status says so. Issue #159:
// a complete import starts the engine by itself, so no test presses Play and
// the removed "Clear stored archives" button is replaced by the harness reset.

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

// Records what the page shows on every DOM mutation, before the import starts:
// transient states (the detail line, the disabled input, the replace status)
// would otherwise race the assertions. It only reads the page, exactly like a
// player watching it.
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

// Whether one archive has been committed under zhwp yet. A small targeted read
// instead of walking the whole tree: the cancel test polls it while the import
// is still writing.
async function archiveStored(page: Page, kind: string, name: string): Promise<boolean> {
  return page.evaluate(async ({ kind, name }: { kind: string; name: string }) => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await (await root.getDirectoryHandle("zhwp")).getDirectoryHandle(kind);
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }, { kind, name });
}

// One ~40 MB ZIP with the four REQUIRED archives around 2000 extra files: the
// many writes keep the import running long enough to see the detail line, the
// ETA and the disabled input (tests 4-6).
//
// The cancel test gets its own, deliberately slow ZIP: the two ZH archives
// first, then 20000 one-kilobyte extra files, then the generals archives. The
// per-file OPFS overhead keeps the copy running for seconds after the archives
// commit, so a cancel right after they appear cannot race the end of the
// import; that is what makes the old one-shot import deterministic under the
// automatic engine start (#159).
let bigDir: string | undefined;
let bigZip: string | undefined;
let cancelZip: string | undefined;

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

  cancelZip = join(bigDir, "cancel-game.zip");
  const cancelEntries: BuildZipEntry[] = [];
  for (const name of ZH) {
    cancelEntries.push({
      path: name,
      data: archiveData(name.replace(/\.big$/i, "")),
      method: "store",
    });
  }
  for (let i = 0; i < 20_000; i++) {
    cancelEntries.push({
      path: `Data/English/file-${String(i).padStart(5, "0")}.dat`,
      data: new Uint8Array(1024),
      method: "store",
    });
  }
  for (const name of GENERALS) {
    cancelEntries.push({
      path: name,
      data: archiveData(name.replace(/\.big$/i, "")),
      method: "store",
    });
  }
  writeFileSync(cancelZip, await buildZip(cancelEntries));
});

test.afterAll(() => {
  if (bigDir !== undefined) rmSync(bigDir, { recursive: true, force: true });
});

test("1: the page offers a labelled multi-ZIP picker and a visible drop zone", async ({ page }) => {
  await openLauncher(page, RESOLVES);

  const input = page.locator("#zip-input");
  await expect(input).toHaveCount(1);
  await expect(input).toHaveAttribute("type", "file");
  await expect(input).toHaveAttribute("accept", /\.zip/i);
  await expect(input).toHaveJSProperty("multiple", true);
  // The brief leaves the label text open, but the picker must stay labelled.
  const label = page.locator('label[for="zip-input"]');
  await expect(label).toHaveCount(1);
  await expect(label.first()).toBeVisible();
  expect((await label.first().innerText()).trim()).not.toBe("");
  await expect(input).toHaveAccessibleName(/.+/);
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
  await openLauncher(page, RESOLVES);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await waitForState(page, "playing");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#canvas")).toBeVisible();
});

test("contract: the storage warning is shown before a ZIP import that does not fit", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "estimate", {
      value: async () => ({ usage: 0, quota: 16 }),
      configurable: true,
    });
  });
  await openLauncher(page, RESOLVES);
  await watchWarning(page);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await waitForState(page, "playing");
  // The warning is shown before the writes; the loader then hides it with the
  // game, so the recorded samples are what proves it appeared.
  await expect
    .poll(
      async () =>
        (await warningSamples(page)).some(
          (sample) =>
            sample.visible &&
            /^The browser reports 16 B available; the import needs \d+(?:\.\d+)? (?:B|KB|MB|GB)\.$/.test(
              sample.text,
            ),
        ),
      { timeout: START_TIMEOUT },
    )
    .toBe(true);
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
  await openLauncher(page, RESOLVES);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await waitForState(page, "playing");
  expect(
    await page.evaluate(
      () => (window as unknown as { __persistCalls: number }).__persistCalls,
    ),
  ).toBe(1);
});

test("3: two picked ZIPs, one per game, import as one install", async ({ page }) => {
  await openLauncher(page, RESOLVES);
  const entries = smallZipEntries();
  const zh = entries.filter((entry) => ZH.includes(entry.path));
  const generals = entries.filter((entry) => GENERALS.includes(entry.path));
  await pickZips(page, [
    { name: "zero-hour.zip", bytes: await buildZip(zh) },
    { name: "generals.zip", bytes: await buildZip(generals) },
  ]);

  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await waitForState(page, "playing");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  expect(await storedPaths(page)).toEqual([
    "generals/INI.big",
    "generals/W3D.big",
    "zh/INIZH.big",
    "zh/W3DZH.big",
  ]);
});

test("4: a ~40 MB ZIP shows the detail line and current file while importing and hides them when done", async ({
  page,
}) => {
  await openLauncher(page, RESOLVES);
  await watch(page);
  await page.locator("#zip-input").setInputFiles(bigZip as string);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60_000 });
  await waitForState(page, "playing", 60_000);

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
  await openLauncher(page, RESOLVES);
  await watch(page);
  await page.locator("#zip-input").setInputFiles(bigZip as string);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60_000 });
  await waitForState(page, "playing", 60_000);

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

test("6: while importing #zip-input is disabled", async ({ page }) => {
  await openLauncher(page, RESOLVES);
  await watch(page);
  await page.locator("#zip-input").setInputFiles(bigZip as string);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60_000 });
  await waitForState(page, "playing", 60_000);

  const seen = await samples(page);
  const importing = seen.filter((sample) => sample.detailVisible);
  expect(importing.length).toBeGreaterThan(0);
  for (const [index, sample] of importing.entries()) {
    expect(sample.zipDisabled, `zip input disabled at sample ${index}`).toBe(true);
  }

  await expect(page.locator("#zip-input")).toBeEnabled();
});

test("7: cancelling midway leaves Cancelled, keeps the completed archives and hides the error", async ({
  page,
}) => {
  await openLauncher(page, RESOLVES);
  // The slow fixture commits the two ZH archives first and then spends seconds
  // copying tiny extras, so waiting for the archives and cancelling at once is
  // deterministic: #import-cancel is still there, and what was completed before
  // the cancel is the two ZH archives plus the extras copied so far.
  await page.locator("#zip-input").setInputFiles(cancelZip as string);
  await expect(page.locator("#import-cancel")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(
      async () =>
        (await archiveStored(page, "zh", "INIZH.big")) &&
        (await archiveStored(page, "zh", "W3DZH.big")),
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.locator("#import-cancel").click();

  await expect(page.locator("#status")).toHaveText("Cancelled", { timeout: 30_000 });
  await expect(page.locator("#import-error")).toBeHidden();
  await expect(page.locator("#import-cancel")).toBeHidden();
  await expect(page.locator("#import-detail")).toBeHidden();
  await waitForState(page, "no-assets");

  // The first two archives and the extra files written before the cancel stay;
  // the second game's archives, placed after the extras, were never written.
  const paths = await storedPaths(page);
  expect(paths.filter((path) => path.endsWith(".big"))).toEqual([
    "zh/INIZH.big",
    "zh/W3DZH.big",
  ]);
  expect(paths.some((path) => path.startsWith("extra/Data/English/file-"))).toBe(true);

  await page.reload();
  await waitForState(page, "no-assets");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 2 archives");
});

test("8: a ZIP missing a REQUIRED archive shows missing-archives, names them and stores nothing", async ({
  page,
}) => {
  await openLauncher(page, RESOLVES);
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
  await waitForState(page, "no-assets");
  expect(await storedPaths(page)).toEqual([]);
});

test("9: a non-ZIP, a truncated ZIP and a bad CRC each show their code, message and hint", async ({
  page,
}) => {
  await openLauncher(page, RESOLVES);
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
  await waitForState(page, "no-assets");
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
  await openLauncher(page, RESOLVES);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);

  const error = page.locator("#import-error");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).toHaveAttribute("data-code", "quota-exceeded");
  await expect(page.locator("#status")).toHaveText("Import failed");
  expect((await error.innerText()).trim().length).toBeGreaterThan(0);
  expect(await storedPaths(page)).toEqual([]);
  await waitForState(page, "no-assets");
});

test("11: dropping a ZIP on #drop-zone imports it and dropping only a .txt shows not-a-zip", async ({
  page,
}) => {
  await openLauncher(page, RESOLVES);
  const error = page.locator("#import-error");

  await dropFiles(page, [
    { name: "notes.txt", bytes: new TextEncoder().encode("plain text") },
  ]);
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("data-code", "not-a-zip");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

  await dropFiles(page, [{ name: "game.zip", bytes: await smallZip() }]);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await waitForState(page, "playing");
  await expect(error).toBeHidden();
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#canvas")).toBeVisible();
});

test("12: starting a new import hides the previous #import-error", async ({ page }) => {
  await openLauncher(page, RESOLVES);
  const error = page.locator("#import-error");
  const incomplete = await buildZip([
    { path: "INIZH.big", data: archiveData("INIZH"), method: "store" },
  ]);
  await pickZips(page, [{ name: "incomplete.zip", bytes: incomplete }]);
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("data-code", "missing-archives");

  await pickZips(page, [{ name: "complete.zip", bytes: await smallZip() }]);
  await expect(error).toBeHidden();
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await waitForState(page, "playing");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
});

test("13: a new import replaces the previous install and reports Removing the previous install", async ({
  page,
}, info) => {
  // The previous install has different sizes and an extra file the new ZIPs do
  // not bring. It is seeded through the harness so no engine holds its files
  // open, and one required archive is removed so the launcher stays on the
  // loader instead of starting the old install.
  await seedInstall(
    page,
    await installZip(info.outputPath("previous"), undefined, {
      extraFiles: [{ path: "old/notes.txt", data: "previous install\n" }],
    }),
  );
  await removeStoredArchive(page, "generals/INI.big");
  await page.goto(launcherUrl(RESOLVES));
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 3 archives");
  await waitForState(page, "no-assets");

  await watch(page);
  await pickZips(page, [{ name: "game.zip", bytes: await smallZip() }]);
  await expect(page.locator("#status")).toHaveText("Ready", { timeout: START_TIMEOUT });
  await waitForState(page, "playing");

  // #157's phase is part of the launcher's status line.
  const seen = await samples(page);
  expect(
    seen.some((sample) => sample.status.includes("Removing the previous install")),
    "the page never reported Removing the previous install",
  ).toBe(true);

  // The old extra and the old archives are gone: the new install is the store.
  expect(await storedPaths(page)).toEqual([
    "generals/INI.big",
    "generals/W3D.big",
    "zh/INIZH.big",
    "zh/W3DZH.big",
  ]);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
});
