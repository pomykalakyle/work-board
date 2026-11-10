#!/bin/bash
# Work board refresh: Claude (or Codex on failure) updates work.db from sources in
# config.toml, then this script rebuilds board.html and board.json and posts the
# report as a Mac notification. install.sh schedules it with launchd; safe to
# run by hand.
#
#   run.sh                      a full check (Check now, or by hand)
#   run.sh --scheduled          launchd's hourly check; skipped while automatic checks are off
#   run.sh --note-check SCOPE   the quick check saving a note starts: only the task or project in
#                               SCOPE (task:KEY or project:KEY). Waits for a running check instead
#                               of skipping, and leaves the "last checked" stamp alone.
#   run.sh --render             only rebuild board.json and board.html from work.db (after a note change)

set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK="$DIR/.lock"
LOG="$DIR/logs/$(date +%Y-%m-%d).log"
cd "$DIR"
mkdir -p logs
exec >>"$LOG" 2>&1

MODE=full
SCOPE=""
case "${1:-}" in
  --scheduled) MODE=scheduled ;;
  --note-check) MODE=note; SCOPE="${2:-}" ;;
  --render) MODE=render ;;
esac
echo "=== $([ $MODE = full ] || [ $MODE = scheduled ] && echo refresh || echo "$MODE") $(date '+%Y-%m-%d %H:%M:%S') $SCOPE"

notify() {
  python3 -I -c 'import subprocess, sys
t, b = sys.argv[1], sys.argv[2][:400]
subprocess.run(["osascript", "-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", t, b])' "$1" "$2"
}

# The board data handed to render_board.py goes in a folder only this user can read, removed on exit.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/work-board.XXXXXX")"
HOLD_LOCK=0
HOLD_RENDER=0
trap '[ $HOLD_LOCK = 1 ] && rmdir "$LOCK"; [ $HOLD_RENDER = 1 ] && rm -f "$DIR/.render-lock/pid" && rmdir "$DIR/.render-lock"; rm -rf "$TMP"' EXIT

# Rebuild board.json and board.html from work.db. Every task, done ones included: the app lists a
# project's done tasks; render_board.py keeps board.html to today's.
render() {
  # Renders run outside the refresh lock (after a note change, during a check), so take turns: export
  # and publish together, or an older snapshot could replace a newer board.json.
  # The lock holds its owner's PID; one whose owner is gone (a killed run) is taken over.
  local owner
  until mkdir "$DIR/.render-lock" 2>/dev/null; do
    owner="$(cat "$DIR/.render-lock/pid" 2>/dev/null)"
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      echo "render lock left by $owner; taking it over"
      rm -f "$DIR/.render-lock/pid"
      rmdir "$DIR/.render-lock" 2>/dev/null
    fi
    sleep 0.1
  done
  echo $$ > "$DIR/.render-lock/pid"
  HOLD_RENDER=1
  render_board_locked
  local rc=$?
  rm -f "$DIR/.render-lock/pid"
  rmdir "$DIR/.render-lock"
  HOLD_RENDER=0
  return $rc
}

render_board_locked() {
  python3 -I db.py export "SELECT task_key, title, status, tier, tier_reason, impact, urgency, effort, impact_reason, urgency_reason, pinned, next_step, blocked_on, link, done_at, project_key, source FROM work_tasks" "$TMP/tasks.json"
  python3 -I db.py export "SELECT project_key, name, priority, stage, done_when, color, rank FROM work_projects WHERE status = 'active' ORDER BY rank" "$TMP/projects.json"
  # An event about a project rather than a task (a change to its notes) carries its own project_key.
  python3 -I db.py export "SELECT e.id, e.at, e.task_key, e.kind, e.text, t.title, t.status, COALESCE(t.project_key, e.project_key) AS project_key FROM work_events e LEFT JOIN work_tasks t ON t.task_key = e.task_key ORDER BY e.at DESC, e.id DESC LIMIT 2000" "$TMP/events.json"
  # A note on an event carries that event's time and text, so it reads right even once the event is past the 2000 above.
  python3 -I db.py export "SELECT n.id, n.task_key, n.project_key, n.text, n.created_at, n.updated_at, n.event_id, e.at AS event_at, e.text AS event_text FROM work_notes n LEFT JOIN work_events e ON e.id = n.event_id WHERE n.removed_at IS NULL ORDER BY n.created_at DESC, n.id DESC" "$TMP/notes.json"
  # The newest standup draft, when [standup] is on (the app shows a Standup page only then).
  local standup_args=()
  if [ "$(python3 -I config.py standup-on)" = 1 ]; then
    python3 -I db.py export "SELECT day, text, updated_at FROM work_standup ORDER BY day DESC LIMIT 1" "$TMP/standup.json" \
      && standup_args=(--standup "$TMP/standup.json")
  fi
  local checked stamp
  checked="$( { cat last_check 2>/dev/null || python3 -I db.py query "SELECT max(checked_at) FROM work_tasks" | python3 -I -c 'import json, sys; print(json.load(sys.stdin)["rows"][0][0] or "")'; } | python3 -I -c 'import datetime, sys
v = sys.stdin.read().strip()
try:
    d = datetime.datetime.strptime(v[:16], "%Y-%m-%d %H:%M")
    print(d.strftime("%a %b ") + str(d.day) + ", " + str(d.hour % 12 or 12) + d.strftime(":%M") + ("am" if d.hour < 12 else "pm"))
except ValueError:
    print(v)')"
  stamp="Checked $checked from $(python3 -I config.py sources)"
  python3 -I render_board.py "$TMP/tasks.json" "$TMP/projects.json" "$stamp" --standalone --out board.html --json-out board.json \
    --events "$TMP/events.json" --notes "$TMP/notes.json" ${standup_args[@]+"${standup_args[@]}"}
}

if [ $MODE = render ]; then
  python3 -I config.py init || exit 1
  render || exit 1
  echo "=== done $(date '+%H:%M:%S')"
  exit 0
fi

# launchd passes --scheduled. Those runs stop here while automatic checks are off
# ([schedule] enabled = false); Check now and running this by hand still work.
if [ $MODE = scheduled ] && [ "$(python3 -I config.py checks-on 2>/dev/null)" = 0 ]; then
  echo "automatic checks are off; skipping"
  exit 0
fi

if [ $MODE = note ]; then
  # Someone is watching the app for this one, so wait for a running check (up to 45 minutes) rather than skip it.
  waited=0
  until mkdir "$LOCK" 2>/dev/null; do
    [ $waited = 0 ] && echo "another refresh is running; waiting for it"
    waited=$((waited + 5))
    if [ $waited -ge 2700 ]; then echo "gave up waiting"; exit 75; fi
    sleep 5
  done
elif ! mkdir "$LOCK" 2>/dev/null; then
  echo "another refresh is running; skipping"
  exit 0
fi
HOLD_LOCK=1

python3 -I config.py init || { notify "Work board" "config.toml has a problem. See logs."; exit 1; }
prompt="$(FOCUS="$SCOPE" NOW="$(date '+%A %Y-%m-%d %H:%M %Z')" python3 -I config.py prompt)" || exit 1
# The runner prefers Claude, then retries once with Codex on failure.
report="$(printf '%s' "$prompt" | python3 -I refresh_agent.py)"
status=$?
echo "$report"
if [ $status -ne 0 ]; then
  echo "refresh providers failed (exit $status)"
  # The app shows a quick check's failure next to the note.
  [ $MODE = note ] || notify "Work board" "The board check failed (exit $status). See $DIR/logs."
fi

# The stamp is the last successful full check, even when it found nothing new.
[ $status -eq 0 ] && [ $MODE != note ] && date '+%Y-%m-%d %H:%M' > last_check
# Rebuild the page every run, even if the agent run failed, so the time stamp shows the last good data.
render || notify "Work board" "Board page failed to render. See $DIR/logs."

# A quick check's result shows in the app, next to the note, so it only goes in the log.
if [ $MODE != note ] && [ $status -eq 0 ] && [ -n "$report" ] && [ "$(echo "$report" | tr -d '[:space:]')" != "NO_UPDATE" ]; then
  printf '## %s\n\n%s\n\n' "$(date '+%a %b %-d, %-I:%M%p')" "$report" >> reports.md
  notify "Work board" "$report"
fi
echo "=== done $(date '+%H:%M:%S')"

exit "$status"
