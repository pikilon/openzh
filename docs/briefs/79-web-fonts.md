# 79: Fonts for the game's text in the browser build

Issue #79. Phase 1. Size m. Owner's decision (2026-10-17): use the free,
metric-compatible Liberation fonts (SIL OFL), mapped to the game's font
names. Found by #33: the browser build logs about 3,000 `[Font] WARNING:
Unable to resolve font '<face>' (all tiers exhausted)` lines and the main
menu buttons have no text.

The repository already tracks Liberation fonts under the game's file names,
with their licence (inherited from GeneralsX, `assets/fonts/`):
`arial.ttf` = Liberation Sans, `arialbold.ttf` = Liberation Sans Bold,
`timesnewroman.ttf` = Liberation Serif, `couriernew.ttf` = Liberation Mono,
`LICENSE.liberation`. No new font file is needed.

## Goal
Every font face the game asks for resolves to one of those Liberation files
in the browser build, so in-game text renders.

## Read first
* `Core/Libraries/Source/WWVegas/WW3D2/render2dsentence.cpp`: the
  multi-tier font resolution (around lines 1920–2120: candidates, Tier 1
  local files, Tier 3 fallback) and the WebGPU fallback path
  `/fonts/GeneralsX.ttf` (~2163)
* `Core/Libraries/Source/Platform/PlatformPaths.h`: `FindLocalFontFile`
  and the directories it probes (relative ones depend on the current
  directory; some are absolute)
* `GeneralsMD/Code/Main/CMakeLists.txt`: the browser link options
  (`--preload-file`, `GENERALSX_WEB_FONT_FILE`)
* `assets/fonts/LICENSE.liberation`

## Contract
* The browser build (`webgpu` preset) preloads exactly the four Liberation
  files above and `LICENSE.liberation` into the Emscripten file system, at a
  directory that `FindLocalFontFile` probes independently of the current
  directory. No other file from `assets/fonts/` is preloaded. Native builds
  are unchanged.
* The game's faces resolve as follows (regular and bold where the game asks
  for bold): `Arial`, `Tahoma`, `Arial Unicode MS` → Liberation Sans;
  `Times New Roman` → Liberation Serif; `Courier`, `Courier New`,
  `FixedSys` → Liberation Mono. Faces that already resolve keep resolving
  the same way on native builds.
* No `[Font] WARNING: Unable to resolve font` line for any of those faces in
  the browser build.
* Every changed source line carries `// GeneralsX @bugfix zhwp 17/10/2026
  <why>`; CMake changes carry a `# GeneralsX @build zhwp 17/10/2026 <why>`
  comment.

## Acceptance criteria
1. With the owner's game data, from Play until 20 s after `GENERALSX_LOAD_DONE`, `__zhwpLog` contains no line with `Unable to resolve font`.
2. In the same run, the engine's file system contains the preloaded Liberation files (checked through `window.__zhwpModule.FS` on the smoke page with `archives=opfs`, or by the absence of warnings if the launcher is used).
3. The synthetic test suite still passes.

## Test paths
* `web/tests/real-data-fonts.spec.ts`: local only, skipped unless
  `ZHWP_GAME_DIR` is set; same import as `web/tests/real-data-webgpu.spec.ts`;
  screenshots only to the system temp folder. Visible text is checked by
  the owner by hand (owner's decision after the first attempt: the pixel
  criterion was dropped).

## Allowed paths
* `GeneralsMD/Code/Main/CMakeLists.txt`
* `Core/Libraries/Source/WWVegas/WW3D2/render2dsentence.cpp`
* `Core/Libraries/Source/Platform/PlatformPaths.h`

## Build
Agents cannot build the engine. The implementer edits, then answers DONE;
the architect runs `scripts/build-webgpu.sh` and returns compiler errors (at
most three rounds within the same attempt).

## Check command
`scripts/build-webgpu.sh && cd web && npm ci && npx playwright test tests/real-data-fonts.spec.ts && env -u ZHWP_GAME_DIR npx playwright test`
(run by the architect, locally, with `ZHWP_GAME_DIR` set; never in CI)
