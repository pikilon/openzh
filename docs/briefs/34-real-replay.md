# 34: A real replay plays in the browser with rendering

Issue #34. Phase 1. Size m. Depends on #33 (done: the main menu renders with
real data), #39, #37.

## Goal
With the owner's game files and a real Zero Hour replay, the windowed engine
plays the replay in Brave: it renders the map and the in-game UI, with no
WebGPU failure. The first real run (#33 triage) showed one defect: the smoke
page puts a `replay=` file in `Replays/` under the user data folder, but
Zero Hour reads replays from `GeneralsZH/Replays/` there, so `-replay <name>`
silently shows the main menu instead of the replay.

## Read first
* `web/AGENTS.md`
* `web/smoke/smoke.js` (`fetchReplay`)
* `web/tests/user-files.spec.ts` (tests 6 and 7 about replay URLs),
  `web/tests/real-data.spec.ts`, `web/tests/real-data-webgpu.spec.ts`
  (local-only pattern, `distinctColours`)
* `docs/briefs/39-replay-file.md`, `docs/briefs/37-smoke-args.md`

## Contract
* `web/smoke/smoke.js`: each `replay=<url>` becomes the user file
  `GeneralsZH/Replays/<name>` (was `Replays/<name>`). Nothing else changes;
  `addUserFiles` itself stays as is (the folder is a path prefix chosen by
  the caller).
* New local-only test `web/tests/real-data-replay.spec.ts`, skipped unless
  `ZHWP_GAME_DIR` and `ZHWP_REPLAY` both exist (`ZHWP_REPLAY` is the path of
  one `.rep` file; it is never copied into the repository). The test:
  1. imports `ZHWP_GAME_DIR` in the launcher exactly as `real-data.spec.ts`
     does, until the status says Ready;
  2. serves the replay's bytes to the page with `page.route` for the path
     `/replays/<file name>` only (match on `URL.pathname`, not on a glob, so
     the page's own URL is not intercepted);
  3. opens `/smoke/index.html?archives=opfs&replay=/replays/<name>&arg=-win&arg=-replay&arg=<name>`
     in the same browser context (same OPFS);
  4. waits 45 seconds, then takes a screenshot of `#canvas`.

## Acceptance criteria
1. `web/tests/user-files.spec.ts` tests about a replay URL place the served bytes at `GeneralsZH/Replays/<name>` (with and without `archives=opfs`) and no longer at `Replays/<name>`.
2. A 404 replay URL is still an error naming the URL and the engine is not started (existing test 7 unchanged).
3. The real replay test finds the replay file in the engine's file system at `GeneralsZH/Replays/<name>` under `/home/web_user/.local/share/GeneralsX`.
4. After 45 s the log has no line matching `/GENERALSX_WEBGPU_\w+_FAILED|RuntimeError|Aborted\(/` and `__zhwpDone` is not an error.
5. The canvas screenshot has at least 5000 distinct colours (the main menu without a shell map has far fewer).
6. The test prints the path of its screenshot (in the system temp folder).

## Test paths
* `web/tests/user-files.spec.ts` (only the two replay-URL tests, criterion 1)
* `web/tests/real-data-replay.spec.ts`

## Allowed paths
* `web/smoke/smoke.js`

## Check command
`cd web && npm ci && npx playwright test tests/user-files.spec.ts && ZHWP_REPLAY=<file.rep> npx playwright test tests/real-data-replay.spec.ts`

## Notes for the architect
* The agents cannot launch Brave with the real data; the architect runs the
  real-data check. The agents' check is `tests/user-files.spec.ts`.
* Known and out of scope: with `linux_2p_vanilla_map.rep` (GeneralsXReplays)
  the engine reports `REPLAY_CRC_MISMATCH frame=100` and the in-game overlay
  says the replay is out of sync. That is the oracle's work in phase 2
  (#41, #43, #44), not this task.
