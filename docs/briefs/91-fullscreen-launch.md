# 91: Play launches the game fullscreen

Issue #91. Phase 1. Size m. Owner's request (2026-10-17): be able to launch
the game fullscreen. Found in the first visible run (#33): the game only
appears in the launcher column, so the player has to leave the launcher and
go fullscreen by hand.

The browser build has no fullscreen path of its own: the Emscripten branch of
`W3DDisplay::setDisplayMode` ignores its `windowed` argument and never calls
`SDL_SetWindowFullscreen` (both `GeneralsMD` and `Generals`), and the engine
writes its render resolution into the canvas backing size. Fullscreen is
therefore page-level: the page puts the canvas container in the browser's
fullscreen mode and displays the canvas at the size of the screen. The engine
and its render resolution do not change.

## Goal
The player presses Play and the game fills the screen at its own aspect
ratio, one keystroke (the browser's Esc) returns to the page, and a Fullscreen
button in the playing view returns to fullscreen.

## Read first
* `web/src/main.ts`: `playNow()` (canvas shown, picker hidden, module import,
  `reportError`), the DOM ids and the page's contract comment.
* `web/app/index.html`: the `<style>` block (#80's canvas rules) and the ids.
* `web/tests/launcher-canvas.spec.ts`: the fake-engine flow (clear the store,
  reload with `?module=`, import a synthetic install, press Play) and the
  windowed-fit assertions that must still hold after leaving fullscreen.
* `web/tests/harness/canvas/fit.js`: the fake engine that sets the drawing
  buffer to 1024x768.
* `web/tests/launcher-errors.spec.ts`: `__zhwpDone`, and the fakes under
  `web/tests/harness/errors/`.
* `web/tests/launcher-input.spec.ts` (test 4): after Play, focus is on
  `#canvas` while the engine loads; that must keep holding.

## Why the canvas box, not an image letterbox
The engine maps the mouse in two steps: the browser maps CSS coordinates to
the canvas backing scale, then `SDL3Mouse::scaleMouseCoordinates`
(`GeneralsMD/Code/GameEngineDevice/Source/SDL3Device/GameClient/SDL3Mouse.cpp`)
maps window coordinates through its aspect-fit viewport. Both steps assume
the canvas element box is the whole game image: a canvas element stretched to
the screen with the image letterboxed inside it (for example with
`object-fit: contain`) would misplace clicks by the letterbox offset, the
same class of bug already noted in `GeneralsMD/Code/Main/SDL3Main.cpp` around
line 315. So the element is sized to the game's aspect ratio and the
letterbox is page background around it.

## Contract
* DOM: `<div id="screen">` wraps `#canvas` and nothing else, and `#screen` is
  the element the browser puts in fullscreen. A `<div id="play-controls"
  hidden>` holds `<button id="fullscreen">Fullscreen</button>` and sits before
  `#screen`. `#engine-error` stays before the canvas in document order. No EA
  trademark appears in any added text.
* `#play-controls` is hidden before Play and shown from Play on, also after an
  engine error (the error message, the canvas and the playing view stay).
* Clicking `#play` starts the engine exactly as today and asks the browser for
  fullscreen on `#screen` in the same user gesture.
* While `#screen` is `document.fullscreenElement`, the canvas is displayed at
  the largest size that fits the screen with the drawing buffer's aspect ratio
  (one of its sides is the viewport's, within 1 px), centred, fully inside the
  viewport; the page has no horizontal scroll.
* Fullscreen never writes `#canvas.width` or `#canvas.height`: the drawing
  buffer stays what the engine set. The page only sets the canvas's CSS size.
* If the engine changes the drawing buffer size while fullscreen, the page
  re-fits the canvas to the new aspect ratio.
* Ending fullscreen for any reason (`fullscreenchange` with no fullscreen
  element, including the browser's Esc) restores the windowed playing layout:
  the canvas keeps its drawing buffer, fits the page as #80 requires and stays
  visible, and `#play-controls` is visible.
* Clicking `#fullscreen` while playing windowed enters fullscreen on `#screen`,
  and `#canvas` has focus again afterwards (`document.activeElement`), so the
  game keeps its keyboard input (#28).
* A browser where `#screen.requestFullscreen` is not a function offers no
  fullscreen: `#fullscreen` is hidden and Play starts the game windowed.
* If the request is refused (the returned promise rejects), the game starts
  windowed and no error is shown: the player still plays.
* If the engine reports an error while fullscreen is being entered or after it
  was entered, the page ends up out of fullscreen so `#engine-error` is
  readable.
* Every existing contract keeps holding: #80's windowed fit, #28's focus on
  `#canvas` at Play and the canvas's context menu, and the error element order.

## Acceptance criteria
1. After Play with a complete synthetic install, `document.fullscreenElement` is `#screen` and `#canvas` is visible.
2. In fullscreen at a 1280x800 viewport with a 1024x768 drawing buffer, the canvas's displayed height is 800 (within 1 px), its displayed width is 800*1024/768 (within 1 px), its two side gaps differ by at most 1 px, it lies inside the viewport, and the page has no horizontal scroll.
3. In that state `#canvas`'s `width` and `height` properties and attributes are still 1024 and 768.
4. If the drawing buffer becomes 1280x720 while fullscreen, the canvas re-fits to 16:9: its displayed width is 1280 (within 1 px), its height is 720 (within 1 px) and its two vertical gaps differ by at most 1 px.
5. After the fullscreen session ends (`document.exitFullscreen()` from the page, which is what the browser's Esc does), `document.fullscreenElement` is null, the canvas is still visible and fits the windowed page (#80: inside the viewport, below the heading, drawing-buffer aspect ratio within 1%, no horizontal scroll), and `#play-controls` is visible.
6. Clicking `#fullscreen` while playing windowed makes `document.fullscreenElement` `#screen` again, the canvas fills the screen as in criterion 2, and `document.activeElement` is `#canvas`.
7. With `Element.prototype.requestFullscreen` removed, Play starts the game windowed: no fullscreen element, `#canvas` visible, `#engine-error` hidden, `#play-controls` visible, and `#fullscreen` hidden.
8. With `requestFullscreen` replaced by a function that returns a rejected promise, Play starts the game windowed: no fullscreen element, `#canvas` visible, `#engine-error` hidden, `#play-controls` visible, and `#fullscreen` visible.
9. With the abort fake engine (its abort races the fullscreen request) and separately with the late-abort fake engine (it aborts 1 s after the engine started, while the game is in fullscreen), the page ends with no fullscreen element, a visible `#engine-error` and a visible `#play-controls`; the fullscreen events recorded by the test show the late-abort run was in fullscreen before the abort.

## Test paths
* `web/tests/launcher-fullscreen.spec.ts`: criteria 1-6, using
  `/harness/canvas/fit.js`. The browser only grants fullscreen to a trusted
  user gesture, so start the game with `page.locator("#play").click()`, never
  with a click dispatched from `page.evaluate`.
* `web/tests/launcher-fullscreen-fallbacks.spec.ts`: criteria 7-9, using
  `page.addInitScript` stubs applied before `goto`, and
  `/harness/errors/abort.js` and `/harness/errors/abort-late.js`. For criterion
  9, record `fullscreenchange` events from an init script, so the fullscreen
  state before the abort is observed without racing a poll.
* `web/tests/launcher-canvas.spec.ts`: only its `startCanvas` setup, which
  must leave fullscreen (guarded with `document.fullscreenElement`) before it
  measures the windowed layout; its assertions do not change.

## Allowed paths
* `web/app/index.html`
* `web/src/main.ts`

## Check command
`cd web && npm ci && npx playwright test`

## Out of scope
The game still renders at its own resolution (1024x768 by default, or the
Options menu's resolution) and the page scales it up to the screen. Rendering
at the screen's pixel resolution is a later engine task: the WebGPU surface
and `W3DDisplay::setDisplayMode` would have to follow the display size, and
`SDL_EVENT_WINDOW_RESIZED` is an empty TODO in `SDL3GameEngine`.
