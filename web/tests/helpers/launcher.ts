// Shared launcher setup for the migrated specs (issue #159): the engine starts
// by itself as soon as the four required archives are stored, so no test
// presses Play any more. `body[data-state]` is the page's observable state
// machine and `#status`/`#stored-summary` are its own status lines. Fakes are
// selected with the `module` query parameter, exactly like the real engine URL.

import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installZip } from "./install-zip";

export const APP = "/app/index.html";
export const HARNESS = "/harness/index.html";

// A fake engine that records `window.__fakeEngineLoaded = "resolves"` and
// resolves at once; the simplest engine for a test that does not measure it.
export const RESOLVES = "/harness/errors/resolves.js";

// The fake engines the canvas and layout specs size the drawing buffer with.
export const CANVAS_FIT = "/harness/canvas/fit.js";
export const WIDE_LAYOUT = "/harness/layout/wide.js";

// Engine starts are observable: a fake module is small but the real engine can
// take a while, so waits on the state machine are generous.
export const START_TIMEOUT = 60_000;

export function launcherUrl(module?: string): string {
  return module === undefined ? APP : `${APP}?module=${encodeURIComponent(module)}`;
}

// The harness page re-exports the wrapper's storage code, so OPFS can be reset
// in the same browser context. #159 removed the "Clear stored archives"
// control; the harness API is the test's way to start from a clean store.
export async function clearStored(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
  await page.evaluate(
    () => (window as unknown as { zhwp: { clearStored(): Promise<void> } }).zhwp.clearStored(),
  );
}

// The state machine's current value, as the page exposes it.
export async function waitForState(page: Page, state: string, timeout = START_TIMEOUT): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-state", state, { timeout });
}

// Opens the launcher with a clean store. With every feature present and no
// archives stored, loading ends in the loader; callers that remove a feature
// wait for `unsupported` themselves.
export async function openLauncher(page: Page, module?: string): Promise<void> {
  await clearStored(page);
  await page.goto(launcherUrl(module));
  await expect(page.locator("#stored-summary")).toHaveText(/^Stored: \d+ archives$/);
  await expect(page.locator("body")).toHaveAttribute("data-state", /^(no-assets|unsupported)$/);
}

// Picks a complete synthetic install. The import alone must start the engine:
// no click, the page reaches `playing`, #status says Ready (criterion 4) and
// the canvas is shown.
export async function importInstall(page: Page, dir: string, timeout = START_TIMEOUT): Promise<void> {
  await page.locator("#zip-input").setInputFiles(await installZip(dir));
  await waitForState(page, "playing", timeout);
  await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#canvas")).toBeVisible();
}

export async function fakeEngineLoaded(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () => (window as unknown as { __fakeEngineLoaded?: string }).__fakeEngineLoaded,
  );
}

export async function activeElementId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

// Every file stored under zhwp, as paths relative to it ("zh/INIZH.big").
export async function storedPaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const paths: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
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
      const zhwp = await root.getDirectoryHandle("zhwp");
      await walk(zhwp, "");
    } catch {
      // No stored tree at all.
    }
    return paths.sort();
  });
}

// Stores a synthetic install through the harness's wrapper code, without the
// launcher and without starting an engine, so no file handle stays open on it.
// A test that needs a previous install to be replaced imports a ZIP here, then
// removes an archive if it needs the launcher to stay in the loader.
export async function seedInstall(page: Page, zipPath: string): Promise<void> {
  const bytes = Array.from(readFileSync(zipPath));
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
  await page.evaluate(async (data: number[]) => {
    const zip = new File([new Uint8Array(data)], "previous.zip", { type: "application/zip" });
    const zhwp = (window as unknown as { zhwp: { importZips(zips: Blob[]): Promise<unknown> } }).zhwp;
    await zhwp.importZips([zip]);
  }, bytes);
}

// Removes one stored file ("generals/INI.big") so a complete install stops
// being complete: the launcher then shows the loader instead of starting.
export async function removeStoredArchive(page: Page, path: string): Promise<void> {
  await page.evaluate(async (parts: string[]) => {
    const root = await navigator.storage.getDirectory();
    let dir = await root.getDirectoryHandle("zhwp");
    for (const segment of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(segment);
    }
    await dir.removeEntry(parts[parts.length - 1]);
  }, path.split("/"));
}

export type WarningSample = { visible: boolean; text: string };

// The storage warning is shown before the writes and disappears with the
// loader once the import starts the game: a plain visibility assertion after
// the import would race that transition, so every mutation is sampled.
export async function watchWarning(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples: { visible: boolean; text: string }[] = [];
    (window as unknown as { __warningSamples?: { visible: boolean; text: string }[] }).__warningSamples =
      samples;
    const record = () => {
      const warning = document.getElementById("storage-warning");
      if (warning === null) return;
      const style = getComputedStyle(warning);
      const rect = warning.getBoundingClientRect();
      samples.push({
        visible:
          !warning.hidden &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0,
        text: warning.textContent?.trim() ?? "",
      });
    };
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    record();
  });
}

export async function warningSamples(page: Page): Promise<WarningSample[]> {
  return page.evaluate(
    () => (window as unknown as { __warningSamples?: WarningSample[] }).__warningSamples ?? [],
  );
}
