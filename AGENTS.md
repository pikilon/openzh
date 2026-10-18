# AGENTS.md

Browser port of the C&C Generals / Zero Hour engine, built from the source code
EA released under GPL-3.0. The owner does not write code: agents implement, the
owner reviews quality hands-on. This is a separate project from Modern
Conquest: Red Line (`pikilon/red-line`); nothing is shared between the two
repositories.

## Goal, in Order

1. **A port that works.** The original game runs in a desktop browser from the
   player's own game files: menus, skirmish against the AI and the campaign.
2. **A port that is proven.** A replay-based oracle measures fidelity and
   catches regressions without a human playing.
3. **Online multiplayer that works.** A separate stage after the port is
   finished and measured, and before anything is added.
4. **A port that can be modified.** Only after 1 to 3: new armies, new
   graphics, updated rendering, mods.

Never trade an earlier step for a later one. Features wait until the port is
playable, measured and playable online.

## First Session: Read This Before Anything Else

The repository starts empty except for this file. Before writing any port code:

1. Evaluate the existing bases and record what each one actually does today
   (builds? starts? playable?), measured rather than taken from READMEs:
   * `origami-ltd/wasm-generals`: an existing WebAssembly + WebGPU browser port
     of Zero Hour. This is the first candidate base.
   * `fbraz3/GeneralsX`: native Linux/macOS/Windows port (SDL3, OpenAL,
     DXVK/Vulkan), forked from TheSuperHackers.
   * `TheSuperHackers/GeneralsGameCode`: the main community base over EA's
     release.
   * `electronicarts/CnC_Generals_Zero_Hour`: EA's original release.
2. Read each candidate's `LICENSE`, `CONTRIBUTING.md`, `AI_POLICY.md` and
   `AGENTS.md` (where present). Any rule about AI-generated contributions
   applies to everything this project sends upstream.
3. Recommend a base in chat (fork it, contribute to it, or start from another
   one, with the reasons) and wait for the owner's decision.
4. Write the decision as D-01 in `docs/decisions.md`, then open GitHub issues
   for the next phase.

## Technical Direction

* One codebase for every platform, web included: the original C++ compiled
  natively and with Emscripten to WASM. No game engine (Godot, Unity, Unreal)
  rewrite.
* Window, input and audio through SDL3 (which already targets the browser).
  Graphics through one WebGPU backend (Dawn or wgpu-native natively, the
  browser's WebGPU on the web) behind `DX8Wrapper`. DXVK does not run in the
  browser, so it is not the long-term renderer.
* A thin TypeScript wrapper handles what exists only in the browser: importing
  the player's game files, OPFS/IndexedDB storage, networking and the launcher
  page.

## Phases

* **Phase 0: Base.** Evaluation above; fork the chosen base into this repository
  keeping its history and license.
* **Phase 1: Playable in the browser.** The player selects their game install
  folder (the `.big` archives); files are stored in OPFS/IndexedDB and never
  uploaded. Rendering through WebGPU (WebGL2 fallback only if needed) behind the
  engine's existing `DX8Wrapper` layer. Threads need `SharedArrayBuffer`, so
  hosting must send COOP/COEP headers. Done when skirmish vs. AI is playable in
  current Chrome and Firefox.
* **Phase 2: Oracle.** Replays (`.rep`) played headless, comparing the
  engine's per-frame CRC of the WASM build across browsers and operating
  systems. WASM float semantics are deterministic, so every browser should
  produce identical CRCs. Prove or refute this with data: it is the path to
  cross-platform multiplayer, which native ports currently break. The native
  reference moved to phase 3 (D-09).
* **Phase 3: Online multiplayer (a goal, not an experiment).** Not part of
  phases 0 to 2: it starts only when the single-player port is done and
  phase 2 shows matching CRCs across browsers. It opens with the native
  reference (D-09): a native build of the same commit, to find where the WASM
  build diverges, because otherwise a desync and a network bug look the same.
  Then lockstep over WebRTC, with a small relay/signalling server because
  browsers cannot open raw UDP.
  Verified automatically: two or more headless clients play a scripted match
  through the real network code and must finish with identical per-frame
  CRCs, across a matrix of browsers and operating systems. A desync fails the
  test and reports the first diverging frame. Play with native clients
  (GeneralsX) is a later, separate goal: it needs both builds to produce
  identical CRCs.
* **Phase 4: Modifiable.** Tag the last fidelity-only commit. From then on the
  original-replay oracle guards unchanged systems only; new content gets its
  own replays and tests. Content overrides use the engine's `.big` load
  priority, so new assets replace originals one at a time. Missing models
  render as team-coloured placeholder boxes.

## Upstream

This fork is independent: it sends no pull requests and no comments to
GeneralsX, TheSuperHackers or `wasm-generals` (D-08). Their AI policies put the
whole contribution on the human submitter, who must explain every line in
review, and the owner does not write or defend the code. Fixes and port work
stay in this repository. If that changes, it is a new decision.

## Legal Limits (Non-Negotiable)

* Code: GPL-3.0, inherited from EA's release and the chosen base. All changes
  are published under it.
* **No EA assets in the repository, its releases, CI caches or artifacts.** The
  player always supplies their own copy (Steam, EA App, The First Decade or
  retail discs).
* Tests that need original game data run locally or on a private runner,
  never in a public CI log, cache or artifact. Public CI uses only builds and
  synthetic test data.
* Do not use EA trademarks ("Command & Conquer", "Generals", "Zero Hour", logos)
  in the UI or branding. "Compatible with C&C Generals game data" in
  descriptions is fine. The trademark question was raised before the repository
  went public and is decided in D-07: the project is called **OpenZH**, and the
  marks appear only in descriptive sentences, never in the name, the logo, the
  domain or the page title.

## Local Game Data

The owner's machine has a legitimate copy of the game (Generals 1.0 and Zero
Hour 1.04) outside the repository. Tests and manual checks that need it read
the folder from `ZHWP_GAME_DIR` (set in the owner's shell; the exact path is in
the gitignored `CLAUDE.local.md`). If the variable is set and the folder
exists, use it: you do not need to ask the owner to install anything. Never
copy it into the repository, build output, CI or artifacts.

## Way of Working

* Everything in the repository and on GitHub is English. Chat with the owner
  in Spanish, quoting identifiers and paths unchanged.
* Work comes from GitHub issues, one at a time. State lives in the repository
  and GitHub, never only in a chat.
* Decisions live in `docs/decisions.md` (D-01, D-02...). Never contradict one;
  flag conflicts instead.
* Every task needs a check a machine can decide (a build, a test, a replay
  CRC, a screenshot diff with tolerance). Write the check first, see it fail,
  then implement. Verification never trusts the build the agent produced: it
  rebuilds from a clean checkout.
* Keep `docs/porting-notes.md`: every recurring class of bug (float
  precision, endianness, pointer size, timing, file paths, threading) gets an
  entry with its cause and fix before its issue is closed.
* Follow the chosen base's code style, formatter and build system; do not
  reformat upstream code.
* Done means tested and CI green. The owner does all manual testing: when a
  player-facing change merges, label its issue `needs-owner-test` and comment
  numbered steps, each with the expected result and a URL.
* AI providers: local models may be used freely. A paid remote AI API needs the
  owner's confirmation, with a spending cap, for each working session. Code,
  tests, CI and the game never call one.
* Work follows the test-driven pipeline of D-05: the architect (strongest
  model) writes specs only; DeepSeek V4.1 Flash (official DeepSeek API, the
  owner's DeepSeek credits, never OpenRouter) writes the tests and, in a
  separate run, the code. A failed step blocks the task; escalating it to
  mimo-v2.6-pro or Sonnet needs the owner's authorisation, in a later pass.
  Delegated agents return results only, never implementation context. Procedure: `.agents/skills/tdd-pipeline/SKILL.md`; the free local
  runner is in `.agents/skills/local-delegation/SKILL.md`.
* Rules live in this file, in `AGENTS.md` files under subdirectories, in
  `.agents/skills/<name>/SKILL.md` and in `.agents/agents/<name>/agent.md`, all
  plain Markdown any harness can read. Never create `CLAUDE.md`, `GEMINI.md`,
  `.claude/`, `.cursor/` or other agent-specific rule files.
* Files inherited from GeneralsX (`.github/copilot-instructions.md`,
  `.github/instructions/`, and its `AGENTS.md` kept as
  `docs/upstream/GeneralsX-AGENTS.md`) describe upstream conventions. Follow
  them for code style, annotations and determinism; where they contradict this
  file (worklog, commit trailers, platforms, CI), this file wins. They stay in
  place so upstream merges stay simple.

## Open Questions for the Owner

* Which browsers and devices count as supported in phase 1 (desktop only, or
  also mobile).
* Where the relay/signalling server is hosted, and who pays for it.
