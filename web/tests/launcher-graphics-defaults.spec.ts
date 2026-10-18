import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openLauncher } from "./helpers/launcher";
import { buildBig } from "./helpers/big";
import { buildZip, type BuildZipEntry } from "./helpers/zip";

// Issue #173: on a fresh web profile the real engine (no `module` parameter)
// reaches initialization with the 1920x1080 / maximum-graphics defaults and
// prints them exactly once. The install is synthetic (no game data): it only
// has to reach GameLODManager::init, where the line is printed. A later engine
// error on those synthetic assets is expected and does not fail the test.
// Criterion 5 is this test's failure on the old build: it has no such line.
//
// The canvas drawing buffer is checked separately, against real game data:
// the synthetic assets fail before display init, so the canvas stays 0x0 and
// criterion 2 cannot be measured here (tests/real-data-resolution.spec.ts).

const LOG_PREFIX = "GENERALSX_GRAPHICS ";
const EXPECTED_VALUES =
  "xres=1920 yres=1080 lod=VeryHigh aa=4 filter=4 anisotropy=16 dynamicLOD=0";
const GRAPHICS_TIMEOUT = 90_000;

// `installZip` gives every archive one `Data\\INI\\Default\\<archive>.ini`
// entry, which is not enough for the engine to walk past its global data and
// GameLOD INI loads: it stops at the first required INI directory with no
// files. This install keeps the four required archive names the launcher
// checks for (synthetic data only) and adds the INI files the engine reads
// before it reaches GameLODManager::init. The files are comment-only: loading
// them only has to succeed, never to change the fresh-profile defaults.
const EMPTY_INI = "; synthetic placeholder: the engine only has to open it\n";

async function syntheticInstall(dir: string): Promise<string> {
  const archive = (name: string, entries: { path: string; data: string }[]) => ({
    path: name,
    data: buildBig(entries),
    method: "store" as const,
  });
  const entries: BuildZipEntry[] = [
    archive("INIZH.big", [
      { path: "Data\\INI\\Default\\INIZH.ini", data: "GameData\nEnd\n" },
    ]),
    archive("W3DZH.big", [
      { path: "Data\\INI\\Default\\W3DZH.ini", data: "GameData\nEnd\n" },
    ]),
    archive("INI.big", [
      { path: "Data\\INI\\Default\\GameData.ini", data: "GameData\nEnd\n" },
      { path: "Data\\INI\\GameData.ini", data: "GameData\nEnd\n" },
      { path: "Data\\INI\\GameLOD.ini", data: EMPTY_INI },
      { path: "Data\\INI\\GameLODPresets.ini", data: EMPTY_INI },
    ]),
    archive("W3D.big", [
      { path: "Data\\INI\\Default\\W3D.ini", data: "GameData\nEnd\n" },
    ]),
  ];
  const bytes = await buildZip(entries);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "synthetic-1080p.zip");
  writeFileSync(path, bytes);
  return path;
}

type PageWithLog = Window &
  typeof globalThis & {
    __zhwpLog?: string[];
  };

async function graphicsLines(page: Page): Promise<string[]> {
  return page.evaluate(
    (prefix) =>
      [...((window as unknown as PageWithLog).__zhwpLog ?? [])].filter((line) =>
        line.startsWith(prefix),
      ),
    LOG_PREFIX,
  );
}

// Waits on the observable log, never on a fixed delay. The old engine does not
// have this line at all, so the timeout is the intended pre-implementation
// failure (criterion 5); the error reports what the engine did log instead.
async function waitForGraphicsLine(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      (prefix) =>
        ((window as unknown as PageWithLog).__zhwpLog ?? []).some((line) => line.startsWith(prefix)),
      LOG_PREFIX,
      { timeout: GRAPHICS_TIMEOUT },
    );
  } catch {
    let tail = "(the page could not be read)";
    try {
      const diagnostic = await page.evaluate(() => {
        const log = [...((window as unknown as PageWithLog).__zhwpLog ?? [])];
        return {
          state: document.body.dataset.state ?? "",
          done: (window as unknown as { __zhwpDone?: unknown }).__zhwpDone ?? null,
          log,
        };
      });
      tail =
        `data-state=${JSON.stringify(diagnostic.state)} __zhwpDone=${JSON.stringify(diagnostic.done)}\n` +
        (diagnostic.log.length === 0
          ? "(the log is empty)"
          : diagnostic.log.slice(-40).join("\n"));
    } catch {
      // The page crashed: keep the generic message.
    }
    throw new Error(
      `no line starting ${JSON.stringify(LOG_PREFIX)} in window.__zhwpLog ` +
        `after ${GRAPHICS_TIMEOUT} ms; the engine was:\n${tail}`,
    );
  }
}

test("1: the real engine logs exactly one 1080p VeryHigh graphics line on a fresh synthetic install", async ({
  page,
}, info) => {
  // The engine can be slow to compile its WASM; this is the passing path, the
  // failing path is the narrower wait above.
  test.setTimeout(3 * 60_000);

  // A fresh profile: no module parameter, so /engine/GeneralsXZH.js runs, and
  // no stored archives, so the import below is the only install.
  await openLauncher(page);
  await page.locator("#zip-input").setInputFiles(await syntheticInstall(info.outputPath()));
  // The import alone starts the engine; do not wait for `playing` or the main
  // menu, the synthetic archives only have to reach engine initialization.
  await waitForGraphicsLine(page);

  // Exactly one line, with the fresh-profile values.
  const lines = await graphicsLines(page);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe(`${LOG_PREFIX}${EXPECTED_VALUES}`);
});
