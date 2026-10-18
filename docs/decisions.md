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

Date: 2026-10-17 (updated the same day). Owner's instruction. Replaces D-02's
split of work.

* The architect (the strongest model, Opus) plans and writes each task's
  spec at contract level: goal, contract, acceptance criteria, test paths,
  allowed paths and check command, in `docs/briefs/`. It does not write,
  review or fix the tests or the code.
* A test-writer agent on DeepSeek V4.1 Flash turns the spec into failing
  tests. A separate implementer agent on DeepSeek V4.1 Flash writes the code
  until the tests pass. Both run as `deepseek-official/deepseek-flash`
  through the `llm` MCP's `dsh_agent`: the official DeepSeek API, paid from
  the owner's DeepSeek credits, never through OpenRouter.
* If either step fails (time-out, BLOCKED, the check does not pass, tests
  that do not fail before implementation, edits outside the allowed paths),
  the task stops there: labels `blocked` and `escalate`, and the next task
  goes on. Escalation is manual and done in separate passes: only the owner
  authorises retrying a step on `openrouter/xiaomi/mimo-v2.6-pro` or on
  `sonnet` (the `llm` MCP's `claude_agent`); no agent starts either model on
  its own. DeepSeek V4 Pro is not used: it costs more and did worse than
  Flash, and it is removed from the `llm` MCP. Trivial tasks labelled
  `local-model-ok` may try the free local model (`scripts/local-agent.sh`)
  first for the code.
* Delegated agents return results only (verdict, check result, changed
  files), never implementation context: no explanations, summaries of the
  code or reasoning. The architect neither asks for nor reads that context.
* Failed attempts are kept (branch, worktree log, agent output) and recorded
  (`report_outcome` and `docs/model-results.md`). Whether the tests or the
  code were at fault is analysed later with Sonnet, when the owner decides;
  nobody analyses or patches a failure on the spot.
* The architect only checks results mechanically: the check passes from a
  clean checkout and only the allowed paths changed. Then it merges.
* Independent `ready` tasks run in parallel, each in its own worktree with its
  own test port (`ZHWP_PORT`).
* Paid models run under a spending cap the owner states for each working
  session; work stops at the cap.
* Procedure: `.agents/skills/tdd-pipeline/SKILL.md`.

## D-07: The project is called OpenZH

Date: 2026-10-18. Owner's decision, taken when the trademark question of
`AGENTS.md` was raised before the repository goes public. Numbered D-07 because
D-06 is reserved for the network architecture (#47).

* The project name is **OpenZH**: repository, site, page title and domain.
  `ZH` abbreviates *Zero Hour* the way `TTD` abbreviates *Transport Tycoon
  Deluxe* in OpenTTD; it is an abbreviation of the mark, not the mark.
* EA's marks stay out of the name, the logo, the domain, the page title and the
  favicon. They are allowed in descriptions, where descriptive use is allowed:
  "compatible with C&C Generals: Zero Hour game data", "the C&C Generals engine
  in a browser".
* The `README` keeps the disclaimer: not affiliated with, sponsored or endorsed
  by Electronic Arts.
* This is tolerance, not a licence. The GPL-3.0 grant on the source release
  covers copyright; it grants no trademark rights, so the icon of the game used
  as the site's favicon is the one branding item still to replace.
* The licence of the code does not change: GPL-3.0.

## D-08: The fork is independent; no upstream contributions

Date: 2026-10-18. Owner's decision. Replaces the "Upstream Help" section of
`AGENTS.md`.

* This repository sends no pull requests and no comments to `fbraz3/GeneralsX`,
  `TheSuperHackers/GeneralsGameCode` or `origami-ltd/wasm-generals`.
* Reason: their AI policies make the human submitter responsible for
  understanding and explaining every line in review. The owner does not write
  the code and will not defend it there, so the cost of contributing is higher
  than the benefit. The fork lives on its own and anyone may read it.
* Credit and licence obligations do not change: the code stays GPL-3.0 and the
  lineage stays in the README.

## D-09: The native reference belongs to phase 3

Date: 2026-10-18. Owner's decision.

* Phase 2 compares the WASM build **across browsers** only. That is the property
  cross-platform play depends on, and it needs no native build.
* The native reference (#14 native build, #43 native runner, #44 one-command
  oracle) moves to phase 3, as its first milestone.
* Reason: the native build answers one question — is a divergence caused by the
  WASM toolchain or by the shared code — and that question is worth paying for
  when online play has to debug a desync, not before.
* Consequence: #14 no longer blocks phase 1 or phase 2.

## D-10: The game is loaded from ZIP files

Date: 2026-10-18. Status: accepted. Issues #131–#133. Replaces the folder pick
of #72 and the dev game-folder server.

Context: the launcher asked the player for the game install folder and the dev
server exposed it. ZIP files replace that: the player picks or drops the ZIPs
and the launcher reads them entry by entry. The whole game is packed, nothing
is filtered. The ZIPs are copied once into OPFS and the engine reads them
through the bridge of D-03. Nothing is uploaded: no cloud, no remote source,
and the game files never leave the player's machine.

* Decision: `web/scripts/make-game-zip.mjs` packs an install folder into the
  ZIPs the launcher loads. `ZHWP_GAME_DIR` is only the input of that script;
  it is no longer a way to import the game.
* Consequence: because Brave reports a quota of about 2 GB (#70), the game is
  split into two ZIPs, one per install (`zero-hour.zip` and `generals.zip`).
* Consequence: since 2026-10-18 the import keeps only the `.big` archives
  because the engine reads nothing else; this supersedes "nothing filtered".
* Consequence: the real-data tests read the ZIPs named by `ZHWP_GAME_ZIPS`,
  never a folder.
* Consequence: the ZIPs never live in the repository, its build output, CI or
  artifacts; they are built outside it.

Rejected: keeping the folder pick as a second import path (two paths to
maintain and test) and a remote or cloud source for the game files (the player
supplies their own copy and the files must not be uploaded).
