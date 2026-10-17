# Plan

The project plan for phases 1 to 4 of `AGENTS.md`. Tasks live as GitHub
issues with a brief in `docs/briefs/` and a row in `docs/tasks.json`; this
file explains the order and what "done" means for each phase. Work follows
D-05 (`.agents/skills/tdd-pipeline/SKILL.md`); how an agent picks a task is in
`docs/briefs/README.md`.

Written 2026-10-17. Revisit after the first run on real game data (#33).

## Where we are

* Phase 0 is done (D-01): fork of GeneralsX with the WebGPU/Emscripten
  backend; `scripts/build-webgpu.sh` builds the engine.
* The engine starts in the browser and stops where game data is needed.
  The web wrapper imports the player's folder into OPFS, mounts it through
  the synchronous bridge (D-03), persists user data (IDBFS) and has a
  launcher page. Browser tests run in Brave only (D-04).
* Game data (#6) is available on the owner's machine through `ZHWP_GAME_DIR`.
  Blocked on the owner: native toolchain (#14). Public CI is
  deferred (#2).

## Phase 1: playable in the browser

Goal: skirmish against the AI and the campaign run in a desktop browser from
the player's own files.

| Milestone | Tasks | Needs |
| --- | --- | --- |
| 1a. Launcher ready for players | #28 canvas input, #29 error display, #30 feature check, #31 storage quota | nothing (synthetic data) |
| 1b. Tooling | #26 attempt verifier, #27 no-EA-assets guard, #32 static package | nothing |
| 1c. First real run | #33 main menu on real data, then one issue per failure | #6 |
| 1d. In-game | #34 replay renders, #35 audio, #36 frame-time baseline | #6, #33 |
| Exit | #7 (owner plays skirmish with numbered steps) | all above |

Order: #28 → #29 → #30 → #31 share the launcher files and run one after the
other; #26, #27 and #37/#40 (phase 2, independent) run in parallel with them.
#32 follows #27.

**Done (machine-checkable):**
1. `cd web && npm ci && npx playwright test` exits 0 from a clean checkout
   (Brave).
2. `ZHWP_GAME_DIR=<install> npx playwright test tests/real-data.spec.ts`
   exits 0 locally (main menu reached, no WebGPU failure lines).
3. The replay rendering test of #34 exits 0 locally.
4. `scripts/check-no-ea-assets.sh` exits 0 and `npm run package` exits 0.
5. The owner closes #7 after the numbered manual test (skirmish vs AI).

## Phase 2: oracle

Goal: replays played headless; the per-frame logic CRC of the browser build
is compared with a native build of the same commit and across browsers.

| Milestone | Tasks | Needs |
| --- | --- | --- |
| 2a. Browser harness | #37 URL arguments, #38 exit code, #39 replay file into user data, #42 replay runner | nothing (fake engines) |
| 2b. Comparison | #40 compare two CRC logs | nothing |
| 2c. Engine CRC output | #41 `-crclog` | #6 |
| 2d. Native reference | #43 native runner, #44 one-command oracle | #14, #6 |
| 2e. Data | #45 replay corpus, #46 cross-browser matrix | owner decisions |

Order: #37 → #38 → #39 → #42 (same files, in sequence); #40 in parallel.
#41 waits for #6; #43 and #44 wait for #14.

**Done (machine-checkable):**
1. For every replay of the agreed corpus (#45),
   `scripts/oracle/oracle.sh <replay>` prints `MATCH` (native vs Brave), or
   each divergence has an issue with its first diverging frame and an entry
   in `docs/porting-notes.md`.
2. The same replays give identical CRC logs in every browser of the matrix
   agreed in #46 (`compare-crc.mjs` exits 0 for each pair).
3. All phase 1 checks still pass.

## Phase 3: online multiplayer

Starts only when phase 2 is done (identical CRCs across browsers). All its
issues are blocked until then; briefs are written when it starts, after the
network decision D-06 (#47).

| Milestone | Tasks |
| --- | --- |
| 3a. Decision | #47 D-06: WebRTC lockstep, signalling/relay, hosting |
| 3b. Pieces | #48 signalling/relay server, #49 engine transport over data channels |
| 3c. Lobby | #50 lobby through the signalling server |
| 3d. Proof | #51 two or more headless clients, identical CRCs |

**Done (machine-checkable):** #51's test passes for the browser matrix of
#46: a scripted match between two or more headless clients through the real
network code ends with identical per-frame CRCs; a desync fails the test
and reports the first diverging frame.

## Phase 4: modifiable

Starts only after phase 3. Issues blocked until then.

| Milestone | Tasks |
| --- | --- |
| 4a. Freeze | #52 tag the last fidelity-only commit |
| 4b. Content | #53 override archives, #54 placeholder boxes |
| 4c. Guard | #55 replays and tests for new content |

**Done (machine-checkable):** the original-replay oracle still matches on the
tag's corpus for unchanged systems; a test mod replaces one asset through
#53; a missing model renders a placeholder (#54); new-content replays have
their own CRC baselines (#55).

## Dependencies outside the task list

* #6 game data (owner): available locally via `ZHWP_GAME_DIR` since 2026-10-17; it blocked #33–#36 and #41, and through them the phase 1
  and phase 2 exits.
* #14 native build (owner action on the toolchain): blocks #43, #44.
* #2 public CI (deferred): until it is picked up, every check runs locally
  from a clean checkout (`scripts/pipeline/verify-task.sh`, #26).

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Real data shows many engine failures | Phase 1 grows past the current tasks | #33 turns each failure into its own small issue; nothing else in phase 1 depends on guessing them |
| Fixed 2 GiB WASM heap is too small for real maps | Crashes in game | Measure in #33/#36; MEMORY64 is a separate, large task (see `cmake/webgpu.cmake`) |
| Single-threaded ASYNCIFY build is too slow | Unplayable frame rate | #36 measures first; pthreads would need D-03 revisited |
| Bridge speed on cold multi-GB archives | Slow loads | Bench exists (`npm run bench`); re-run with real archives in #33 |
| WASM and native CRCs differ | Phase 2 cannot prove fidelity | #44 reports the first diverging frame; GeneralsX determinism rules and its deep CRC dump help find it |
| Brave-only testing (D-04) vs. the cross-browser goals of phases 1–3 | Phase 2/3 "done" cannot be shown | Owner decision (#46, questions below) |
| Cheap models fail C++ engine tasks | Tasks stay blocked | Engine tasks are small and listed paths only; escalation per D-05 |
| Agents cannot build the engine in their sandbox | Engine tasks need the architect in the loop | The architect runs `scripts/build-webgpu.sh` and the check |

## Questions for the owner

1. Browsers: `AGENTS.md` says phase 1 is done in "current Chrome and
   Firefox", D-04 says Brave only, and phase 2/3 need several browsers.
   Which browsers count for each phase exit?
2. Replays for the oracle (#45): use your own games, GeneralsX's public
   replay repository, or both? They stay outside the repository either way.
3. The ten EA files from the GPL source release that the repository tracks
   (`.tga`, `.w3d`, `.wnd`, listed in #27): keep them allowlisted, or remove
   them from the browser build and packages too?
4. Static hosting for owner tests (#32): which host, if any, and may the
   package be uploaded there while the repository is private?
5. Campaign: is it part of the phase 1 exit (`AGENTS.md` goal 1 says yes,
   #7 says skirmish only)?
