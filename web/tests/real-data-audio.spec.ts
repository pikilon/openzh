import { gameZips } from "./helpers/real-game";
import { openLauncher, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// Issue #35: with the owner's real game data, after the automatic engine start
// (the ZIP import is the user gesture) the engine's audio backend must create a
// running AudioContext whose clock advances, and the engine must log the sounds
// it plays. Local only: skipped unless ZHWP_GAME_ZIPS lists the game ZIPs
// (make-game-zip.mjs --split), which hold both game installs. Nothing from the
// game is copied into the repository.
const gameZipPaths = gameZips();

test.skip(gameZipPaths === null, "set ZHWP_GAME_ZIPS to run against real game data");

// The five criteria describe one run: from the automatic start until 5 s after
// GENERALSX_LOAD_DONE and 5 s more for the clock to advance. The run happens
// once in beforeAll and each test checks its own criterion against the same
// snapshots and log.
test.describe.configure({ timeout: 15 * 60_000 });

type AudioContextSnapshot = { state: string; currentTime: number };

async function readAudioContexts(page: Page): Promise<AudioContextSnapshot[]> {
  return page.evaluate(() => {
    const contexts = (window as unknown as { __zhwpAudioContexts?: AudioContext[] }).__zhwpAudioContexts ?? [];
    return contexts.map((context) => ({ state: context.state, currentTime: context.currentTime }));
  });
}

test.describe("audio on the real engine", () => {
  let context: BrowserContext;
  let page: Page;
  let beforeEngine: AudioContextSnapshot[] = [];
  let afterLoad: AudioContextSnapshot[] = [];
  let later: AudioContextSnapshot[] = [];
  let log: string[] = [];

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.ZHWP_PORT ?? 4173}` });
    page = await context.newPage();
    // Runs before any page script: every AudioContext the page creates is
    // pushed to __zhwpAudioContexts, and the wrapper returns the real context.
    await page.addInitScript(() => {
      const page = window as unknown as { __zhwpAudioContexts?: AudioContext[]; AudioContext: typeof AudioContext };
      const contexts: AudioContext[] = [];
      page.__zhwpAudioContexts = contexts;
      const RealAudioContext = page.AudioContext;
      if (typeof RealAudioContext === "function") {
        page.AudioContext = new Proxy(RealAudioContext, {
          construct(target, args) {
            const created = Reflect.construct(target, args, target) as AudioContext;
            contexts.push(created);
            return created;
          },
        });
      }
    });
    await openLauncher(page);
    await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");

    // Criterion 1: the launcher itself must not have created a context before
    // the ZIP import starts the engine (#159 removed the Play click).
    beforeEngine = await readAudioContexts(page);

    await page.locator("#zip-input").setInputFiles(gameZipPaths as string[]);
    // The complete import starts the engine by itself.
    await waitForState(page, "playing", 10 * 60_000);
    await expect(page.locator("#status")).toContainText("Ready", { timeout: START_TIMEOUT });

    // The shell map loads behind the main menu; its end is GENERALSX_LOAD_DONE.
    await page.waitForFunction(
      () => ((window as unknown as { __zhwpLog?: string[] }).__zhwpLog ?? []).some((line) => line.includes("GENERALSX_LOAD_DONE")),
      null,
      { timeout: 5 * 60_000 },
    );
    // Criteria 2 and 3: state and currentTime 5 s after the load finished.
    await page.waitForTimeout(5000);
    afterLoad = await readAudioContexts(page);
    // Criterion 3: the same contexts' currentTime 5 s later.
    await page.waitForTimeout(5000);
    later = await readAudioContexts(page);
    // Criteria 4 and 5: the run's log at its end.
    log = await page.evaluate(() => [...((window as unknown as { __zhwpLog: string[] }).__zhwpLog)]);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("1: no AudioContext exists before the engine starts", () => {
    expect(beforeEngine, `AudioContexts created before the engine started: ${JSON.stringify(beforeEngine)}`).toEqual([]);
  });

  test("2: at least one AudioContext is running after the engine loaded", () => {
    const running = afterLoad.filter((snapshot) => snapshot.state === "running");
    expect(
      running.length,
      `no running AudioContext after GENERALSX_LOAD_DONE; contexts: ${JSON.stringify(afterLoad)}`,
    ).toBeGreaterThan(0);
  });

  test("3: the running AudioContext's currentTime grows by at least 4 seconds", () => {
    const running = afterLoad
      .map((snapshot, index) => ({ ...snapshot, index }))
      .filter((snapshot) => snapshot.state === "running");
    expect(
      running.length,
      `no running AudioContext to measure after GENERALSX_LOAD_DONE; contexts: ${JSON.stringify(afterLoad)}`,
    ).toBeGreaterThan(0);
    const first = running[0];
    const second: AudioContextSnapshot | undefined = later[first.index];
    if (second === undefined) {
      throw new Error(`AudioContext #${first.index} disappeared during the 5 s wait`);
    }
    const growth = second.currentTime - first.currentTime;
    expect(
      growth,
      `AudioContext #${first.index} currentTime grew ${growth.toFixed(3)} s (${first.currentTime} -> ${second.currentTime})`,
    ).toBeGreaterThanOrEqual(4);
  });

  test("4: __zhwpLog has at least one 'AUDIO_REQ <file> ok' line", () => {
    const requests = log.filter((line) => /^AUDIO_REQ .* ok$/.test(line));
    expect(requests.length, `no successful AUDIO_REQ line; log tail: ${log.slice(-10).join(" | ")}`).toBeGreaterThan(0);
  });

  test("5: __zhwpLog has no WebGPU failure or runtime abort line", () => {
    const failures = log.filter((line) => /GENERALSX_WEBGPU_\w+_FAILED|RuntimeError|Aborted\(/.test(line));
    expect(failures, `failing lines:\n${failures.slice(0, 5).join("\n")}`).toEqual([]);
  });
});
