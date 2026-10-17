# 37: Engine arguments from the smoke page URL

Issue #37. Phase 2. Size s. `local-model-ok`.

## Goal
The oracle runs replays with `-headless -replay <file>`. The smoke page must
pass engine arguments taken from its URL instead of the fixed `-win`.

## Read first
* `web/AGENTS.md`
* `web/smoke/smoke.js`, `web/tests/smoke.spec.ts`

## Contract
* When the page URL has one or more `arg` query parameters, the factory's
  `arguments` option is `params.getAll("arg")`, in URL order, unchanged
  (empty values included). Without any `arg` parameter it stays `["-win"]`.
* Nothing else changes.

## Acceptance criteria
1. Without `arg` parameters a fake engine receives `["-win"]`.
2. With `?arg=-headless&arg=-replay&arg=a.rep` it receives `["-headless", "-replay", "a.rep"]` in that order.
3. Values are passed unchanged, including spaces and an empty value.
4. The `module` and `archives` parameters keep working alongside `arg`.

## Test paths
* `web/tests/smoke-args.spec.ts`
* `web/tests/harness/args/` (fake engine modules, served at
  `/harness/args/`)

## Allowed paths
* `web/smoke/smoke.js`

## Check command
`cd web && npm ci && npx playwright test`
