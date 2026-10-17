# 99: Mute the game when the page is not focused

Issue #99. Phase 1. Size s. Owner's request (2026-10-17): when the game tab is
out of focus the game audio must be muted, and it must come back when the page
is focused again.

Today nothing in the page mutes the engine. The export
`GeneralsXSetAudioMuted(Int muted)` exists
(`GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp:253`) but no file
under `web/` calls it, and its body is wrong: it calls
`TheAudio->setVolume(muted ? 0 : 1, AudioAffect_All)`, which writes the scripting
volumes (`m_script*Volume` in `AudioManager::setVolume`), so unmuting with 1.0
would overwrite volumes the game's scripts had set.

The engine already has the right mechanism:
`AudioManager::muteAudio(AudioManager::MuteAudioReason_WindowFocus)` saves the
four system volumes and silences them, and `unmuteAudio` restores the saved
values (`Core/GameEngine/Source/Common/Audio/GameAudio.cpp:1094-1140`); the
native Windows entry point uses it on window activation
(`GeneralsMD/Code/Main/WinMain.cpp:494/499`). The browser build goes through
`SDL3Main.cpp`, so that path never runs and the page has to drive it.

## Goal
While the page is hidden or has lost focus the game is silent; when it is
visible and focused again the previous volumes are restored, including the
player's Options values.

## Read first
* `web/src/main.ts`: `playNow()` (the module import and the factory result),
  `reportError`, and the existing event listeners.
* `GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp`: the export at
  line 253 and the `EMSCRIPTEN_KEEPALIVE` exports around it.
* `Core/GameEngine/Source/Common/Audio/GameAudio.cpp` (`muteAudio`/`unmuteAudio`)
  and `Core/GameEngine/Include/Common/GameAudio.h` (the reason enum).
* `GeneralsMD/Code/Main/WinMain.cpp:488-500`: the native focus handling.
* `web/tests/launcher-fullscreen.spec.ts` and
  `web/tests/harness/canvas/fit.js`: the fake-engine flow and shape.

## Contract
* `GeneralsXSetAudioMuted(1)` mutes through
  `TheAudio->muteAudio(AudioManager::MuteAudioReason_WindowFocus)`;
  `GeneralsXSetAudioMuted(0)` unmutes through `unmuteAudio` with the same
  reason. The export no longer writes the scripting or system volumes directly.
  It returns false when `TheAudio` is null and true otherwise, and repeated
  calls in the same state are harmless (the reason bits handle it).
* The page keeps a focus flag from `window` `blur`/`focus` (seeded with
  `document.hasFocus()`) and reads `document.visibilityState`. It tells the
  engine to mute when the document is hidden **or** the window lost focus, and
  to unmute only when the document is visible **and** the window has focus;
  visibility wins over focus.
* The page re-applies the current state when the engine module becomes
  available (Play may be pressed from a hidden or unfocused page), and on every
  later change.
* A module without `_GeneralsXSetAudioMuted` is ignored: no error, no rejected
  promise, the game keeps playing.
* No new audio backend and no Web Audio in the page (#35 is separate).
* Every existing contract keeps holding: the launcher, #80's windowed fit,
  #91's fullscreen button and #28's focus/context menu.

## Acceptance criteria
Using a fake engine that exposes `window.__muteCalls` and
`_GeneralsXSetAudioMuted(muted)` (returning 1):
1. After Play, a `blur` on the window makes the engine receive 1.
2. After that, `focus` makes it receive 0.
3. With `document.visibilityState` stubbed to `"hidden"`, a `visibilitychange` makes the engine receive 1; stubbed back to `"visible"` with the window focused, it receives 0.
4. With the page hidden before Play (stubbed before the first `goto`), the first value the engine receives once it is ready is 1.
5. With a fake engine that does not export `_GeneralsXSetAudioMuted`, Play, `blur` and `focus` leave `#canvas` visible with no `#engine-error` and no page error.
6. A visible but unfocused page is muted (1), and a `focus` while the document is stubbed hidden keeps it muted (the last call stays 1).

## Test paths
* `web/tests/launcher-mute.spec.ts`: criteria 1-6.
* `web/tests/harness/mute/`: the fakes (one with the export, one without).

## Allowed paths
* `web/src/main.ts`
* `GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp`

## Check command
`scripts/build-webgpu.sh && cd web && npm ci && npx playwright test`

The synthetic tests pin the page wiring; the engine export change is exercised
by the build and by the owner's ears, since there is no machine-readable audio
signal yet (#35). The implementer runs `cd web && npm ci && npx playwright test`;
the architect runs the Emscripten build.

## Out of scope
The audio backend itself (#35), pausing the game on focus loss, and the native
Windows path, which already mutes.
