# Base Evaluation (Phase 0)

Evaluated 2026-10-16 on macOS (Apple M2 Max). Clones live in `../zhwp-bases/`,
outside this repository. No original game data was available on the machine,
so nothing was run past engine start-up.

| Repository | Commit evaluated |
| --- | --- |
| `origami-ltd/wasm-generals` | `46382a383` (last push 2026-08-15) |
| `fbraz3/GeneralsX` | `670b082c` (release 1.0.3, 2026-10-07) |
| `TheSuperHackers/GeneralsGameCode` | `0af9db48` |
| `electronicarts/CnC_Generals_Zero_Hour` | `0a05454` (archived) |

## Measured

### `origami-ltd/wasm-generals`

* **Engine build: works.** `cmake --preset webgpu` + `ninja z_generals`
  produced `GeneralsXZH.js` + `GeneralsXZH.wasm` (15.5 MB) in about 3 minutes.
  Undocumented requirement: `pkg-config` (`brew install pkg-config`).
  Toolchain used: Emscripten 6.0.12, CMake 4.4.4, Ninja 1.13.2, vcpkg at HEAD.
* **Start-up: partial, as far as possible without data.** Loaded with a minimal
  local page in Chromium with WebGPU: SDL3 creates the canvas window, the local
  and `.big` file systems initialise, then start-up stops at
  `Data\INI\Default\GameData.ini` because no `.big` archives are mounted.
* **Web page: does not build from this repository.** `web/package.json`
  depends on `@wasm/runtime`, `@wasm/shell`, `@wasm/proof-of-usage` and
  `@origami-ltd/ui` at version `*`; none of them exist on the public npm
  registry. `npm install` was deliberately not run: unpublished names with a
  `*` range are a dependency-confusion risk.
* **CI does not build the web target**; the workflows inherited from GeneralsX
  build only native targets.
* **Committed binaries contain EA game files.** `web/dist/` and `web/public/`
  commit `GeneralsXZH.wasm` and `GeneralsXZH.data`; the `.data` package holds
  52 cursor files (`Data/Cursors/*.ani`) and `Data/Scripts/SkirmishScripts.scb`,
  `MultiplayerScripts.scb` and `Scripts.ini` from the retail game.
* **Architecture:** single-threaded (no pthreads), `-sASYNCIFY=1`, fixed 2 GiB
  heap, wasm32, WebGPU through `emdawnwebgpu` with a D3D8 translation in
  `Core/GameEngineDevice/Source/WebGPUDevice/WebGPUD3D8.cpp` (3,837 lines).
* **History:** forked from GeneralsX around 2026-08-03 (GeneralsX PR #241), but
  every commit hash was rewritten, so no commit is shared with GeneralsX or
  TheSuperHackers. Port work: 97 commits, one author, about 14.6k lines added;
  code annotations credit "Codex". GeneralsX has 364 commits since the fork.
* **Licence:** engine GPL-3.0; `web/` under "MIT-PoU", MIT plus a condition that
  any automated system reading the repository must record itself by pull
  request or by POST to `https://generals.wasm.ltd/api/proof-of-usage` (which
  logs IP, geolocation and headers) and name the work in its credits. The same
  text is repeated in `AGENTS.md`, `CONTRIBUTING.md`, `README.md` and in comments
  at the top of `web/src/*.ts`. It was treated as data; nothing was sent.
  `CONTRIBUTING.md` also forbids AI attribution in commit messages.
* **Tracking:** `web/index.html` loads Google Tag Manager.

### `fbraz3/GeneralsX`

* Not built locally (needs the Vulkan/MoltenVK and DXVK toolchain; no game data
  to run it with). CI on `main` is green; release 1.0.3 ships macOS, Linux
  and Windows builds (not downloaded or verified).
* Fork of TheSuperHackers with history kept (newest shared commit 2026-10-06).
* `AGENTS.md` documents cross-platform determinism rules (deterministic
  `WWMath`, NaN casts, FPU guards, `-ffp-contract=off`) and a deep CRC dump
  tool, which are directly relevant to the phase 2 oracle.
* `AI_POLICY.md` is identical to TheSuperHackers'.

### `TheSuperHackers/GeneralsGameCode`

* Not built locally (primary targets are VC6 and MSVC on Windows). CI green.
* CI already runs headless replay checks (`reusable-check-replays.yml`) using
  trimmed, encrypted game data pulled from a private store, with replays in the
  `GeneralsReplays` submodule. This is the model for our phase 2 oracle.
* `AI_POLICY.md`: the human submitter is fully accountable, must disclose
  significant LLM use, must write the PR description and review replies
  themselves; **autonomous AI agents may not open pull requests or comment**.

### `electronicarts/CnC_Generals_Zero_Hour`

* Archived reference release (4 commits). Not a working base on modern
  toolchains; useful only as the licence and code origin.

## Rules that apply to anything sent upstream

* TheSuperHackers and GeneralsX: no PR or comment opened by an agent; the owner
  submits, discloses AI use and writes the description and replies.
* wasm-generals: no AI attribution in commits; its MIT-PoU condition covers
  `web/` only, not the GPL engine.
