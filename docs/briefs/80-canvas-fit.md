# 80: The game canvas fits the page

Issue #80. Phase 1. Size s. `local-model-ok`. Found in the first visible run
(#33): the engine sizes the canvas to 1024×768, wider than the launcher's
column, so the page scrolls sideways.

## Goal
While playing, the whole game canvas is visible without scrolling at
1280×800, keeping its aspect ratio.

## Read first
* `web/app/index.html` (its `<style>`), `web/src/main.ts`
* `web/tests/launcher.spec.ts`

## Contract
* While the canvas is shown, it is displayed (CSS size) at most as wide and
  as tall as the viewport allows below the page heading, centred, with its
  drawing-buffer aspect ratio; its drawing-buffer size (`width`/`height`
  attributes, set by the engine) is not changed by the page.
* The page has no horizontal scroll at 1280×800 while playing.
* Mouse coordinates still map to the drawing buffer (CSS scaling only; no
  transform that breaks `getBoundingClientRect`).

## Acceptance criteria
1. With the canvas shown and its `width`/`height` set to 1024×768 at a 1280×800 viewport, `document.documentElement.scrollWidth` is at most the viewport width.
2. In that state the canvas's bounding box lies fully inside the viewport.
3. The canvas's displayed aspect ratio equals its drawing-buffer aspect ratio within 1%.
4. The canvas's `width` and `height` attributes are not changed by the page.

## Test paths
* `web/tests/launcher-canvas.spec.ts` (uses a fake engine module through
  the launcher's `module` parameter that sets the canvas to 1024×768; new
  fakes under `web/tests/harness/canvas/`)
* `web/tests/harness/canvas/`

## Allowed paths
* `web/app/index.html`
* `web/src/main.ts`

## Check command
`cd web && npm ci && npx playwright test`
