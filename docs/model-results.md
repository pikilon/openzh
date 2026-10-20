# Model Results

One row per delegated attempt (D-05). The architect appends a row after
verifying each attempt. Used to decide which models do which work well.

| Date | Issue | Step | Model | Result | Time | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-17 | trial | code | mimo-v2.6-pro | ok | <1 min | `.big` index parser |
| 2026-10-17 | #3 | code | mimo-v2.6-pro | ok | 28 min | 3 API-drift compile fixes |
| 2026-10-17 | #4 | code | mimo-v2.6-pro | failed | 3 min | provider aborted; retried |
| 2026-10-17 | #4 | code | mimo-v2.6-pro | ok | 14 min | dev server + smoke page |
| 2026-10-17 | #5a | code | mimo-v2.6-pro | ok | 4 min | OPFS store + bridge |
| 2026-10-17 | #5b | code | mimo-v2.6-pro | failed | 30 min | time-out; root readdir empty, debug code left; lead fixed |
| 2026-10-17 | #5c | code | mimo-v2.6-pro | ok | 16 min | launcher page |
| 2026-10-17 | #13 | code | mimo-v2.6-pro | ok | 10 min | bridge watchdog |
| 2026-10-17 | #18 | code | local ornith-1.5-35b | ok | 2 min | one CSS rule |
| 2026-10-17 | #19 | code | mimo-v2.6-pro | ok | 6 min | IDBFS persistence; provider content_filter at the end; lead fixed double populate |
| 2026-10-17 | #26 | tests | deepseek-flash | ok | 4.6 min | new tests fail, only test paths (call 10) |
| 2026-10-17 | #27 | tests | deepseek-flash | ok | 1.5 min | new tests fail, only test paths (call 11) |
| 2026-10-17 | #28 | tests | deepseek-flash | ok | 2.4 min | new tests fail, only test paths (call 12) |
| 2026-10-17 | #37 | tests | deepseek-flash | ok | 1.4 min | new tests fail, only test paths (call 13) |
| 2026-10-17 | #40 | tests | deepseek-flash | ok | 1.6 min | new tests fail, only test paths (call 14) |
| 2026-10-17 | #26 | code | deepseek-flash | ok | 1.5 min | check passes from clean checkout, only allowed paths (call 15) |
| 2026-10-17 | #27 | code | deepseek-flash | ok | 0.8 min | check passes from clean checkout, only allowed paths (call 16) |
| 2026-10-17 | #28 | code | deepseek-flash | ok | 0.4 min | check passes from clean checkout, only allowed paths (call 17) |
| 2026-10-17 | #37 | code | deepseek-flash | ok | 0.4 min | check passes from clean checkout, only allowed paths (call 18) |
| 2026-10-17 | #40 | code | deepseek-flash | ok | 0.3 min | check passes from clean checkout, only allowed paths (call 19) |
| 2026-10-17 | #29 | tests | deepseek-flash | ok | 4.1 min | new tests fail, only test paths (call 20) |
| 2026-10-17 | #32 | tests | deepseek-flash | ok | 2.0 min | new tests fail, only test paths (call 21) |
| 2026-10-17 | #38 | tests | deepseek-flash | ok | 1.9 min | new tests fail, only test paths (call 22) |
| 2026-10-17 | #29 | code | deepseek-flash | ok | 1.3 min | check passes from clean checkout, only allowed paths (call 23) |
| 2026-10-17 | #32 | code | deepseek-flash | ok | 0.9 min | check passes from clean checkout, only allowed paths (call 24) |
| 2026-10-17 | #38 | code | deepseek-flash | ok | 1.3 min | check passes from clean checkout, only allowed paths (call 25) |
| 2026-10-17 | #30 | tests | deepseek-flash | ok | 3.7 min | new tests fail, only test paths (call 26) |
| 2026-10-17 | #30 | code | deepseek-flash | ok | 0.6 min | check passes from clean checkout, only allowed paths (call 27) |
| 2026-10-17 | #39 | tests | deepseek-flash | ok | 6.2 min | new tests fail, only test paths (call 28) |
| 2026-10-17 | #31 | tests | deepseek-flash | ok | 2.6 min | new tests fail, only test paths (call 29) |
| 2026-10-17 | #31 | code | deepseek-flash | ok | 0.8 min | check passes from clean checkout, only allowed paths (call 30) |
| 2026-10-17 | #39 | code | deepseek-flash | ok | 2.3 min | check passes from clean checkout, only allowed paths (call 31) |
| 2026-10-17 | #42 | tests | deepseek-flash | ok | 4.1 min | new tests fail, only test paths (call 32) |
| 2026-10-17 | #42 | code | deepseek-flash | ok | 1.8 min | check passes from clean checkout, only allowed paths (call 33) |
| 2026-10-17 | #70 | tests | deepseek-flash | ok | 2.5 min | new tests fail, only test paths (call 34) |
| 2026-10-17 | #70 | code | deepseek-flash | ok | 5.4 min | check passes from clean checkout, only allowed paths (call 35) |
| 2026-10-17 | #72 | tests | deepseek-flash | ok | 11.1 min | 11 new tests fail; flaky main tests seen (#74) (call 36) |
| 2026-10-17 | #72 | code | deepseek-flash | ok | 2.6 min | check passes twice from clean checkout (call 37) |
| 2026-10-17 | #77 | tests | deepseek-flash | ok | 4.5 min | 3 real-data tests fail on the old engine (call 38) |
| 2026-10-17 | #80 | tests | deepseek-flash | ok | 2.4 min | 4 new tests fail, only test paths (call 39) |
| 2026-10-17 | #77 | code | deepseek-flash | ok | 4.2 min | C++; compiled first try, real-data and synthetic checks pass (call 40) |
| 2026-10-17 | #80 | code | deepseek-flash | ok | 2.4 min | check passes from clean checkout (call 41) |
| 2026-10-17 | #78 | tests | deepseek-flash | ok | 1.6 min | real-data test fails on the old engine (call 42) |
| 2026-10-17 | #78 | code | deepseek-flash | ok | 0.5 min | C++; compiled first try, checks pass (call 43) |
| 2026-10-17 | #79 | tests | deepseek-flash | failed | 16.6 min | criterion 3 test passes before the code; branch failed/79-tests-deepseek-flash (call 44) |
| 2026-10-17 | #79 | tests | deepseek-flash (dsh, owner) | ok | – | revised brief; 2 new real-data tests fail on the old engine |
| 2026-10-17 | #79 | code | deepseek-flash (dsh, owner) | ok | – | C++/CMake; compiled first try; real-data and synthetic checks pass (one #74 flake, rerun) |

| 2026-10-17 | #91 | tests | deepseek-flash (dsh) | ok | ~8 min | first brief, criteria 1-6; superseded by the owner's decision |
| 2026-10-17 | #91 | tests | deepseek-flash (dsh) | ok | ~9 min | first brief, criteria 7-9, in parallel; superseded |
| 2026-10-17 | #91 | code | deepseek-flash (dsh) | ok | ~8 min | first contract; verified, not merged (contract revised) |
| 2026-10-17 | #91 | tests | deepseek-flash (dsh) | ok | ~23 min | revised brief (button, Play windowed); 10 tests fail, only test paths |
| 2026-10-17 | #91 | code | deepseek-flash (dsh) | ok | ~8 min | verified from a clean checkout, merged (#102) |
| 2026-10-17 | #97 | tests | deepseek-flash (dsh) | ok | ~18 min | guard criteria settled in the brief; 2/4 fail on the layout |
| 2026-10-17 | #97 | code | deepseek-flash (dsh) | ok | ~6 min | verified from a clean checkout, merged (#106) |

| 2026-10-17 | #103 | tests | deepseek-flash (dsh) | ok | ~15 min | 5 tests fail; the brief needed the dev server MIME fix |
| 2026-10-17 | #103 | code | deepseek-flash (dsh) | ok | ~13 min | suite + package green from a clean checkout, merged (#113) |
| 2026-10-17 | #99 | tests | deepseek-flash (dsh) | ok | ~15 min | 5 tests fail; criterion 5 is the brief's guard |
| 2026-10-17 | #99 | code | deepseek-flash (dsh) | blocked | ~9 min | web suite + TU syntax compile green; the engine build is denied by the sandbox (vcpkg lock); branch issue-99-code, not merged |
| 2026-10-18 | #99 | code | deepseek-flash (dsh) | ok | – | architect verified the same branch with the clean engine build: 147 tests pass, merged (#115) |
| 2026-10-18 | #34 | tests | deepseek-flash (dsh) | ok | ~2.5 min | 2 replay-URL tests fail as expected; real-data spec skips without env |
| 2026-10-18 | #34 | code | deepseek-flash (dsh) | ok | ~0.5 min | architect ran user-files (9) + real replay spec (4) in Brave with the owner's data: 13 pass |
| 2026-10-18 | #35 | tests | deepseek-flash (dsh) | ok | ~1.5 min | regression test only (nothing to implement); architect ran it with the real data: 5 pass |
| 2026-10-18 | #36 | tests | deepseek-flash (dsh) | ok | ~1.5 min | bench only; architect ran it with the real data: 3601 frames, p99 16.67 ms |
| 2026-10-18 | #74 | analysis+fix | sonnet (claude_agent, owner-authorised) | ok | ~10 min | root causes: clearAll() reset status after its await; harness read before the IDB load finished; 180/180 twice, full web suite 140 pass (call 50) |
| 2026-10-18 | #125 | tests | deepseek-flash (dsh) | ok | ~3 min | 9 tests; architect check: fail from clean worktree (call 51) |
| 2026-10-18 | #125 | code | deepseek-flash (dsh) | ok | ~0.5 min | 10 pass (call 52) |
| 2026-10-18 | #126 | tests | deepseek-flash (dsh) | ok | ~4.7 min | 12 tests plus zip builder helper (call 53) |
| 2026-10-18 | #126 | code | deepseek-flash (dsh) | ok | ~1.5 min | 22 pass (call 54) |
| 2026-10-18 | #127 | tests | deepseek-flash (dsh) | ok | ~7.8 min | 13 tests (call 55) |
| 2026-10-18 | #127 | code | deepseek-flash (dsh) | failed | ~5.5 min | BLOCKED: agent says test 7 cannot pass (filters progress by absolute performance.now()); 28 pass, 1 fail from a clean worktree; branch failed/127-code-deepseek-flash (call 57) |
| 2026-10-18 | #131 | tests | deepseek-flash (dsh) | ok | ~2.7 min | 9 tests (call 56) |
| 2026-10-18 | #131 | code | deepseek-flash (dsh) | ok | ~3.5 min | 21 pass (call 58) |
| 2026-10-18 | #127 | analysis+fix | sonnet (claude_agent, owner-authorised) | ok | ~0.7 min | the test was wrong (progress filtered by absolute performance.now()); flash's code kept; 29 pass twice (call 59) |
| 2026-10-18 | #128 | tests | deepseek-flash (dsh) | ok | ~19 min | 13 tests (call 60) |
| 2026-10-18 | #128 | code | deepseek-flash (dsh) | ok | ~3.8 min | 38 pass (call 62) |
| 2026-10-18 | #130 | tests | deepseek-flash (dsh) | ok | ~6 min | bench found the ZIP import at 4.5x the folder copy (call 61) |
| 2026-10-18 | #130 | code | deepseek-flash (dsh) | ok | ~29 min | stored 1.03x, deflated 1.60x of the folder copy (call 63) |
| 2026-10-18 | #129 | tests | deepseek-flash (dsh) | ok | ~6.8 min | found real bug: Stored counted empty files after a mid-import reload (call 64) |
| 2026-10-18 | #129 | code | deepseek-flash (dsh) | ok | ~9 min | 52 pass (call 65) |
| 2026-10-18 | #133 | tests | deepseek-flash (dsh) | ok | ~4.5 min | migrated 13 specs to ZIPs plus folder-removed spec; the brief's test paths missed launcher-zip.spec.ts (architect error, accepted) (call 66) |
| 2026-10-18 | #133 | code | deepseek-flash (dsh) | ok | ~2.4 min | folder pick and dev game-folder server removed; suite passes (call 67) |
| 2026-10-18 | #134 | tests | deepseek-flash (dsh) | ok | ~0.9 min | 3 tests (call 68) |
| 2026-10-18 | #134 | code | deepseek-flash (dsh) | ok | ~1.7 min | docs pass; reported check-no-ea-assets.sh failing on main since #39 (synthetic .rep tracked), outside scope (call 69) |
| 2026-10-18 | #149 | tests | deepseek-flash (dsh) | ok | ~4.9 min | 10 tests incl. an independent reference decoder and an ffmpeg cross-check (call 70) |
| 2026-10-18 | #149 | code | deepseek-flash (dsh) | ok | ~1 min | 10 pass (call 72) |
| 2026-10-18 | #150 | tests | deepseek-flash (dsh) | ok | ~2.5 min | 11 tests (call 71) |
| 2026-10-18 | #150 | code | deepseek-flash (dsh) | ok | ~1.3 min | 11 pass (call 73) |
| 2026-10-18 | #151 | tests | deepseek-flash (dsh) | ok | ~3.2 min | 11 tests (call 74) |
| 2026-10-18 | #151 | code | deepseek-flash (dsh) | ok | ~1.5 min | 19 pass; real game: 2.95 GB -> 1.86 GB, speech SNR avg 27 dB (call 75) |
| 2026-10-18 | #157 | tests | deepseek-flash (dsh) | ok | ~6 min | new spec plus updated accumulate-assuming asserts; launcher-storage 70.5 needed a follow-up run because the brief's test paths missed it (calls 76, 77) |
| 2026-10-18 | #157 | code | deepseek-flash (dsh) | ok | ~5.8 min | 62 pass, suite 245 pass; real game: full 2.79 GB -> lite 1.70 GB after replace (call 78) |

| 2026-10-18 | #159 | spec | deepseek-flash (dsh) | ok | ~11 min | the spec agent stalled; the architect completed docs/briefs/159-launcher-shell.md with 30 criteria and the T1/T2 + I1/I2 split |
| 2026-10-18 | #159 | tests T1 | deepseek-flash (dsh) | ok | ~8 min | 34 tests in the new shell/menu/style/overlay specs, all fail on the old page at #topbar; About and support tips included after the owner's addition |
| 2026-10-18 | #159 | tests T2 | deepseek-flash (dsh) | ok | ~7.2 min | 74 fail on the old page at body[data-state]; 7 guards pass; the migration keeps #157's replace-on-import expectations |
| 2026-10-18 | #159 | code engine | deepseek-flash (dsh) | ok | ~3 min | GeneralsXSetDebugOverlay; scripts/build-webgpu.sh exit 0, symbol present in GeneralsXZH.js |
| 2026-10-18 | #159 | tests T3 | deepseek-flash (dsh) | ok | ~6 min | 12 fail on the old page at #topbar/body[data-state], 16 real-data skipped without ZIPs, 11 guards pass; migrates zip-replace/zip-persistence/folder-removed/real-data |
| 2026-10-18 | #159 | code web | deepseek-flash (dsh) | ok | ~30 min | 281 pass, 16 skipped, package green; fixed the #screen overlay z-index and the FileBridge release before retry/clear; visual polish applied |
| 2026-10-19 | #162 | code | deepseek-flash (dsh) | ok | ~10 min | no new tests by owner decision; suite 245 pass; extras no longer stored (call 79) |
| 2026-10-19 | #164 | tests | deepseek-flash (dsh) | ok | ~5.4 min | 10 tests with a reference RLE decoder and an ffmpeg cross-check (call 80) |
| 2026-10-19 | #164 | code | deepseek-flash (dsh) | ok | ~1.3 min | 10 pass; real game: 601 tga encodable, 115 MB saved, main menu screenshot byte-identical (call 82) |
| 2026-10-19 | #166 | tests | deepseek-flash (dsh) | ok | ~4.8 min | 10 tests (call 81) |
| 2026-10-19 | #166 | code | deepseek-flash (dsh) | ok | ~0.8 min | 10 pass; real game: 55 mp3 at 128 kbps, 65 MB saved (call 83) |
| 2026-10-19 | #167 | tests | deepseek-flash (dsh) | ok | ~4.6 min | 10 criteria (call 84) |
| 2026-10-19 | #167 | code | deepseek-flash (dsh) | ok | ~2.2 min | 29 pass (call 85) |
| 2026-10-19 | #175 | tests | deepseek-flash (dsh) | ok | ~1.9 min | bug found on the real game: PatchZH.big has a zero-size entry at offset 0 (call 86) |
| 2026-10-19 | #175 | code | deepseek-flash (dsh) | ok | ~0.5 min | 37 pass; all 32 real archives now read (call 87) |

| 2026-10-19 | #173 | spec | deepseek-flash (dsh) | ok | brief only | docs/briefs/173-web-1080p-max-graphics.md: web-only 1920x1080, VeryHigh, 4x MSAA, 16x anisotropy, terrain max, dynamic LOD off, log line and real-data canvas check |
| 2026-10-19 | #173 | tests | deepseek-flash (dsh) | ok | ~8 min | 3 pass, 1 skipped; synthetic log test failed on the old build (no GENERALSX_GRAPHICS), passes with the new engine; real-data canvas spec skips without ZIPs |
| 2026-10-19 | #173 | code | deepseek-flash (dsh) | ok | ~3 min | build exit 0; 304 pass, 17 skipped; log line `GENERALSX_GRAPHICS xres=1920 yres=1080 lod=VeryHigh aa=4 filter=4 anisotropy=16 dynamicLOD=0` observed |
| 2026-10-19 | #180 | tests | deepseek-flash (dsh) | ok | ~4.7 min | wav-mp3 lib and --voices-mp3 option; includes a compile-and-decode check with the engine's own miniaudio (call 88) |
| 2026-10-19 | #180 | code | deepseek-flash (dsh) | ok | ~1.9 min | 41 pass; real game: 8579 wav to 48 kbps MP3, 700 MB saved vs the originals; lite-mp3 1.48 GB; engine real-data specs pass (call 89) |

Before D-05 the lead agent wrote all tests, so there are no test-writing rows yet.

| 2026-10-19 | #186 | tests+code | deepseek-flash (dsh) | ok | ~4 min | new tests 7-8 fail on HEAD, test 9 passes; 9/9 after refreshing the focus flag at engine start and on first interaction |
| 2026-10-19 | #188 | tests+code | deepseek-flash (dsh) | ok | ~25 min | 5 PWA tests plus the package contract pass; first run caught icon-512 at 1024 px, fixed to 512 |
| 2026-10-19 | #191 | tests+code | deepseek-flash (dsh) | ok | ~6 min | 7 About tests and the #159 menu tests pass; no trademark in the new text |
| 2026-10-19 | #192 | tests+code | deepseek-flash (dsh) | ok | ~8 min | 7 donation tests and the updated top-bar contract pass; menu support row unchanged |
| 2026-10-19 | #189 | tests+code | deepseek-flash (dsh) | ok | ~5 min | seeded IDBFS saves keep bytes and timestamps through two install replacements and clearStored |
| 2026-10-19 | #190 | tests+code | deepseek-flash (dsh) | ok | ~10 min | 3 zip-writer tests and the menu download pass; exported ZIP round-trips through openZip |
| 2026-10-19 | #187 | tests+code | deepseek-flash (dsh) | ok | ~35 min | 15 touch tests pass in Brave; engine build exit 0 with GeneralsXPanCamera present in GeneralsXZH.js; full synthetic suite 377 pass, 18 skipped |

| 2026-10-19 | #187/#188/#189/#190/#191/#192 | verify | deepseek-flash (dsh) | ok | ~3 min | full synthetic suite 377 pass, 18 skipped; real data lite-mp3: main menu, WebGPU (#184 attachments), audio, fonts, textures and 1080p resolution pass; main menu screenshot drawn, no black canvas |

| 2026-10-19 | #186-#192 | publish+verify | deepseek-flash (dsh) | ok | ~3 min | gh-pages 108173de2 includes the save-path fix; live https://openzh.pikilon.com/ is cross-origin isolated, imports the lite-mp3 ZIPs, reaches the main menu with no WebGPU/sample-mismatch/InvalidCommandBuffer lines, no page errors, manifest and #donate present |

| 2026-10-20 | #194 | tests+code | deepseek-flash (dsh) | ok | ~20 min | 3 new tests fail on HEAD (70 % size, game menu in the column, fullscreen exit); 19 pass after moving #game-menu, scaling the column and wiring the exit; 52 affected tests pass |
