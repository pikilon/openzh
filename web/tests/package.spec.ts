import { test, expect, type TestInfo } from "@playwright/test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Contract of scripts/package.mjs (docs/briefs/32-static-package.md).
//
// These are Node-side tests: the packager is run as a child process against
// synthetic engine folders created under this test's output folder. No game
// data is used.

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_SCRIPT = join(WEB_ROOT, "scripts", "package.mjs");

const FAKE_ENGINE: Record<string, string> = {
  "GeneralsXZH.js": "// synthetic engine module\nexport default async () => ({});\n",
  "GeneralsXZH.wasm": "\0asm",
};

function writeEngine(dir: string, files: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}

function fakeEngine(info: TestInfo, extra: Record<string, string> = {}): string {
  return writeEngine(info.outputPath("engine"), { ...FAKE_ENGINE, ...extra });
}

function outputDir(info: TestInfo): string {
  const out = info.outputPath("out");
  mkdirSync(out, { recursive: true });
  return out;
}

function runPackage(engine: string, out: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [PACKAGE_SCRIPT, "--engine", engine, "--out", out], {
    cwd: WEB_ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function report(result: SpawnSyncReturns<string>): string {
  return `exit ${result.status}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`;
}

function lastStdoutLine(result: SpawnSyncReturns<string>): string {
  const lines = (result.stdout ?? "").split(/\r?\n/).filter((line) => line.length > 0);
  return lines.at(-1) ?? "";
}

function nonEmptyLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines;
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

test("1: a fake engine folder produces the package tree and exits 0", ({}, info) => {
  const engine = fakeEngine(info, { "README.txt": "not an engine file\n" });
  const out = outputDir(info);

  const result = runPackage(engine, out);
  expect(result.status, report(result)).toBe(0);

  for (const rel of [
    "app/index.html",
    "dist/main.js",
    "engine/GeneralsXZH.js",
    "engine/GeneralsXZH.wasm",
    "index.html",
    "_headers",
  ]) {
    expect(existsSync(join(out, rel)), rel).toBe(true);
  }

  // Only files whose name starts with GeneralsXZH. come from the engine folder.
  expect(readdirSync(join(out, "engine")).sort()).toEqual(["GeneralsXZH.js", "GeneralsXZH.wasm"]);

  // app/ and dist/ are copies of the repository's files.
  expect(readFileSync(join(out, "app", "index.html"))).toEqual(
    readFileSync(join(WEB_ROOT, "app", "index.html")),
  );
  expect(readFileSync(join(out, "dist", "main.js"))).toEqual(
    readFileSync(join(WEB_ROOT, "dist", "main.js")),
  );

  const redirect = readFileSync(join(out, "index.html"), "utf8");
  expect(redirect).toMatch(/http-equiv=["']refresh["']/i);
  expect(redirect).toContain('content="0; url=app/index.html"');
});

test("2: _headers contains exactly the four contract lines", ({}, info) => {
  const engine = fakeEngine(info);
  const out = outputDir(info);

  const result = runPackage(engine, out);
  expect(result.status, report(result)).toBe(0);

  expect(nonEmptyLines(readFileSync(join(out, "_headers"), "utf8"))).toEqual([
    "/*",
    "  Cross-Origin-Opener-Policy: same-origin",
    "  Cross-Origin-Embedder-Policy: require-corp",
    "  Cross-Origin-Resource-Policy: same-origin",
  ]);
});

test("3: the out folder has no top-level entries beyond app, dist, engine, index.html and _headers", ({}, info) => {
  const engine = fakeEngine(info);
  const out = outputDir(info);

  const result = runPackage(engine, out);
  expect(result.status, report(result)).toBe(0);

  expect(readdirSync(out).sort()).toEqual(["_headers", "app", "dist", "engine", "index.html"]);
});

test("4: an engine folder without GeneralsXZH.wasm exits 1 with a message", ({}, info) => {
  const engine = fakeEngine(info);
  const out = outputDir(info);

  const ok = runPackage(engine, out);
  expect(ok.status, report(ok)).toBe(0);

  rmSync(join(engine, "GeneralsXZH.wasm"));
  const result = runPackage(engine, out);
  expect(result.status, report(result)).toBe(1);
  expect(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim()).not.toBe("");
});

test("4: an engine folder without GeneralsXZH.js exits 1 with a message", ({}, info) => {
  const engine = fakeEngine(info);
  const out = outputDir(info);

  const ok = runPackage(engine, out);
  expect(ok.status, report(ok)).toBe(0);

  rmSync(join(engine, "GeneralsXZH.js"));
  const result = runPackage(engine, out);
  expect(result.status, report(result)).toBe(1);
  expect(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim()).not.toBe("");
});

test("5: a GeneralsXZH.data file in the engine folder makes the guard fail with exit 1", ({}, info) => {
  const engine = fakeEngine(info, { "GeneralsXZH.data": "synthetic data\n" });
  const out = outputDir(info);

  const result = runPackage(engine, out);
  expect(result.status, report(result)).toBe(1);

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  expect(output).toContain("no-ea-assets: FAIL");
  expect(output).toContain("GeneralsXZH.data");
});

test("6: a second run removes engine files the first run copied", ({}, info) => {
  const engine = fakeEngine(info, { "GeneralsXZH.first.js": "// first run only\n" });
  const out = outputDir(info);

  const first = runPackage(engine, out);
  expect(first.status, report(first)).toBe(0);
  expect(existsSync(join(out, "engine", "GeneralsXZH.first.js"))).toBe(true);

  rmSync(join(engine, "GeneralsXZH.first.js"));
  const second = runPackage(engine, out);
  expect(second.status, report(second)).toBe(0);
  expect(existsSync(join(out, "engine", "GeneralsXZH.first.js"))).toBe(false);
  expect(readdirSync(join(out, "engine")).sort()).toEqual(["GeneralsXZH.js", "GeneralsXZH.wasm"]);
});

test("7: the last output line reports the out folder, file count and byte total", ({}, info) => {
  const engine = fakeEngine(info);
  const out = outputDir(info);

  const result = runPackage(engine, out);
  expect(result.status, report(result)).toBe(0);

  const line = lastStdoutLine(result);
  const match = /^package: (.+) \((\d+) files, (\d+) bytes\)$/.exec(line);
  expect(match, `last stdout line: ${JSON.stringify(line)}`).not.toBeNull();
  expect(match![1]).toBe(out);

  const files = listFiles(out);
  const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
  expect(Number(match![2]), line).toBe(files.length);
  expect(Number(match![3]), line).toBe(bytes);
});
