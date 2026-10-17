# Task briefs

One brief per task, named `<issue>-<slug>.md`, linked from its issue. The
index of every task, including those without a brief yet, is
`docs/tasks.json`. The plan behind them is `docs/plan.md`; the procedure is
D-05 and `.agents/skills/tdd-pipeline/SKILL.md`.

## Brief layout

Every brief has: Goal, Read first, Contract, Acceptance criteria (numbered,
one sentence each), Test paths, Allowed paths, Check command. Older briefs
(before #26) predate this layout.

## `docs/tasks.json`

```json
{ "issue": 28, "title": "...", "phase": 1,
  "status": "needs-spec|needs-tests|ready|needs-owner|escalate|done",
  "blocked": false, "blocked_by": null, "size": "s|m", "local_model_ok": true,
  "brief": "docs/briefs/28-canvas-input.md", "depends_on": [27, "phase-2-exit"],
  "check": "cd web && npm ci && npx playwright test",
  "test_paths": ["web/tests/launcher-input.spec.ts"],
  "allowed_paths": ["web/src/main.ts"], "summary": "..." }
```

* A path ending in `/` covers everything under it.
* The issue labels are the source of truth for status; whoever changes a
  label updates `docs/tasks.json` in the same pull request (or the architect
  does it when merging).

## Picking a task

Next task for the test writer (no brief needed, no open dependency):

```bash
jq -r --argjson done "$(jq '[.tasks[]|select(.status=="done")|.issue]' docs/tasks.json)" \
  '.tasks[] | select(.status=="needs-tests" and (.blocked|not))
   | select([.depends_on[] | numbers] - $done == [])
   | "\(.issue)\t\(.brief)"' docs/tasks.json
```

Tasks for the implementer: same query with `.status=="ready"`. A dependency
that is an issue outside the list (`6`, `14`) or a phase exit
(`"phase-2-exit"`) counts as open until the task is unblocked by hand.

Two tasks may run at the same time only when their `test_paths` and
`allowed_paths` do not overlap.

## Running a task (any agent or provider)

1. Work in your own worktree from `main`:
   `git worktree add ../zhwp-worktrees/issue-<n> -b issue-<n> main`. For
   browser tests, link the engine build of the main checkout:
   `ln -s <main checkout>/build ../zhwp-worktrees/issue-<n>/build`, and set
   your own `ZHWP_PORT`.
2. Test writer: follow `.agents/agents/test-writer/agent.md`; change only
   `test_paths`; the new tests must fail.
3. Implementer: follow `.agents/agents/local-implementer/agent.md`; change
   only `allowed_paths`; stop when the check exits 0.
4. Do not commit unless the caller asked; never edit the brief, other
   tests, `AGENTS.md`, `.agents/` or `docs/`.
5. Answer with results only:
   ```
   RESULT: DONE | BLOCKED
   CHECK: <command> -> exit <code>, <runner summary line>
   FILES: <changed files>
   REASON: <one sentence, only when BLOCKED>
   ```

## Verifying an attempt (architect)

Mechanical only (D-05): changed paths inside the brief's lists, and the
check from a clean checkout. Once #26 lands:

```bash
ZHWP_BUILD_DIR=$PWD/build scripts/pipeline/verify-task.sh --mode tests <issue> <branch>
ZHWP_BUILD_DIR=$PWD/build scripts/pipeline/verify-task.sh --mode code <issue> <branch>
```

Engine (C++) tasks: the architect runs `scripts/build-webgpu.sh` in the
clean checkout before the check; agents cannot build the engine.

Tasks that need real game data run only on the owner's machine with
`ZHWP_GAME_DIR`, never in CI.
