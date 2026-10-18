import { test, expect, type Page } from "@playwright/test";
import { CANVAS_FIT, importInstall, openLauncher } from "./helpers/launcher";

// Issue #103: the launcher links a PNG icon at /app/favicon.png. The icon is an
// extra: a 404 for it must never block importing the game data or starting the
// engine, and the page names no EA trademark. Since #159 the import starts the
// fake engine by itself.

const FAKE = CANVAS_FIT;
const ICON_PATH = "/app/favicon.png";
// The eight bytes every PNG file starts with.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The path each <link rel="icon"> on the page resolves to, as the browser
// resolves it against the page's own URL.
async function iconPaths(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('link[rel="icon"]')].map((link) => {
      const href = link.getAttribute("href");
      return href === null ? null : new URL(href, document.baseURI).pathname;
    }),
  );
}

test("1: the page links an icon whose href resolves to /app/favicon.png", async ({ page }) => {
  await page.goto("/app/index.html");

  const paths = await iconPaths(page);
  expect(paths.length, 'the page has no <link rel="icon">').toBeGreaterThanOrEqual(1);
  expect(paths).toContain(ICON_PATH);
});

test("2: /app/favicon.png is served as a PNG image", async ({ request }) => {
  const response = await request.get(ICON_PATH);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");

  const body = await response.body();
  expect(body.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
});

test("3: a 404 for the icon still imports the install and starts the fake engine", async ({ page }, info) => {
  let iconRequests = 0;
  await page.route(`**${ICON_PATH}`, async (route) => {
    iconRequests += 1;
    await route.fulfill({ status: 404, body: "" });
  });

  await openLauncher(page, FAKE);
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");

  await importInstall(page, info.outputPath());
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#engine-error")).toHaveCount(1);
  await expect(page.locator("#engine-error")).toBeHidden();

  // The scenario only exists if the page actually asks for the icon and gets
  // the 404 this test routes.
  expect(iconRequests, `the page never requested ${ICON_PATH}`).toBeGreaterThan(0);
});

test("5: the title, headings and icon link carry no EA trademark", async ({ page }) => {
  await page.goto("/app/index.html");

  expect(await page.locator('link[rel="icon"]').count(), 'the page has no <link rel="icon">').toBeGreaterThanOrEqual(
    1,
  );

  const text = await page.evaluate(() => {
    const title = document.title;
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map(
      (heading) => heading.textContent ?? "",
    );
    const icon = document.querySelector('link[rel="icon"]');
    const iconText =
      icon === null
        ? ""
        : [
            icon.textContent ?? "",
            ...[...icon.attributes].map((attribute) => attribute.value),
          ].join(" ");
    return [title, ...headings, iconText].join(" ");
  });

  expect(text).not.toMatch(/Command\s*&\s*Conquer|Generals|Zero Hour/i);
});
