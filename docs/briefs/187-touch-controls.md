# 187: Touch controls

Issue #187. Phase 1. Size m. Owner's request (2026-10-19): implement
`docs/specs/touch-controls.md`. The spec is the product contract; this brief
fixes the choices the spec left open (section 8).

## Choices the spec left open

* **Multi lock modifier: Shift.** The engine's selection code reads
  `TheKeyboard->isShift()`/`isCtrl()` when the left button goes up
  (`SelectionXlat.cpp`); Shift and Ctrl are equivalent there. The page holds a
  synthetic Shift key down around the click, which also works for the right
  click. Ctrl is not used because the browser keeps it for shortcuts.
* **Camera pan: a new engine export.** The arrow-key path only has on/off
  directions and cannot express half a push. `GeneralsXPanCamera(float x,
  float y)` applies the same per-frame offset the keyboard scroll uses
  (`LookAtXlat.cpp`: `SCROLL_AMT = 100 * 2`, the horizontal/vertical speed
  factors, the frame-rate ratio and the keyboard scroll factor) scaled by the
  joystick vector in [-1, 1], through `TheTacticalView->userScrollBy()`. The
  engine needs no other change.
* **Input injection: synthetic `PointerEvent`s with `pointerType: "mouse"`.**
  The SDL3 Emscripten backend listens to `pointerdown`/`pointermove`/
  `pointerup` on the canvas and ignores `MouseEvent`, so the page dispatches
  pointer events the SDL backend already translates. The page captures the raw
  touch pointer on the canvas in the capture phase and stops its propagation,
  so SDL never sees the raw touch twice. Shift is a synthetic `KeyboardEvent`
  dispatched on the canvas (it bubbles to the SDL keyboard target).

## Contract

* Toggle: `#touch-toggle` inside `#screen`, visible only in the playing view,
  labelled "Touch". It shows/hides `#touch-controls` and keeps the choice in
  `localStorage` key `openzh.touchControls` as "1"/"0". Default on when
  `navigator.maxTouchPoints > 0` or `(pointer: coarse)`, off otherwise. A
  blocked Storage falls back to the default without an error.
* Overlay: `#touch-controls` inside `#screen`, hidden until playing and
  enabled. It holds `#touch-left`, `#touch-right`, `#touch-multi` (latches,
  `aria-pressed`, at least 48x48 with a label and an icon) and
  `#touch-joystick` (120 px base, 40 px `#touch-knob`) as the rightmost
  control. Locks are cleared when the overlay is hidden or the game restarts.
  The landscape layout (`max-height: 480px`) keeps a 180 px strip free on the
  right for the minimap; the row is still left-to-right with the joystick
  rightmost.
* Map gestures on the canvas, only while the overlay is shown:
  * no lock: tap = left click; 500 ms press with less than 10 CSS px movement =
    right click; a drag does nothing;
  * Left lock: a drag of more than 10 px is a left-button drag (selection box),
    a tap is a left click;
  * Right lock: a tap is a right click;
  * Multi lock: Shift is held around the tap/drag.
  * A second finger is ignored. `pointercancel` and window `blur` end the
    gesture and release any drag.
* Joystick: pointer capture, dead zone 0.15 of the base radius, vector axes in
  [-1, 1] (length clamped to 1), knob springs back and the engine receives one
  final `(0, 0)`. `_GeneralsXPanCamera` is called once per animation frame;
  a fake or older engine without the export is ignored.
* Overlay controls stop `pointerdown`/`pointerup`/`click` and prevent
  `contextmenu`; a touch on a control never reaches the map.
* Desktop is unchanged: `pointerType` "mouse" is never captured, the overlay
  starts hidden on a device without touch, and the existing #28/#80/#91/#97
  contracts hold.
* The engine export is `EMSCRIPTEN_KEEPALIVE` in `SDL3GameEngine.cpp`, next to
  the mute and debug-overlay exports.

## Acceptance criteria

1. `#touch-toggle` is hidden before Play and visible once playing, with the
   overlay on by default on a touch device.
2. Pressing the toggle hides/shows the overlay and clears the latches.
3. The overlay is a child of `#screen` and stays visible after
   `requestFullscreen` on `#screen`.
4. The controls are Left, Right, Multi, joystick in that order; each latch is
   at least 48x48 and the joystick is rightmost. The landscape row leaves the
   bottom-right 180 px free.
5. Each latch toggles `aria-pressed` and sends no map pointer event.
6. No lock: a tap sends a left click (button 0 down/up) and a 500 ms press
   sends a right click (button 2 down/up), with no left click.
7. Left lock: a drag sends left button down, at least one move and left button
   up.
8. Right lock: a tap sends a right click and no left click.
9. Multi lock: Shift keydown precedes the click and Shift keyup follows it.
10. The joystick sends a pan vector with the pushed sign, then one final
    `(0, 0)` and resets the knob on release.
11. A touch on the overlay never produces a map pointer event.
12. The toggle choice survives a reload; a blocked `localStorage` falls back to
    the device default with no page error.
13. On a desktop context the overlay starts hidden, the toggle still works,
    a mouse pointer event reaches the fake engine exactly once, and the page
    synthesises no key or pan event.
14. The engine build still compiles and `GeneralsXPanCamera` is present in the
    exported symbol table (`scripts/build-webgpu.sh`).

## Test paths

* `web/tests/touch-controls.spec.ts`: criteria 1-13.
* `web/tests/harness/touch/records.js`: the fake engine.
* Criterion 14 is the build command below.

## Allowed paths

* `web/app/index.html`
* `web/app/shell.css`
* `web/src/prefs.ts`
* `web/src/touch.ts`
* `web/src/main.ts`
* `web/tests/touch-controls.spec.ts`
* `web/tests/harness/touch/`
* `GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp`

## Check command

`cd web && npx playwright test tests/touch-controls.spec.ts`
and, for the engine, `scripts/build-webgpu.sh` (the architect builds it; the
implementer cannot).

On HEAD the tests fail at the missing `#touch-toggle`; the engine export does
not exist.
