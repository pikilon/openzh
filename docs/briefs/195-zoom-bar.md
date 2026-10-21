# 195: Touch zoom bar on the right

Issue #195. Phase 1. Size s. Owner's request (chat, 2026-10-20): start the zoom
controls with a bar, before pinch.

## Goal

While the touch overlay is shown, a vertical zoom bar with tick marks on the
right edge of `#screen` zooms the camera in and out with one finger. The
joystick never covers it, and a touch on the bar never moves or scrolls the
map or the page.

## Read first

* `docs/specs/touch-controls.md`: sections 3, 4.2 and 4.5, the product
  contract this brief extends.
* `web/src/touch.ts`: the overlay show/hide, the map gesture state machine and
  `applyDock`, which clamps the movable joystick.
* `web/app/index.html`: `#screen`, `#touch-controls` and
  `#touch-joystick-dock`.
* `web/app/shell.css`: `.touch-controls`, `.touch-joystick-dock`,
  `.touch-joystick::before` (the 16 px landing ring) and `.touch-grip`.
* `web/src/main.ts`: where `createTouchControls` receives its elements.
* `web/tests/touch-controls.spec.ts`: test 4 (the joystick gap) and test 16
  (the movable joystick), which this brief must not break.
* `web/tests/harness/touch/records.js`: the fake engine that records the
  pointer, key and pan events.

## Contract

* **Element and placement.** `#touch-zoom` is a child of `#screen`, a sibling
  of `#touch-controls`, hidden unless the touch overlay is shown. Its visible
  rail is 30 CSS px wide, anchored to the right edge with the same 6 px safe
  area as the overlay, from 8 px below the top of `#screen` to 127 px above the
  overlay's bottom plus its safe area. At 812 x 375 it is inside `#screen` and
  at least 140 px tall. It never intersects `#touch-joystick`,
  `#touch-joystick-grip`, `#touch-joystick-dock`, or the joystick's 16 px
  landing ring.
* **Ticks and thumb.** Nine `.touch-zoom-tick` marks are spread down the rail,
  the middle one longer; `#touch-zoom-thumb` is a handle at the rail's centre.
  While dragging, the thumb follows the finger clamped inside the rail; on
  release it returns to the centre with a short transition.
* **Input.** Only `pointerType` "touch" and "pen" reach the bar, like the
  joystick. `pointerdown` captures the pointer and starts a drag; vertical
  movement up zooms in and down zooms out. 4 CSS px of travel is one retail
  wheel notch: the page synthesises one `WheelEvent` on `#canvas` with
  `deltaMode: 0` and `deltaY = -notches * 100` (negative is zoom in, the
  engine's existing wheel path). A tap without movement does not zoom. No
  engine change and no engine rebuild: the bar uses the wheel path only.
* **No mixing with scroll.** A touch on the bar produces no pointer event on
  `#canvas`, no `_GeneralsXPanCamera` call and no page scroll
  (`window.scrollY` stays 0). The bar is `touch-action: none`, cancels its
  pointer events and stops their propagation. The wheel event is the intended
  zoom command, not a scroll.
* **Joystick.** The dock's default right margin becomes 60 CSS px. While the
  bar is shown, `applyDock` clamps the dock so the joystick's landing ring
  stays at least 8 CSS px left of the bar; the joystick can still be moved
  left, down and up, but never onto the bar. Hiding the overlay resets the
  bar's drag and thumb.
* **Relative, not absolute.** The engine exposes no camera zoom value to the
  page, so the bar's displacement is a relative zoom delta; it does not claim
  to show the camera's absolute position. An absolute fader and pinch wait for
  later work.
* **Fullscreen and desktop.** The bar is inside `#screen`, so it survives
  fullscreen. With the overlay hidden (the desktop default) it is hidden and
  desktop input is unchanged.

## Acceptance criteria

1. With touch and the overlay shown at 812 x 375, `#touch-zoom` is visible
   inside `#screen`, at the right edge, at least 140 CSS px tall and 30 px wide.
2. Its rectangle does not intersect the joystick dock, the joystick, the grip
   or the joystick's 16 px landing ring.
3. The bar has nine visible tick marks and a thumb at its centre.
4. A drag up dispatches at least one `WheelEvent` on the canvas with a negative
   `deltaY`; the thumb moves up during the drag.
5. A drag down dispatches at least one `WheelEvent` on the canvas with a
   positive `deltaY`; the thumb moves down during the drag.
6. On release the thumb returns to the centre and the page stops dispatching
   wheel events.
7. A drag on the bar produces no pointer event on the canvas, no analog pan
   call, and no page scroll; the pointerdown is cancelled (`dispatchEvent`
   returns false).
8. Clicking the touch toggle hides the bar; showing the overlay again shows it
   with the thumb centred.
9. Moving the joystick as far right as possible keeps the joystick and its
   landing ring clear of the bar.
10. The existing touch tests (1-16) still pass; desktop is unchanged.

## Test paths

* `web/tests/zoom-bar.spec.ts` (new)
* `web/tests/harness/touch/records.js` (record wheel events)

## Allowed paths

* `web/app/index.html`
* `web/app/shell.css`
* `web/src/touch.ts`
* `web/src/main.ts`
* `web/tests/zoom-bar.spec.ts`
* `web/tests/harness/touch/records.js`
* `docs/specs/touch-controls.md`

## Check command

`cd web && npx playwright test tests/zoom-bar.spec.ts tests/touch-controls.spec.ts`

On HEAD the new tests fail: `#touch-zoom` does not exist and the fake engine
does not record wheel events.
