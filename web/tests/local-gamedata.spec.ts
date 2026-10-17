import { test, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBig } from "./helpers/big";

// Issue #72: expose ZHWP_GAME_DIR to the launcher read-only and import it on
// load (docs/briefs/72-local-gamedata.md). These tests start their own
// scripts/serve.mjs on a free port with a synthetic folder made by
// tests/helpers/big.ts; no real game data is used.

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVE = join(WEB_ROOT, "scripts", "serve.mjs");
const TEST_SERVER_PORT = Number(process.env.ZHWP_PORT ?? 4173);
const START_TIMEOUT_MS = 20_000;

const REQUIRED_FETCHES = [
  "/gamedata/files/data/generals/ini.big",
  "/gamedata/files/data/generals/w3d.big",
  "/gamedata/files/data/zh/inizh.big",
  "/gamedata/files/data/zh/w3dzh.big",
];

type FileSpec = { path: string; data: Uint8Array | string };

const activeServers: ServeHandle[] = [];

interface ServeHandle {
  url: string;
  port: number;
  output(): string;
  waitForOutput(pattern: RegExp): Promise<void>;
  stop(): Promise<void>;
}

interface ServeExit {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

function archive(label: string): Uint8Array {
  return buildBig([{ path: `Data\\INI\\${label}.ini`, data: `GameData ${label}\nEnd\n` }]);
}

function writeTree(root: string, files: FileSpec[], dirs: string[] = []): string {
  mkdirSync(root, { recursive: true });
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
  for (const file of files) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.data);
  }
  return root;
}

function makeCompleteInstall(root: string): string {
  return writeTree(root, [
    { path: "data/zh/inizh.big", data: archive("inizh") },
    { path: "data/zh/w3dzh.big", data: archive("w3dzh") },
    { path: "data/generals/ini.big", data: archive("ini") },
    { path: "data/generals/w3d.big", data: archive("w3d") },
  ]);
}

function fileRequests(requests: readonly string[]): string[] {
  return requests.filter((path) => path.startsWith("/gamedata/files/"));
}

function freePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => {
        server.closeAllConnections();
        resolvePromise(port);
      });
    });
  });
}

async function startServe(gamedata: string | null = null): Promise<ServeHandle> {
  let port = await freePort();
  while (port === TEST_SERVER_PORT) port = await freePort();
  const args = [SERVE, "--port", String(port), "--mount", "/app=app", "--mount", "/dist=dist"];
  if (gamedata !== null) args.push("--gamedata", gamedata);
  const child = spawn(process.execPath, args, { cwd: WEB_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const handle: ServeHandle = {
    url: `http://127.0.0.1:${port}`,
    port,
    output: () => stdout,
    async waitForOutput(pattern) {
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (!pattern.test(stdout)) {
        if (Date.now() > deadline) {
          throw new Error(`serve did not log ${String(pattern)}: ${stderr}${stdout}`);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      }
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolvePromise) => {
        const timer = setTimeout(resolvePromise, 2000);
        child.once("close", () => {
          clearTimeout(timer);
          resolvePromise();
        });
        child.kill("SIGKILL");
      });
    },
  };

  return new Promise<ServeHandle>((resolvePromise, rejectPromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectPromise(new Error(`serve did not start: ${stderr}${stdout}`));
    }, START_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!settled && stdout.includes("listening on ")) {
        settled = true;
        clearTimeout(timer);
        activeServers.push(handle);
        resolvePromise(handle);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new Error(`serve exited with ${code} before listening: ${stderr}${stdout}`));
    });
  });
}

function runServeToExit(args: string[]): Promise<ServeExit> {
  return new Promise<ServeExit>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SERVE, ...args], { cwd: WEB_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`serve did not exit: ${stderr}${stdout}`));
    }, START_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

// Records the same-origin paths the page requests, decoded to compare with the
// gamedata paths the server lists.
function recordRequests(page: Page, origin: string): string[] {
  const paths: string[] = [];
  page.on("request", (request) => {
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (url.origin !== origin) return;
    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Keep the encoded form when it does not decode.
    }
    paths.push(pathname);
  });
  return paths;
}

test.afterEach(async () => {
  const servers = activeServers.splice(0);
  await Promise.all(servers.map((server) => server.stop()));
});

test("1: /gamedata/index.json lists every .big file at any depth, sorted by path, with relative /-separated paths and sizes", async ({ request }, info) => {
  const root = join(info.outputPath(), "gamedata");
  const files: FileSpec[] = [
    { path: "inizh.big", data: archive("inizh") },
    { path: "w3d.big", data: archive("w3d") },
    { path: "extras/EXTRA.BIG", data: archive("extra") },
    { path: "nested/w3dzh.big", data: archive("w3dzh") },
    { path: "nested/deep/ini.big", data: archive("ini") },
    { path: "readme.txt", data: "not an archive" },
    { path: "nested/notes.md", data: "notes" },
  ];
  writeTree(root, files, ["only-a-directory.big"]);
  const server = await startServe(root);
  await server.waitForOutput(/game data: 5 archives/);

  const response = await request.get(`${server.url}/gamedata/index.json`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^application\/json/);

  const body = (await response.json()) as { files: { path: string; size: number }[] };
  const expected = files
    .filter((file) => file.path.toLowerCase().endsWith(".big"))
    .map((file) => ({ path: file.path, size: statSync(join(root, file.path)).size }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  expect(body).toEqual({ files: expected });
});

test("2: /gamedata/files/<listed path> returns the file's exact bytes with the isolation headers", async ({ request }, info) => {
  const root = join(info.outputPath(), "gamedata");
  const bytes = archive("with space");
  writeTree(root, [{ path: "Game Files/inizh.big", data: bytes }]);
  const server = await startServe(root);

  const index = await request.get(`${server.url}/gamedata/index.json`);
  expect(index.status()).toBe(200);
  expect((await index.json()).files).toContainEqual({ path: "Game Files/inizh.big", size: bytes.length });

  const response = await request.get(`${server.url}/gamedata/files/Game%20Files/inizh.big`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/octet-stream");
  expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(Buffer.from(await response.body())).toEqual(Buffer.from(bytes));
});

test("3: unlisted, non-.big, .. and encoded traversal under /gamedata/files/ are 404", async ({ request }, info) => {
  const root = join(info.outputPath(), "gamedata");
  writeTree(root, [
    { path: "inizh.big", data: archive("inizh") },
    { path: "nested/w3d.big", data: archive("w3d") },
    { path: "readme.txt", data: "not an archive" },
  ]);
  const server = await startServe(root);
  expect((await request.get(`${server.url}/gamedata/index.json`)).status()).toBe(200);

  for (const path of [
    "/gamedata/files/missing.big",
    "/gamedata/files/readme.txt",
    "/gamedata/files/",
    "/gamedata/files/../readme.txt",
    "/gamedata/files/%2e%2e/readme.txt",
    "/gamedata/files/%2e%2e%2freadme.txt",
    "/gamedata/files/..%2freadme.txt",
    "/gamedata/files/nested/%2e%2e%2f%2e%2e%2freadme.txt",
  ]) {
    const response = await request.get(server.url + path);
    expect(response.status(), path).toBe(404);
  }
});

test("4: without --gamedata, or with an empty value, /gamedata/index.json is 404", async ({ request }) => {
  const off = await startServe(null);
  expect((await request.get(`${off.url}/gamedata/index.json`)).status()).toBe(404);

  const empty = await startServe("");
  expect((await request.get(`${empty.url}/gamedata/index.json`)).status()).toBe(404);
  expect((await request.get(`${empty.url}/gamedata/files/inizh.big`)).status()).toBe(404);
});

test("5: a --gamedata value that is not a directory exits with code 2", async ({}, info) => {
  const dir = join(info.outputPath(), "gamedata");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "not-a-directory.big");
  writeFileSync(file, "not a directory");

  for (const value of [file, join(dir, "missing")]) {
    const port = await freePort();
    const result = await runServeToExit(["--port", String(port), "--mount", "/app=app", "--gamedata", value]);
    expect(result.code, `${value}\n${result.stderr}`).toBe(2);
  }
});

test("6: a complete synthetic folder is imported on load, reaches Ready and enables Play", async ({ page }, info) => {
  const server = await startServe(makeCompleteInstall(join(info.outputPath(), "gamedata")));
  const requests = recordRequests(page, server.url);
  // Hold each archive response so #status stays on the import message.
  await page.route("**/gamedata/files/**", async (route) => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    await route.continue();
  });

  await page.goto(`${server.url}/app/index.html`);
  await expect(page.locator("#status")).toContainText("Importing from the local game folder");
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
  expect(fileRequests(requests).sort()).toEqual([...REQUIRED_FETCHES].sort());
});

test("7: reloading the launcher after that requests no /gamedata/files/ URL", async ({ page }, info) => {
  const server = await startServe(makeCompleteInstall(join(info.outputPath(), "gamedata")));
  const requests = recordRequests(page, server.url);

  await page.goto(`${server.url}/app/index.html`);
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  expect(fileRequests(requests)).toHaveLength(4);

  const mark = requests.length;
  await page.goto(`${server.url}/app/index.html`);
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await page.waitForLoadState("networkidle");
  expect(requests.slice(mark).filter((path) => path.startsWith("/gamedata/files/"))).toEqual([]);
});

test("8: ?gamedata=off requests nothing under /gamedata/", async ({ page }, info) => {
  const server = await startServe(makeCompleteInstall(join(info.outputPath(), "gamedata")));
  const requests = recordRequests(page, server.url);

  await page.goto(`${server.url}/app/index.html`);
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect.poll(() => requests.some((path) => path.startsWith("/gamedata/"))).toBe(true);

  const mark = requests.length;
  await page.goto(`${server.url}/app/index.html?gamedata=off`);
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await page.waitForLoadState("networkidle");
  expect(requests.slice(mark).filter((path) => path.startsWith("/gamedata/"))).toEqual([]);
});

test("9: a folder without every required archive gives #status starting with Missing: and stores nothing", async ({ page }, info) => {
  const root = join(info.outputPath(), "gamedata");
  writeTree(root, [{ path: "data/zh/inizh.big", data: archive("inizh") }]);
  const server = await startServe(root);
  const requests = recordRequests(page, server.url);

  await page.goto(`${server.url}/app/index.html`);
  await expect(page.locator("#status")).toHaveText(/^Missing:/);
  await expect(page.locator("#status")).toContainText("W3DZH.big");
  await expect(page.locator("#status")).toContainText("INI.big");
  await expect(page.locator("#status")).toContainText("W3D.big");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 0 archives");
  await expect(page.locator("#play")).toBeDisabled();
  await page.waitForLoadState("networkidle");
  expect(fileRequests(requests)).toEqual([]);
});

test("10: when /gamedata/index.json is 404 the launcher behaves as before", async ({ page }, info) => {
  const server = await startServe(null);
  const requests = recordRequests(page, server.url);

  await page.goto(`${server.url}/app/index.html`);
  await expect(page.locator("#stored-summary")).toHaveText(/Stored: \d+ archives/);
  await expect
    .poll(() => requests.filter((path) => path === "/gamedata/index.json").length)
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator("#status")).toHaveText("");
  await expect(page.locator("#play")).toBeDisabled();
  await expect(page.locator("#folder-input")).toBeEnabled();
  expect(fileRequests(requests)).toEqual([]);

  await page.locator("#folder-input").setInputFiles(makeCompleteInstall(join(info.outputPath(), "manual")));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 30_000 });
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#play")).toBeEnabled();
});

test("11: the serve script passes ZHWP_GAME_DIR to --gamedata", () => {
  const pkg = JSON.parse(readFileSync(join(WEB_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const serve = pkg.scripts?.serve ?? "";
  expect(serve).toContain("scripts/serve.mjs");
  expect(serve).toContain('--gamedata "${ZHWP_GAME_DIR:-}"');
});
