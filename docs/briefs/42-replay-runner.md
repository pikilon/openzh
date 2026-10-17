# 42: Run a replay in Brave and write its CRC log

Issue #42. Phase 2. Size m. Depends on #39 (and through it #37, #38).

## Goal
One command runs a replay in the browser build, headless, and saves its
`ZHWP_CRC` lines, so the oracle can compare it with a native run or another
browser. It is tested here with a fake engine; real runs need #41 and #6.

## Read first
* `web/AGENTS.md`, D-04 in `docs/decisions.md`
* `web/playwright.config.ts` (how Brave and the dev server are started)
* `web/scripts/serve.mjs`, `web/smoke/smoke.js`
* `docs/briefs/37-smoke-args.md`, `docs/briefs/38-smoke-exit.md`,
  `docs/briefs/39-replay-file.md`, `docs/briefs/40-compare-crc.md`

## Contract
`node scripts/run-replay.mjs --replay <file.rep> --out <file.crc> [--module <url>] [--archives opfs|none] [--profile <dir>] [--port <n>] [--timeout <seconds>]`,
run from `web/` after `npm run build`; Node 22+, uses `@playwright/test`'s
`chromium` API, no new dependencies.

* Starts `scripts/serve.mjs` on `--port` (default `ZHWP_PORT` or 4173) with
  the same mounts as the `serve` script plus `/replays=<folder of the replay
  file>`, and stops it at the end.
* Launches Brave headless (`BRAVE_PATH`, default the macOS path used in
  `playwright.config.ts`, with `--enable-unsafe-webgpu`). With `--profile` it
  uses a persistent context in that folder (so archives imported earlier
  stay in OPFS); otherwise a temporary one.
* Opens `/smoke/index.html` with `replay=/replays/<name>`, `arg=-headless`,
  `arg=-replay`, `arg=<name>`, `arg=-crclog`, plus `archives=opfs` unless
  `--archives none`, plus `module=<url>` when `--module` is given.
* Waits for `__zhwpDone` (default timeout 600 s). Writes every
  `__zhwpLog` line that starts with `ZHWP_CRC ` to `--out`, in order, one per
  line, also when the run fails or times out.
* Last output line: `RESULT <exited <code>|error|timeout> crc_lines=<n>`.
* Exit code: 0 when the engine exited with 0; 1 when it exited non-zero or
  ended in `error`; 3 on time-out; 2 on bad arguments or a missing replay
  file.
* `web/package.json`: new script `"replay": "node scripts/run-replay.mjs"`.

## Acceptance criteria
1. With a fake engine that prints three `ZHWP_CRC` lines among other lines and exits 0, the command exits 0 and the out file holds exactly those three lines in order.
2. The last output line is `RESULT exited 0 crc_lines=3` in that case.
3. A fake engine that exits with 1 makes the command exit 1, and the out file still holds the lines printed before.
4. A fake engine that never finishes, with `--timeout 5`, makes the command exit 3 with `RESULT timeout`.
5. A fake engine that aborts makes the command exit 1 with `RESULT error`.
6. The fake engine receives the arguments `-headless -replay <name> -crclog` in that order.
7. A missing `--replay` file or a missing `--out` argument exits 2 without starting a browser.
8. No server process is left listening on the port after the command ends.

## Test paths
* `web/tests/run-replay.spec.ts` (spawns the command as a child process;
  uses `--archives none` and a port different from the test server's)
* `web/tests/harness/replay/` (fake engine modules)

## Allowed paths
* `web/scripts/run-replay.mjs`
* `web/package.json` (the `replay` script only)

## Check command
`cd web && npm ci && npx playwright test`
