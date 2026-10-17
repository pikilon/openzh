#!/usr/bin/env bash
# Acceptance tests for issue #27: scripts/check-no-ea-assets.sh.
#
# Run from the checkout root:
#   bash scripts/tests/check-no-ea-assets.test.sh
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/scripts/check-no-ea-assets.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/check-no-ea-assets.XXXXXX")" || exit 1
trap 'rm -rf "$work"' EXIT

test_no=0
passed=0
failed=0
last_output=""
last_status=0

ok() {
  test_no=$((test_no + 1))
  printf 'ok %d - %s\n' "$test_no" "$1"
  passed=$((passed + 1))
}

not_ok() {
  test_no=$((test_no + 1))
  printf 'not ok %d - %s\n' "$test_no" "$1"
  shift
  printf '%s\n' "$@" | sed 's/^/# /'
  failed=$((failed + 1))
}

# new_repo <name>: throwaway git repository with a copy of the script under
# test and an empty allowlist, so the script always resolves both files.
new_repo() {
  local dir="$work/$1"
  mkdir -p "$dir/scripts" "$dir/assets" || return 1
  git -C "$dir" init -q >/dev/null 2>&1 || return 1
  if [ -f "$script" ]; then
    cp "$script" "$dir/scripts/check-no-ea-assets.sh" || return 1
  fi
  : > "$dir/scripts/no-ea-assets.allow" || return 1
  printf '%s\n' "$dir"
}

# run_script <script-path> <dir> [<argument>...]
run_script() {
  local runner="$1" dir="$2"
  shift 2
  last_output="$(cd "$dir" && bash "$runner" "$@" 2>&1)"
  last_status=$?
}

last_line() {
  printf '%s\n' "$1" | tail -n 1
}

has_line() {
  printf '%s\n' "$last_output" | grep -qxF -- "$1"
}

test_1() {
  local name="1: a directory with only allowed file types passes with exit 0 and the OK line"
  local dir
  dir="$(new_repo allowed-only)" || { not_ok "$name" "could not create temp repository"; return; }
  : > "$dir/assets/readme.md"
  : > "$dir/assets/source.c"
  : > "$dir/assets/data.json"

  run_script "$dir/scripts/check-no-ea-assets.sh" "$dir" assets
  if [ "$last_status" -ne 0 ]; then
    not_ok "$name" "expected exit 0, got $last_status" "output:" "$last_output"
    return
  fi
  local got
  got="$(last_line "$last_output")"
  if [ "$got" != "no-ea-assets: OK (3 files checked)" ]; then
    not_ok "$name" "expected last line 'no-ea-assets: OK (3 files checked)', got '$got'" "output:" "$last_output"
    return
  fi
  ok "$name"
}

test_2() {
  local name="2: a directory holding a forbidden extension exits 1 and prints that path"
  local dir
  dir="$(new_repo forbidden)" || { not_ok "$name" "could not create temp repository"; return; }
  : > "$dir/assets/readme.md"
  : > "$dir/assets/sounds.wav"

  run_script "$dir/scripts/check-no-ea-assets.sh" "$dir" assets
  if [ "$last_status" -ne 1 ]; then
    not_ok "$name" "expected exit 1, got $last_status" "output:" "$last_output"
    return
  fi
  if ! has_line "assets/sounds.wav"; then
    not_ok "$name" "expected 'assets/sounds.wav' on its own line" "output:" "$last_output"
    return
  fi
  local got
  got="$(last_line "$last_output")"
  if [ "$got" != "no-ea-assets: FAIL (1 forbidden files)" ]; then
    not_ok "$name" "expected last line 'no-ea-assets: FAIL (1 forbidden files)', got '$got'" "output:" "$last_output"
    return
  fi
  ok "$name"
}

test_3() {
  local name="3: extensions are matched case-insensitively (INI.BIG fails)"
  local dir
  dir="$(new_repo uppercase)" || { not_ok "$name" "could not create temp repository"; return; }
  : > "$dir/assets/INI.BIG"

  run_script "$dir/scripts/check-no-ea-assets.sh" "$dir" assets
  if [ "$last_status" -ne 1 ]; then
    not_ok "$name" "expected exit 1 for INI.BIG, got $last_status" "output:" "$last_output"
    return
  fi
  if ! has_line "assets/INI.BIG"; then
    not_ok "$name" "expected 'assets/INI.BIG' on its own line" "output:" "$last_output"
    return
  fi
  ok "$name"
}

test_4() {
  local name="4: files of every depth under a given directory are scanned"
  local dir
  dir="$(new_repo deep)" || { not_ok "$name" "could not create temp repository"; return; }
  mkdir -p "$dir/assets/one/two/three"
  : > "$dir/assets/one/two/three/deep.dds"

  run_script "$dir/scripts/check-no-ea-assets.sh" "$dir" assets
  if [ "$last_status" -ne 1 ]; then
    not_ok "$name" "expected exit 1 for a nested forbidden file, got $last_status" "output:" "$last_output"
    return
  fi
  if ! has_line "assets/one/two/three/deep.dds"; then
    not_ok "$name" "expected 'assets/one/two/three/deep.dds' on its own line" "output:" "$last_output"
    return
  fi
  ok "$name"
}

test_5() {
  local name="5: an allowlisted path is accepted in tracked-files mode but not in directory mode"
  local dir
  dir="$(new_repo allowlist)" || { not_ok "$name" "could not create temp repository"; return; }
  : > "$dir/assets/allowed.tga"
  printf '%s\n' "assets/allowed.tga" > "$dir/scripts/no-ea-assets.allow"
  git -C "$dir" add assets >/dev/null 2>&1

  run_script "$dir/scripts/check-no-ea-assets.sh" "$dir"
  if [ "$last_status" -ne 0 ]; then
    not_ok "$name" "tracked-files mode: expected exit 0, got $last_status" "output:" "$last_output"
    return
  fi
  local got
  got="$(last_line "$last_output")"
  if [ "$got" != "no-ea-assets: OK (1 files checked)" ]; then
    not_ok "$name" "tracked-files mode: expected last line 'no-ea-assets: OK (1 files checked)', got '$got'" "output:" "$last_output"
    return
  fi

  run_script "$dir/scripts/check-no-ea-assets.sh" "$dir" assets
  if [ "$last_status" -ne 1 ]; then
    not_ok "$name" "directory mode: expected exit 1 for an allowlisted path, got $last_status" "output:" "$last_output"
    return
  fi
  if ! has_line "assets/allowed.tga"; then
    not_ok "$name" "directory mode: expected 'assets/allowed.tga' on its own line" "output:" "$last_output"
    return
  fi
  ok "$name"
}

test_6() {
  local name="6: blank and # lines in the allowlist are ignored"
  local dir
  dir="$(new_repo allowlist-lines)" || { not_ok "$name" "could not create temp repository"; return; }
  : > "$dir/assets/keep.tga"
  : > "$dir/assets/commented.tga"
  {
    printf '%s\n' "# assets/commented.tga"
    printf '\n'
    printf '%s\n' "assets/keep.tga"
  } > "$dir/scripts/no-ea-assets.allow"
  git -C "$dir" add assets >/dev/null 2>&1

  run_script "$dir/scripts/check-no-ea-assets.sh" "$dir"
  if [ "$last_status" -ne 1 ]; then
    not_ok "$name" "expected exit 1 (commented entry must not whitelist its file), got $last_status" "output:" "$last_output"
    return
  fi
  if has_line "assets/keep.tga"; then
    not_ok "$name" "'assets/keep.tga' is allowlisted and must not be reported" "output:" "$last_output"
    return
  fi
  if ! has_line "assets/commented.tga"; then
    not_ok "$name" "expected 'assets/commented.tga' on its own line" "output:" "$last_output"
    return
  fi
  ok "$name"
}

test_7() {
  local name="7: a directory argument that does not exist exits 2"
  local dir
  dir="$(new_repo missing-dir)" || { not_ok "$name" "could not create temp repository"; return; }
  run_script "$dir/scripts/check-no-ea-assets.sh" "$dir" does/not/exist
  if [ "$last_status" -ne 2 ]; then
    not_ok "$name" "expected exit 2, got $last_status" "output:" "$last_output"
    return
  fi
  ok "$name"
}

test_8() {
  local name="8: without arguments this repository as it is exits 0"
  run_script "$script" "$repo_root"
  if [ "$last_status" -ne 0 ]; then
    not_ok "$name" "expected exit 0, got $last_status" "output:" "$last_output"
    return
  fi
  local got
  got="$(last_line "$last_output")"
  if ! printf '%s\n' "$got" | grep -Eq '^no-ea-assets: OK \([0-9]+ files checked\)$'; then
    not_ok "$name" "expected an OK line as the last line, got '$got'" "output:" "$last_output"
    return
  fi
  ok "$name"
}

test_1
test_2
test_3
test_4
test_5
test_6
test_7
test_8

printf '%d passed, %d failed\n' "$passed" "$failed"
if [ "$failed" -ne 0 ]; then
  exit 1
fi
exit 0
