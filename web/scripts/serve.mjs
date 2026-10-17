// Static development server for the browser engine build (docs/briefs/4-smoke-harness.md).
//
// Usage (from web/): node scripts/serve.mjs --port <n> --mount <urlPrefix>=<dir> [--mount ...]
//   [--gamedata <dir>]
// Serves only files under each mount, with the cross-origin isolation headers
// every response needs so the engine can use threads and SharedArrayBuffer.
// With --gamedata it also lists and serves the player's local game archives
// (docs/briefs/72-local-gamedata.md), read-only and on 127.0.0.1 only.
import { createServer } from "node:http";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".json", "application/json"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
]);

const GAMEDATA_INDEX = "/gamedata/index.json";
const GAMEDATA_FILES = "/gamedata/files/";

function usage(message) {
  console.error(message);
  console.error("usage: node scripts/serve.mjs --port <n> --mount <urlPrefix>=<dir> [--mount ...] [--gamedata <dir>]");
  process.exit(2);
}

// Lists every regular .big file under `root` at any depth: relative,
// `/`-separated paths sorted by path, with the bytes on disk at start.
function listArchives(root) {
  const archives = [];
  const walk = (dir, segments) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, [...segments, entry.name]);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".big")) {
        archives.push({
          path: [...segments, entry.name].join("/"),
          size: statSync(absolute).size,
          file: absolute,
        });
      }
    }
  };
  walk(root, []);
  archives.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return archives;
}

function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      mount: { type: "string", multiple: true },
      gamedata: { type: "string" },
    },
    allowPositionals: true,
  });
  if (positionals.length > 0) usage(`unexpected argument: ${positionals[0]}`);
  const port = Number(values.port);
  if (!values.port || !Number.isInteger(port) || port < 1 || port > 65535) {
    usage("--port <n> is required and must be an integer between 1 and 65535");
  }
  const mounts = new Map();
  for (const spec of values.mount ?? []) {
    const equals = spec.indexOf("=");
    const prefix = spec.slice(0, equals);
    const dir = spec.slice(equals + 1);
    if (equals < 1 || dir === "") usage(`bad --mount, expected <urlPrefix>=<dir>: ${spec}`);
    if (!prefix.startsWith("/")) usage(`mount prefix must start with "/": ${spec}`);
    if (prefix.includes("?") || prefix.includes("#")) usage(`bad mount prefix: ${spec}`);
    const urlPrefix = prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    const root = resolve(dir);
    let stat;
    try {
      stat = statSync(root);
    } catch {
      usage(`mount directory does not exist: ${dir}`);
    }
    if (!stat.isDirectory()) usage(`mount path is not a directory: ${dir}`);
    if (mounts.has(urlPrefix)) usage(`duplicate mount prefix: ${urlPrefix}`);
    mounts.set(urlPrefix, root);
  }
  if (mounts.size === 0) usage("at least one --mount <urlPrefix>=<dir> is required");
  let gamedata = null;
  if (values.gamedata !== undefined && values.gamedata !== "") {
    const root = resolve(values.gamedata);
    let stat;
    try {
      stat = statSync(root);
    } catch {
      usage(`--gamedata path does not exist: ${values.gamedata}`);
    }
    if (!stat.isDirectory()) usage(`--gamedata path is not a directory: ${values.gamedata}`);
    const archives = listArchives(root);
    const files = new Map(archives.map((archive) => [archive.path, archive.file]));
    gamedata = { archives, files };
  }
  return { port, mounts, gamedata };
}

// Resolves a decoded request path to a file inside one of the mounts, or null.
function resolveFile(pathname, mounts) {
  for (const [urlPrefix, root] of mounts) {
    let rest = "";
    if (urlPrefix === "/") rest = pathname;
    else if (pathname === urlPrefix) rest = "";
    else if (pathname.startsWith(`${urlPrefix}/`)) rest = pathname.slice(urlPrefix.length);
    else continue;
    const segments = rest.split("/").filter((part) => part !== "");
    // A decoded "..", a decoded "/" or any empty segment means the path left the
    // mount or is not a plain file path: refuse instead of guessing.
    if (segments.some((part) => part === ".." || part === "." || part.includes(sep) || part.includes("/"))) {
      return null;
    }
    const file = resolve(root, ...segments);
    if (file !== root && !file.startsWith(root + sep)) return null;
    return file;
  }
  return null;
}

function contentType(file) {
  const dot = file.lastIndexOf(".");
  return TYPES.get(dot < 0 ? "" : file.slice(dot).toLowerCase()) ?? "application/octet-stream";
}

function setHeaders(response) {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-store");
}

function notFound(response) {
  setHeaders(response);
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", "0");
  response.statusCode = 404;
  response.end();
}

function sendFile(request, response, file, type) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    notFound(response);
    return;
  }
  if (!stat.isFile()) {
    notFound(response);
    return;
  }
  setHeaders(response);
  response.setHeader("Content-Type", type);
  response.setHeader("Content-Length", String(stat.size));
  response.statusCode = 200;
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

const { port, mounts, gamedata } = parseOptions(process.argv.slice(2));

const server = createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  } catch {
    notFound(response);
    return;
  }
  if (gamedata !== null) {
    if (pathname === GAMEDATA_INDEX) {
      const body = JSON.stringify({
        files: gamedata.archives.map((archive) => ({ path: archive.path, size: archive.size })),
      });
      setHeaders(response);
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Content-Length", String(Buffer.byteLength(body)));
      response.statusCode = 200;
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      response.end(body);
      return;
    }
    if (pathname.startsWith(GAMEDATA_FILES)) {
      // Only the exact paths listed at start are served: encoded traversal
      // decodes to a path outside that set and gets a 404 like any other miss.
      const file = gamedata.files.get(pathname.slice(GAMEDATA_FILES.length));
      if (file === undefined) {
        notFound(response);
        return;
      }
      sendFile(request, response, file, "application/octet-stream");
      return;
    }
    if (pathname === "/gamedata" || pathname.startsWith("/gamedata/")) {
      notFound(response);
      return;
    }
  }
  const file = resolveFile(pathname, mounts);
  if (file === null) {
    notFound(response);
    return;
  }
  sendFile(request, response, file, contentType(file));
});

if (gamedata !== null) {
  console.log(`game data: ${gamedata.archives.length} archives`);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`listening on http://127.0.0.1:${port}`);
});
