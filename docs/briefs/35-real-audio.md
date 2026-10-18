# 35: Audio in the browser with real data

Issue #35. Phase 1. Size m. Depends on #33 (done).

## Goal
The first real run showed that audio already works: after the Play click
(the user gesture) the engine's audio backend (MiniAudio over Web Audio)
creates an `AudioContext` that is `running` at 48 kHz and whose clock
advances, and the engine logs `AUDIO_REQ <file> ok` for the sounds it plays.
No product change is needed; this task adds the local-only regression test
that keeps it true. (It is the one D-05 exception where the new tests pass
on the current code, because there is nothing to implement.)

## Read first
* `web/tests/real-data.spec.ts` (the import-and-Play flow, local-only skip)
* `web/tests/real-data-webgpu.spec.ts` (how a run is shared by several tests)

## Contract
New local-only test `web/tests/real-data-audio.spec.ts`, skipped unless
`ZHWP_GAME_DIR` exists. It:
1. adds an init script (`page.addInitScript`) that wraps `window.AudioContext`
   so every context the page creates is pushed to `window.__zhwpAudioContexts`
   (the wrapper returns the real context, nothing else changes);
2. imports the game folder in the launcher as `real-data.spec.ts` does, waits
   for Ready, and clicks `#play`;
3. waits for `GENERALSX_LOAD_DONE` in `__zhwpLog`, then 5 s, reads the
   contexts' `state` and `currentTime`, waits 5 s more and reads
   `currentTime` again.

## Acceptance criteria
1. Before `#play` is clicked no `AudioContext` exists.
2. After the engine finished loading, at least one `AudioContext` has state `running`.
3. The `currentTime` of that running context grows by at least 4 seconds during the 5 s wait.
4. `__zhwpLog` contains at least one line matching `/^AUDIO_REQ .* ok$/`.
5. `__zhwpLog` contains no line matching `/GENERALSX_WEBGPU_\w+_FAILED|RuntimeError|Aborted\(/`.

## Test paths
* `web/tests/real-data-audio.spec.ts`

## Allowed paths
None (tests only).

## Check command
`cd web && npx playwright test tests/real-data-audio.spec.ts` (the architect runs it with `ZHWP_GAME_DIR`)
