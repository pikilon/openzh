# 5c: Launcher page: pick the install folder, import, play

Part of issue #5, after 5a and 5b. Tests exist (`web/tests/launcher.spec.ts`)
and fail. TypeScript for the logic, plain HTML/CSS for the page, no new
dependencies.

## Read first
* `web/AGENTS.md`; Legal Limits in the root `AGENTS.md` (no EA trademarks in
  UI or branding; "compatible with C&C Generals game data" in a description
  is fine)
* `web/tests/launcher.spec.ts`
* `web/src/install.ts`, `web/src/opfs-store.ts`, `web/src/engine.ts`,
  `web/smoke/smoke.js` (log contract to copy)

## Contract
`web/app/index.html` (served at `/app/index.html`) loads `/dist/main.js`
(built from `web/src/main.ts`).

Elements (ids are the contract):
* `#folder-input`: `<input type="file" webkitdirectory multiple>`.
* `#status`: one line of state text.
* `#import-progress`: `<progress>`; shows import progress, hidden when idle.
* `#stored-summary`: exactly `Stored: <n> archives`.
* `#play`: button, enabled only when every `REQUIRED` archive is stored.
* `#clear`: button that removes stored archives and resets the page.
* `#canvas`: `<canvas width="800" height="600">`, hidden until play.

Behaviour:
* On load: `listStored()` → update `#stored-summary` and `#play`.
* On folder pick: `classifyArchives` over each file's `webkitRelativePath`.
  If `missing` is not empty, `#status` reads `Missing: ` + the names joined
  with `, ` and nothing is stored. Otherwise `storeFiles` with progress into
  `#import-progress`, then `#status` contains `Ready`, summary and play update.
* Play: show `#canvas`, hide the picker controls, then start the engine
  exactly like `smoke.js` does with `?archives=opfs`: import
  `/engine/GeneralsXZH.js`, `prepareEngineOptions({ canvas, arguments:
  ["-win"], print, printErr, onAbort })`, with `print`/`printErr` pushing
  every line to `window.__zhwpLog` (create it before starting).
* Clear: `clearStored()`, then refresh as on load.
* Title and headings: a neutral project name (no "Command & Conquer",
  "Generals" or "Zero Hour"); body text may say the page needs the player's
  own copy of the game data and that it is compatible with C&C Generals game
  data. Minimal, readable, dark page; works at 1280×800.

Build and serving:
* Add `src/main.ts` to the `build` script entry points and
  `--mount /app=app` to the `serve` script in `web/package.json`.

## Check
From `web/`: `npx playwright test` exits 0 (all specs).

## Allowed paths
* `web/app/index.html`
* `web/src/main.ts`
* `web/package.json` (the `build` and `serve` scripts only)
