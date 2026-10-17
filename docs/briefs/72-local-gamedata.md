# 72: Import the local game folder automatically in development

Issue #72. Phase 1. Size m. Depends on #70 (same launcher files). Owner's
request (2026-10-17): on the owner's machine the game data is already in
`ZHWP_GAME_DIR`, so the launcher must not ask for the folder every time.

## Goal
`npm run serve` exposes the folder named by `ZHWP_GAME_DIR` to the launcher,
read-only and on `127.0.0.1` only, and the launcher imports it into OPFS by
itself on load, exactly as a folder pick of the same files would. Nothing is
copied into the repository, its build output or any artifact; the static
package (#32) never includes it.

## Read first
* `web/AGENTS.md`, "Local Game Data" and Legal Limits in `AGENTS.md`
* `web/scripts/serve.mjs`, `web/package.json`, `web/playwright.config.ts`
* `web/src/main.ts`, `web/app/index.html`, `web/src/install.ts`,
  `web/src/opfs-store.ts`
* `docs/briefs/4-smoke-harness.md` (server contract that stays),
  `docs/briefs/70-storage-warning.md`
* `web/tests/serve.spec.ts`, `web/tests/launcher.spec.ts`

## Contract

### `web/scripts/serve.mjs`
* New option `--gamedata <dir>`. An empty value means off. A value that is
  not a directory exits 2 with a message.
* When on, besides the mounts:
  * `GET /gamedata/index.json` → 200, `application/json`:
    `{ "files": [{ "path": "<relative path, / separated>", "size": <bytes> }] }`
    listing every regular file under `<dir>` (any depth) whose name ends in
    `.big` (case-insensitive), sorted by `path`. The list is built at start.
  * `GET /gamedata/files/<path>` (URL-decoded) → 200 with the bytes and
    `application/octet-stream` when `<path>` is exactly one of the listed
    paths; anything else (unlisted, `..`, encoded traversal, non-`.big`) → 404.
  * Logs one line at start: `game data: <n> archives`.
* When off, `/gamedata/...` is 404 like any unknown prefix.
* All other behaviour and headers (COOP/COEP/CORP, `no-store`) unchanged and
  applied to these responses too.

### `web/package.json`
* The `serve` script passes `--gamedata "${ZHWP_GAME_DIR:-}"`. No other
  change. `playwright.config.ts` is not changed: the test server never
  exposes game data.

### Launcher
* On load, after the feature check of #30 and unless the page URL has
  `gamedata=off`, the launcher requests `/gamedata/index.json`. When it is not
  200 the page behaves exactly as today.
* When it is 200: classify the listed paths with `classifyArchives`.
  * `missing` not empty: `#status` reads `Missing: ` + names, nothing is
    stored (as for a folder pick).
  * Otherwise store them with `storeFiles` and the same progress, warning
    (#70) and error handling as a folder pick, each file's data fetched from
    `/gamedata/files/<path>`; a file already stored with the same kind, name
    and size is not fetched at all. Then `#status` contains `Ready`, the
    summary and Play update. `#status` reads `Importing from the local game
    folder` while it runs.
* The folder picker stays usable for a manual import.

## Acceptance criteria
1. A server started with `--gamedata <dir>` lists in `/gamedata/index.json` every `.big` file under `<dir>` at any depth, with relative `/`-separated paths and sizes, sorted by path, and no other file.
2. `/gamedata/files/<listed path>` returns the file's exact bytes with the isolation headers.
3. Unlisted paths, non-`.big` files, `..` and encoded traversal under `/gamedata/files/` return 404.
4. Without `--gamedata`, or with an empty value, `/gamedata/index.json` returns 404.
5. `--gamedata` with a path that is not a directory exits with code 2.
6. With a complete synthetic folder exposed, opening the launcher stores all its archives without any user action, `#status` contains `Ready` and Play is enabled.
7. Reloading the launcher after that requests no `/gamedata/files/` URL.
8. With `?gamedata=off` the launcher requests nothing under `/gamedata/`.
9. A folder without every required archive gives `#status` starting with `Missing:` and stores nothing.
10. When `/gamedata/index.json` is 404 the launcher behaves as before (the existing launcher tests pass).
11. The `serve` script in `web/package.json` passes `ZHWP_GAME_DIR` to `--gamedata`.

## Test paths
* `web/tests/local-gamedata.spec.ts` (starts its own `scripts/serve.mjs`
  on a free port with `--gamedata` pointing to a synthetic folder made with
  `tests/helpers/big.ts` under the test's output folder; never real data)

## Allowed paths
* `web/scripts/serve.mjs`
* `web/src/local-gamedata.ts`
* `web/src/main.ts`
* `web/app/index.html`
* `web/package.json` (the `serve` script only)

## Check command
`cd web && npm ci && npx playwright test`
