#!/usr/bin/env bash
# Runs one implementation task on a local model (LM Studio through OpenCode) in
# its own git worktree, then decides the result with a machine check.
# Procedure and rules: .agents/skills/local-delegation/SKILL.md
#
# Usage:
#   scripts/local-agent.sh --brief <file> --check "<command>" --allow "<path> [<path>...]"
#
#   --brief  Markdown task brief, committed (see the skill for its template).
#   --check  Command run from the worktree root; exit 0 means the task is done.
#   --allow  Space-separated files or directories (ending in /) the local model
#            may create or change. Any other change rejects the run.
#
# Environment:
#   LOCAL_AGENT_MODEL        OpenCode model id (default lmstudio/ornith-1.5-35b-a3b-mlx)
#   LOCAL_AGENT_URL          OpenAI-compatible base URL (default http://127.0.0.1:1234/v1)
#   LOCAL_AGENT_TIMEOUT_MIN  Minutes before the run is stopped (default 30)
#   LOCAL_AGENT_WORKTREES    Where worktrees are created (default zhwp-worktrees next to the main checkout)
#
# The first stdout line is the verdict:
#   PASS (0)         check passed and only allowed paths changed
#   FAIL (1)         check failed
#   REJECTED (2)     a path outside --allow changed
#   UNAVAILABLE (3)  LM Studio or the model is not reachable
#   ERROR (4)        bad arguments, dirty checkout, or the agent run crashed or timed out
# The worktree is kept for review; nothing is committed or pushed.
set -uo pipefail

MODEL="${LOCAL_AGENT_MODEL:-lmstudio/ornith-1.5-35b-a3b-mlx}"
URL="${LOCAL_AGENT_URL:-http://127.0.0.1:1234/v1}"
TIMEOUT_MIN="${LOCAL_AGENT_TIMEOUT_MIN:-30}"

verdict() { echo "Verdict: $1"; shift; printf '%s\n' "$@"; }

brief="" check="" allow=""
while [ $# -gt 0 ]; do
  case "$1" in
    --brief) brief="$2"; shift 2 ;;
    --check) check="$2"; shift 2 ;;
    --allow) allow="$2"; shift 2 ;;
    *) verdict ERROR "Unknown argument: $1"; exit 4 ;;
  esac
done
if [ -z "$brief" ] || [ -z "$check" ] || [ -z "$allow" ]; then
  verdict ERROR "--brief, --check and --allow are required."; exit 4
fi

root="$(git rev-parse --show-toplevel 2>/dev/null)" || { verdict ERROR "Not inside a git checkout."; exit 4; }
cd "$root" || exit 4
if [ ! -f "$brief" ]; then verdict ERROR "Brief not found: $brief"; exit 4; fi
if [ -n "$(git status --porcelain -- "$brief")" ] || ! git ls-files --error-unmatch "$brief" >/dev/null 2>&1; then
  verdict ERROR "Commit the brief and its tests first: the local model works from HEAD."; exit 4
fi

model_id="${MODEL#*/}"
if ! curl -s -m 5 "$URL/models" | grep -q "\"$model_id\""; then
  verdict UNAVAILABLE "Model $model_id not served at $URL. Start LM Studio and load it."; exit 3
fi
command -v opencode >/dev/null || { verdict UNAVAILABLE "opencode is not installed."; exit 3; }

stamp="$(date +%Y%m%d-%H%M%S)"
slug="$(basename "$brief" .md | tr -c 'A-Za-z0-9-' '-' | sed 's/-*$//')"
# Default next to the main checkout, even when run from a linked worktree.
main_root="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
worktrees="${LOCAL_AGENT_WORKTREES:-$main_root/../zhwp-worktrees}"
wt="$worktrees/local-$slug-$stamp"
branch="local/$slug-$stamp"
mkdir -p "$worktrees"
git worktree add -q -b "$branch" "$wt" HEAD || { verdict ERROR "Could not create worktree $wt"; exit 4; }
log="$wt.log"
base="$(git -C "$wt" rev-parse HEAD)"

prompt="You are the local implementer for the checkout in the current directory.
Read .agents/agents/local-implementer/agent.md and follow it exactly.
Your task brief is $brief.
You may only create or change these paths: $allow
The task is done when this command exits 0: $check"

# OpenCode hangs in non-interactive runs unless it gets --standalone (its background
# service never answers) and an empty stdin (it waits for a message on a non-TTY stdin).
( cd "$wt" && perl -e 'alarm shift; exec @ARGV' "$((TIMEOUT_MIN * 60))" \
    opencode run --standalone --auto --model "$MODEL" "$prompt" ) </dev/null >"$log" 2>&1
agent_status=$?

changed="$( (git -C "$wt" diff --name-only "$base"; git -C "$wt" ls-files --others --exclude-standard) | sort -u)"
outside=""
for f in $changed; do
  ok=0
  for a in $allow; do
    case "$a" in
      */) case "$f" in "$a"*) ok=1 ;; esac ;;
      *) [ "$f" = "$a" ] && ok=1 ;;
    esac
  done
  [ $ok -eq 1 ] || outside="$outside $f"
done

summary=("Model: $MODEL" "Worktree: $wt" "Branch: $branch" "Agent log: $log" "Changed:" ${changed:+$(printf '  %s\n' $changed)})

if [ $agent_status -ne 0 ] && [ -z "$changed" ]; then
  verdict ERROR "Agent run exited $agent_status with no changes (timeout is ${TIMEOUT_MIN} min)." "${summary[@]}"; exit 4
fi
if [ -n "$outside" ]; then
  verdict REJECTED "Changed outside --allow:$outside" "${summary[@]}"; exit 2
fi
check_log="$wt.check.log"
( cd "$wt" && bash -c "$check" ) >"$check_log" 2>&1
check_status=$?
if [ $check_status -eq 0 ]; then
  verdict PASS "Check: $check (exit 0)" "${summary[@]}"; exit 0
fi
verdict FAIL "Check: $check (exit $check_status), last lines:" "$(tail -15 "$check_log")" "${summary[@]}"; exit 1
