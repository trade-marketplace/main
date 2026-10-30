#!/bin/bash
set -euo pipefail
lock=/tmp/trade-marketplace-heavy-check.lock
if ! mkdir "$lock" 2>/dev/null; then
  printf 'Issue 180 queued for shared heavy-check lock.\n'
  until mkdir "$lock" 2>/dev/null; do sleep 2; done
fi
printf 'issue=180 owner=Codex pid=%s\n' "$$" > "$lock/owner"
printf '%s\n' "$$" > "$lock/pid"
cleanup() { if [ "$(cat "$lock/pid" 2>/dev/null)" = "$$" ]; then rm "$lock/owner" "$lock/pid"; rmdir "$lock"; fi; }
trap cleanup EXIT INT TERM
"$@"
