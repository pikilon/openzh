# 28: Canvas keeps the right mouse button and the keyboard

Issue #28. Phase 1. Size s. `local-model-ok`.

## Goal
The game is played with the right mouse button and the keyboard. The browser
must not open its context menu over the game, and after Play the keys must
reach the canvas without an extra click.

## Read first
* `web/AGENTS.md`
* `web/src/main.ts`, `web/app/index.html`
* `web/tests/launcher.spec.ts`, `web/tests/helpers/big.ts` (how a
  synthetic install is imported and Play is pressed)

## Contract
* `#canvas` has `tabindex="0"` in the HTML.
* A `contextmenu` event on `#canvas` is cancelled (`preventDefault`), from
  page load on, whether the canvas is hidden or not. Elsewhere on the page the
  context menu is untouched.
* When Play shows the canvas, it calls `canvas.focus()` before the engine
  module is imported, so `document.activeElement` is `#canvas` while the
  engine starts.
* Nothing else changes; existing tests keep passing.

## Acceptance criteria
1. `#canvas` has the attribute `tabindex="0"`.
2. A `contextmenu` event dispatched on `#canvas` (cancelable) reports `defaultPrevented === true`.
3. A `contextmenu` event dispatched on `document.body` reports `defaultPrevented === false`.
4. After Play with a complete synthetic install, `document.activeElement` is `#canvas`.

## Test paths
* `web/tests/launcher-input.spec.ts`

## Allowed paths
* `web/src/main.ts`
* `web/app/index.html`

## Check command
`cd web && npm ci && npx playwright test`
