# 18: Hidden launcher elements must not be displayed

Issue #18. Tests exist (`web/tests/launcher-visibility.spec.ts`) and fail.

## Read first
* `web/app/index.html` (its `<style>`), `web/src/main.ts`

## Contract
* Elements with the `hidden` attribute are never displayed: the page CSS
  must not override `[hidden]` (add `[hidden] { display: none !important; }`
  or remove the conflicting `display` rules).
* `#import-progress` and `#canvas` start hidden in the HTML (add the `hidden`
  attribute if missing); `main.ts` already shows them when needed.
* Nothing else changes.

## Check
From `web/`: `npx playwright test` exits 0.

## Allowed paths
* `web/app/index.html`
