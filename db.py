"""Read and write the work board's SQLite data (work.db, next to this file).

Usage (the refresh agent may run query and exec):
  python3 -I db.py query "SELECT ..." ['[param, ...]']
  python3 -I db.py exec "INSERT ... ON CONFLICT(task_key) DO UPDATE ..." '[param, ...]'
  python3 -I db.py exec "INSERT INTO work_events (at, task_key, text) VALUES (?, ?, ?), ..." '[param, ...]'
Usage (run.sh only; not in the agent's allowed tools):
  python3 -I db.py export "SELECT ..." OUT_FILE

query and export print or write {"columns": [...], "rows": [[...], ...]}, the shape
render_board.py reads. exec runs one statement and prints how many rows it changed.
SQLite's authorizer enforces what exec may do, whatever the SQL text says: insert or
update tasks, add history events (never change old ones), and write the standup draft.
Projects come from config.toml (config.py init) and the user's notes from the app (notes.py),
so neither can be changed here.
"""
import json
import os
import sqlite3
import sys

DB = os.path.join(os.path.dirname(os.path.realpath(__file__)), "work.db")

# (action, table) pairs exec may perform. Reads are allowed; everything else is denied.
WRITABLE = {
    (sqlite3.SQLITE_INSERT, "work_tasks"), (sqlite3.SQLITE_UPDATE, "work_tasks"),
    (sqlite3.SQLITE_INSERT, "work_events"),
    (sqlite3.SQLITE_INSERT, "work_standup"), (sqlite3.SQLITE_UPDATE, "work_standup"),
}
READ_ONLY_OK = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}


def guard(action, arg1, _arg2, _db, _trigger):
    # BEGIN/COMMIT around the one statement (sqlite3 opens them itself).
    if action in READ_ONLY_OK or action == sqlite3.SQLITE_TRANSACTION:
        return sqlite3.SQLITE_OK
    if (action, (arg1 or "").lower()) in WRITABLE:
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def history(db):
    """Every history row by id, as {column: value} (whatever columns this board's table has)."""
    cur = db.execute("SELECT * FROM work_events")
    cols = [d[0] for d in cur.description]
    return {r[0]: dict(zip(cols, r)) for r in cur}


def history_ok(before, after):
    """exec only adds history: every old row is still there unchanged (REPLACE could overwrite one),
    and no new row is of kind 'note', which says the user changed a note (only notes.py writes those)."""
    return all(after.get(i) == r for i, r in before.items()) and all(
        r.get("kind") != "note" for i, r in after.items() if i not in before)


def run_query(sql, params):
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    db.set_authorizer(lambda action, *rest: sqlite3.SQLITE_OK if action in READ_ONLY_OK else sqlite3.SQLITE_DENY)
    cur = db.execute(sql, params)
    return {"columns": [d[0] for d in cur.description or []], "rows": cur.fetchall()}


def main():
    args = sys.argv[1:]
    if len(args) < 2 or args[0] not in ("query", "exec", "export"):
        sys.exit(__doc__)
    mode, sql = args[0], args[1]
    try:
        if mode == "export":
            if len(args) != 3:
                sys.exit(__doc__)
            with open(args[2], "w") as f:
                f.write(json.dumps(run_query(sql, [])))
            return
        if len(args) > 3:
            sys.exit("Too many arguments. " + __doc__)
        try:
            params = json.loads(args[2]) if len(args) > 2 else []
        except ValueError:
            sys.exit("The params must be a JSON list, e.g. '[\"a\", 1]'.")
        if mode == "query":
            print(json.dumps(run_query(sql, params)))
            return
        db = sqlite3.connect(DB)
        db.set_authorizer(guard)
        with db:
            before = history(db)
            cur = db.execute(sql, params)
            # Raising inside the transaction rolls the statement back.
            if not history_ok(before, history(db)):
                raise sqlite3.DatabaseError("not authorized: history")
        print(f"{cur.rowcount} row(s) changed")
    except sqlite3.DatabaseError as e:
        if "not authorized" in str(e):
            sys.exit("Not allowed: query and export only read." if mode != "exec" else
                     "Not allowed: exec only inserts or updates work_tasks and work_standup, and adds work_events rows"
                     " (never of kind 'note', and never replacing an old one).")
        sys.exit(f"SQLite error: {e}")


if __name__ == "__main__":
    main()
