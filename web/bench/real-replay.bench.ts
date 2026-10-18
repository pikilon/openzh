import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

// Issue #36: frame-time baseline of a real replay windowed in Brave with the
// owner's game files. Local only: skipped unless ZHWP_GAME_DIR points to the
// game installs and ZHWP_REPLAY to one .rep file. Not part of `npm test`: run
// `npm run bench -- real-replay`; record the FRAME_BASELINE line in
// docs/porting-notes.md.
const gameDir = process.env.ZHWP_GAME_DIR;
const replayFile = process.env.ZHWP_REPLAY;

test.skip(
  !gameDir || !existsSync(gameDir) || !replayFile || !existsSync(replayFile),
  "set ZHWP_GAME_DIR and ZHWP_REPLAY to run against real game data",
);

type FrameWindow = {
  __zhwpFrameDeltas?: number[];
  __zhwpLog?: string[];
  __zhwpModule?: unknown;
  __zhwpDone?: unknown;
};

// Deltas sorted ascending, nearest-rank percentile, values in ms rounded to
// 0.01. `over33ms` counts deltas strictly above 33.4 ms (one 30 Hz frame).
function summarize(deltas: number[]) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const round = (ms: number) => Math.round(ms * 100) / 100;
  return {
    frames: sorted.length,
    p50: round(at(50)),
    p95: round(at(95)),
    p99: round(at(99)),
    max: round(sorted.length === 0 ? 0 : sorted[sorted.length - 1]),
    over33ms: sorted.filter((delta) => delta > 33.4).length,
  };
}

test("real replay frame-time baseline", async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const gamePath = gameDir as string;
  const replayPath = replayFile as string;
  const replayName = basename(replayPath);
  const replayBytes = readFileSync(replayPath);
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.ZHWP_PORT ?? 4173}`,
  });

  try {
    // Record the browser's frame cadence before any page script runs. The
    // callback reads the window property on every frame, so clearing it
    // between the warm-up and the measured window starts a fresh sample.
    await context.addInitScript(() => {
      const w = window as unknown as { __zhwpFrameDeltas: number[] };
      w.__zhwpFrameDeltas = [];
      let previous: number | undefined;
      const tick = (timestamp: number) => {
        if (previous !== undefined) w.__zhwpFrameDeltas.push(timestamp - previous);
        previous = timestamp;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // Import the game files exactly as tests/real-data.spec.ts does: the
    // launcher stores the archives in OPFS, which the smoke page mounts.
    const page = await context.newPage();
    await page.goto("/app/index.html");
    await page.locator("#clear").click();
    await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
    await page.locator("#folder-input").setInputFiles(gamePath);
    await expect(page.locator("#status")).toContainText("Ready", { timeout: 10 * 60_000 });
    await expect(page.locator("#play")).toBeEnabled();

    // Same browser context as the launcher, so the smoke page sees the same
    // OPFS. Serve only the replay's path; matching on URL.pathname keeps the
    // page's own URL (which contains replay=/replays/<name>) untouched.
    const smoke = await context.newPage();
    await smoke.route(
      (url) => url.pathname === `/replays/${encodeURIComponent(replayName)}`,
      (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: replayBytes }),
    );
    const encodedName = encodeURIComponent(replayName);
    await smoke.goto(
      `/smoke/index.html?archives=opfs&replay=/replays/${encodedName}&arg=-win&arg=-replay&arg=${encodedName}`,
    );
    await smoke.bringToFront();

    // Let the engine mount OPFS and start before the fixed timing sequence.
    await smoke.waitForFunction(
      () => {
        const w = window as unknown as FrameWindow;
        return w.__zhwpModule !== undefined || w.__zhwpDone !== undefined;
      },
      null,
      { timeout: 5 * 60_000 },
    );
    // The first real run pauses the replay at logic frame 100
    // (REPLAY_CRC_MISMATCH, expected in phase 1). Focusing the canvas and
    // pressing P resumes the logic so the measured frames are not idle ones.
    await smoke.waitForTimeout(20_000);
    await smoke.locator("#canvas").click();
    await smoke.keyboard.press("p");
    await smoke.waitForTimeout(5_000);
    await smoke.evaluate(() => {
      const w = window as unknown as FrameWindow;
      if (w.__zhwpFrameDeltas) w.__zhwpFrameDeltas.length = 0;
    });
    await smoke.waitForTimeout(60_000);

    const deltas = await smoke.evaluate(() => [...((window as unknown as FrameWindow).__zhwpFrameDeltas ?? [])]);
    const log = await smoke.evaluate(() => [...((window as unknown as FrameWindow).__zhwpLog ?? [])]);
    const baseline = summarize(deltas);
    console.log(`FRAME_BASELINE ${JSON.stringify(baseline)}`);

    // The bench fails only on too few frames or a WebGPU failure or abort.
    expect(baseline.frames, `only ${baseline.frames} frames measured in 60 s`).toBeGreaterThanOrEqual(1000);
    const failures = log.filter((line) => /GENERALSX_WEBGPU_\w+_FAILED|RuntimeError|Aborted\(/.test(line));
    expect(failures, `failures in the engine log:\n${failures.slice(0, 5).join("\n")}`).toEqual([]);
  } finally {
    await context.close();
  }
});
