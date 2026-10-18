# 133: Remove the folder pick, the dev game-folder server and local-gamedata

Issue #133. Phase 1. Size m. Depends on #129, #130 and #132, **and on the
lead's final acceptance** of the ZIP path with the real game (owner request
2026-10-18: remove the folder path only after the ZIP path with persistence
is proven). Do not start before the issue is labelled `ready`.

## Goal
ZIPs are the only way to load the game. The code of the folder pick and of
the development server's game-folder import is gone.

## Read first
* `web/AGENTS.md`, `web/app/index.html`, `web/src/main.ts`,
  `web/src/local-gamedata.ts`, `web/scripts/serve.mjs`, `web/package.json`,
  `web/playwright.config.ts`, `web/tests/local-gamedata.spec.ts`,
  `web/tests/serve.spec.ts`, `web/tests/helpers/zip.ts`

## Contract
* `web/app/index.html`: no `#folder-input`, no `webkitdirectory`, no note
  about picking a folder. `#zip-input` and `#drop-zone` remain the only
  inputs.
* `web/src/main.ts`: `importFolder`, `classifyPicked`, `importLocalGameData`,
  `fetchLocalIndex` use and every other code path that only served them are
  deleted. `storeEntries` and `ImportEntry` go if nothing else uses them.
* `web/src/local-gamedata.ts` is deleted.
* `web/scripts/serve.mjs`: the `--gamedata` option and the `/gamedata/...`
  routes are removed; `--gamedata` is now an unknown option (exit 2 as for
  any unknown option). `web/package.json` `serve` no longer passes it.
  `?gamedata=off` is meaningless and ignored.
* `web/tests/local-gamedata.spec.ts` is deleted. Every launcher and real-data
  spec that loads an install does it through `#zip-input` and a synthetic ZIP
  built with `buildZip` (each spec's local `makeInstall` becomes a ZIP
  builder, or uses a shared helper `web/tests/helpers/install-zip.ts`), with
  unchanged assertions.
* `classifyArchives`, `opfs-store` and the engine side do not change.
* `docs/briefs/72-local-gamedata.md` stays as history.

## Acceptance criteria
1. The launcher HTML contains no `folder-input` and no `webkitdirectory`.
2. `web/src/local-gamedata.ts` and `web/tests/local-gamedata.spec.ts` do not exist, and no file under `web/src` or `web/app` mentions `gamedata` or `webkitRelativePath`.
3. `serve.mjs --gamedata <dir>` exits 2 as an unknown option, and `GET /gamedata/index.json` is 404.
4. `npm run serve` in `package.json` does not pass `--gamedata`.
5. Every launcher spec that imported an install now does it through `#zip-input` and passes.
6. Importing the four-archive synthetic ZIP still ends `Ready` with `Stored: 4 archives` and Play starting the fake engine.
7. The whole suite passes: `npx playwright test` exits 0.

## Test paths
`web/tests/folder-removed.spec.ts`, `web/tests/helpers/install-zip.ts`,
`web/tests/launcher.spec.ts`, `web/tests/launcher-canvas.spec.ts`,
`web/tests/launcher-errors.spec.ts`, `web/tests/launcher-favicon.spec.ts`,
`web/tests/launcher-features.spec.ts`, `web/tests/launcher-fullscreen.spec.ts`,
`web/tests/launcher-fullscreen-fallbacks.spec.ts`, `web/tests/launcher-input.spec.ts`,
`web/tests/launcher-mute.spec.ts`, `web/tests/launcher-storage.spec.ts`,
`web/tests/launcher-window-layout.spec.ts`, `web/tests/serve.spec.ts`,
`web/tests/local-gamedata.spec.ts`

## Allowed paths
`web/app/index.html`, `web/src/main.ts`, `web/src/local-gamedata.ts`,
`web/scripts/serve.mjs`, `web/package.json`, `web/playwright.config.ts`

## Check
`cd web && npm ci && npx playwright test`
