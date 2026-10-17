# Decisions

Each decision has an id that never changes. A later decision may supersede an
earlier one; it names the one it replaces. Never contradict a decision
silently: flag the conflict to the owner.

## D-01: Base: GeneralsX, plus the GPL browser engine work of wasm-generals

Date: 2026-10-16. Evidence: `docs/base-evaluation.md`.

* This repository is a fork of `fbraz3/GeneralsX`, imported with its full
  history (which includes TheSuperHackers' and EA's), so it can keep merging
  GeneralsX and TheSuperHackers upstream. Imported commit:
  `f6e8ddb6fdafc28dae91f60cb0d4b15ffb36af6b` (2026-10-16), remotes
  `generalsx` and `thesuperhackers`.
* The browser engine work from `origami-ltd/wasm-generals` is ported in from
  its GPL-3.0 part only: the WebGPU D3D8 translation
  (`Core/GameEngineDevice/Source/WebGPUDevice/`), the Emscripten CMake
  (`cmake/webgpu.cmake`, the `webgpu` preset) and the SDL3/engine changes the
  browser build needs. Each ported file credits its origin in the commit.
* Nothing is taken from wasm-generals' `web/` (MIT-PoU licence, unpublished
  npm dependencies), from its committed binaries (`web/dist/`, `web/public/`,
  which contain EA game files) or from its history (rewritten, no common
  commits with GeneralsX). The TypeScript browser wrapper is written here.
* Upstream contributions follow GeneralsX's and TheSuperHackers'
  `AI_POLICY.md`: agents never open pull requests or comments upstream; the
  owner submits, discloses AI use and writes the description and replies.

Rejected: forking wasm-generals directly (EA files in its history, unbuildable
web page, stale since 2026-08-14, history that cannot merge GeneralsX); forking
TheSuperHackers directly (loses GeneralsX's SDL3, macOS and cross-platform
determinism work); EA's archived release (does not build on current
toolchains).

## D-02: Who writes what: strong model for specs and tests, local model for small implementations

Superseded by D-05 for who writes specs, tests and implementations. Its
last point (plain Markdown rules any harness can read) still holds.

Date: 2026-10-16.

* The strongest model in the session writes issues, briefs, specs and tests,
  and verifies every change from a clean checkout.
* Small, fully specified implementation tasks may go to a local model in LM
  Studio through `scripts/local-agent.sh`, following
  `.agents/skills/local-delegation/SKILL.md`. The local model never writes or
  changes tests, specs or rules.
* All agent instructions are plain Markdown readable by any harness:
  `AGENTS.md` files, `.agents/skills/` and `.agents/agents/`. No
  harness-specific rule files.

## D-03: Game archives reach the engine through OPFS and a synchronous worker bridge

Date: 2026-10-17. Issue #5.

* The engine opens `/GeneralsZH/*.big` and `/Generals/*.big` with ordinary
  synchronous file calls, and the archives are several GB while the WASM heap
  is a fixed 2 GiB, so archives are never copied into the Emscripten heap or
  into an in-memory file system.
* The player's chosen files are copied once into OPFS. A dedicated worker
  opens them with `FileSystemSyncAccessHandle`; the main thread reads byte
  ranges synchronously through a `SharedArrayBuffer` request/response block
  (the main thread spins on `Atomics.load`, because `Atomics.wait` is not
  allowed there). An Emscripten file system mount exposes the stored files at
  the paths the engine expects, with `readdir`/`stat`/`read` backed by the
  bridge.
* This is the architecture wasm-generals describes ("synchronous worker +
  SharedArrayBuffer file bridge"), written here from scratch because its
  implementation lives in unpublished packages.

Rejected for now: Emscripten WASMFS with its OPFS backend (needs a pthreads
build and relinking the engine; revisit if the bridge is too slow), loading
archives into JS memory (several GB per tab), and moving the engine into a
worker (rendering and input live on the main thread today).

## D-04: Test only in Brave and the agent's built-in browser

Date: 2026-10-17. Owner's instruction.

* Automated browser tests (Playwright) run in Brave, the browser installed on
  the owner's machine, through its executable (`BRAVE_PATH` overrides it).
* Manual and exploratory checks use Brave or the agent's built-in browser.
* Chrome and Firefox are not tested; no time is spent on other browsers.
* Conflict to resolve: `AGENTS.md` phase 1 says "playable in current Chrome
  and Firefox" and issue #7 repeats it. Until the owner restates the target,
  phase 1 is verified in Brave only.

## D-05: Test-driven pipeline: architect specs, flash tests, flash code, escalate

Date: 2026-10-17. Owner's instruction. Replaces D-02's split of work.

* The architect (the strongest model, Opus) plans and writes each task's
  spec at contract level: goal, contract, acceptance criteria, allowed paths
  and check command, in `docs/briefs/`. It does not write the tests or the
  code.
* A test-writer agent on `deepseek-official/deepseek-flash` turns the spec
  into failing tests. The architect reviews the tests against the spec
  before any implementation starts; tests that miss a spec sentence or test
  the wrong thing count as a failed test-writing attempt.
* A separate implementer agent on `deepseek-official/deepseek-flash` writes
  the code in a loop until the tests pass. It never edits tests or specs.
* If either step fails (time-out, cannot make the tests pass, rejected tests,
  edits outside the allowed paths), the task gets the `escalate` label and
  the same step is retried one rung up: `openrouter/xiaomi/mimo-v2.6-pro`,
  then `deepseek-official/deepseek-v4-pro`, and last `sonnet` (the `llm`
  MCP's `claude_agent`). Trivial tasks labelled `local-model-ok` may try the
  free local model (`scripts/local-agent.sh`) before the first rung.
* Every attempt is recorded (`report_outcome` in the `llm` MCP and a row in
  `docs/model-results.md`) so the owner can see which models do which work
  well; the ladder changes when the data says so.
* Independent `ready` tasks run in parallel, each in its own worktree with its
  own test port (`ZHWP_PORT`). The architect verifies every result from a
  clean checkout before merging, as before.
* Paid models run under a spending cap the owner states for each working
  session; work stops at the cap.
* Procedure: `.agents/skills/tdd-pipeline/SKILL.md`.
