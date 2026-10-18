import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installZip } from "./helpers/install-zip";
import { openLauncher, START_TIMEOUT, waitForState } from "./helpers/launcher";

// Issue #133: ZIPs are the only way to load the game. The folder pick, the
// development server's game-folder import and src/local-gamedata.ts are gone
// (docs/briefs/133-remove-folder-pick.md). These tests read the files and run
// scripts/serve.mjs directly; no real game data is used.

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVE = join(WEB_ROOT, "scripts", "serve.mjs");
const FAKE = "/harness/canvas/fit.js";
const START_TIMEOUT_MS = 5_000;
const TEXT_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs", ".ts", ".tsx", ".json", ".txt", ".svg"]);

interface ServeExit {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

function filesUnder(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function textFilesUnder(root: string): string[] {
  return filesUnder(root).filter((file) => {
    const dot = file.lastIndexOf(".");
    return dot >= 0 && TEXT_EXTENSIONS.has(file.slice(dot).toLowerCase());
  });
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

function runServe(args: string[]): Promise<ServeExit> {
  return new Promise<ServeExit>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SERVE, ...args], {
      cwd: WEB_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), START_TIMEOUT_MS);
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

test("1: the launcher HTML has no #folder-input and no webkitdirectory", async ({ page }) => {
  const html = readFileSync(join(WEB_ROOT, "app", "index.html"), "utf8");
  expect(html).not.toContain("folder-input");
  expect(html.toLowerCase()).not.toContain("webkitdirectory");

  await page.goto("/app/index.html");
  await expect(page.locator("#folder-input")).toHaveCount(0);
  await expect(page.locator("input[webkitdirectory]")).toHaveCount(0);
});

test("2: local-gamedata is gone and no src or app file mentions gamedata or webkitRelativePath", () => {
  expect(existsSync(join(WEB_ROOT, "src", "local-gamedata.ts")), "src/local-gamedata.ts").toBe(false);
  expect(existsSync(join(WEB_ROOT, "tests", "local-gamedata.spec.ts")), "tests/local-gamedata.spec.ts").toBe(false);

  for (const dir of ["src", "app"]) {
    for (const file of textFilesUnder(join(WEB_ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} mentions gamedata`).not.toMatch(/gamedata/i);
      expect(text, `${file} mentions webkitRelativePath`).not.toContain("webkitRelativePath");
    }
  }
});

test("3: --gamedata is an unknown option (exit 2) and /gamedata/index.json is 404", async ({ request }, info) => {
  const dir = join(info.outputPath(), "gamedata");
  mkdirSync(dir, { recursive: true });
  const port = await freePort();

  const result = await runServe(["--port", String(port), "--mount", "/app=app", "--gamedata", dir]);
  expect(result.code, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(2);

  expect((await request.get("/gamedata/index.json")).status()).toBe(404);
});

test("4: the package.json serve script does not pass --gamedata", () => {
  const pkg = JSON.parse(readFileSync(join(WEB_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const serve = pkg.scripts?.serve ?? "";
  expect(serve).toContain("scripts/serve.mjs");
  expect(serve).not.toContain("--gamedata");
});

test("6: a four-archive synthetic ZIP ends Ready, stores 4 archives and starts the fake engine", async ({ page }, info) => {
  // Issue #159: the complete import starts the fake engine by itself; there is
  // no Play click any more and the removed #clear is the harness reset.
  await openLauncher(page, FAKE);

  await page.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await expect(page.locator("#status")).toContainText("Ready", { timeout: START_TIMEOUT });
  await waitForState(page, "playing");
  await expect(page.locator("#stored-summary")).toHaveText("Stored: 4 archives");
  await expect(page.locator("#canvas")).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
    return canvas !== null && canvas.width === 1024 && canvas.height === 768;
  });
});
