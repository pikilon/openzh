# 4: Static dev server and smoke page for the WASM build

Part of issue #4. The tests already exist and fail; implement the two pieces
they exercise. Plain JavaScript (ES modules, Node 22+), no new dependencies.

## Read first
* `web/AGENTS.md`
* `web/tests/serve.spec.ts`, `web/tests/smoke.spec.ts`, `web/playwright.config.ts`

## Contract

### `web/scripts/serve.mjs`
`node scripts/serve.mjs --port <n> --mount <urlPrefix>=<dir> [--mount ...]`
(run from `web/`; `<dir>` is relative to the current directory).
* Binds `127.0.0.1:<port>`; serves files under each mount with `node:http`.
* Every response, including 404s, has `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Embedder-Policy: require-corp`,
  `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store`.
* Content types: `.html` `text/html; charset=utf-8`, `.js`/`.mjs`
  `text/javascript; charset=utf-8`, `.wasm` `application/wasm`, `.json`
  `application/json`, `.css` `text/css; charset=utf-8`, anything else
  `application/octet-stream`. Sets `Content-Length`.
* Decodes the URL path; any path whose resolved file is not inside the
  mount's directory (`..`, encoded `%2e%2e` or `%2f`) is 404. Unknown
  prefixes and missing files are 404. Directories are 404.
* Logs one line when listening; nothing per request.

### `web/smoke/index.html` + `web/smoke/smoke.js`
A page that loads an Emscripten module factory and records what it prints.
* Module URL: query parameter `module`, default `/engine/GeneralsXZH.js`.
  It is an ES module whose default export is the factory
  (`createGeneralsX(options) → Promise`).
* Before importing: `window.__zhwpLog = []`; `window.__zhwpDone` stays
  `undefined` until the outcome is known.
* Calls the factory with `{ canvas, arguments: ["-win"], print, printErr,
  onAbort }` where `canvas` is a `<canvas id="canvas" width="800"
  height="600">`, and `print`/`printErr` push each line, unchanged, to
  `__zhwpLog`.
* Factory resolves: `__zhwpDone = { status: "resolved" }`. Import fails,
  factory rejects, or `onAbort` fires: `__zhwpDone = { status: "error",
  message: <non-empty text> }` (an abort after resolving replaces it).
* `window` `error` and `unhandledrejection` events push `"[page] " + message`
  to `__zhwpLog`.
* No external resources; a minimal dark page is fine.

## Check
From `web/`: `npx playwright test` exits 0 (the engine must already be built
at `../build/webgpu/GeneralsMD/`).

## Allowed paths
* `web/scripts/serve.mjs`
* `web/smoke/index.html`
* `web/smoke/smoke.js`
