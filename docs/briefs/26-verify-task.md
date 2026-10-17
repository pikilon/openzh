# 26: Script that verifies a task attempt mechanically

Issue #26. Phase 1 (pipeline tooling). Size m.

## Goal
The architect accepts or rejects every delegated attempt with the same two
mechanical checks (D-05): only the brief's paths changed, and the check
command gives the expected result from a clean checkout. This script makes
those checks one command, driven by `docs/tasks.json`.

## Read first
* `.agents/skills/tdd-pipeline/SKILL.md` (steps 2 and 4)
* `docs/briefs/README.md` (the `docs/tasks.json` fields)
* `scripts/local-agent.sh` (style of an existing shell tool in this repo)

## Contract
`scripts/pipeline/verify-task.sh [--tasks <file>] [--base <ref>] [--mode tests|code] <issue> <ref>`

* Bash, `set -uo pipefail`, needs only `git` and `jq`. Runs from anywhere
  inside the repository; resolves the repository root with
  `git rev-parse --show-toplevel`.
* `--tasks` defaults to `docs/tasks.json` read from `<ref>`
  (`git show <ref>:docs/tasks.json`); `--base` defaults to `main`;
  `--mode` defaults to `code`.
* Looks up the entry whose `issue` equals `<issue>`. Unknown issue, missing
  argument, unknown option or a ref that does not resolve: print
  `VERDICT: ERROR <one-line reason>` and exit 3.
* Changed paths are `git diff --name-only <merge-base of base and ref> <ref>`.
  A pattern matches a path when they are equal, or when the pattern ends in
  `/` and the path starts with it.
  * `--mode tests`: every changed path must match `test_paths`.
  * `--mode code`: every changed path must match `allowed_paths`.
  * Any other changed path: print `VERDICT: PATHS` and then each offending
    path on its own line, exit 2. No check is run.
  * No changed path at all: `VERDICT: ERROR no changes`, exit 3.
* Then it creates a temporary detached worktree of `<ref>` (outside the
  repository, under `${TMPDIR:-/tmp}`), and when `ZHWP_BUILD_DIR` is set and
  is a directory, symlinks it as `build` at the worktree root. It runs the
  entry's `check` with `bash -c` from the worktree root, with stdout and
  stderr appended to a log file, and prints the log path as
  `LOG: <path>`.
  * `--mode code`: check exit 0 → `VERDICT: PASS`, exit 0; otherwise
    `VERDICT: FAIL <check exit code>`, exit 1.
  * `--mode tests` (the new tests must fail before the implementation):
    check exit non-zero → `VERDICT: PASS`, exit 0; check exit 0 →
    `VERDICT: FAIL tests pass before implementation`, exit 1.
* The worktree is removed afterwards (also on failure and on Ctrl-C); the
  log file is kept.
* The `VERDICT:` line is always the last line printed.

## Acceptance criteria
1. A ref whose changes are all inside `allowed_paths` and whose check exits 0 gives `VERDICT: PASS` and exit 0 in code mode.
2. A ref whose check exits non-zero gives `VERDICT: FAIL <code>` and exit 1 in code mode.
3. A ref that changes a path outside `allowed_paths` gives `VERDICT: PATHS`, lists that path, exits 2 and does not run the check.
4. A directory pattern ending in `/` matches every path under it and nothing else.
5. In tests mode, changes outside `test_paths` give `VERDICT: PATHS` and exit 2.
6. In tests mode, a check that fails gives `VERDICT: PASS` and a check that passes gives `VERDICT: FAIL` with exit 1.
7. An unknown issue, a bad ref, a missing argument or a ref with no changes gives `VERDICT: ERROR ...` and exit 3.
8. The check runs in a clean worktree of the ref, so untracked or uncommitted files of the caller's checkout are not visible to it.
9. When `ZHWP_BUILD_DIR` is set, the check sees it as `build/` at the worktree root.
10. No worktree is left registered (`git worktree list`) after any run, and the `LOG:` file exists.
11. `--tasks <file>` reads the task list from that file instead of the ref.

## Test paths
* `scripts/pipeline/tests/` (tests build throwaway git repositories under a
  temporary folder; they never touch this repository's branches)

## Allowed paths
* `scripts/pipeline/verify-task.sh`

## Check command
`bash scripts/pipeline/tests/verify-task.test.sh`
