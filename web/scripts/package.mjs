// Static site packager for a plain host (docs/briefs/32-static-package.md).
//
// Usage (from web/, after `npm run build`):
//   node scripts/package.mjs [--engine <dir>] [--out <dir>]
//
// Produces one folder with the launcher, the bundled wrapper, the engine
// build and the headers file static hosts read (cross-origin isolation for
// threads and SharedArrayBuffer). It copies no game data: the guard script
// rejects any forbidden file type afterwards.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GUARD = fileURLToPath(new URL("../../scripts/check-no-ea-assets.sh", import.meta.url));
const ENGINE_PREFIX = "GeneralsXZH.";
const ENGINE_REQUIRED = ["GeneralsXZH.js", "GeneralsXZH.wasm"];

const HEADERS = `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
`;

const REDIRECT = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=app/index.html">
    <title>Web port launcher</title>
  </head>
  <body>
    <p>Continue to the <a href="app/index.html">launcher</a>.</p>
  </body>
</html>
`;

function usage(message) {
  console.error(message);
  console.error("usage: node scripts/package.mjs [--engine <dir>] [--out <dir>]");
  process.exit(2);
}

function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      engine: { type: "string" },
      out: { type: "string" },
    },
    allowPositionals: true,
  });
  if (positionals.length > 0) usage(`unexpected argument: ${positionals[0]}`);
  return {
    engine: resolve(values.engine ?? join(WEB_ROOT, "..", "build", "webgpu", "GeneralsMD")),
    out: resolve(values.out ?? join(WEB_ROOT, "out")),
  };
}

function fail(message) {
  console.error(`package: ${message}`);
  process.exit(1);
}

// Lists every regular file under dir, relative to it.
function listFiles(dir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path, rel));
    else if (entry.isFile()) files.push({ path, size: statSync(path).size });
  }
  return files;
}

function requireDirectory(dir, label) {
  let stat;
  try {
    stat = statSync(dir);
  } catch {
    fail(`${label} directory does not exist: ${dir}`);
  }
  if (!stat.isDirectory()) fail(`${label} path is not a directory: ${dir}`);
}

function copyDirectory(source, target, filter) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!filter(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to, () => true);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

const { engine, out } = parseOptions(process.argv.slice(2));

// Start clean so a second run never leaves a file the first one copied.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

requireDirectory(engine, "engine");
for (const name of ENGINE_REQUIRED) {
  let stat;
  try {
    stat = statSync(join(engine, name));
  } catch {
    fail(`engine build is missing ${name} in ${engine}`);
  }
  if (!stat.isFile()) fail(`engine build has no ${name} file in ${engine}`);
}

const dist = join(WEB_ROOT, "dist");
const appDir = join(WEB_ROOT, "app");
const appIndex = join(appDir, "index.html");
const appIcon = join(appDir, "favicon.png");
requireDirectory(dist, "dist");
requireDirectory(appDir, "app");
statSync(appIndex).isFile() || fail(`launcher page is not a file: ${appIndex}`);
statSync(appIcon).isFile() || fail(`launcher icon is not a file: ${appIcon}`);

// The whole app folder goes out: the page links its local stylesheet next to
// the favicon, so a new asset there must not be forgotten by the packager.
copyDirectory(appDir, join(out, "app"), () => true);
copyDirectory(dist, join(out, "dist"), () => true);

mkdirSync(join(out, "engine"), { recursive: true });
for (const entry of readdirSync(engine, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.startsWith(ENGINE_PREFIX)) continue;
  copyFileSync(join(engine, entry.name), join(out, "engine", entry.name));
}

// The top bar shows which build this is: date and commit, "+" when built
// with uncommitted changes.
const BUILD_INFO = '<span id="build-info" title="Development build">dev</span>';
const git = (...args) => spawnSync("git", args, { cwd: WEB_ROOT, encoding: "utf8" }).stdout?.trim() ?? "";
const commit = git("rev-parse", "HEAD");
if (commit) {
  const dirty = git("status", "--porcelain", "--untracked-files=no") !== "" ? "+" : "";
  const label = `${git("show", "-s", "--format=%cs", "HEAD")} · ${commit.slice(0, 9)}${dirty}`;
  const outIndex = join(out, "app", "index.html");
  const page = readFileSync(outIndex, "utf8");
  if (!page.includes(BUILD_INFO)) fail(`launcher has no ${BUILD_INFO} to fill`);
  writeFileSync(outIndex, page.replace(BUILD_INFO, `<span id="build-info" title="Build ${commit}${dirty ? " with uncommitted changes" : ""}">${label}</span>`));
}

writeFileSync(join(out, "index.html"), REDIRECT);
writeFileSync(join(out, "_headers"), HEADERS);

// No EA game data may enter a package (AGENTS.md, Legal Limits).
const guard = spawnSync("bash", [GUARD, out], { encoding: "utf8" });
if (guard.stdout) process.stdout.write(guard.stdout);
if (guard.stderr) process.stderr.write(guard.stderr);
if (guard.error) fail(`could not run the no-EA-assets guard: ${guard.error.message}`);
if (guard.status !== 0) process.exit(1);

const files = listFiles(out);
const bytes = files.reduce((total, file) => total + file.size, 0);
console.log(`package: ${out} (${files.length} files, ${bytes} bytes)`);
