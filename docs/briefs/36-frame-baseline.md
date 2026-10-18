# 36: Real data: frame-time baseline

Issue #36. Phase 1. Size s. Depends on #34 (done).

## Goal
Know whether phase 1 needs performance work. A local-only bench plays a real
replay windowed in Brave with the owner's game files and prints the
distribution of browser frame times. The architect runs it and records the
numbers in `docs/porting-notes.md`.

## Read first
* `web/bench/bridge.bench.ts` (bench style: not part of `npm test`, prints
  one JSON line, `npm run bench`)
* `web/tests/real-data-replay.spec.ts` (import the game folder, serve the
  replay with `page.route` on the pathname, open the smoke page)

## Facts from the first real run
* Replays from GeneralsXReplays `linux_2p_vanilla_map.rep` pause the game at
  logic frame 100 (`REPLAY_CRC_MISMATCH`, expected, phase 2 material).
  Pressing `P` with the canvas focused (click on it first) resumes it and
  the logic runs on. The bench does that, then measures.

## Contract
New `web/bench/real-replay.bench.ts`, skipped unless `ZHWP_GAME_DIR` and
`ZHWP_REPLAY` (path of one `.rep`) both exist. It:
1. adds an init script that records `requestAnimationFrame` timestamp deltas
   (ms) into `window.__zhwpFrameDeltas`;
2. imports the game folder in the launcher until Ready, serves the replay,
   opens `/smoke/index.html?archives=opfs&replay=/replays/<name>&arg=-win&arg=-replay&arg=<name>`;
3. waits 20 s, clicks the canvas, presses `P`, waits 5 s, clears the deltas,
   waits 60 s, then reads them;
4. prints one line: `FRAME_BASELINE {"frames":n,"p50":..,"p95":..,"p99":..,"max":..,"over33ms":n}`
   (deltas sorted ascending; `over33ms` counts deltas above 33.4 ms), and
   fails only if there are fewer than 1000 frames or a WebGPU failure/abort
   line (`/GENERALSX_WEBGPU_\w+_FAILED|RuntimeError|Aborted\(/`) is in `__zhwpLog`.

## Acceptance criteria
1. The bench is skipped without `ZHWP_GAME_DIR` or `ZHWP_REPLAY`.
2. It prints exactly one `FRAME_BASELINE` line with the fields above.
3. It fails with fewer than 1000 measured frames.
4. It fails when `__zhwpLog` has a WebGPU failure or abort line.

## Test paths
* `web/bench/real-replay.bench.ts`

## Allowed paths
None (the bench is the deliverable; the architect writes the notes).

## Check command
`cd web && ZHWP_REPLAY=<file.rep> npm run bench -- real-replay` (the architect runs it with `ZHWP_GAME_DIR`)
