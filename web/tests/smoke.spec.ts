import { test, expect, type Page } from "@playwright/test";

// Start-up milestones of the engine without game data, in the order they must
// appear. Without .big archives the engine must stop at the missing GameData.ini
// and nowhere earlier.
const MILESTONES: RegExp[] = [
  /SDL3 window created successfully/,
  /initSubsystem\('TheLocalFileSystem'\) END/,
  /initSubsystem\('TheArchiveFileSystem'\) END/,
  /No files read from directory 'Data\\INI\\Default\\GameData'/,
];
const FAILURES = /RuntimeError|Aborted\(|abort\(|unreachable|out of bounds|\[page\] /;

type Done = { status: "resolved" | "error"; message?: string } | undefined;

async function run(page: Page, query = ""): Promise<{ log: string[]; done: Done }> {
  await page.goto(`/smoke/index.html${query}`);
  const last = MILESTONES[MILESTONES.length - 1].source;
  await page.waitForFunction(
    (lastSource) => {
      const w = window as unknown as { __zhwpLog?: string[]; __zhwpDone?: { status: string } };
      const re = new RegExp(lastSource);
      return w.__zhwpDone?.status === "error" || (w.__zhwpLog ?? []).some((line) => re.test(line));
    },
    last,
    { timeout: 60_000 },
  );
  return page.evaluate(() => {
    const w = window as unknown as { __zhwpLog: string[]; __zhwpDone: Done };
    return { log: [...w.__zhwpLog], done: w.__zhwpDone };
  });
}

test("engine starts and stops at the missing game data, in order", async ({ page }) => {
  const { log, done } = await run(page);
  expect(done?.status, `page reported: ${done?.message}`).not.toBe("error");
  let previous = -1;
  for (const milestone of MILESTONES) {
    const index = log.findIndex((line) => milestone.test(line));
    expect(index, `milestone ${milestone} missing; last lines:\n${log.slice(-15).join("\n")}`).toBeGreaterThan(previous);
    previous = index;
  }
  const failure = log.slice(0, previous).find((line) => FAILURES.test(line));
  expect(failure, "engine failed before the expected stop").toBeUndefined();
});

test("a module that cannot load is reported as an error", async ({ page }) => {
  const { done } = await run(page, "?module=/engine/does-not-exist.js");
  expect(done?.status).toBe("error");
  expect(done?.message ?? "").not.toBe("");
});

test("the page is cross-origin isolated", async ({ page }) => {
  await page.goto("/smoke/index.html?module=/engine/does-not-exist.js");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
});
