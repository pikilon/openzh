#!/usr/bin/env bash
# Verifies one delegated task attempt mechanically (D-05, issue #26): the diff of
# a ref against its base may only touch the task's paths, and the task's check
# must give the expected result in a clean worktree of that ref.
# Procedure: .agents/skills/tdd-pipeline/SKILL.md
#
# Usage:
#   scripts/pipeline/verify-task.sh [--tasks <file>] [--base <ref>]
#                                   [--mode tests|code] <issue> <ref>
#
#   --tasks  Task list JSON (default: docs/tasks.json read from <ref>).
#   --base   Ref the attempt is compared against (default: main).
#   --mode   tests: the check must fail (tests written before code).
#            code:  the check must pass (default).
#
# The last stdout line is the verdict:
#   PASS (0)         changed paths are allowed and the check result is expected
#   FAIL (1)         the check result is not expected
#   PATHS (2)        a changed path is outside the allowed list; no check runs
#   ERROR (3)        bad arguments, unknown issue, bad ref or no changes
# The log file (LOG: <path>) is kept; the temporary worktree is removed.
set -uo pipefail

error() { printf 'VERDICT: ERROR %s\n' "$1"; exit 3; }

root=""
tmpdir=""
wt=""
log=""
check_pid=""
wt_created=0

cleanup() {
  trap - EXIT INT TERM
  if [ -n "${check_pid:-}" ] && kill -0 "$check_pid" 2>/dev/null; then
    kill -TERM "$check_pid" 2>/dev/null || true
    wait "$check_pid" 2>/dev/null || true
  fi
  if [ "$wt_created" -eq 1 ] && [ -n "${wt:-}" ]; then
    git -C "${root:-.}" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf -- "$wt"
    git -C "${root:-.}" worktree prune >/dev/null 2>&1 || true
  fi
  if [ -n "${tmpdir:-}" ]; then
    rm -rf -- "$tmpdir"
  fi
}

tasks_file=""
base="main"
mode="code"
positional=()
while [ $# -gt 0 ]; do
  case "$1" in
    --tasks)
      [ $# -ge 2 ] || error "--tasks requires a file"
      tasks_file="$2"; shift 2 ;;
    --base)
      [ $# -ge 2 ] || error "--base requires a ref"
      base="$2"; shift 2 ;;
    --mode)
      [ $# -ge 2 ] || error "--mode requires tests or code"
      mode="$2"; shift 2 ;;
    --)
      shift
      while [ $# -gt 0 ]; do positional+=("$1"); shift; done ;;
    -*)
      error "unknown option: $1" ;;
    *)
      positional+=("$1"); shift ;;
  esac
done

case "$mode" in
  tests|code) ;;
  *) error "unknown mode: $mode" ;;
esac

[ "${#positional[@]}" -ge 2 ] || error "missing <issue> and <ref>"
[ "${#positional[@]}" -le 2 ] || error "too many arguments"
issue="${positional[0]}"
ref="${positional[1]}"

root="$(git rev-parse --show-toplevel 2>/dev/null)" || error "not inside a git repository"
[ -n "$root" ] || error "not inside a git repository"

ref_commit="$(git -C "$root" rev-parse --verify --quiet "$ref^{commit}" 2>/dev/null)" || true
[ -n "$ref_commit" ] || error "ref does not resolve: $ref"

if [ -n "$tasks_file" ]; then
  [ -f "$tasks_file" ] || error "tasks file not found: $tasks_file"
  tasks_json="$(cat "$tasks_file" 2>/dev/null)" || error "cannot read tasks file: $tasks_file"
else
  tasks_json="$(git -C "$root" show "$ref_commit:docs/tasks.json" 2>/dev/null)" \
    || error "cannot read docs/tasks.json from $ref"
fi

printf '%s' "$tasks_json" | jq -e . >/dev/null 2>&1 || error "invalid tasks JSON"
entry="$(printf '%s' "$tasks_json" \
  | jq -c --arg issue "$issue" '[.tasks[]? | select((.issue|tostring) == $issue)][0] // empty' 2>/dev/null)" \
  || error "invalid tasks JSON"
[ -n "$entry" ] || error "unknown issue: $issue"

check="$(printf '%s' "$entry" | jq -r '.check // empty')"
[ -n "$check" ] || error "issue $issue has no check"

if [ "$mode" = "tests" ]; then
  field="test_paths"
else
  field="allowed_paths"
fi
patterns="$(printf '%s' "$entry" | jq -r --arg f "$field" '.[$f] // [] | .[]')" \
  || error "invalid tasks JSON"

base_commit="$(git -C "$root" rev-parse --verify --quiet "$base^{commit}" 2>/dev/null)" || true
[ -n "$base_commit" ] || error "base ref does not resolve: $base"
merge_base="$(git -C "$root" merge-base "$base_commit" "$ref_commit" 2>/dev/null)" \
  || error "no merge base between $base and $ref"
changed="$(git -C "$root" diff --name-only "$merge_base" "$ref_commit" 2>/dev/null)" \
  || error "cannot diff $base and $ref"
[ -n "$changed" ] || error "no changes"

offending=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  matched=0
  while IFS= read -r pattern; do
    [ -n "$pattern" ] || continue
    if [ "$pattern" = "$path" ]; then
      matched=1
      break
    fi
    case "$pattern" in
      */)
        case "$path" in
          "$pattern"*) matched=1; break ;;
        esac
        ;;
    esac
  done <<<"$patterns"
  if [ "$matched" -eq 0 ]; then
    offending="${offending}${path}"$'\n'
  fi
done <<<"$changed"

if [ -n "$offending" ]; then
  printf '%s' "$offending"
  printf 'VERDICT: PATHS\n'
  exit 2
fi

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/verify-task.XXXXXX")" \
  || error "cannot create a temporary directory"
wt="$tmpdir/worktree"
log="$(mktemp "${TMPDIR:-/tmp}/verify-task-log.XXXXXX")" \
  || error "cannot create a log file"

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

git -C "$root" worktree add -q --detach "$wt" "$ref_commit" >>"$log" 2>&1 \
  || error "cannot create a worktree of $ref"
wt_created=1

if [ -n "${ZHWP_BUILD_DIR:-}" ] && [ -d "${ZHWP_BUILD_DIR}" ]; then
  build_abs="$(cd "$ZHWP_BUILD_DIR" && pwd)"
  rm -rf -- "$wt/build"
  ln -s "$build_abs" "$wt/build" >>"$log" 2>&1 \
    || error "cannot link ZHWP_BUILD_DIR as build"
fi

printf 'LOG: %s\n' "$log"
( cd "$wt" && bash -c "$check" ) >>"$log" 2>&1 &
check_pid=$!
wait "$check_pid"
check_status=$?
check_pid=""

if [ "$mode" = "tests" ]; then
  if [ "$check_status" -ne 0 ]; then
    printf 'VERDICT: PASS\n'
    exit 0
  fi
  printf 'VERDICT: FAIL tests pass before implementation\n'
  exit 1
fi

if [ "$check_status" -eq 0 ]; then
  printf 'VERDICT: PASS\n'
  exit 0
fi
printf 'VERDICT: FAIL %s\n' "$check_status"
exit 1
