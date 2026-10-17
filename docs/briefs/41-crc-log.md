# 41: Print the logic CRC with -crclog

Issue #41. Phase 2. Size m. Blocked by #6: only real game data and a real
replay can show that it works. The architect runs the build; agents cannot.

## Goal
The oracle needs the engine's logic CRC per frame from any build (native or
browser) as plain text. A new command-line flag prints the CRC each time the
engine computes the value the replay recorder compares.

## Read first
* `GeneralsMD/Code/GameEngine/Source/GameLogic/System/GameLogic.cpp`, the
  block that computes `m_CRC = getCRC( CRC_RECALC )` for
  `generateForSolo || generateForMP` (around line 4045)
* `Core/GameEngine/Source/Common/CommandLine.cpp` (`parseHeadless`,
  `parseReplay` and the argument table)
* `GeneralsMD/Code/GameEngine/Include/Common/GlobalData.h` and
  `GeneralsMD/Code/GameEngine/Source/Common/GlobalData.cpp` (`m_headless`)
* `GeneralsMD/Code/GameEngine/Source/Common/GameMain.cpp` (replay
  simulation exit code)
* `docs/upstream/GeneralsX-AGENTS.md` (annotations, determinism rules)

## Contract
* New flag `-crclog` (no value) sets a new `Bool m_crcLog` in
  `GlobalData` (default `FALSE`, reset where the other flags are reset).
* With the flag, right after `m_CRC = getCRC( CRC_RECALC )` in that block,
  the engine writes one line to stdout and flushes it:
  `ZHWP_CRC <frame> <crc>` with `frame` = `m_frame` in decimal and `crc` =
  `m_CRC` as 8 lower-case hex digits (`printf("ZHWP_CRC %u %08x\n", …)`).
  Without the flag nothing new is printed. The flag never changes what the
  game computes (no extra CRC calculations, no change to logic state).
* In Emscripten builds (`__EMSCRIPTEN__`), when replay simulation finishes in
  `GameMain.cpp`, the page's `Module.onExit` receives the simulation's exit
  code (for example through `emscripten_force_exit(exitcode)`). Native builds
  are unchanged.
* Every changed line carries `// GeneralsX @feature zhwp DD/MM/YYYY <why>`.
* Both `scripts/build-webgpu.sh` and the native presets must still compile
  (the architect checks the WebGPU build; native is #14).

## Acceptance criteria
1. Started with `-headless -replay <real replay> -crclog`, the browser build prints at least one `ZHWP_CRC` line matching `^ZHWP_CRC \d+ [0-9a-f]{8}$`.
2. The frames of those lines strictly increase.
3. Without `-crclog`, the same run prints no `ZHWP_CRC` line.
4. The page's `onExit` receives the exit code of the replay simulation (0 when the replay has no CRC mismatch).
5. Two runs of the same replay in the same browser print identical `ZHWP_CRC` lines.

## Test paths
* `web/tests/real-data-crc.spec.ts`: local only, skipped unless
  `ZHWP_GAME_DIR` and `ZHWP_REPLAY` (a `.rep` file) are set; imports the
  archives through the launcher as `web/tests/real-data.spec.ts` does and
  runs the smoke page with `arg`, `replay` and `archives=opfs` (needs #37,
  #38 and #39 merged first).

## Allowed paths
* `Core/GameEngine/Source/Common/CommandLine.cpp`
* `GeneralsMD/Code/GameEngine/Include/Common/GlobalData.h`
* `GeneralsMD/Code/GameEngine/Source/Common/GlobalData.cpp`
* `GeneralsMD/Code/GameEngine/Source/GameLogic/System/GameLogic.cpp`
* `GeneralsMD/Code/GameEngine/Source/Common/GameMain.cpp`

## Check command
`scripts/build-webgpu.sh && cd web && npm ci && ZHWP_GAME_DIR=<install> ZHWP_REPLAY=<file.rep> npx playwright test tests/real-data-crc.spec.ts`
(run by the architect, locally; never in CI)
