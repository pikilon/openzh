# 29: Show engine failures on the launcher page

Issue #29. Phase 1. Size s. Depends on #28 (same files).

## Goal
When the engine aborts or cannot start, the player sees why on the page, and
tests can tell the outcome the same way they do on the smoke page. Tests can
also start a fake engine instead of the real one.

## Read first
* `web/AGENTS.md`
* `web/src/main.ts`, `web/app/index.html`
* `web/smoke/smoke.js` (the `__zhwpDone` and `module` contract to copy)
* `web/tests/launcher.spec.ts`, `web/tests/helpers/big.ts`

## Contract
* Module URL: query parameter `module` of the launcher URL, default
  `/engine/GeneralsXZH.js`. Same rule as `smoke.js`: an ES module whose
  default export is the factory.
* `window.__zhwpDone` is `undefined` until the outcome is known, then:
  * factory resolves: `{ status: "resolved" }`;
  * import fails, the module has no default-exported function, the factory
    rejects, or `onAbort` fires: `{ status: "error", message: <non-empty
    text> }` (an abort after resolving replaces `resolved`).
* New element `<div id="engine-error" role="alert" hidden>` placed before
  `#canvas`. On any error outcome it becomes visible and its text contains
  the message. `#status` keeps its current `Engine failed: <message>` text.
  The canvas stays visible.
* Everything else (import, Play enabling, `__zhwpLog`) is unchanged.

## Acceptance criteria
1. With `?module=<fake that resolves>`, after Play `__zhwpDone` is `{ status: "resolved" }` and `#engine-error` is hidden.
2. With a fake whose factory calls `onAbort("boom")`, `__zhwpDone.status` is `"error"`, the message contains `boom`, and `#engine-error` is visible and contains `boom`.
3. With a fake whose factory rejects with an `Error("nope")`, `#engine-error` is visible and contains `nope`.
4. With a `module` URL that does not exist, `#engine-error` is visible with a non-empty message.
5. With a module whose default export is not a function, `#engine-error` is visible with a non-empty message.
6. An abort after the factory resolved changes `__zhwpDone` to the error outcome.
7. Without the `module` parameter the launcher still loads `/engine/GeneralsXZH.js` (the existing launcher test passes).

## Test paths
* `web/tests/launcher-errors.spec.ts`
* `web/tests/harness/errors/` (fake engine modules, served at
  `/harness/errors/`)

## Allowed paths
* `web/src/main.ts`
* `web/app/index.html`

## Check command
`cd web && npm ci && npx playwright test`
