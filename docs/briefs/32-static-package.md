# 32: Static site package with isolation headers

Issue #32. Phase 1. Size s. Depends on #27 (the guard).

## Goal
The owner needs to test the port from a plain static host, not only the dev
server. `npm run package` produces one folder with everything the launcher
needs, the headers file static hosts read, and no game data.

## Read first
* `web/AGENTS.md`, Legal Limits in `AGENTS.md`
* `web/package.json`, `web/scripts/serve.mjs`
* `scripts/check-no-ea-assets.sh` and its brief `docs/briefs/27-no-ea-assets.md`

## Contract
`web/scripts/package.mjs [--engine <dir>] [--out <dir>]`, run from `web/`
after `npm run build`; Node 22+, no new dependencies.
* Defaults: `--engine ../build/webgpu/GeneralsMD`, `--out out`.
* Deletes `<out>` first, then writes:
  * `app/index.html` (copy of `app/index.html`);
  * `dist/` (copy of every file in `dist/`);
  * `engine/` (copy of every file in `<engine>` whose name starts with
    `GeneralsXZH.`); exit 1 with a message when `GeneralsXZH.js` or
    `GeneralsXZH.wasm` is missing there;
  * `index.html`: a page that redirects to `app/index.html`
    (`<meta http-equiv="refresh" content="0; url=app/index.html">`);
  * `_headers` with exactly:
    ```
    /*
      Cross-Origin-Opener-Policy: same-origin
      Cross-Origin-Embedder-Policy: require-corp
      Cross-Origin-Resource-Policy: same-origin
    ```
* Nothing else: no `smoke/`, no `tests/`, no source maps beyond what is in
  `dist/`.
* Then runs `../scripts/check-no-ea-assets.sh <out>` and exits with 1 when it
  fails (printing its output).
* Last line on success: `package: <out> (<n> files, <total bytes> bytes)`.
* `web/package.json`: new script `"package": "npm run build && node
  scripts/package.mjs"`; no other script changes.
* `web/.gitignore`: add `out/`.

## Acceptance criteria
1. With a fake engine folder holding `GeneralsXZH.js` and `GeneralsXZH.wasm`, the script exits 0 and creates `app/index.html`, `dist/main.js`, `engine/GeneralsXZH.js`, `engine/GeneralsXZH.wasm`, `index.html` and `_headers` in the out folder.
2. `_headers` contains exactly the four lines of the contract.
3. The out folder contains no other top-level entries than `app`, `dist`, `engine`, `index.html` and `_headers`.
4. An engine folder without `GeneralsXZH.wasm` makes the script exit 1.
5. An engine folder that also holds `GeneralsXZH.data` makes the script exit 1, because the guard rejects `.data` files.
6. Running the script twice leaves no file from the first run that the second would not write.
7. The last output line on success matches `package: <out> (<n> files, <m> bytes)`.

## Test paths
* `web/tests/package.spec.ts` (Node-side Playwright test; fake engine
  folders under the test's output folder)

## Allowed paths
* `web/scripts/package.mjs`
* `web/package.json` (the `package` script only)
* `web/.gitignore`

## Check command
`cd web && npm ci && npx playwright test`
