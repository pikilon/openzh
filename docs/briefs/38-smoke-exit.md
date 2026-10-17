# 38: Record the engine's exit code on the smoke page

Issue #38. Phase 2. Size s. Depends on #37 (same file).

## Goal
A headless replay simulation ends with exit code 0 (no CRC mismatch) or 1.
The smoke page must report that code so a runner can decide the result.

## Read first
* `web/AGENTS.md`
* `web/smoke/smoke.js`, `web/tests/smoke.spec.ts`
* Emscripten: `Module.onExit(code)` and the `ExitStatus` error (its `name`
  is `"ExitStatus"`, its `status` is the code) thrown by `exit()`.

## Contract
* The factory options gain `onExit: (code) => …` which sets
  `window.__zhwpDone = { status: "exited", code }` (`code` a number).
* An error caught from the factory, or an `unhandledrejection` reason, whose
  `name` is `"ExitStatus"` and which has a numeric `status` is an exit, not an
  error: `{ status: "exited", code: status }`.
* Once `__zhwpDone.status` is `"exited"`, nothing replaces it (a later
  abort or the factory resolving does not).
* Existing outcomes (`resolved`, `error`) are unchanged otherwise.

## Acceptance criteria
1. A fake engine that calls `onExit(0)` gives `{ status: "exited", code: 0 }`.
2. A fake engine that calls `onExit(1)` gives `{ status: "exited", code: 1 }`.
3. A fake factory that rejects with an object named `ExitStatus` with `status: 1` gives `{ status: "exited", code: 1 }`.
4. A fake that calls `onExit(0)` and then `onAbort("x")` keeps `{ status: "exited", code: 0 }`.
5. A fake that calls `onExit(0)` and then resolves keeps `{ status: "exited", code: 0 }`.
6. A fake that rejects with an ordinary `Error` still gives `status: "error"`.

## Test paths
* `web/tests/smoke-exit.spec.ts`
* `web/tests/harness/exit/` (fake engine modules, served at `/harness/exit/`)

## Allowed paths
* `web/smoke/smoke.js`

## Check command
`cd web && npm ci && npx playwright test`
