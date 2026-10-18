import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openAsBlob,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBig } from "./helpers/big";
import { crc32, inspectZip } from "./helpers/zip";
import { entryStream, openZip, type ZipEntry } from "../src/zip";

// Contract of scripts/make-game-zip.mjs (docs/briefs/131-make-game-zip.md).
//
// These are Node-side tests: the tool is spawned as a child process against
// synthetic source folders created in a temporary directory. No real game data
// is used and nothing is written inside the repository.

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(TESTS_DIR, "..");
const REPO_ROOT = resolve(WEB_ROOT, "..");
const SCRIPT = join(WEB_ROOT, "scripts", "make-game-zip.mjs");

const MIB = 1024 * 1024;

interface RunResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

const tempRoots: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "zhwp-make-game-zip-"));
  tempRoots.push(dir);
  return dir;
}

test.afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function report(result: RunResult): string {
  return `exit ${result.status} signal ${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function envWithoutGameDir(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.ZHWP_GAME_DIR;
  return env;
}

function start(
  args: string[],
  options: { env?: Record<string, string | undefined> } = {},
): { child: ReturnType<typeof spawn>; done: Promise<RunResult> } {
  const child = spawn(process.execPath, [SCRIPT, ...args], {
    cwd: WEB_ROOT,
    env: options.env ?? envWithoutGameDir(),
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const done = new Promise<RunResult>((resolveDone, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolveDone({ status, signal, stdout, stderr });
    });
  });
  return { child, done };
}

function run(
  args: string[],
  options: { env?: Record<string, string | undefined> } = {},
): Promise<RunResult> {
  return start(args, options).done;
}

function writeSource(dir: string, files: Record<string, Uint8Array | string>): string {
  for (const [relative, data] of Object.entries(files)) {
    const target = join(dir, ...relative.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return dir;
}

// A synthetic BIG archive; the tool never parses the contents, only the bytes.
function bigArchive(name: string): Uint8Array {
  return buildBig([{ path: `data/${name}`, data: `synthetic bytes of ${name}` }]);
}

function sample(length: number, seed = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 37 + seed) & 0xff;
  return out;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

interface OpenedZip {
  blob: Blob;
  entries: ZipEntry[];
}

async function readZip(path: string): Promise<OpenedZip> {
  const blob = new Blob([readFileSync(path)]);
  return { blob, entries: await openZip(blob) };
}

function entryAt(entries: ZipEntry[], path: string): ZipEntry {
  const entry = entries.find((candidate) => candidate.path === path);
  expect(entry, `entry ${path}`).toBeDefined();
  return entry as ZipEntry;
}

// Asserts the archive lists exactly the expected paths and that every entry is
// stored with the source bytes and CRC.
async function expectArchiveMatches(
  opened: OpenedZip,
  expected: Map<string, Uint8Array>,
  label: string,
): Promise<void> {
  const paths = opened.entries.map((entry) => entry.path).sort();
  expect(paths, `${label} paths`).toEqual([...expected.keys()].sort());
  for (const [path, data] of expected) {
    const entry = entryAt(opened.entries, path);
    expect(entry.method, `${label} ${path} method`).toBe(0);
    expect(entry.size, `${label} ${path} size`).toBe(data.length);
    expect(entry.crc32, `${label} ${path} crc`).toBe(crc32(data));
    const bytes = await collect(entryStream(opened.blob, entry));
    expect(Array.from(bytes), `${label} ${path} bytes`).toEqual(Array.from(data));
  }
}

function zipLeftovers(out: string): string[] {
  return readdirSync(out).filter((name) => name.endsWith(".zip") || name.endsWith(".partial"));
}

test("1: --split writes zero-hour.zip and generals.zip for nested installs, each readable with its REQUIRED archives", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const generals = new Map<string, Uint8Array>([
    ["INI.big", bigArchive("INI.big")],
    ["W3D.big", bigArchive("W3D.big")],
    ["generals-extra/readme.txt", new TextEncoder().encode("generals extra file\n")],
  ]);
  const zeroHour = new Map<string, Uint8Array>([
    ["Zero Hour/INIZH.big", bigArchive("INIZH.big")],
    ["Zero Hour/W3DZH.big", bigArchive("W3DZH.big")],
    ["Zero Hour/Data/zh-extra.bin", sample(1024, 3)],
  ]);
  writeSource(src, Object.fromEntries([...generals, ...zeroHour]));

  const result = await run(["--src", src, "--out", out, "--split"]);
  expect(result.status, report(result)).toBe(0);

  for (const [name, expected, required] of [
    ["zero-hour.zip", zeroHour, ["Zero Hour/INIZH.big", "Zero Hour/W3DZH.big"]],
    ["generals.zip", generals, ["INI.big", "W3D.big"]],
  ] as const) {
    const zipPath = join(out, name);
    expect(existsSync(zipPath), `${name} exists`).toBe(true);
    const opened = await readZip(zipPath);
    for (const requiredPath of required) {
      expect(
        opened.entries.some((entry) => entry.path === requiredPath),
        `${name} holds ${requiredPath}`,
      ).toBe(true);
    }
    await expectArchiveMatches(opened, expected, name);
  }
});

test("2: without --split game.zip holds every file at its relative / path with the source bytes and CRC", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const expected = new Map<string, Uint8Array>([
    ["root.txt", new TextEncoder().encode("top level\n")],
    ["sub/deep/nested.bin", sample(4099, 5)],
    ["sub/empty.bin", new Uint8Array(0)],
    ["café/日本語.txt", new TextEncoder().encode("non-ASCII path\n")],
    ["with space.txt", new TextEncoder().encode("a name with a space\n")],
    [".hidden", new TextEncoder().encode("a dotfile is a regular file too\n")],
  ]);
  writeSource(src, Object.fromEntries(expected));

  const result = await run(["--src", src, "--out", out]);
  expect(result.status, report(result)).toBe(0);
  expect(readdirSync(out), "one finished archive and no partial file").toEqual(["game.zip"]);

  const opened = await readZip(join(out, "game.zip"));
  await expectArchiveMatches(opened, expected, "game.zip");
});

test("3: --zip64 forces ZIP64 records and the output still opens and matches", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(out);

  const expected = new Map<string, Uint8Array>([
    ["small.bin", sample(300, 7)],
    ["nested/payload.txt", new TextEncoder().encode("zip64 forced payload ".repeat(50))],
  ]);
  writeSource(src, Object.fromEntries(expected));

  const result = await run(["--src", src, "--out", out, "--zip64"]);
  expect(result.status, report(result)).toBe(0);

  const zipPath = join(out, "game.zip");
  const bytes = readFileSync(zipPath);
  expect(inspectZip(bytes).zip64, "ZIP64 end-of-central-directory records").toBe(true);

  const opened = await readZip(zipPath);
  await expectArchiveMatches(opened, expected, "game.zip --zip64");
});

test("4: --out inside the repository exits 2 with the documented message and writes nothing", async () => {
  const root = scratch();
  const src = join(root, "game");
  writeSource(src, { "file.txt": "payload\n" });
  const out = join(
    REPO_ROOT,
    "web",
    "test-results",
    `make-game-zip-inside-${process.pid}-${Date.now()}`,
  );
  expect(existsSync(out), "the inside-repository target starts absent").toBe(false);

  const result = await run(["--src", src, "--out", out]);
  expect(result.status, report(result)).toBe(2);
  expect(`${result.stdout}\n${result.stderr}`).toContain(
    "refusing to write game data inside the repository",
  );
  expect(existsSync(out), "the refused output directory was not created").toBe(false);
  expect(existsSync(join(WEB_ROOT, "game.zip")), "no game.zip in the working directory").toBe(
    false,
  );
});

test("5: missing --src and $ZHWP_GAME_DIR exits 2, and a non-directory --src exits 2", async () => {
  const root = scratch();
  const out = join(root, "out");
  mkdirSync(out);

  const noSrc = await run(["--out", out], { env: envWithoutGameDir() });
  expect(noSrc.status, report(noSrc)).toBe(2);
  expect(`${noSrc.stdout}${noSrc.stderr}`.trim().length, "an error message").toBeGreaterThan(0);

  const notADirectory = join(root, "not-a-directory.txt");
  writeFileSync(notADirectory, "plain file\n");
  const fileSrc = await run(["--src", notADirectory, "--out", out]);
  expect(fileSrc.status, report(fileSrc)).toBe(2);

  const missingSrc = await run(["--src", join(root, "does-not-exist"), "--out", out]);
  expect(missingSrc.status, report(missingSrc)).toBe(2);
});

test("6: with --split, a group missing a REQUIRED archive exits 3, names it, and leaves no ZIP or .partial", async () => {
  const cases = [
    {
      label: "Zero Hour without INIZH.big",
      files: {
        "INI.big": bigArchive("INI.big"),
        "W3D.big": bigArchive("W3D.big"),
        "Zero Hour/W3DZH.big": bigArchive("W3DZH.big"),
      } as Record<string, Uint8Array | string>,
      missing: "INIZH.big",
    },
    {
      label: "generals without INI.big",
      files: {
        "W3D.big": bigArchive("W3D.big"),
        "Zero Hour/INIZH.big": bigArchive("INIZH.big"),
        "Zero Hour/W3DZH.big": bigArchive("W3DZH.big"),
      } as Record<string, Uint8Array | string>,
      missing: "INI.big",
    },
  ];

  for (const missingCase of cases) {
    const root = scratch();
    const src = join(root, "game");
    const out = join(root, "out");
    mkdirSync(out);
    writeSource(src, missingCase.files);

    const result = await run(["--src", src, "--out", out, "--split"]);
    expect(result.status, `${missingCase.label}: ${report(result)}`).toBe(3);
    expect(
      `${result.stdout}\n${result.stderr}`,
      `${missingCase.label} names ${missingCase.missing}`,
    ).toContain(missingCase.missing);
    expect(zipLeftovers(out), `${missingCase.label} leftovers`).toEqual([]);
  }
});

test("7: an interrupted run leaves no ZIP that opens, only .partial files or nothing", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  mkdirSync(src, { recursive: true });
  mkdirSync(out);
  const huge = join(src, "huge.bin");
  writeFileSync(huge, "");
  truncateSync(huge, 512 * MIB);

  const { child, done } = start(["--src", src, "--out", out]);
  let sawPartial = false;
  let finished: RunResult | undefined;
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      if (existsSync(out) && readdirSync(out).some((name) => name.endsWith(".partial"))) {
        sawPartial = true;
        break;
      }
      await delay(5);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    finished = await done;
  }

  expect(
    sawPartial,
    `the run never created a .partial file; it ended before it was interrupted: ${report(finished)}`,
  ).toBe(true);
  const leftovers = readdirSync(out);
  expect(
    leftovers.filter((name) => !name.endsWith(".partial")),
    `finished archives left after SIGKILL: ${report(finished)}`,
  ).toEqual([]);
});

test("8: symlinks are skipped with one warning line each while regular files are packed", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  const outside = join(root, "outside");
  mkdirSync(out);
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "target.bin"), sample(777, 9));
  mkdirSync(join(outside, "folder"), { recursive: true });
  writeFileSync(join(outside, "folder", "inner.txt"), "inside the linked folder\n");

  writeSource(src, {
    "regular.txt": "a regular file\n",
    "nested/regular.bin": sample(2048, 11),
  });
  symlinkSync(join(outside, "target.bin"), join(src, "link-to-target.bin"));
  symlinkSync(join(outside, "folder"), join(src, "link-to-folder"));

  const result = await run(["--src", src, "--out", out]);
  expect(result.status, report(result)).toBe(0);

  const opened = await readZip(join(out, "game.zip"));
  expect(
    opened.entries.map((entry) => entry.path).sort(),
    "only regular files are packed",
  ).toEqual(["nested/regular.bin", "regular.txt"]);

  const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/);
  const links = ["link-to-target.bin", "link-to-folder"];
  for (const link of links) {
    const warnings = lines.filter((line) => line.includes(link));
    expect(warnings, `one warning line for ${link}: ${report(result)}`).toHaveLength(1);
  }
  expect(
    lines.filter((line) => links.some((link) => line.includes(link))),
    `one separate warning line per symlink: ${report(result)}`,
  ).toHaveLength(2);
});

test("9: packing a 200 MB file keeps process RSS growth under 100 MB", async () => {
  const root = scratch();
  const src = join(root, "game");
  const out = join(root, "out");
  const size = 200 * MIB;
  mkdirSync(src, { recursive: true });
  mkdirSync(out);
  const huge = join(src, "huge.bin");
  writeFileSync(huge, "");
  truncateSync(huge, size);

  const { child, done } = start(["--src", src, "--out", out]);
  const samples: number[] = [];
  while (child.exitCode === null && child.signalCode === null) {
    const rss = rssOf(child.pid as number);
    if (rss !== null && rss > 0) samples.push(rss);
    await delay(5);
  }
  const result = await done;
  expect(result.status, report(result)).toBe(0);
  expect(samples.length, "RSS samples taken while the tool ran").toBeGreaterThan(5);

  const baseline = samples[0];
  const peak = Math.max(...samples);
  const growth = peak - baseline;
  expect(
    growth,
    `RSS grew ${(growth / MIB).toFixed(1)} MiB (${(baseline / MIB).toFixed(1)} -> ${(peak / MIB).toFixed(1)} MiB)`,
  ).toBeLessThan(100 * MIB);

  const blob = await openAsBlob(join(out, "game.zip"));
  const entries = await openZip(blob);
  expect(entries.map((entry) => entry.path)).toEqual(["huge.bin"]);
  expect(entries[0].size).toBe(size);
});

// Resident set size of a live process in bytes, or null when it is gone.
function rssOf(pid: number): number | null {
  try {
    const output = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    if (output === "") return null;
    const kilobytes = Number(output.split(/\s+/)[0]);
    return Number.isFinite(kilobytes) ? kilobytes * 1024 : null;
  } catch {
    return null;
  }
}
