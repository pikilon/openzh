import { gameZips } from "./helpers/real-game";
import { openLauncher, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Issue #79: with the owner's real game data, the browser build must resolve
// every font face the game asks for to the bundled Liberation files, so no
// "[Font] WARNING: Unable to resolve font" line is logged, and the four
// Liberation fonts plus their licence are in the engine's file system. Local
// only: skipped unless ZHWP_GAME_ZIPS lists the game ZIPs (make-game-zip.mjs --split), which hold both game
// installs. Nothing from the game is copied into the repository; the screenshot
// goes to the system temp folder.
//
// Criterion 3 (the synthetic suite still passes) is covered by the rest of the
// suite, which runs without ZHWP_GAME_ZIPS: this file covers criteria 1 and 2.
const gameZipPaths = gameZips();

test.skip(gameZipPaths === null, "set ZHWP_GAME_ZIPS to run against real game data");

// Criterion 1 describes one run from the automatic engine start until 20 s
// after GENERALSX_LOAD_DONE, so that run happens once in beforeAll and test 1
// checks the captured log.
test.describe.configure({ timeout: 15 * 60_000 });

// The files the browser build must preload from assets/fonts/, with their
// licence. The other two files of that directory must not be preloaded.
const PRELOADED_FONTS = [
  "arial.ttf",
  "arialbold.ttf",
  "couriernew.ttf",
  "timesnewroman.ttf",
  "LICENSE.liberation",
] as const;
const NOT_PRELOADED_FONTS = ["fa-brands-400.ttf", "LICENSE.fontawesome"] as const;
const ASSETS_FONTS = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));

// Runs in the page: every regular file the engine's file system exposes. The
// walk guards every node because /proc and /dev are not preloaded game files
// and some of their entries cannot be stat'ed. It is location agnostic on
// purpose: where the browser build puts the files is the implementer's choice,
// but criterion 1 proves the directory is one the engine probes.
function walkEngineFileSystem(): string[] {
  const FS = (window as unknown as { __zhwpModule: { FS: any } }).__zhwpModule.FS;
  const files: string[] = [];
  const walk = (path: string): void => {
    let entries: string[];
    try {
      entries = FS.readdir(path) as string[];
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "." || name === "..") continue;
      const child = path === "/" ? `/${name}` : `${path}/${name}`;
      try {
        const stat = FS.lstat(child);
        if (FS.isDir(stat.mode)) walk(child);
        else if (!FS.isLink(stat.mode)) files.push(child);
      } catch {
        // A node this file system cannot stat is not a preloaded font file.
      }
    }
  };
  walk("/");
  return files;
}

test.describe("fonts on the real engine", () => {
  let context: BrowserContext;
  let page: Page;
  let log: string[] = [];
  let screenshotPath = "";

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.ZHWP_PORT ?? 4173}` });
    page = await context.newPage();
    await openLauncher(page);
    await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

    await page.locator("#zip-input").setInputFiles(gameZipPaths as string[]);
    // Issue #159: the completed import starts the engine by itself; there is
    // no Play click any more.
    await waitForState(page, "playing", 10 * 60_000);
    await expect(page.locator("#status")).toContainText("Ready", { timeout: START_TIMEOUT });

    // The shell map loads behind the main menu; its end is GENERALSX_LOAD_DONE.
    await page.waitForFunction(
      () => ((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? []).some((line) => line.includes("GENERALSX_LOAD_DONE")),
      null,
      { timeout: 5 * 60_000 },
    );
    // Criterion 1 covers the run until 20 s after GENERALSX_LOAD_DONE; the
    // screenshot is what the owner checks the visible menu text with by hand.
    await page.waitForTimeout(20_000);
    log = await page.evaluate(() => [...((window as unknown as { __zhwpLog: string[] }).__zhwpLog)]);
    screenshotPath = join(tmpdir(), "zhwp-web-fonts-79-main-menu.png");
    await page.locator("#canvas").screenshot({ path: screenshotPath });
    console.log(`main menu screenshot: ${screenshotPath}`);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("1: __zhwpLog has no 'Unable to resolve font' line", () => {
    const unresolved = log.filter((line) => line.includes("Unable to resolve font"));
    expect(unresolved.length, `unresolved font faces:\n${unresolved.slice(0, 5).join("\n")}`).toBe(0);
  });

  test("2: the engine file system has the preloaded Liberation files", async () => {
    // The launcher page does not expose the engine module; the smoke page does.
    // Its pagehide handler releases the launcher's OPFS access handles before
    // this page opens them (web/src/bridge.ts closes synchronously), and
    // archives=opfs mounts the archives the launcher stored. Only
    // window.__zhwpModule.FS is read; no game bytes leave the page.
    await page.goto("/smoke/index.html?archives=opfs", { waitUntil: "commit" });
    await page.waitForFunction(
      () => Boolean((window as unknown as { __zhwpModule?: { FS?: unknown } }).__zhwpModule?.FS),
      null,
      { timeout: 5 * 60_000 },
    );
    // The engine's main starts only after the preloaded file package has been
    // unpacked, and [ASSET_ROOT] is what it prints once the archives are
    // mounted, so from there on the file system holds every preload.
    await page.waitForFunction(
      () => ((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? []).some((line) => line.includes("[ASSET_ROOT] Selected")),
      null,
      { timeout: 2 * 60_000 },
    );

    const files = await page.evaluate(walkEngineFileSystem);
    const pathsByName = new Map<string, string[]>();
    for (const path of files) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      pathsByName.set(name, [...(pathsByName.get(name) ?? []), path]);
    }

    for (const name of PRELOADED_FONTS) {
      // Size and digest of the tracked file, so this checks the real Liberation
      // font and not an empty placeholder with the right name.
      const data = readFileSync(join(ASSETS_FONTS, name));
      const expected = { size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
      const paths = pathsByName.get(name) ?? [];
      expect(paths.length, `${name} is not preloaded; engine files: ${files.join(", ")}`).toBeGreaterThan(0);
      for (const path of paths) {
        const actual = await page.evaluate(async (filePath) => {
          const FS = (window as unknown as { __zhwpModule: { FS: any } }).__zhwpModule.FS;
          const bytes = FS.readFile(filePath) as Uint8Array;
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          return {
            size: bytes.length,
            sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
          };
        }, path);
        expect(actual.size, `${path} has the wrong size`).toBe(expected.size);
        expect(actual.sha256, `${path} is not the Liberation file tracked in assets/fonts/`).toBe(expected.sha256);
      }
    }

    for (const name of NOT_PRELOADED_FONTS) {
      expect(pathsByName.has(name), `${name} must not be preloaded`).toBe(false);
    }
  });
});
