# 197: The fullscreen toggle in the touch column

Issue #197. Phase 1. Size s. Owner's follow-up to #194 (chat, 2026-10-20):
in touch play the fullscreen button moves into the left touch column as well.
The column gets one control that enters fullscreen while windowed and exits it
in fullscreen; the top-bar `#fullscreen` hides while the touch overlay is shown.
Desktop keeps the top-bar button.

## Read first

* `docs/specs/touch-controls.md`: sections 4.2, 4.6 and 7, the product contract
  this brief refines.
* `web/app/index.html`: the top-bar `#fullscreen` and the last control of
  `.touch-column` (`#touch-fullscreen-exit` at the base commit).
* `web/app/shell.css`: `.touch-column`, `.touch-button`, and `#fullscreen`.
* `web/src/main.ts`: `enterFullscreen`, `leaveFullscreen`,
  `updateFullscreenButton`, `onFullscreenChange`, `wireFullscreen`.
* `web/src/touch.ts`: `showOverlay` and the overlay's initial hidden state.
* `web/tests/touch-controls.spec.ts`: tests 3, 4, 19 and the touch layout.
* `web/tests/launcher-topbar-game.spec.ts`: the touch top-bar contract.
* `web/tests/harness/touch/records.js`: the fake engine.

## Contract

* `#touch-fullscreen-exit` becomes `#touch-fullscreen`, the last control of the
  touch column, visible whenever the overlay is visible (not only in
  fullscreen). It keeps the four-corner icon and the other column buttons'
  70 % size and style.
* Windowed, `#touch-fullscreen` reads "Enter fullscreen" in `aria-label` and
  `title`, shows the label "Full" and `aria-pressed="false"`; a click enters
  fullscreen. While `#screen` is the fullscreen element it reads "Exit
  fullscreen", shows "Exit", `aria-pressed="true"`, and a click leaves
  fullscreen. The labels switch on `fullscreenchange`, including a browser Esc.
* While the touch overlay is shown, the top-bar `#fullscreen` is not displayed:
  in touch play the column is the fullscreen control. When the overlay is
  hidden again (the touch toggle), the top-bar button is displayed again. A
  desktop session, whose overlay starts hidden, keeps the top-bar button at all
  times and the existing fullscreen tests keep passing.
* Hiding the overlay hides `#touch-fullscreen` with the rest of the column.
* `#topbar` keeps only the touch toggle, Multiplayer, donate, the (now
  conditional) fullscreen button, mute and the menu.

## Acceptance criteria

21. The column is top to bottom game menu, Left, Right, Multi, fullscreen; all
    five buttons are 39.2 x 37.8 CSS px on the 812 x 375 touch viewport.
22. `#touch-fullscreen` is visible windowed with "Enter fullscreen"; clicking
    it enters fullscreen, changes its labels to "Exit fullscreen" / "Exit",
    and clicking it there leaves fullscreen and restores the windowed labels.
23. While the overlay is shown the top bar's `#fullscreen` is hidden, and it is
    visible again after the touch toggle hides the overlay; on a desktop
    context the top-bar button stays visible and `#touch-fullscreen` is hidden
    with the overlay.
24. Hiding the overlay hides `#touch-fullscreen`, and the existing touch,
    top-bar and fullscreen tests pass unchanged in behaviour.

## Test paths

* `web/tests/touch-controls.spec.ts`
* `web/tests/launcher-topbar-game.spec.ts`

## Allowed paths

* `web/app/index.html`
* `web/app/shell.css`
* `web/src/main.ts`
* `web/src/touch.ts`
* `docs/specs/touch-controls.md`

## Check command

`cd web && npx playwright test tests/touch-controls.spec.ts tests/launcher-topbar-game.spec.ts tests/launcher-fullscreen.spec.ts tests/launcher-fullscreen-fallbacks.spec.ts`

On HEAD the tests for criteria 21-23 fail: the column's last control is
`#touch-fullscreen-exit` (hidden windowed), there is no enter action in the
column, and the top-bar `#fullscreen` is still shown with the overlay.
