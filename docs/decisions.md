# Decisions

Each decision has an id that never changes. A later decision may supersede an
earlier one; it names the one it replaces. Never contradict a decision
silently: flag the conflict to the owner.

## D-01: Base: GeneralsX, plus the GPL browser engine work of wasm-generals

Date: 2026-10-16. Evidence: `docs/base-evaluation.md`.

* This repository is a fork of `fbraz3/GeneralsX`, imported with its full
  history (which includes TheSuperHackers' and EA's), so it can keep merging
  GeneralsX and TheSuperHackers upstream.
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
