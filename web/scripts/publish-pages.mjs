// Publishes the static package to GitHub Pages (the gh-pages branch).
//
// Usage (from web/, with the engine build in place):
//   node scripts/publish-pages.mjs [--engine <dir>] [--domain <host>] [--no-push]
//
// Builds the package (scripts/package.mjs), then adds what GitHub Pages needs:
// the launcher at the site root, a service worker (scripts/lib/pages-sw.mjs) that sets the cross-origin
// isolation headers Pages cannot set itself and keeps the site for use without internet, its registration in
// the launcher, CNAME and .nojekyll. It force-pushes the result as a single
// commit to gh-pages of the `origin` remote. --no-push stops before the push
// and prints the folder. It copies no game data: package.mjs runs the guard.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { offlineFiles, serviceWorker } from "./lib/pages-sw.mjs";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GUARD = fileURLToPath(new URL("../../scripts/check-no-ea-assets.sh", import.meta.url));
const DEFAULT_DOMAIN = "openzh.pikilon.com";


const REGISTRATION = `    <script>
      if (!window.crossOriginIsolated && "serviceWorker" in navigator) {
        navigator.serviceWorker.register("/coi-sw.js").then((registration) => {
          if (registration.active && !navigator.serviceWorker.controller) location.reload();
          else navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
        });
      }
    </script>
`;

const MODULE_TAG = '    <script type="module" src="/dist/main.js"></script>';

function fail(message) {
  console.error(`publish-pages: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed`);
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error || result.status !== 0) fail(`${command} ${args.join(" ")} failed`);
  return result.stdout.trim();
}

const { values } = parseArgs({
  options: {
    engine: { type: "string" },
    domain: { type: "string", default: DEFAULT_DOMAIN },
    "no-push": { type: "boolean", default: false },
  },
});

const out = mkdtempSync(join(tmpdir(), "openzh-pages-"));
const packageArgs = ["scripts/package.mjs", "--out", out];
if (values.engine) packageArgs.push("--engine", values.engine);

run("npm", ["run", "build"], { cwd: WEB_ROOT });
run("node", packageArgs, { cwd: WEB_ROOT });

// The launcher is the site root: replace package.mjs's redirect page with it.
const launcher = join(out, "index.html");
for (const name of readdirSync(join(out, "app"))) {
  renameSync(join(out, "app", name), join(out, name));
}
rmSync(join(out, "app"), { recursive: true });
const html = readFileSync(launcher, "utf8");
if (!html.includes(MODULE_TAG)) fail(`launcher has no "${MODULE_TAG.trim()}" to register before`);
writeFileSync(launcher, html.replace(MODULE_TAG, REGISTRATION + MODULE_TAG));
const files = (function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : ["/" + relative(out, path).split(sep).join("/")];
  });
})(out);
const version = capture("git", ["rev-parse", "--short=9", "HEAD"], { cwd: WEB_ROOT });
writeFileSync(join(out, "coi-sw.js"), serviceWorker(version, offlineFiles(files)));
writeFileSync(join(out, "CNAME"), `${values.domain}\n`);
writeFileSync(join(out, ".nojekyll"), "");

// _headers is for hosts that read it; Pages ignores it and the worker replaces it.
run("bash", [GUARD, out]);

if (values["no-push"]) {
  console.log(`publish-pages: package ready in ${out} (not pushed)`);
  process.exit(0);
}

const remote = capture("git", ["remote", "get-url", "origin"], { cwd: WEB_ROOT });
run("git", ["init", "-q", "-b", "gh-pages"], { cwd: out });
run("git", ["add", "-A"], { cwd: out });
run(
  "git",
  ["-c", "user.name=openzh-pages", "-c", "user.email=noreply@openzh.pikilon.com", "commit", "-qm", "Publish web build"],
  { cwd: out },
);
run("git", ["push", "-f", remote, "gh-pages:gh-pages"], { cwd: out });
console.log(`publish-pages: published to https://${values.domain}/`);
