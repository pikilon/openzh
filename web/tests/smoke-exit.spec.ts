import { test, expect, type Page } from "@playwright/test";

// Issue #38: the smoke page records the engine's exit code so a runner can
// decide whether a headless replay ended with 0 (no CRC mismatch) or 1. Each
// fake module below drives one contract case without starting the real engine.
function fakeModule(name: string): string {
  return `/harness/exit/${name}.js`;
}

type Done =
  | { status: "exited"; code: number }
  | { status: "resolved" }
  | { status: "error"; message?: string };

async function runFake(page: Page, name: string): Promise<Done> {
  await page.goto(`/smoke/index.html?module=${fakeModule(name)}`);
  await page.waitForFunction(
    () => (window as unknown as { __zhwpDone?: unknown }).__zhwpDone !== undefined,
    null,
    { timeout: 60_000 },
  );
  // Let a late abort, factory resolution or unhandled rejection settle before
  // reading the outcome, so "keeps the exit" is actually exercised.
  await page.waitForTimeout(250);
  return page.evaluate(() => (window as unknown as { __zhwpDone: Done }).__zhwpDone);
}

test("1: onExit(0) is recorded as exited with code 0", async ({ page }) => {
  expect(await runFake(page, "exit-0")).toEqual({ status: "exited", code: 0 });
});

test("2: onExit(1) is recorded as exited with code 1", async ({ page }) => {
  expect(await runFake(page, "exit-1")).toEqual({ status: "exited", code: 1 });
});

test("3: a factory rejecting with ExitStatus is recorded as an exit, not an error", async ({ page }) => {
  expect(await runFake(page, "reject-exit-status")).toEqual({ status: "exited", code: 1 });
});

test("3: an unhandled ExitStatus rejection is recorded as an exit, not an error", async ({ page }) => {
  expect(await runFake(page, "unhandled-exit-status")).toEqual({ status: "exited", code: 1 });
});

test("4: an abort after onExit(0) keeps the exit", async ({ page }) => {
  expect(await runFake(page, "exit-then-abort")).toEqual({ status: "exited", code: 0 });
});

test("5: the factory resolving after onExit(0) keeps the exit", async ({ page }) => {
  expect(await runFake(page, "exit-then-resolve")).toEqual({ status: "exited", code: 0 });
});

test("6: a factory rejecting with an ordinary Error is still an error", async ({ page }) => {
  const done = await runFake(page, "reject-error");
  const exitOption = await page.evaluate(
    () => (window as unknown as { __fakeExitOption?: string }).__fakeExitOption,
  );
  expect(exitOption, "the factory options must carry onExit").toBe("function");
  expect(done).toMatchObject({
    status: "error",
    message: "ordinary failure",
  });
});
