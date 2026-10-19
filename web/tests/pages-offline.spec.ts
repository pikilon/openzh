import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import type { AddressInfo } from "node:net";

// The published site (scripts/publish-pages.mjs, scripts/lib/pages-sw.mjs)
// served like GitHub Pages, without cross-origin isolation headers: the
// service worker adds them, stores the site, and the site loads without a
// network afterwards (games on a network without internet, src/lan.ts).

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

let site: string;
let server: Server;
let origin: string;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const result = spawnSync("node", ["scripts/publish-pages.mjs", "--no-push"], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  site = /package ready in (\S+)/.exec(result.stdout)![1];
  server = createServer((request, response) => {
    let path = join(site, decodeURIComponent(new URL(request.url!, "http://x").pathname));
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", etag: `"${statSync(path).mtimeMs}"` });
    createReadStream(path).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server?.close();
});

test("the published site loads and starts its engine without a network", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();

  // First visit: the worker installs, stores the site and reloads the page isolated.
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => crossOriginIsolated, null, { timeout: 30_000 });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const names = await caches.keys();
          const cache = names.find((name) => name.startsWith("openzh-"));
          if (!cache) return [];
          return (await (await caches.open(cache)).keys()).map((request) => new URL(request.url).pathname).sort();
        }),
      { timeout: 60_000 },
    )
    .toEqual(expect.arrayContaining(["/", "/dist/main.js", "/dist/bridge-worker.js", "/engine/GeneralsXZH.js", "/engine/GeneralsXZH.wasm", "/shell.css"]));

  await context.setOffline(true);
  await page.goto(`${origin}/?relay=ws://nowhere.test/x#l=abc`);
  await expect(page.locator("#topbar")).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await expect(page.locator("#offline")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
  const wasm = await page.evaluate(async () => {
    const response = await fetch("/engine/GeneralsXZH.wasm");
    return { ok: response.ok, coep: response.headers.get("cross-origin-embedder-policy"), size: (await response.arrayBuffer()).byteLength };
  });
  expect(wasm.ok).toBe(true);
  expect(wasm.coep).toBe("require-corp");
  expect(wasm.size).toBeGreaterThan(1_000_000);
  await context.close();
});
