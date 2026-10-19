import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import createTorrent from "create-torrent";
import { installZip } from "./helpers/install-zip";
import { openLauncher, RESOLVES, waitForState } from "./helpers/launcher";

// The game ZIPs can be downloaded from https links, or from a torrent (a
// .torrent link or a magnet link) over WebTorrent; they import like picked files.

const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range, content-length, accept-ranges" };

async function zipBytes(): Promise<Buffer> {
  return readFileSync(await installZip(mkdtempSync(join(tmpdir(), "zhwp-links-"))));
}

/** Serves `body` at `url`, honouring Range requests like a real web server. */
async function serve(page: Page, url: string, body: Buffer, type = "application/zip"): Promise<void> {
  await page.route(url, (route) => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
    if (range === null) return route.fulfill({ status: 200, body, headers: { ...CORS, "content-type": type, "accept-ranges": "bytes" } });
    const start = Number(range[1]);
    const end = range[2] === "" ? body.length - 1 : Number(range[2]);
    return route.fulfill({
      status: 206,
      body: body.subarray(start, end + 1),
      headers: { ...CORS, "content-type": type, "content-range": `bytes ${start}-${end}/${body.length}`, "accept-ranges": "bytes" },
    });
  });
}

test("a link that is not a link is refused before anything downloads", async ({ page }) => {
  await openLauncher(page, RESOLVES);
  await page.locator("#link-input").fill("not a link");
  await page.locator("#link-go").click();
  await expect(page.locator("#import-error")).toContainText("that is not a link");
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
});

test("a server that fails is reported with its link", async ({ page }) => {
  await openLauncher(page, RESOLVES);
  await page.route("https://zips.test/missing.zip", (route) => route.fulfill({ status: 404, headers: CORS, body: "no" }));
  await page.locator("#link-input").fill("https://zips.test/missing.zip");
  await page.locator("#link-go").click();
  await expect(page.locator("#import-error")).toContainText("answered 404");
  await expect(page.locator("#link-go")).toBeEnabled();
});

test("the game ZIP downloads from an https link and imports", async ({ page }) => {
  await openLauncher(page, RESOLVES);
  await serve(page, "https://zips.test/game.zip", await zipBytes());
  await page.locator("#link-input").fill("https://zips.test/game.zip");
  await page.locator("#link-go").click();
  await waitForState(page, "playing");
  await expect(page.locator("#status")).toContainText("Ready");
});

test("the game ZIP downloads from a torrent (web seed) and imports", async ({ page }) => {
  test.setTimeout(120_000);
  await openLauncher(page, RESOLVES);
  const zip = await zipBytes();
  await serve(page, "https://seed.test/game.zip", zip);
  const torrent = await new Promise<Buffer>((resolve, reject) => {
    const file = Object.assign(zip, { name: "game.zip" });
    createTorrent(file, { name: "game.zip", urlList: ["https://seed.test/game.zip"], announce: [] }, (error, result) => (error ? reject(error) : resolve(result)));
  });
  await serve(page, "https://seed.test/game.torrent", Buffer.from(torrent), "application/x-bittorrent");
  await page.locator("#link-input").fill("https://seed.test/game.torrent");
  await page.locator("#link-go").click();
  await waitForState(page, "playing", 90_000);
  await expect(page.locator("#status")).toContainText("Ready");
});
