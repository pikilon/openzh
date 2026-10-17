import { test, expect, type Page } from "@playwright/test";

// Issue #37: the smoke page passes engine arguments taken from its URL instead
// of the fixed -win. A fake engine module records the factory options, so the
// contract is checked without starting the real engine.
const FAKE_MODULE = "/harness/args/fake-engine.js";

type Param = [key: string, value: string];

async function runFake(page: Page, params: Param[] = []): Promise<string[]> {
  const query = new URLSearchParams();
  query.set("module", FAKE_MODULE);
  for (const [key, value] of params) query.append(key, value);
  await page.goto(`/smoke/index.html?${query.toString()}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __fakeEngine?: unknown; __zhwpDone?: { status: string } };
      return w.__fakeEngine !== undefined || w.__zhwpDone?.status === "error";
    },
    null,
    { timeout: 60_000 },
  );
  const result = await page.evaluate(() => {
    const w = window as unknown as {
      __fakeEngine?: { arguments?: unknown };
      __zhwpDone?: { status: string; message?: string };
    };
    return { arguments: w.__fakeEngine?.arguments, done: w.__zhwpDone };
  });
  expect(result.done?.status, `page reported: ${result.done?.message}`).not.toBe("error");
  return result.arguments as string[];
}

test("1: without arg parameters the engine receives -win", async ({ page }) => {
  expect(await runFake(page)).toEqual(["-win"]);
});

test("2: arg parameters become the engine arguments in URL order", async ({ page }) => {
  const args = await runFake(page, [
    ["arg", "-headless"],
    ["arg", "-replay"],
    ["arg", "a.rep"],
  ]);
  expect(args).toEqual(["-headless", "-replay", "a.rep"]);
});

test("3: arg values are passed unchanged, including spaces and an empty value", async ({ page }) => {
  const args = await runFake(page, [
    ["arg", "-replay"],
    ["arg", "my saved game.rep"],
    ["arg", ""],
    ["arg", " trailing space "],
  ]);
  expect(args).toEqual(["-replay", "my saved game.rep", "", " trailing space "]);
});

test("4: the module parameter still selects the engine alongside arg", async ({ page }) => {
  const args = await runFake(page, [["arg", "-headless"]]);
  expect(args).toEqual(["-headless"]);
});

test("4: archives=opfs still prepares the engine alongside arg", async ({ page }) => {
  const args = await runFake(page, [
    ["archives", "opfs"],
    ["arg", "-headless"],
  ]);
  expect(args).toEqual(["-headless"]);
  const prepared = await page.evaluate(
    () => typeof (window as unknown as { __zhwpSaveUserData?: unknown }).__zhwpSaveUserData === "function",
  );
  expect(prepared).toBe(true);
});
