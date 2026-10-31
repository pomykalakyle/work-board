#!/bin/bash
# Work board refresh: a headless Claude run updates work.db from the sources in
# config.toml, then this script rebuilds board.html and board.json and posts the
# report as a Mac notification. install.sh schedules it with launchd; safe to
# run by hand.

set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK="$DIR/.lock"
LOG="$DIR/logs/$(date +%Y-%m-%d).log"
cd "$DIR"
mkdir -p logs
exec >>"$LOG" 2>&1
echo "=== refresh $(date '+%Y-%m-%d %H:%M:%S')"

# launchd passes --scheduled. Those runs stop here while automatic checks are off
# ([schedule] enabled = false); Check now and running this by hand still work.
if [ "${1:-}" = "--scheduled" ] && [ "$(python3 -I config.py checks-on 2>/dev/null)" = 0 ]; then
  echo "automatic checks are off; skipping"
  exit 0
fi

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another refresh is running; skipping"
  exit 0
fi
# The board data handed to render_board.py goes in a folder only this user can read, removed after the run.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/work-board.XXXXXX")"
trap 'rmdir "$LOCK"; rm -rf "$TMP"' EXIT

notify() {
  python3 -I -c 'import subprocess, sys
t, b = sys.argv[1], sys.argv[2][:400]
subprocess.run(["osascript", "-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", t, b])' "$1" "$2"
}

python3 -I config.py init || { notify "Work board" "config.toml has a problem. See logs."; exit 1; }
prompt="$(NOW="$(date '+%A %Y-%m-%d %H:%M %Z')" python3 -I config.py prompt)"
model="$(python3 -I config.py get claude.model)"
effort="$(python3 -I config.py get claude.effort)"
timeout=$(( $(python3 -I config.py get claude.timeout_minutes) * 60 ))
tools=()
while IFS= read -r t; do tools+=("$t"); done < <(python3 -I config.py tools)
mcp="$(python3 -I config.py mcp)"
mcp_args=()
[ -n "$mcp" ] && mcp_args=(--mcp-config "$mcp")

# Read-only tools only, apart from db.py writing work.db (config.py tools lists them; --tools hides
# Edit, Write, web and other built-in tools entirely). Time-capped.
report="$(perl -e 'alarm shift; exec @ARGV' "$timeout" claude -p "$prompt" \
  --model "$model" \
  --effort "$effort" \
  --no-session-persistence \
  --setting-sources project,local \
  --settings '{"autoMemoryEnabled": false}' \
  ${mcp_args[@]+"${mcp_args[@]}"} --strict-mcp-config \
  --permission-mode dontAsk \
  --tools "Bash,Read,Grep,Glob" \
  --allowedTools "${tools[@]}" \
  < /dev/null)"
status=$?
echo "$report"
if [ $status -ne 0 ]; then
  echo "claude run failed (exit $status)"
  notify "Work board" "The board check failed (exit $status). See $DIR/logs."
fi

# Rebuild the page every run, even if the Claude run failed, so the time stamp shows the last good data.
# Every task, done ones included: the app lists a project's done tasks; render_board.py keeps board.html to today's.
python3 -I db.py export "SELECT task_key, title, status, tier, tier_reason, impact, urgency, effort, impact_reason, urgency_reason, pinned, next_step, blocked_on, link, done_at, project_key, source FROM work_tasks" "$TMP/tasks.json"
python3 -I db.py export "SELECT project_key, name, priority, stage, done_when, color, rank FROM work_projects WHERE status = 'active' ORDER BY rank" "$TMP/projects.json"
python3 -I db.py export "SELECT e.at, e.task_key, e.kind, e.text, t.title, t.status, t.project_key FROM work_events e LEFT JOIN work_tasks t ON t.task_key = e.task_key ORDER BY e.at DESC, e.id DESC LIMIT 2000" "$TMP/events.json"
# The newest standup draft, when [standup] is on (the app shows a Standup page only then).
standup_args=()
if [ "$(python3 -I config.py standup-on)" = 1 ]; then
  python3 -I db.py export "SELECT day, text, updated_at FROM work_standup ORDER BY day DESC LIMIT 1" "$TMP/standup.json" \
    && standup_args=(--standup "$TMP/standup.json")
fi
# The stamp is the last successful check, even when it found nothing new.
[ $status -eq 0 ] && date '+%Y-%m-%d %H:%M' > last_check
checked="$( { cat last_check 2>/dev/null || python3 -I db.py query "SELECT max(checked_at) FROM work_tasks" | python3 -I -c 'import json, sys; print(json.load(sys.stdin)["rows"][0][0] or "")'; } | python3 -I -c 'import datetime, sys
v = sys.stdin.read().strip()
try:
    d = datetime.datetime.strptime(v[:16], "%Y-%m-%d %H:%M")
    print(d.strftime("%a %b ") + str(d.day) + ", " + str(d.hour % 12 or 12) + d.strftime(":%M") + ("am" if d.hour < 12 else "pm"))
except ValueError:
    print(v)')"
stamp="Checked $checked from $(python3 -I config.py sources)"
python3 -I render_board.py "$TMP/tasks.json" "$TMP/projects.json" "$stamp" --standalone --out board.html --json-out board.json --events "$TMP/events.json" ${standup_args[@]+"${standup_args[@]}"} \
  || notify "Work board" "Board page failed to render. See $DIR/logs."

if [ $status -eq 0 ] && [ -n "$report" ] && [ "$(echo "$report" | tr -d '[:space:]')" != "NO_UPDATE" ]; then
  printf '## %s\n\n%s\n\n' "$(date '+%a %b %-d, %-I:%M%p')" "$report" >> reports.md
  notify "Work board" "$report"
fi
echo "=== done $(date '+%H:%M:%S')"
