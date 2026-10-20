# 194: Touch column at 70 %, with the game menu and the fullscreen exit

Issue #194. Phase 1. Size s. Owner's review of #187 (chat, 2026-10-20):
the vertical touch buttons on the left shrink to 70 % of their size; the
pause/menu button moves from the top bar into that column; in fullscreen an
exit-fullscreen button appears in the same column.

## Read first

* `docs/specs/touch-controls.md`: sections 4.1, 4.2 and 7, the product contract
  this brief refines.
* `web/app/index.html`: `#topbar` (`#game-menu`, `#fullscreen`) and
  `#touch-controls` (the three latches).
* `web/app/shell.css`: `.touch-controls`, `.touch-locks`, `.touch-lock`, the
  `.icon-btn` base, and the `max-width: 420px` override.
* `web/src/touch.ts`: the overlay show/hide and latch contract.
* `web/src/main.ts`: `#game-menu` (`openGameMenu`), `#fullscreen`,
  `updateFullscreenButton`, `onFullscreenChange`.
* `web/tests/touch-controls.spec.ts`: the existing touch contract, especially
  tests 2, 3, 4 and 15.
* `web/tests/launcher-topbar-game.spec.ts`: the current top-bar game-menu test.
* `web/tests/harness/touch/records.js`: the fake engine that records Escape and
  pointer events.

## Contract

* `#game-menu` moves out of `#topbar` and becomes the first control of the
  vertical touch column. It keeps its id, its SVG icon, its `aria-label`
  "Game menu" and its behaviour: a click sends one Escape `keydown` and one
  Escape `keyup` to the canvas, which the engine receives. While the touch
  overlay is hidden it is not reachable; Esc still opens the menu on desktop.
* The column (`#touch-controls`) is top to bottom: `#game-menu`,
  `#touch-left`, `#touch-right`, `#touch-multi`, `#touch-fullscreen-exit`.
  All five share the same button style and a label under the icon.
* Every column button is rendered at 70 % of its current 56 x 54 CSS px size:
  39.2 x 37.8 CSS px at the 812 x 375 touch viewport, gaps and icons included
  in the scale. The 56 x 54 base and its `max-width: 420px` variant (52 x 52)
  stay the design source; the shrink is applied uniformly.
* `#touch-fullscreen-exit` is hidden while `#screen` is not the fullscreen
  element. When `#screen` enters fullscreen it appears as the last column
  control; clicking it leaves fullscreen (it does not send Escape or a pointer
  event to the map) and it hides again when the browser reports the exit.
  Entering fullscreen stays on the top-bar `#fullscreen` button.
* The overlay toggle keeps its contract: hiding `#touch-controls` hides every
  column control, including the game menu and the fullscreen exit; showing it
  does not change the locks.
* Desktop behaviour is unchanged except for the moved game menu: the overlay
  still starts hidden without touch, mouse input is untouched, and the
  existing `#187` tests keep passing.

## Acceptance criteria

17. Every visible column control renders at 39.2 x 37.8 CSS px on the 812 x 375
    touch viewport, top to bottom in the order game menu, Left, Right, Multi
    (and exit fullscreen when fullscreen).
18. `#game-menu` is not inside `#topbar`; it is inside `#touch-controls` and a
    click while the overlay is shown sends Escape down and up to the engine.
19. `#touch-fullscreen-exit` is hidden windowed, appears as the last column
    control in fullscreen, and clicking it leaves fullscreen and hides it.
20. Hiding the overlay hides `#game-menu` and `#touch-fullscreen-exit` with the
    rest of the column, and the existing touch and desktop tests 1-16 pass.

## Test paths

* `web/tests/touch-controls.spec.ts`
* `web/tests/launcher-topbar-game.spec.ts`

## Allowed paths

* `web/app/index.html`
* `web/app/shell.css`
* `web/src/main.ts`
* `docs/specs/touch-controls.md`

## Check command

`cd web && npx playwright test tests/touch-controls.spec.ts tests/launcher-topbar-game.spec.ts`

On HEAD the tests for criteria 17-19 fail: the column controls are 56 x 54,
`#game-menu` is still in the top bar, and `#touch-fullscreen-exit` does not
exist.
