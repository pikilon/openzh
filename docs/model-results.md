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

Before D-05 the lead agent wrote all tests, so there are no test-writing rows yet.
