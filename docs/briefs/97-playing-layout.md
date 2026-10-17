# 97: While playing, the game fills the window below the text

Issue #97. Phase 1. Size m. Owner's request (2026-10-17): in the windowed
playing view the canvas must use all the width and height it can below the
page text, without overflowing the window, so that leaving fullscreen with Esc
still shows a big game and the next Esc opens the in-game menu.

Today the playing layout is capped twice: `body { max-width: 48rem }` keeps
every element in the launcher's 768 px column, and `#canvas { max-height:
calc(100vh - 15rem) }` bounds the height. A 1600 px wide window shows the game
at 640x480 in the middle of the page.

## Goal
While the game runs windowed, the canvas is the largest rectangle with the
drawing buffer's aspect ratio that fits below the page text, inside the window,
and the page does not scroll.

## Read first
* `web/app/index.html`: the `<style>` block (the body column, `#play-controls`,
  `#screen`, `#canvas` rules from #80 and #91) and the elements.
* `web/src/main.ts`: how Play shows the canvas (`canvas.hidden = false`,
  `picker.hidden = true`, `playControls.hidden = false`) and the fullscreen code.
* `web/tests/launcher-canvas.spec.ts`: the synthetic-install + fake-engine
  flow, and #80's windowed-fit assertions that must keep passing.
* `web/tests/launcher-fullscreen.spec.ts`: #91's windowed criteria (the button
  above the canvas).
* `web/tests/harness/canvas/fit.js`: a fake engine that sets the drawing
  buffer, the shape a new fake follows.

## Contract
* The page never writes `#canvas`'s drawing buffer (`width`/`height`
  attributes or properties).
* While `#canvas` is visible, the playing view fits the window: the document
  does not scroll vertically or horizontally (`scrollHeight <= innerHeight + 1`,
  `scrollWidth <= innerWidth + 1`) at 1280x800 and at 1920x1080.
* While playing, the heading and the intro paragraph stay within a 48rem
  readable column; the game is not capped by it.
* The space available to the game is vertical, from the bottom of
  `#play-controls` to the bottom of the viewport, and horizontal, the body's
  content width (the viewport minus its horizontal padding). The canvas is
  displayed at the largest size with the drawing buffer's aspect ratio that
  fits in that space, horizontally centred, with its top at the bottom of
  `#play-controls` (within 1 px each).
* Leaving fullscreen (#91) changes nothing about this layout: the windowed
  playing view is the same before entering and after leaving fullscreen.
* Every existing contract keeps holding: #80's windowed fit (its spec),
  #91's button and fullscreen behaviour (its specs), #28's focus and context
  menu, the error element order, and the launcher view before Play (the
  picker still scrolls and works as today).

## Acceptance criteria
1. At 1280x800 with a 1280x720 drawing buffer, after Play the page does not scroll vertically or horizontally, and the canvas lies fully inside the viewport.
2. In that state the canvas's displayed top is the bottom of `#play-controls` (within 1 px), its displayed aspect ratio equals the drawing buffer's within 1%, and it is the largest such rectangle: its height equals the viewport height minus the bottom of `#play-controls` (within 1 px), or its width equals the body's content width (within 1 px).
3. In that state the canvas is horizontally centred in the body's content area (the two side gaps differ by at most 1 px).
4. At 1920x1080 with a 1280x720 drawing buffer, the canvas's displayed width is larger than 768 px, its height is the viewport height minus the bottom of `#play-controls` (within 1 px), and its aspect ratio is the drawing buffer's within 1%.
5. At 1920x1080 in the same state, the `h1` and the intro paragraph are at most 768 px wide.
6. In that state `#canvas`'s `width` and `height` properties and attributes are still 1280 and 720.

## Test paths
* `web/tests/launcher-window-layout.spec.ts`: criteria 1-6, using the
  synthetic-install flow of `web/tests/launcher-canvas.spec.ts` and a fake
  engine under `/harness/layout/` that sets the drawing buffer to 1280x720.
* `web/tests/harness/layout/`: the fakes.

Criteria 1, 3, 5 and 6 are guards: they already hold on today's code (a
768x432 canvas inside a page that does not scroll, centred, a 768 px text
column, an untouched drawing buffer) and must keep holding after the change.
The tests that fail before the implementation are 2 and 4: today the canvas
does not start at the bottom of `#play-controls` and stays 768 px wide at
1920x1080. They are the ones that gate the change; the check must fail before
the implementation because of them, and the guard tests must not be weakened
to make that happen.

## Allowed paths
* `web/app/index.html`
* `web/src/main.ts`

## Check command
`cd web && npm ci && npx playwright test`

## Out of scope
Fullscreen behaviour (#91) and the engine's render resolution (a later engine
task).
