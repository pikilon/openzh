---
name: tdd-pipeline
description: The project's work pipeline (D-05). The architect writes specs, a flash model writes failing tests, another flash model implements, and failures escalate up a model ladder ending in Sonnet. Use for every task.
---

# TDD Pipeline (D-05)

## Roles

| Role | Who | Writes | Never |
| --- | --- | --- | --- |
| Architect | strongest model (Opus) | plan, specs (`docs/briefs/`), reviews, merges | tests, product code |
| Test writer | `deepseek-official/deepseek-flash` first | failing tests in the brief's test paths | product code, specs |
| Implementer | `deepseek-official/deepseek-flash` first | product code in the brief's allowed paths | tests, specs |

Test writer and implementer are separate agent runs, so the implementer never
sees how the tests were reasoned about, only the tests.

## Model ladder

Each step (tests, code) starts at rung 1 and climbs one rung per failure:

0. Optional, implementation only, for `local-model-ok` tasks: the local model
   through `scripts/local-agent.sh` (free).
1. `deepseek-official/deepseek-flash`
2. `openrouter/xiaomi/mimo-v2.6-pro`
3. `deepseek-official/deepseek-v4-pro`
4. `sonnet` through the `llm` MCP's `claude_agent`

A step fails when the agent times out or reports BLOCKED, when its check does
not pass when the architect runs it, when it changed paths outside the brief,
or (tests only) when the architect rejects the tests. After rung 4 fails the
task returns to the architect with the `needs-owner` label.

## Per task

1. Architect: brief in `docs/briefs/<issue>-<slug>.md` with Goal, Read first,
   Contract, Acceptance criteria (one numbered sentence each), Test paths,
   Allowed paths, Check command. Label `needs-tests`. Commit.
2. Test writer (`dsh_agent`, cwd = the task's worktree): read
   `.agents/agents/test-writer/agent.md` and the brief; write tests only in
   the test paths; every acceptance criterion maps to at least one test named
   after its number; the tests must fail on the current code.
3. Architect review: each criterion covered, tests fail for the right
   reason, no test tied to an implementation detail the spec leaves open.
   Accept → commit the tests, label `ready`. Reject → record the failure and
   rerun step 2 one rung up with the reasons.
4. Implementer (`dsh_agent`): read `.agents/agents/local-implementer/agent.md`
   and the brief; change only allowed paths; loop until the check passes.
5. Architect: review the diff, run the check from a clean checkout, record
   the outcome, open the PR, merge. On failure rerun step 4 one rung up,
   passing the failing output.

## Escalation and records

* On any failed step add the `escalate` label and comment on the issue:
  step, model, what failed.
* After each attempt call `report_outcome(call_id, ok|failed, note)` in the
  `llm` MCP and append a row to `docs/model-results.md`.
* Periodically summarise `docs/model-results.md` for the owner; change the
  ladder only with the owner's agreement.

## Parallel work

* Run every `ready` task whose dependencies are merged at the same time,
  each in its own worktree (`git worktree add ../zhwp-worktrees/issue-<n>`),
  with its own `ZHWP_PORT` for the Playwright tests.
* Never give two running agents overlapping allowed paths.

## Spending

Paid rungs (1 to 3) run only under the cap the owner set for the session.
Check the spend before each call; stop at the cap and report.

## Sandbox notes

See `.agents/skills/local-delegation/SKILL.md` (agents cannot run the
Emscripten build; browser tests run in Brave only).
