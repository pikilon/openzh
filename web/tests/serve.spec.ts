import { test, expect } from "@playwright/test";

// Contract of scripts/serve.mjs (see docs/briefs/4-smoke-harness.md).

test("every response carries the cross-origin isolation headers", async ({ request }) => {
  for (const path of ["/smoke/index.html", "/engine/GeneralsXZH.js", "/engine/GeneralsXZH.wasm", "/smoke/missing.txt"]) {
    const res = await request.get(path);
    expect(res.headers()["cross-origin-opener-policy"], path).toBe("same-origin");
    expect(res.headers()["cross-origin-embedder-policy"], path).toBe("require-corp");
    expect(res.headers()["cross-origin-resource-policy"], path).toBe("same-origin");
    expect(res.headers()["cache-control"], path).toBe("no-store");
  }
});

test("content types match what browsers require", async ({ request }) => {
  const types: Record<string, RegExp> = {
    "/smoke/index.html": /^text\/html/,
    "/engine/GeneralsXZH.js": /^text\/javascript/,
    "/engine/GeneralsXZH.wasm": /^application\/wasm$/,
  };
  for (const [path, type] of Object.entries(types)) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toMatch(type);
  }
});

test("missing files and paths outside a mount are 404", async ({ request }) => {
  expect((await request.get("/smoke/missing.txt")).status()).toBe(404);
  expect((await request.get("/nowhere/index.html")).status()).toBe(404);
  expect((await request.get("/smoke/../package.json")).status()).toBe(404);
  expect((await request.get("/smoke/%2e%2e/package.json")).status()).toBe(404);
  expect((await request.get("/engine/..%2f..%2fweb%2fpackage.json")).status()).toBe(404);
});

test("served bytes are the file's bytes", async ({ request }) => {
  const res = await request.get("/engine/GeneralsXZH.wasm");
  const body = await res.body();
  expect(body.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
  expect(Number(res.headers()["content-length"])).toBe(body.length);
});
