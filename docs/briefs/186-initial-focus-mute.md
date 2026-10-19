# 186: The first engine start unmutes when the window is focused

Issue #186. Phase 1. Size s. Owner's report (2026-10-19): on the first load the
game can start muted although the page is visible and focused. #99 made the
page mute the engine when the document is hidden or the window lost focus.

## Cause

`windowFocused` is seeded once, when the module is evaluated, with
`document.hasFocus()`. A navigation started from the address bar can leave that
call false for a moment, and the window `focus` event that follows can fire
before `wireAudio()` attaches its listener. The flag then stays false for the
whole session, so `applyMute()` sends `1` as soon as the engine exists. A tap or
click on the page does not recover it either, because only `blur` and `focus`
events update the flag.

## Goal

A visible, focused page that missed the startup `focus` event is audible as soon
as the engine is ready. A page that is really hidden or unfocused stays muted,
and every #99 contract still holds.

## Read first

* `web/src/main.ts`: `windowFocused`, `audibleMuted()`, `applyMute()`,
  `startEngine()` after the factory resolves, `wireAudio()`.
* `web/tests/launcher-mute.spec.ts`: the recording fake and the six #99
  criteria.
* `web/tests/harness/mute/records.js`.

## Contract

* At the moment the page applies the mute state after a successful engine
  start, it refreshes the focus flag from `document.hasFocus()`; a true result
  sets the flag true. This is the one place where the live query is allowed to
  override the event-tracked flag.
* A `pointerdown` or `keydown` on the window that arrives while the page is
  actually focused also refreshes the flag and re-applies the mute state, so a
  later missed `focus` event recovers on the first interaction.
* Nothing else changes: `blur` sets the flag false immediately, `focus` sets it
  true, visibility wins over focus, the user's own mute wins over both, and a
  module without `_GeneralsXSetAudioMuted` is ignored.

## Acceptance criteria

1. With `document.hasFocus()` returning false before the load and true when the
   automatic engine start runs, the last mute value the engine receives is `0`.
2. With `document.hasFocus()` returning false throughout and the document
   visible, the engine receives `1` and no later `0`.
3. With the page hidden and `document.hasFocus()` true, the engine still
   receives `1` (visibility wins).
4. #99 criteria 1-6 keep passing unchanged.

## Test paths

* `web/tests/launcher-mute.spec.ts`: criteria 1-3, appended as tests 7-9.
* `web/tests/harness/mute/records.js`: unchanged.

## Allowed paths

* `web/src/main.ts`
* `web/tests/launcher-mute.spec.ts`

## Check command

`cd web && npx playwright test tests/launcher-mute.spec.ts`

The tests fail on HEAD: test 7 ends with `1` because the flag was seeded false
and no focus event ever reaches the page.
