// Runs a replay in the browser build, headless, and saves its ZHWP_CRC lines
// (docs/briefs/42-replay-runner.md).
//
// Usage (from web/, after npm run build):
//   node scripts/run-replay.mjs --replay <file.rep> --out <file.crc>
//     [--module <url>] [--archives opfs|none] [--profile <dir>]
//     [--port <n>] [--timeout <seconds>]
//
// Exit codes: 0 engine exited 0, 1 engine failed or the page reported an error,
// 2 bad arguments or a missing replay file, 3 the run timed out.
import { spawn } from "node:child_process";
import { mkdirSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_BRAVE_PATH = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const CRC_PREFIX = "ZHWP_CRC ";
const DEFAULT_TIMEOUT_SECONDS = 600;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseOptions(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        replay: { type: "string" },
        out: { type: "string" },
        module: { type: "string" },
        archives: { type: "string" },
        profile: { type: "string" },
        port: { type: "string" },
        timeout: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (error) {
    fail(`bad arguments: ${error instanceof Error ? error.message : String(error)}`);
  }
  const values = parsed.values;
  if (values.replay === undefined || values.replay === "") fail("--replay <file.rep> is required");
  if (values.out === undefined || values.out === "") fail("--out <file.crc> is required");

  const replay = resolve(values.replay);
  let replayStat;
  try {
    replayStat = statSync(replay);
  } catch {
    fail(`replay file not found: ${values.replay}`);
  }
  if (!replayStat.isFile()) fail(`replay path is not a file: ${values.replay}`);

  const archives = values.archives ?? "opfs";
  if (archives !== "opfs" && archives !== "none") {
    fail(`--archives must be "opfs" or "none": ${archives}`);
  }

  const portText = values.port ?? process.env.ZHWP_PORT ?? "4173";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`--port must be an integer between 1 and 65535: ${portText}`);
  }

  const timeoutText = values.timeout ?? String(DEFAULT_TIMEOUT_SECONDS);
  const timeoutSeconds = Number(timeoutText);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    fail(`--timeout must be a positive number of seconds: ${timeoutText}`);
  }

  return {
    replay,
    out: resolve(values.out),
    moduleUrl: values.module,
    archives,
    profile: values.profile,
    port,
    timeoutMs: timeoutSeconds * 1000,
  };
}

function startServer(port, replayDir) {
  const mounts = [
    ["/smoke", join(WEB_ROOT, "smoke")],
    ["/app", join(WEB_ROOT, "app")],
    ["/engine", join(WEB_ROOT, "..", "build", "webgpu", "GeneralsMD")],
    ["/dist", join(WEB_ROOT, "dist")],
    ["/harness", join(WEB_ROOT, "tests", "harness")],
    ["/replays", replayDir],
  ];
  const args = [join(WEB_ROOT, "scripts", "serve.mjs"), "--port", String(port)];
  for (const [prefix, dir] of mounts) args.push("--mount", `${prefix}=${dir}`);
  const child = spawn(process.execPath, args, {
    cwd: WEB_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, stderr: () => stderr };
}

function stopServer(server) {
  return new Promise((resolveStop) => {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      resolveStop();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      resolveStop();
    };
    const timer = setTimeout(() => {
      server.child.kill("SIGKILL");
      resolveStop();
    }, 2000);
    server.child.once("exit", done);
    server.child.kill("SIGTERM");
  });
}

async function waitForServer(server, port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/smoke/index.html`;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error(`dev server exited before listening${server.stderr() ? `: ${server.stderr().trim()}` : ""}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`dev server did not listen on port ${port}`);
}

function buildPageUrl(port, replay, options) {
  const name = basename(replay);
  const params = new URLSearchParams();
  params.append("replay", `/replays/${encodeURIComponent(name)}`);
  params.append("arg", "-headless");
  params.append("arg", "-replay");
  params.append("arg", name);
  params.append("arg", "-crclog");
  if (options.archives === "opfs") params.append("archives", "opfs");
  if (options.moduleUrl !== undefined) params.append("module", options.moduleUrl);
  return `http://127.0.0.1:${port}/smoke/index.html?${params.toString()}`;
}

async function openPage(options) {
  const launchOptions = {
    executablePath: process.env.BRAVE_PATH ?? DEFAULT_BRAVE_PATH,
    headless: true,
    args: ["--enable-unsafe-webgpu"],
  };
  if (options.profile !== undefined) {
    const profile = resolve(options.profile);
    mkdirSync(profile, { recursive: true });
    const context = await chromium.launchPersistentContext(profile, launchOptions);
    const page = context.pages()[0] ?? (await context.newPage());
    return { context, page, close: () => context.close() };
  }
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page, close: () => browser.close() };
}

async function readCrcLines(page) {
  try {
    const log = await page.evaluate(() => (Array.isArray(window.__zhwpLog) ? window.__zhwpLog : []));
    return log
      .filter((line) => typeof line === "string" && line.startsWith(CRC_PREFIX))
      .map((line) => line.replace(/\r$/, ""));
  } catch {
    return [];
  }
}

async function run(options) {
  const replayDir = dirname(options.replay);
  const server = startServer(options.port, replayDir);
  let browserSession;
  let crcLines = [];
  let outcome;
  let exitCode;

  try {
    await waitForServer(server, options.port);
    browserSession = await openPage(options);
    const pageUrl = buildPageUrl(options.port, options.replay, options);
    await browserSession.page.goto(pageUrl);
    try {
      await browserSession.page.waitForFunction(() => window.__zhwpDone !== undefined, undefined, {
        timeout: options.timeoutMs,
        polling: 100,
      });
      const done = await browserSession.page.evaluate(() => window.__zhwpDone);
      if (done?.status === "exited") {
        const code = Number(done.code);
        exitCode = code === 0 ? 0 : 1;
        outcome = `exited ${code}`;
      } else if (done?.status === "error") {
        exitCode = 1;
        outcome = "error";
      } else {
        exitCode = 1;
        outcome = "error";
      }
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      exitCode = timedOut ? 3 : 1;
      outcome = timedOut ? "timeout" : "error";
    }
    crcLines = await readCrcLines(browserSession.page);
  } catch (error) {
    exitCode = 1;
    outcome = "error";
  } finally {
    try {
      if (browserSession !== undefined) await browserSession.close();
    } catch {
      // Nothing left to close.
    }
    await stopServer(server);
  }

  writeFileSync(options.out, crcLines.length > 0 ? `${crcLines.join("\n")}\n` : "");
  writeSync(1, `RESULT ${outcome} crc_lines=${crcLines.length}\n`);
  process.exit(exitCode);
}

run(parseOptions(process.argv.slice(2)));
