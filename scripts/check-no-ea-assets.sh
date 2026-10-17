#!/usr/bin/env bash
# Rejects game-data file types that must never enter the repository, a release
# or a package (AGENTS.md, Legal Limits): .big archives, .w3d models, .tga
# textures, .wav audio, .map maps and the rest of the list below.
#
# Usage:
#   scripts/check-no-ea-assets.sh [<dir>...]
#
# Without arguments, checks every file git tracks (repository-relative paths).
# With arguments, checks every regular file under each given directory instead
# (paths printed relative to the current directory). scripts/no-ea-assets.allow
# lists the tracked paths that are accepted, one repository-relative path per
# line; empty lines and lines starting with '#' are ignored, and the allowlist
# applies to tracked-files mode only.
#
# Exit: 0 nothing forbidden found, 1 forbidden files found, 2 a given directory
# does not exist or the checkout cannot be resolved.
set -uo pipefail

is_forbidden() {
  case "$1" in
    *.[bB][iI][gG] | \
    *.[aA][nN][iI] | \
    *.[sS][cC][bB] | \
    *.[wW]3[dD] | \
    *.[cC][sS][fF] | \
    *.[sS][tT][rR] | \
    *.[wW][nN][dD] | \
    *.[tT][gG][aA] | \
    *.[dD][dD][sS] | \
    *.[rR][eE][pP] | \
    *.[mM][aA][pP] | \
    *.[wW][aA][vV] | \
    *.[mM][pP]3 | \
    *.[bB][iI][kK] | \
    *.[dD][aA][tT][aA])
      return 0
      ;;
  esac
  return 1
}

# is_allowed <tracked-path>: the path is listed in the allowlist.
is_allowed() {
  [ -n "$allow_list" ] || return 1
  case $'\n'"$allow_list" in
    *$'\n'"$1"$'\n'*) return 0 ;;
  esac
  return 1
}

checked=0
forbidden=0

report() {
  printf '%s\n' "$1"
  forbidden=$((forbidden + 1))
}

if [ $# -eq 0 ]; then
  # Tracked-files mode: git lists repository-relative paths from any directory
  # inside the checkout.
  root="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -z "$root" ]; then
    printf 'no-ea-assets: not inside a git checkout\n' >&2
    exit 2
  fi

  allow_list=""
  allow_file="$root/scripts/no-ea-assets.allow"
  if [ -f "$allow_file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      case "$line" in
        '' | '#'*) continue ;;
      esac
      allow_list="$allow_list$line"$'\n'
    done <"$allow_file"
  fi

  while IFS= read -r -d '' file; do
    [ -n "$file" ] || continue
    checked=$((checked + 1))
    is_forbidden "$file" || continue
    is_allowed "$file" && continue
    report "$file"
  done < <(git ls-files --full-name -z)
else
  # Directory mode: every regular file at every depth under each argument.
  # Validate every argument before scanning so a typo never yields a partial
  # listing.
  for dir in "$@"; do
    if [ ! -d "$dir" ]; then
      printf 'no-ea-assets: not a directory: %s\n' "$dir" >&2
      exit 2
    fi
  done

  for dir in "$@"; do
    while IFS= read -r -d '' file; do
      checked=$((checked + 1))
      is_forbidden "$file" || continue
      report "$file"
    done < <(find "$dir" -type f -print0 2>/dev/null)
  done
fi

if [ "$forbidden" -ne 0 ]; then
  printf 'no-ea-assets: FAIL (%d forbidden files)\n' "$forbidden"
  exit 1
fi
printf 'no-ea-assets: OK (%d files checked)\n' "$checked"
exit 0
