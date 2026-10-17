---
name: tdd-pipeline
description: The project's work pipeline (D-05). The architect writes specs, DeepSeek V4.1 Flash writes failing tests and then the code in separate runs; a failed step blocks the task until the owner authorises a manual escalation. Use for every task.
---

# TDD Pipeline (D-05)

## Roles

| Role | Who | Writes | Never |
| --- | --- | --- | --- |
| Architect | strongest model (Opus) | plan, specs (`docs/briefs/`), mechanical checks, merges | tests, product code, reviews of tests or code |
| Test writer | DeepSeek V4.1 Flash first | failing tests in the brief's test paths | product code, specs |
| Implementer | DeepSeek V4.1 Flash first | product code in the brief's allowed paths | tests, specs |

DeepSeek V4.1 Flash is `deepseek-official/deepseek-flash` in the `llm` MCP's
`dsh_agent`: the official DeepSeek API, paid from the owner's DeepSeek
credits. Never reach DeepSeek through OpenRouter.

Test writer and implementer are separate agent runs.

## Model ladder

Automatic, in every pass:

0. Optional, code only, for `local-model-ok` tasks: the local model through
   `scripts/local-agent.sh` (free).
1. `deepseek-official/deepseek-flash` (DeepSeek V4.1 Flash, DeepSeek credits)

Manual, only when the owner authorises it for named tasks in a later pass:

2. `openrouter/xiaomi/mimo-v2.6-pro`
3. `sonnet` through the `llm` MCP's `claude_agent`

Never start rungs 2 or 3 on your own. DeepSeek V4 Pro is not used (more
expensive and worse than Flash) and is not offered by the `llm` MCP.

A step fails when the agent times out or reports BLOCKED, when the check
does not pass when the architect runs it, when it changed paths outside the
brief, or (tests only) when the new tests do not fail on the code before
implementation.

## Per task

1. Architect: brief in `docs/briefs/<issue>-<slug>.md` with Goal, Read first,
   Contract, Acceptance criteria (one numbered sentence each), Test paths,
   Allowed paths, Check command. Label `needs-tests`. Commit.
2. Test writer (`dsh_agent`, cwd = the task's worktree): follow
   `.agents/agents/test-writer/agent.md`. Architect checks only that the
   changes are inside the test paths and that the new tests fail; commits
   them; label `ready`. The architect does not judge test quality.
3. Implementer (`dsh_agent`): follow `.agents/agents/local-implementer/agent.md`;
   change only allowed paths; loop until the check passes.
4. Architect: run the check from a clean checkout, confirm only allowed paths
   changed, record the outcome, open the PR, merge.

## Results only

Delegated agents answer with results only: verdict, check command and its
exit code with the runner's summary line, changed files, and for BLOCKED one
sentence. No explanations, code summaries or reasoning. The `llm` MCP's agent
context (v2) and `.agents/agents/*/agent.md` require this; if an agent sends
more, do not use it and do not ask for it. The architect judges an attempt
only by its mechanical checks.

## Failures and escalation

* On a failed step: labels `blocked` and `escalate`, a comment on the issue
  (step, model, the agent's result lines), keep the failed attempt (push its
  branch as `failed/<issue>-<step>-<model>`), and move on to the next task.
* Do not retry on another model, analyse or patch it. Escalation happens in a
  separate pass, task by task, when the owner authorises the model; the
  owner decides when Sonnet analyses kept failures (tests and code together).
* After every attempt: `report_outcome(call_id, ok|failed, note)` in the
  `llm` MCP and a row in `docs/model-results.md`.

## Parallel work

* Run every `ready` task whose dependencies are merged at the same time,
  each in its own worktree (`git worktree add ../zhwp-worktrees/issue-<n>`),
  with its own `ZHWP_PORT` for the Playwright tests.
* Never give two running agents overlapping allowed or test paths.

## Spending

Paid rungs run only under the cap the owner set for the session. Check the
spend before each call; stop at the cap and report.

## Sandbox notes

See `.agents/skills/local-delegation/SKILL.md` (agents cannot run the
Emscripten build; browser tests run in Brave only).
