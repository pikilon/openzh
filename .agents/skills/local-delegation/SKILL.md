---
name: local-delegation
description: How the lead agent hands a small implementation task to a local model (LM Studio) while keeping specs, tests and verification on the stronger model. Use before delegating any implementation work.
---

# Local Delegation

The lead agent (the strongest model available in the session) owns the
issue, the spec, the tests and the verification. A local model may write the
implementation for tasks that pass the checklist below. Local models cost
nothing, so prefer them whenever a task qualifies; never send them the spec
or the tests to write.

## Delegate only when all of these hold

* The task is described by tests or a check that already fail on HEAD.
* The change fits in a few files the brief can list, and needs no knowledge
  of the wider engine beyond what the brief quotes.
* The behaviour is fully specified: formats, edge cases and errors are in
  the brief or the tests, not left to judgement.
* It is not about determinism, networking, threading, memory layout,
  licensing or anything the replay CRC oracle guards. Those stay with the
  lead agent.

Good fits: parsers and serializers with byte-level specs, small TypeScript
modules of the browser wrapper, build-script glue, mechanical renames across
listed files, porting a function whose behaviour a test pins down.

## Procedure

1. Write the failing test and the brief, commit both, and see the check fail.
2. Run:

   ```bash
   scripts/local-agent.sh --brief docs/briefs/<issue>-<slug>.md \
     --check "<command that exits 0 when done>" \
     --allow "<file> <dir/>"
   ```

3. Read the verdict line:
   * `PASS`: review the diff in the worktree as you would review any
     contributor, then verify from a clean checkout as `AGENTS.md` requires
     before merging it into your branch.
   * `FAIL`: decide whether one more local run with a sharper brief is worth
     it; otherwise implement it yourself.
   * `REJECTED`: the model touched files outside `--allow`; discard the
     worktree.
   * `UNAVAILABLE` or `ERROR`: do the task yourself and mention it to the
     owner; do not switch to a paid API without the owner's confirmation.
4. Remove the worktree when done: `git worktree remove <path>` and delete
   its `local/...` branch.

## Brief template

Briefs live in `docs/briefs/` so any agent or harness can read them.

```markdown
# <Issue number>: <imperative title>

## Goal
<two or three sentences>

## Read first
* `<path>`: <why>

## Contract
<signatures, data formats, error behaviour; quote the exact spec>

## Check
`<command>` must exit 0. Tests: `<test paths>` (do not edit).

## Allowed paths
* `<path>`
```

## Measured local models

Keep this table current when models change. Times are on the owner's
Apple M2 Max (64 GB) through `scripts/local-agent.sh`.

| Model (LM Studio id) | Trial task | Result | Time |
| --- | --- | --- | --- |
| `ornith-1.5-35b-a3b-mlx`, 32k context | C++ `.big` index parser, 1 file, tests with ASan/UBSan | PASS; review found a contract bug the tests missed | 208 s |
| `ornith-1.5-35b-a3b-mlx`, 13k context | same | FAIL: context full before it wrote the file | 53 s |
| `gemma-4-26b-a4b-it-mlx` | not measured yet | | |

Lessons from the trials:

* Load the model with at least 32k context (`lms load <id> --context-length 32768`);
  OpenCode's own prompt takes about 8k tokens.
* The local model satisfies the tests, not the contract: in the trial it
  returned `false` without clearing the output on a later bad entry, which no
  test checked. Write tests for every sentence of the contract, and review
  the diff before accepting a `PASS`.

## Remote implementer through the `llm` MCP

When the owner has confirmed a paid model for the session (D-02 and the
paid-API rule in `AGENTS.md`), implementation can also go to the `llm` MCP
server's `dsh_agent` tool (DeepSeek Harness), for example with
`openrouter/xiaomi/mimo-v2.6-pro`. The procedure is the same: committed brief
and failing tests first, the agent edits only the allowed paths, the lead
reviews the diff, runs the full check outside the agent and calls
`report_outcome(call_id, ok|failed, note)`.

Measured on 2026-10-17 with `mimo-v2.6-pro`:

| Task | Result | Time |
| --- | --- | --- |
| `.big` index parser (C++, trial) | PASS, contract fully met | under 1 min |
| 3 API-drift compile fixes in the ported engine | PASS after the lead's build | 28 min |
| Dev server + smoke page (JS, tests given) | PASS 14/14 | 14 min |
| OPFS store + SharedArrayBuffer file bridge (TS, tests given) | PASS 18/18 | 4 min |

Constraints of the `dsh` sandbox (workspace-write):

* It cannot write outside the working folder, so it cannot run
  `scripts/build-webgpu.sh` (vcpkg and the emscripten cache live elsewhere):
  the lead runs the build and sends back the errors.
* Firefox cannot start inside it; the agent runs `--project=chromium` and the
  lead runs both browsers.
* A provider error ("The operation was aborted") is usually transient: retry
  once, then do the task yourself.
* Track spend against the owner's cap before every paid call.
