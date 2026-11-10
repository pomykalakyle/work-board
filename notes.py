"""The user's notes on a task or a project: corrections and context the hourly check must follow.

Usage (the app runs these; the refresh agent can't, so only the user writes notes):
  python3 -I notes.py add task|project KEY TEXT    prints {"id": N}
  python3 -I notes.py add event EVENT_ID TEXT      a note on one history row, kept with that row's task
  python3 -I notes.py edit ID TEXT
  python3 -I notes.py remove ID

Each change also adds a history event of kind 'note', so History keeps every version.
A removed note keeps its row (removed_at set) and drops out of the board and the prompt.
"""
from pathlib import Path
import datetime
import json
import sqlite3
import sys

# Isolated Python omits the script directory; trust only this sibling module.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import config

MAX_LEN = 2000
# How much of a note a history line quotes.
QUOTE_LEN = 160


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


def quote(text):
    """A note as one history line: whitespace collapsed, long ones cut short."""
    one = " ".join(text.split())
    return one if len(one) <= QUOTE_LEN else one[:QUOTE_LEN - 1].rstrip() + "…"


def clean(text):
    text = text.strip()
    if not text:
        raise ValueError("A note can't be empty.")
    if len(text) > MAX_LEN:
        raise ValueError(f"A note can be at most {MAX_LEN} characters.")
    return text


def log(db, task_key, project_key, text):
    db.execute("INSERT INTO work_events (at, task_key, project_key, kind, text) VALUES (?, ?, ?, 'note', ?)",
               (now(), task_key, project_key, text))


def add(db, kind, key, text):
    text = clean(text)
    event_id = None
    if kind == "task":
        if not db.execute("SELECT 1 FROM work_tasks WHERE task_key = ?", (key,)).fetchone():
            raise ValueError(f"No task {key}.")
        task_key, project_key = key, None
    elif kind == "project":
        if not db.execute("SELECT 1 FROM work_projects WHERE project_key = ? AND status = 'active'", (key,)).fetchone():
            raise ValueError(f"No active project {key}.")
        task_key, project_key = None, key
    elif kind == "event":
        # A note on one piece of evidence: it belongs to that event's task, and an event takes one note.
        event_id = int(key) if str(key).isdigit() else -1
        row = db.execute("SELECT e.task_key FROM work_events e JOIN work_tasks t ON t.task_key = e.task_key"
                         " WHERE e.id = ? AND e.kind <> 'note'", (event_id,)).fetchone()
        if not row:
            raise ValueError(f"No event {key} on a task.")
        if db.execute("SELECT 1 FROM work_notes WHERE event_id = ? AND removed_at IS NULL", (event_id,)).fetchone():
            raise ValueError("That event already has a note. Edit it instead.")
        task_key, project_key = row[0], None
    else:
        raise ValueError("A note is on a task, a project or an event.")
    t = now()
    cur = db.execute("INSERT INTO work_notes (task_key, project_key, text, created_at, updated_at, event_id) VALUES (?, ?, ?, ?, ?, ?)",
                     (task_key, project_key, text, t, t, event_id))
    log(db, task_key, project_key, "Added: " + quote(text))
    return cur.lastrowid


def current(db, note_id):
    row = db.execute("SELECT task_key, project_key, text FROM work_notes WHERE id = ? AND removed_at IS NULL",
                     (note_id,)).fetchone()
    if not row:
        raise ValueError(f"No note {note_id}.")
    return row


def edit(db, note_id, text):
    text = clean(text)
    task_key, project_key, old = current(db, note_id)
    if text == old:
        return
    db.execute("UPDATE work_notes SET text = ?, updated_at = ? WHERE id = ?", (text, now(), note_id))
    # No period inside the parentheses: the app ends the line with one.
    log(db, task_key, project_key, f"Edited: {quote(text)} (was: {quote(old).rstrip('.')})")


def remove(db, note_id):
    task_key, project_key, old = current(db, note_id)
    db.execute("UPDATE work_notes SET removed_at = ? WHERE id = ?", (now(), note_id))
    log(db, task_key, project_key, "Removed: " + quote(old))


def main():
    args = sys.argv[1:]
    db = sqlite3.connect(config.DB)
    try:
        with db:
            config.ensure_schema(db)
        with db:
            if len(args) == 4 and args[0] == "add":
                print(json.dumps({"id": add(db, args[1], args[2], args[3])}))
            elif len(args) == 3 and args[0] == "edit":
                edit(db, int(args[1]), args[2])
            elif len(args) == 2 and args[0] == "remove":
                remove(db, int(args[1]))
            else:
                sys.exit(__doc__)
    except ValueError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
