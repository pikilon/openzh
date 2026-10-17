#!/usr/bin/env bash
# Tests for scripts/pipeline/verify-task.sh (issue #26).
#
# Every test builds a throwaway git repository under a temporary directory and
# runs the script under test from inside it. The checkout that holds this file
# is only used as the location of the script under test; its branches and
# worktrees are never touched.
#
# Run from the checkout root:
#   bash scripts/pipeline/tests/verify-task.test.sh
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
repo_root="$(cd "$here/../../.." >/dev/null 2>&1 && pwd)"
sut="$repo_root/scripts/pipeline/verify-task.sh"

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/verify-task-tests.XXXXXX")" || {
  printf 'could not create a temporary directory\n' >&2
  exit 1
}
cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

tests=0
failures=0
current_dir=""
output_file=""
error_file=""
repo=""
log_path=""

# ---------------------------------------------------------------- assertions

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  return 1
}

assert_eq() {
  local expected="$1" actual="$2" what="${3:-value}"
  if [ "$expected" != "$actual" ]; then
    fail "$what: expected [$expected], got [$actual]"
    return 1
  fi
  return 0
}

assert_last_line() {
  local expected="$1" what="${2:-last line}" actual
  actual="$(tail -n 1 "$output_file")"
  assert_eq "$expected" "$actual" "$what" || return 1
  return 0
}

assert_error_last_line() {
  local actual
  actual="$(tail -n 1 "$output_file")"
  if printf '%s\n' "$actual" | grep -Eq '^VERDICT: ERROR .+$'; then
    return 0
  fi
  fail "expected a 'VERDICT: ERROR <reason>' last line, got [$actual]"
  return 1
}

assert_exact_line() {
  local line="$1" what="${2:-output}"
  if grep -Fxq "$line" "$output_file"; then
    return 0
  fi
  fail "$what does not contain the line [$line]"
  return 1
}

assert_no_marker() {
  local marker="$1"
  if [ -e "$marker" ]; then
    fail "the check ran even though it should not have (marker: $marker)"
    rm -f "$marker"
    return 1
  fi
  return 0
}

# ------------------------------------------------------------------ fixtures

init_repo() {
  local dir="$1"
  mkdir -p "$dir" || return 1
  git -C "$dir" init -q || return 1
  git -C "$dir" symbolic-ref HEAD refs/heads/main || return 1
  git -C "$dir" config user.name "verify-task tests" || return 1
  git -C "$dir" config user.email "verify-task@example.invalid" || return 1
  git -C "$dir" config commit.gpgsign false || return 1
  git -C "$dir" config tag.gpgsign false || return 1
  return 0
}

start_repo() {
  repo="$current_dir/repo"
  init_repo "$repo"
}

write_file() {
  local path="$repo/$1" content="$2"
  mkdir -p "$(dirname "$path")" || return 1
  printf '%s\n' "$content" >"$path" || return 1
  return 0
}

commit_all() {
  local message="$1"
  git -C "$repo" add -A || return 1
  git -C "$repo" commit -q -m "$message" || return 1
  return 0
}

start_feature() {
  git -C "$repo" checkout -q -b feature || return 1
  return 0
}

checkout_branch() {
  git -C "$repo" checkout -q "$1" || return 1
  return 0
}

# write_tasks <file> <issue> <check> <test_paths-json> <allowed_paths-json>
write_tasks() {
  local file="$1" issue="$2" check="$3" test_paths="$4" allowed_paths="$5"
  mkdir -p "$(dirname "$file")" || return 1
  jq -n \
    --argjson issue "$issue" \
    --arg check "$check" \
    --argjson test_paths "$test_paths" \
    --argjson allowed_paths "$allowed_paths" \
    '{schema: 1, tasks: [{issue: $issue, check: $check, test_paths: $test_paths, allowed_paths: $allowed_paths}]}' \
    >"$file" || return 1
  return 0
}

# --------------------------------------------------------------- invocation

# sut_run <dir> [args...]
sut_run() {
  local dir="$1"
  shift
  : >"$output_file"
  : >"$error_file"
  ( cd "$dir" && bash "$sut" "$@" ) >"$output_file" 2>"$error_file"
  return $?
}

worktree_count() {
  local dir="$1" count
  count="$(git -C "$dir" worktree list --porcelain 2>/dev/null | grep -c '^worktree ' || true)"
  printf '%s\n' "${count:-0}"
}

assert_single_worktree() {
  local dir="$1" count
  count="$(worktree_count "$dir")"
  if [ "$count" != "1" ]; then
    fail "expected 1 registered worktree, found $count"
    return 1
  fi
  return 0
}

read_log_path() {
  log_path="$(sed -n 's/^LOG: //p' "$output_file" | tail -n 1)"
  if [ -z "$log_path" ]; then
    fail "no 'LOG: <path>' line in the output"
    return 1
  fi
  return 0
}

assert_one_log_line() {
  local count
  count="$(grep -c '^LOG: ' "$output_file" || true)"
  if [ "${count:-0}" != "1" ]; then
    fail "expected exactly one 'LOG: <path>' line, found ${count:-0}"
    return 1
  fi
  return 0
}

assert_log_exists() {
  read_log_path || return 1
  if [ ! -f "$log_path" ]; then
    fail "the log file does not exist: $log_path"
    return 1
  fi
  return 0
}

# The check is a real side effect in a directory outside the fixture, so it
# proves both that the check ran and, when the marker is absent, that it did not.
marker_check() {
  local marker="$1"
  printf 'touch "%s"' "$marker"
}

# ------------------------------------------------------------------ runner

run_test() {
  local name="$1"
  shift
  tests=$((tests + 1))
  current_dir="$tmp_root/t$tests"
  output_file="$current_dir/output.txt"
  error_file="$current_dir/stderr.txt"
  mkdir -p "$current_dir" || exit 1

  if [ ! -f "$sut" ]; then
    failures=$((failures + 1))
    printf 'not ok %d - %s\n' "$tests" "$name"
    printf '#   script under test not found: %s\n' "$sut"
    return 0
  fi

  if ( "$@" ); then
    printf 'ok %d - %s\n' "$tests" "$name"
  else
    failures=$((failures + 1))
    printf 'not ok %d - %s\n' "$tests" "$name"
    if [ -s "$output_file" ]; then
      sed 's/^/#   /' "$output_file"
    fi
    if [ -s "$error_file" ]; then
      sed 's/^/# ! /' "$error_file"
    fi
  fi
}

# ------------------------------------------------------------------- tests

test_1_code_mode_pass() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "nested/deep/keep.txt" "keep" || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/sub/change.txt" "change" || return 1
  commit_all "feature" || return 1

  # No --mode and no --base: exercises both defaults, from a subdirectory.
  sut_run "$repo/nested/deep" 26 feature
  assert_eq "0" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PASS" "verdict" || return 1
  return 0
}

test_2_code_mode_fail() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "exit 7" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode code 26 feature
  assert_eq "1" "$?" "exit code" || return 1
  assert_last_line "VERDICT: FAIL 7" "verdict" || return 1
  return 0
}

test_3_paths_outside_allowed() {
  local marker="$current_dir/check-ran"
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "$(marker_check "$marker")" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/ok.txt" "ok" || return 1
  write_file "outside/bad.txt" "bad" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode code 26 feature
  assert_eq "2" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PATHS" "verdict" || return 1
  assert_exact_line "outside/bad.txt" "path list" || return 1
  assert_no_marker "$marker" || return 1
  return 0
}

test_4_directory_pattern_matches_nested_paths() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/a.txt" "a" || return 1
  write_file "allowed/deep/b.txt" "b" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode code 26 feature
  assert_eq "0" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PASS" "verdict" || return 1
  return 0
}

test_4_directory_pattern_does_not_match_siblings() {
  local marker="$current_dir/check-ran"
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "$(marker_check "$marker")" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed-extra/file.txt" "extra" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode code 26 feature
  assert_eq "2" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PATHS" "verdict" || return 1
  assert_exact_line "allowed-extra/file.txt" "path list" || return 1
  assert_no_marker "$marker" || return 1
  return 0
}

test_4_file_pattern_is_exact() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/file.txt"]' || return 1
  write_file "allowed/file.txt" "base" || return 1
  commit_all "main" || return 1

  start_feature || return 1
  write_file "allowed/file.txt" "changed" || return 1
  commit_all "exact" || return 1
  sut_run "$repo" --mode code 26 feature
  assert_eq "0" "$?" "exact match exit code" || return 1
  assert_last_line "VERDICT: PASS" "exact match verdict" || return 1

  checkout_branch main || return 1
  git -C "$repo" checkout -q -b prefixed || return 1
  write_file "allowed/file.txt.bak" "prefixed" || return 1
  commit_all "prefixed" || return 1

  sut_run "$repo" --mode code 26 prefixed
  assert_eq "2" "$?" "prefixed path exit code" || return 1
  assert_last_line "VERDICT: PATHS" "prefixed path verdict" || return 1
  assert_exact_line "allowed/file.txt.bak" "prefixed path list" || return 1
  return 0
}

test_5_tests_mode_paths_outside_test_paths() {
  local marker="$current_dir/check-ran"
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "$(marker_check "$marker")" '["tests/"]' '["allowed/"]' || return 1
  write_file "tests/base.test.sh" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "tests/new.test.sh" "new" || return 1
  write_file "src/app.txt" "app" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode tests 26 feature
  assert_eq "2" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PATHS" "verdict" || return 1
  assert_exact_line "src/app.txt" "path list" || return 1
  assert_no_marker "$marker" || return 1
  return 0
}

test_6_tests_mode_failing_check_passes() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "exit 1" '["tests/"]' '["allowed/"]' || return 1
  write_file "tests/base.test.sh" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "tests/new.test.sh" "new" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode tests 26 feature
  assert_eq "0" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PASS" "verdict" || return 1
  return 0
}

test_6_tests_mode_passing_check_fails() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "tests/base.test.sh" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "tests/new.test.sh" "new" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode tests 26 feature
  assert_eq "1" "$?" "exit code" || return 1
  assert_last_line "VERDICT: FAIL tests pass before implementation" "verdict" || return 1
  return 0
}

test_7_unknown_issue() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode code 99 feature
  assert_eq "3" "$?" "exit code" || return 1
  assert_error_last_line || return 1
  return 0
}

test_7_bad_ref() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode code 26 no-such-ref
  assert_eq "3" "$?" "exit code" || return 1
  assert_error_last_line || return 1
  return 0
}

test_7_missing_argument() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode code 26
  assert_eq "3" "$?" "exit code" || return 1
  assert_error_last_line || return 1
  return 0
}

test_7_unknown_option() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --no-such-option 26 feature
  assert_eq "3" "$?" "exit code" || return 1
  assert_error_last_line || return 1
  return 0
}

test_7_no_changes() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1

  sut_run "$repo" --mode code 26 main
  assert_eq "3" "$?" "exit code" || return 1
  assert_last_line "VERDICT: ERROR no changes" "verdict" || return 1
  return 0
}

test_8_check_runs_in_clean_worktree() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 \
    'test "$(cat state.txt)" = committed && test ! -e untracked.txt' \
    '["tests/"]' '["allowed/"]' || return 1
  write_file "state.txt" "committed" || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  # Dirty and untracked files in the caller's checkout must not be visible.
  printf 'dirty\n' >"$repo/state.txt" || return 1
  printf 'untracked\n' >"$repo/untracked.txt" || return 1

  sut_run "$repo" --mode code 26 feature
  assert_eq "0" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PASS" "verdict" || return 1
  return 0
}

test_9_build_dir_is_linked() {
  local build_dir="$current_dir/build"
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 \
    'test -L build && test -f build/marker.txt' \
    '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  mkdir -p "$build_dir" || return 1
  printf 'build marker\n' >"$build_dir/marker.txt" || return 1

  ZHWP_BUILD_DIR="$build_dir" sut_run "$repo" --mode code 26 feature
  assert_eq "0" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PASS" "verdict" || return 1
  return 0
}

test_10_pass_cleans_worktree_and_keeps_log() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "echo checked" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode code 26 feature
  assert_eq "0" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PASS" "verdict" || return 1
  assert_single_worktree "$repo" || return 1
  assert_one_log_line || return 1
  assert_log_exists || return 1
  grep -q "checked" "$log_path" || {
    fail "the log file does not contain the check output"
    rm -f "$log_path"
    return 1
  }
  rm -f "$log_path"
  return 0
}

test_10_fail_cleans_worktree_and_keeps_log() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "exit 3" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  sut_run "$repo" --mode code 26 feature
  assert_eq "1" "$?" "exit code" || return 1
  assert_last_line "VERDICT: FAIL 3" "verdict" || return 1
  assert_single_worktree "$repo" || return 1
  assert_one_log_line || return 1
  assert_log_exists || return 1
  rm -f "$log_path"
  return 0
}

test_10_sigint_cleans_worktree_and_keeps_log() {
  local pid="" tries=0 marker="$current_dir/check-started"
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "touch \"$marker\"; sleep 30" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  : >"$output_file"
  : >"$error_file"
  set -m
  ( cd "$repo" && bash "$sut" --mode code 26 feature ) >"$output_file" 2>"$error_file" &
  pid=$!
  set +m

  # Wait until the check itself is running: the worktree exists and the trap
  # that removes it has been installed by then.
  tries=0
  while [ "$tries" -lt 100 ]; do
    if [ -e "$marker" ]; then
      break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.05
    tries=$((tries + 1))
  done
  if [ ! -e "$marker" ]; then
    kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    fail "the check did not start"
    return 1
  fi
  rm -f "$marker"

  kill -INT -"$pid" 2>/dev/null

  tries=0
  while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 200 ]; do
    sleep 0.05
    tries=$((tries + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    fail "the script did not stop after SIGINT"
    return 1
  fi
  wait "$pid" 2>/dev/null

  assert_single_worktree "$repo" || return 1
  assert_one_log_line || return 1
  assert_log_exists || return 1
  rm -f "$log_path"
  return 0
}

test_11_explicit_tasks_file() {
  local alt="$current_dir/alt-tasks.json"
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "exit 9" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  write_tasks "$alt" 26 "true" '["tests/"]' '["allowed/"]' || return 1

  sut_run "$repo" --mode code --tasks "$alt" 26 feature
  assert_eq "0" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PASS" "verdict" || return 1
  return 0
}

test_default_tasks_come_from_ref() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/base.txt" "base" || return 1
  commit_all "main" || return 1
  start_feature || return 1
  write_file "allowed/change.txt" "change" || return 1
  commit_all "feature" || return 1

  # An uncommitted edit to the caller's copy must not be used.
  write_tasks "$repo/docs/tasks.json" 26 "exit 9" '["tests/"]' '["allowed/"]' || return 1

  sut_run "$repo" --mode code 26 feature
  assert_eq "0" "$?" "exit code" || return 1
  assert_last_line "VERDICT: PASS" "verdict" || return 1
  return 0
}

test_base_option_overrides_default_main() {
  start_repo || return 1
  write_tasks "$repo/docs/tasks.json" 26 "true" '["tests/"]' '["allowed/"]' || return 1
  write_file "allowed/root.txt" "root" || return 1
  commit_all "main" || return 1

  git -C "$repo" checkout -q -b stage || return 1
  write_file "outside/stage.txt" "stage" || return 1
  commit_all "stage" || return 1

  git -C "$repo" checkout -q -b feature || return 1
  write_file "allowed/feature.txt" "feature" || return 1
  commit_all "feature" || return 1

  # HEAD is stage; the default base is main, so diff main..feature includes the
  # path added on stage and must be rejected.
  checkout_branch stage || return 1
  sut_run "$repo" --mode code 26 feature
  assert_eq "2" "$?" "default base exit code" || return 1
  assert_last_line "VERDICT: PATHS" "default base verdict" || return 1
  assert_exact_line "outside/stage.txt" "default base path list" || return 1

  # With stage as the base only the feature commit's path is in the diff.
  sut_run "$repo" --mode code --base stage 26 feature
  assert_eq "0" "$?" "--base exit code" || return 1
  assert_last_line "VERDICT: PASS" "--base verdict" || return 1
  return 0
}

# -------------------------------------------------------------------- main

run_test "1: code mode passes when only allowed paths changed and the check exits 0" test_1_code_mode_pass
run_test "2: code mode fails with the check exit code" test_2_code_mode_fail
run_test "3: a path outside allowed_paths gives PATHS, lists it, and skips the check" test_3_paths_outside_allowed
run_test "4: a pattern ending in / matches every path under it" test_4_directory_pattern_matches_nested_paths
run_test "4: a pattern ending in / does not match a sibling with the same prefix" test_4_directory_pattern_does_not_match_siblings
run_test "4: a pattern without a trailing slash matches only the exact path" test_4_file_pattern_is_exact
run_test "5: tests mode rejects changes outside test_paths" test_5_tests_mode_paths_outside_test_paths
run_test "6: tests mode passes when the check fails" test_6_tests_mode_failing_check_passes
run_test "6: tests mode fails when the check passes" test_6_tests_mode_passing_check_fails
run_test "7: an unknown issue is an error" test_7_unknown_issue
run_test "7: a ref that does not resolve is an error" test_7_bad_ref
run_test "7: a missing argument is an error" test_7_missing_argument
run_test "7: an unknown option is an error" test_7_unknown_option
run_test "7: a ref with no changes is an error" test_7_no_changes
run_test "8: the check runs in a clean worktree of the ref" test_8_check_runs_in_clean_worktree
run_test "9: ZHWP_BUILD_DIR is visible as build/ at the worktree root" test_9_build_dir_is_linked
run_test "10: a passing run removes its worktree and keeps the log" test_10_pass_cleans_worktree_and_keeps_log
run_test "10: a failing run removes its worktree and keeps the log" test_10_fail_cleans_worktree_and_keeps_log
run_test "10: a SIGINT run removes its worktree and keeps the log" test_10_sigint_cleans_worktree_and_keeps_log
run_test "11: --tasks reads the task list from the given file" test_11_explicit_tasks_file
run_test "contract: the default task list is read from the ref" test_default_tasks_come_from_ref
run_test "contract: --base overrides the default main base" test_base_option_overrides_default_main

printf '\nSUMMARY: %d tests, %d failed\n' "$tests" "$failures"
if [ "$failures" -ne 0 ]; then
  exit 1
fi
exit 0
