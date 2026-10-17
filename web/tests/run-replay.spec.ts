import { test, expect, type TestInfo } from "@playwright/test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Contract of scripts/run-replay.mjs (docs/briefs/42-replay-runner.md).
//
// These are Node-side tests: the command is spawned as a child process with
// `--archives none` and its own port, and it runs synthetic fake engines served
// by its server from tests/harness/replay/. No real replay or game data is used.

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUN_REPLAY = join(WEB_ROOT, "scripts", "run-replay.mjs");
const TEST_SERVER_PORT = Number(process.env.ZHWP_PORT ?? 4173);
const SPAWN_TIMEOUT_MS = 60_000;

const THREE_CRC = "/harness/replay/three-crc.js";
const EXIT_1 = "/harness/replay/exit-1.js";
const NEVER_FINISHES = "/harness/replay/never-finishes.js";
const ABORTS = "/harness/replay/aborts.js";
const REPORTS_ARGS = "/harness/replay/reports-args.js";

// Bytes of a made-up replay file. Never a real replay.
const SYNTHETIC_REPLAY = Buffer.from("ZHWP synthetic replay, issue 42\n", "utf8");

interface RunResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

interface ProbeRecord {
  path: string;
  args: string[];
}

interface Probe {
  url: string;
  records: ProbeRecord[];
  close: () => Promise<void>;
}

function report(result: RunResult): string {
  return `exit ${result.status} signal ${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

// Splits text into lines, removing only one final newline so stray blank lines
// inside a file are not silently ignored.
function fileLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed === "" ? [] : trimmed.split("\n");
}

function lastStdoutLine(result: RunResult): string {
  return fileLines(result.stdout).at(-1) ?? "";
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

// A port the OS says is free right now, different from the Playwright server's.
async function freePort(): Promise<number> {
  for (;;) {
    const server = createServer();
    await listen(server);
    const port = (server.address() as AddressInfo).port;
    await closeServer(server);
    if (port !== TEST_SERVER_PORT) return port;
  }
}

async function portIsFree(port: number): Promise<boolean> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch {
    return false;
  }
  await closeServer(server);
  return true;
}

async function waitForPortFree(port: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return portIsFree(port);
}

function runReplay(args: string[], env: Record<string, string | undefined> = process.env): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUN_REPLAY, ...args], {
      cwd: WEB_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), SPAWN_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: null, signal: null, stdout, stderr: `${stderr}${error}` });
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function replayFile(info: TestInfo, name = "sample.rep"): string {
  const path = info.outputPath("replays", name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, SYNTHETIC_REPLAY);
  return path;
}

function outFile(info: TestInfo): string {
  const path = info.outputPath("out", "replay.crc");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

// The command line shared by the runs that expect a browser: synthetic replay,
// its own out file, a fake engine, no archives and a port of its own.
function replayArgs(info: TestInfo, port: number, moduleUrl: string, name = "sample.rep"): string[] {
  return [
    "--replay", replayFile(info, name),
    "--out", outFile(info),
    "--module", moduleUrl,
    "--archives", "none",
    "--port", String(port),
  ];
}

function crcLines(path: string, result: RunResult): string[] {
  expect(existsSync(path), `out file ${path} was not written; ${report(result)}`).toBe(true);
  return fileLines(readFileSync(path, "utf8"));
}

// A stand-in for Brave: records that it was executed, then exits without ever
// becoming a browser, so a test can prove no browser was started.
function braveStub(info: TestInfo): { executable: string; marker: string } {
  const dir = info.outputPath("brave-stub");
  mkdirSync(dir, { recursive: true });
  const executable = join(dir, "brave");
  const marker = join(dir, "browser-started");
  writeFileSync(
    executable,
    ["#!/bin/sh", ': > "$(dirname "$0")/browser-started"', "exit 0", ""].join("\n"),
  );
  chmodSync(executable, 0o755);
  return { executable, marker };
}

// A browser-reachable server the fake engine reports to, since the runner owns
// the browser and the test cannot read the page's variables.
async function startProbe(): Promise<Probe> {
  const records: ProbeRecord[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    records.push({ path: url.pathname, args: url.searchParams.getAll("arg") });
    // The smoke page is cross-origin isolated (COEP require-corp), so the
    // response has to opt in to being read cross-origin.
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    response.setHeader("Connection", "close");
    response.statusCode = 200;
    response.end("ok");
  });
  await listen(server);
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    records,
    close: () => closeServer(server),
  };
}

test("1: a fake engine's ZHWP_CRC lines are written to the out file in order", async ({}, info) => {
  const port = await freePort();
  const out = outFile(info);
  const result = await runReplay(replayArgs(info, port, THREE_CRC));

  expect(result.status, report(result)).toBe(0);
  expect(crcLines(out, result)).toEqual([
    "ZHWP_CRC 1 0a1b2c3d",
    "ZHWP_CRC 2 0a1b2c3e",
    "ZHWP_CRC 3 0a1b2c3f",
  ]);
});

test("2: the last output line reports the exit code and the CRC line count", async ({}, info) => {
  const port = await freePort();
  const result = await runReplay(replayArgs(info, port, THREE_CRC));

  expect(result.status, report(result)).toBe(0);
  expect(lastStdoutLine(result), report(result)).toBe("RESULT exited 0 crc_lines=3");
});

test("3: an engine that exits 1 makes the command exit 1 and keeps the earlier lines", async ({}, info) => {
  const port = await freePort();
  const out = outFile(info);
  const result = await runReplay(replayArgs(info, port, EXIT_1));

  expect(result.status, report(result)).toBe(1);
  expect(crcLines(out, result)).toEqual(["ZHWP_CRC 1 11111111", "ZHWP_CRC 2 22222222"]);
  expect(lastStdoutLine(result), report(result)).toBe("RESULT exited 1 crc_lines=2");
});

test("4: an engine that never finishes times out with exit 3", async ({}, info) => {
  const port = await freePort();
  const out = outFile(info);
  const result = await runReplay([...replayArgs(info, port, NEVER_FINISHES), "--timeout", "5"]);

  expect(result.status, report(result)).toBe(3);
  expect(lastStdoutLine(result), report(result)).toBe("RESULT timeout crc_lines=1");
  expect(crcLines(out, result)).toEqual(["ZHWP_CRC 9 deadbeef"]);
});

test("5: an engine that aborts makes the command exit 1 and report error", async ({}, info) => {
  const port = await freePort();
  const result = await runReplay(replayArgs(info, port, ABORTS));

  expect(result.status, report(result)).toBe(1);
  expect(lastStdoutLine(result), report(result)).toBe("RESULT error crc_lines=0");
});

test("6: the engine receives -headless -replay <name> -crclog in that order", async ({}, info) => {
  const port = await freePort();
  const probe = await startProbe();
  try {
    const name = "synthetic-args.rep";
    const moduleUrl = `${REPORTS_ARGS}?probe=${encodeURIComponent(probe.url)}`;
    const result = await runReplay(replayArgs(info, port, moduleUrl, name));

    expect(result.status, report(result)).toBe(0);
    expect(probe.records, report(result)).toEqual([
      { path: "/args", args: ["-headless", "-replay", name, "-crclog"] },
    ]);
  } finally {
    await probe.close();
  }
});

test("7: a missing replay file exits 2 without starting a browser", async ({}, info) => {
  const port = await freePort();
  const brave = braveStub(info);
  const result = await runReplay(
    [
      "--replay", info.outputPath("missing", "does-not-exist.rep"),
      "--out", outFile(info),
      "--module", THREE_CRC,
      "--archives", "none",
      "--port", String(port),
    ],
    { ...process.env, BRAVE_PATH: brave.executable },
  );

  expect(result.status, report(result)).toBe(2);
  expect(existsSync(brave.marker), `a browser was started; ${report(result)}`).toBe(false);
});

test("7: a missing --out argument exits 2 without starting a browser", async ({}, info) => {
  const port = await freePort();
  const brave = braveStub(info);
  const result = await runReplay(
    [
      "--replay", replayFile(info),
      "--module", THREE_CRC,
      "--archives", "none",
      "--port", String(port),
    ],
    { ...process.env, BRAVE_PATH: brave.executable },
  );

  expect(result.status, report(result)).toBe(2);
  expect(existsSync(brave.marker), `a browser was started; ${report(result)}`).toBe(false);
});

test("8: no server is left listening on the port after the command ends", async ({}, info) => {
  const port = await freePort();
  const result = await runReplay(replayArgs(info, port, THREE_CRC));

  expect(result.status, report(result)).toBe(0);
  expect(await waitForPortFree(port), `something still listens on 127.0.0.1:${port}; ${report(result)}`).toBe(
    true,
  );
});
