import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleUrl = new URL("../compare-crc.mjs", import.meta.url);
const modulePath = fileURLToPath(moduleUrl);

async function loadModule() {
  return import(moduleUrl.href);
}

function makeTempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "zhwp-crc-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeLogs(t, files) {
  const dir = makeTempDir(t);
  const paths = {};
  for (const [name, text] of Object.entries(files)) {
    paths[name] = join(dir, name);
    writeFileSync(paths[name], text);
  }
  return { dir, paths };
}

function runCli(...args) {
  return spawnSync(process.execPath, [modulePath, ...args], {
    encoding: "utf8",
  });
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function assertStdout(result, expected) {
  assert.equal(
    (result.stdout ?? "").trim(),
    expected,
    `stdout: ${JSON.stringify(result.stdout)}; stderr: ${JSON.stringify(result.stderr)}`,
  );
}

function assertSingleErrorLine(result, expectedExit = 2) {
  assert.equal(
    result.status,
    expectedExit,
    `exit ${result.status}; output: ${JSON.stringify(combinedOutput(result))}`,
  );
  const lines = combinedOutput(result)
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  assert.equal(
    lines.length,
    1,
    `expected one ERROR line, got: ${JSON.stringify(combinedOutput(result))}`,
  );
  assert.match(
    lines[0],
    /^ERROR/,
    `expected the line to start with ERROR, got: ${JSON.stringify(lines[0])}`,
  );
  return lines[0];
}

test("1: two identical logs report MATCH <n> frames and exit 0", (t) => {
  const text = [
    "ZHWP_CRC 0 00000000",
    "ZHWP_CRC 7 abcdef01",
    "ZHWP_CRC 8 ABCDEF02",
  ].join("\n");
  const { paths } = writeLogs(t, { "a.log": text, "b.log": text });

  const result = runCli(paths["a.log"], paths["b.log"]);

  assert.equal(
    result.status,
    0,
    `exit ${result.status}; output: ${JSON.stringify(combinedOutput(result))}`,
  );
  assertStdout(result, "MATCH 3 frames");
});

test("1: parseCrcLog reads a well-formed log", async () => {
  const { parseCrcLog } = await loadModule();

  const parsed = parseCrcLog(
    "ZHWP_CRC 0 00000000\r\nZHWP_CRC 12 abcdef01\r\n",
  );

  assert.deepEqual(parsed, [
    { frame: 0, crc: "00000000" },
    { frame: 12, crc: "abcdef01" },
  ]);
});

test("1: compareCrcLogs reports a match and the number of entries", async () => {
  const { parseCrcLog, compareCrcLogs } = await loadModule();
  const a = parseCrcLog("ZHWP_CRC 0 00000000\nZHWP_CRC 3 abcdef01\n");
  const b = parseCrcLog("ZHWP_CRC 0 00000000\nZHWP_CRC 3 abcdef01\n");

  const result = compareCrcLogs(a, b);

  assert.equal(result.match, true);
  assert.equal(result.frames, 2);
});

test("2: parseCrcLog ignores lines that do not start with ZHWP_CRC", async () => {
  const { parseCrcLog } = await loadModule();
  const text = [
    "Engine: loading game data",
    "ZHWP_CRC 0 00000000",
    "frame 5 rendered",
    "ZHWP_CRCX 1 deadbeef",
    " ZHWP_CRC 2 00000001",
    "zhwp_crc 3 00000002",
    "",
    "done",
  ].join("\n");

  const parsed = parseCrcLog(text);

  assert.deepEqual(parsed, [{ frame: 0, crc: "00000000" }]);
});

test("2: the CLI ignores non-CRC lines on both sides", (t) => {
  const aText = [
    "engine boot",
    "ZHWP_CRC 0 00000000",
    "loading archive",
    "ZHWP_CRC 5 abcdef01",
    "shutdown",
  ].join("\n");
  const bText = [
    "other engine output",
    "ZHWP_CRC 0 00000000",
    "ZHWP_CRCX 5 deadbeef",
    "ZHWP_CRC 5 abcdef01",
  ].join("\n");
  const { paths } = writeLogs(t, { "a.log": aText, "b.log": bText });

  const result = runCli(paths["a.log"], paths["b.log"]);

  assert.equal(
    result.status,
    0,
    `exit ${result.status}; output: ${JSON.stringify(combinedOutput(result))}`,
  );
  assertStdout(result, "MATCH 2 frames");
});

test("3: parseCrcLog lower-cases CRCs", async () => {
  const { parseCrcLog } = await loadModule();

  const parsed = parseCrcLog("ZHWP_CRC 9 AbCdEf01\n");

  assert.deepEqual(parsed, [{ frame: 9, crc: "abcdef01" }]);
});

test("3: CRCs that differ only in letter case match", (t) => {
  const aText = "ZHWP_CRC 0 ABCDEF01\nZHWP_CRC 9 0000000A\n";
  const bText = "ZHWP_CRC 0 abcdef01\nZHWP_CRC 9 0000000a\n";
  const { paths } = writeLogs(t, { "a.log": aText, "b.log": bText });

  const result = runCli(paths["a.log"], paths["b.log"]);

  assert.equal(
    result.status,
    0,
    `exit ${result.status}; output: ${JSON.stringify(combinedOutput(result))}`,
  );
  assertStdout(result, "MATCH 2 frames");
});

test("4: the first differing frame is reported even when later frames differ", (t) => {
  const aText = [
    "ZHWP_CRC 0 00000000",
    "ZHWP_CRC 10 aaaaaaaa",
    "ZHWP_CRC 20 bbbbbbbb",
  ].join("\n");
  const bText = [
    "ZHWP_CRC 0 00000000",
    "ZHWP_CRC 10 aaaaabbb",
    "ZHWP_CRC 20 cccccccc",
  ].join("\n");
  const { paths } = writeLogs(t, { "a.log": aText, "b.log": bText });

  const result = runCli(paths["a.log"], paths["b.log"]);

  assert.equal(
    result.status,
    1,
    `exit ${result.status}; output: ${JSON.stringify(combinedOutput(result))}`,
  );
  assertStdout(result, "DIVERGED frame 10 a=aaaaaaaa b=aaaaabbb");
});

test("4: compareCrcLogs returns the first differing frame", async () => {
  const { parseCrcLog, compareCrcLogs } = await loadModule();
  const a = parseCrcLog("ZHWP_CRC 0 00000000\nZHWP_CRC 10 aaaaaaaa\n");
  const b = parseCrcLog("ZHWP_CRC 0 00000000\nZHWP_CRC 10 aaaaabbb\n");

  const result = compareCrcLogs(a, b);

  assert.equal(result.match, false);
  assert.equal(result.frame, 10);
  assert.equal(result.a, "aaaaaaaa");
  assert.equal(result.b, "aaaaabbb");
});

test("5: a log that stops early reports missing for its side", (t) => {
  const aText = "ZHWP_CRC 0 00000000\nZHWP_CRC 1 abcdef01\n";
  const bText =
    "ZHWP_CRC 0 00000000\nZHWP_CRC 1 abcdef01\nZHWP_CRC 2 00000002\n";
  const { paths } = writeLogs(t, { "a.log": aText, "b.log": bText });

  const result = runCli(paths["a.log"], paths["b.log"]);

  assert.equal(
    result.status,
    1,
    `exit ${result.status}; output: ${JSON.stringify(combinedOutput(result))}`,
  );
  assertStdout(result, "DIVERGED frame 2 a=missing b=00000002");
});

test("5: the other log stopping early reports missing for its side", (t) => {
  const aText =
    "ZHWP_CRC 0 00000000\nZHWP_CRC 1 abcdef01\nZHWP_CRC 2 00000002\n";
  const bText = "ZHWP_CRC 0 00000000\nZHWP_CRC 1 abcdef01\n";
  const { paths } = writeLogs(t, { "a.log": aText, "b.log": bText });

  const result = runCli(paths["a.log"], paths["b.log"]);

  assert.equal(
    result.status,
    1,
    `exit ${result.status}; output: ${JSON.stringify(combinedOutput(result))}`,
  );
  assertStdout(result, "DIVERGED frame 2 a=00000002 b=missing");
});

test("5: compareCrcLogs uses the union of frames and marks missing values", async () => {
  const { parseCrcLog, compareCrcLogs } = await loadModule();
  const a = parseCrcLog("ZHWP_CRC 0 00000000\nZHWP_CRC 2 00000002\n");
  const b = parseCrcLog("ZHWP_CRC 1 00000001\nZHWP_CRC 2 00000002\n");

  const result = compareCrcLogs(a, b);

  assert.equal(result.match, false);
  assert.equal(result.frame, 0);
  assert.equal(result.a, "00000000");
  assert.equal(result.b, "missing");
});

test("6: parseCrcLog rejects malformed ZHWP_CRC lines", async () => {
  const { parseCrcLog } = await loadModule();
  const malformed = [
    "ZHWP_CRC ",
    "ZHWP_CRC 1",
    "ZHWP_CRC 1 0000000",
    "ZHWP_CRC 1 000000000",
    "ZHWP_CRC 1 0000000g",
    "ZHWP_CRC -1 00000000",
    "ZHWP_CRC 1.5 00000000",
    "ZHWP_CRC 1  00000000",
    "ZHWP_CRC  1 00000000",
    "ZHWP_CRC 1 00000000 ",
    "ZHWP_CRC 1\t00000000",
    "ZHWP_CRC 1 00000000 extra",
  ];

  for (const line of malformed) {
    assert.throws(
      () => parseCrcLog(`${line}\n`),
      Error,
      `expected a malformed line to throw: ${JSON.stringify(line)}`,
    );
  }
});

test("6: parseCrcLog errors name the log and the 1-based line", async () => {
  const { parseCrcLog } = await loadModule();

  assert.throws(
    () => parseCrcLog("ZHWP_CRC 0 00000000\nZHWP_CRC 1 123\n", "native.log"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /native\.log/);
      assert.match(error.message, /\b2\b/);
      return true;
    },
  );

  assert.throws(
    () => parseCrcLog("ZHWP_CRC 0 zzzzzzzz\n"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /log/);
      assert.match(error.message, /\b1\b/);
      return true;
    },
  );
});

test("6: a malformed ZHWP_CRC line exits 2 naming the file and line", (t) => {
  const text = [
    "engine output",
    "ZHWP_CRC 0 00000000",
    "ZHWP_CRC 1 123",
  ].join("\n");
  const { dir, paths } = writeLogs(t, { "bad.log": text });

  const result = runCli(paths["bad.log"], paths["bad.log"]);

  const message = assertSingleErrorLine(result);
  assert.match(message, /bad\.log/);
  const withoutPathAndName = message
    .replaceAll(dir, "")
    .replaceAll("bad.log", "");
  assert.match(
    withoutPathAndName,
    /\b3\b/,
    `expected line 3 in: ${JSON.stringify(message)}`,
  );
});

test("7: repeated frames exit 2", (t) => {
  const text = ["ZHWP_CRC 5 00000000", "ZHWP_CRC 5 00000001"].join("\n");
  const { paths } = writeLogs(t, { "a.log": text });

  const result = runCli(paths["a.log"], paths["a.log"]);

  assertSingleErrorLine(result);
});

test("7: decreasing frames exit 2", (t) => {
  const text = ["ZHWP_CRC 6 00000000", "ZHWP_CRC 5 00000001"].join("\n");
  const { paths } = writeLogs(t, { "a.log": text });

  const result = runCli(paths["a.log"], paths["a.log"]);

  assertSingleErrorLine(result);
});

test("8: a file without a CRC line exits 2", (t) => {
  const { paths } = writeLogs(t, {
    "a.log": "engine output only\n",
    "b.log": "ZHWP_CRC 0 00000000\n",
  });

  const result = runCli(paths["a.log"], paths["b.log"]);

  assertSingleErrorLine(result);
});

test("8: a missing file exits 2", (t) => {
  const dir = makeTempDir(t);
  const { paths } = writeLogs(t, { "b.log": "ZHWP_CRC 0 00000000\n" });

  const result = runCli(join(dir, "missing.log"), paths["b.log"]);

  assertSingleErrorLine(result);
});

test("8: a wrong number of arguments exits 2", (t) => {
  const { paths } = writeLogs(t, {
    "a.log": "ZHWP_CRC 0 00000000\n",
    "b.log": "ZHWP_CRC 0 00000000\n",
    "c.log": "ZHWP_CRC 0 00000000\n",
  });

  for (const args of [[], [paths["a.log"]], [paths["a.log"], paths["b.log"], paths["c.log"]]]) {
    assertSingleErrorLine(runCli(...args));
  }
});

test("9: importing the module prints nothing and exits 0", () => {
  const code = `await import(${JSON.stringify(moduleUrl.href)});`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    { encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    `exit ${result.status}; stdout: ${JSON.stringify(result.stdout)}; stderr: ${JSON.stringify(result.stderr)}`,
  );
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("9: importing the module exposes parseCrcLog and compareCrcLogs", async () => {
  const module = await loadModule();

  assert.equal(typeof module.parseCrcLog, "function");
  assert.equal(typeof module.compareCrcLogs, "function");
});
