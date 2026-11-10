"""The user's notes: notes.py's writes and history, the agent's guard, the schema migration and the quick check's prompt."""
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

import config
import db as dbmod
import notes

DIR = os.path.dirname(os.path.realpath(__file__))


def fresh_db(path):
    db = sqlite3.connect(path)
    with db:
        config.ensure_schema(db)
        db.execute("INSERT INTO work_projects (project_key, name, priority) VALUES ('p', 'P', 'high')")
        db.execute("INSERT INTO work_tasks (task_key, title, status, project_key) VALUES ('t', 'T', 'open', 'p')")
    return db


class NotesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "work.db")
        # ensure_schema backs the file up before a migration; keep that inside the temp folder.
        self.patch = patch.object(config, "DB", self.path)
        self.patch.start()
        self.db = fresh_db(self.path)

    def tearDown(self):
        self.db.close()
        self.patch.stop()
        self.tmp.cleanup()

    def events(self):
        return self.db.execute("SELECT task_key, project_key, kind, text FROM work_events ORDER BY id").fetchall()

    def test_add_edit_remove_log_history(self):
        with self.db:
            n = notes.add(self.db, "task", "t", "  Sam owns this now.  ")
            notes.edit(self.db, n, "Sam owns this now; I only review.")
            notes.remove(self.db, n)
            p = notes.add(self.db, "project", "p", "Calls go to Sam first.")
        self.assertEqual(self.events(), [
            ("t", None, "note", "Added: Sam owns this now."),
            ("t", None, "note", "Edited: Sam owns this now; I only review. (was: Sam owns this now)"),
            ("t", None, "note", "Removed: Sam owns this now; I only review."),
            (None, "p", "note", "Added: Calls go to Sam first."),
        ])
        rows = self.db.execute("SELECT id, removed_at IS NOT NULL FROM work_notes ORDER BY id").fetchall()
        self.assertEqual(rows, [(n, 1), (p, 0)])

    def test_rejects_bad_notes(self):
        for args in [("task", "missing", "x"), ("project", "missing", "x"), ("task", "t", "   "),
                     ("task", "t", "x" * (notes.MAX_LEN + 1)), ("other", "t", "x")]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                notes.add(self.db, *args)
        with self.db:
            n = notes.add(self.db, "task", "t", "x")
            notes.remove(self.db, n)
        with self.assertRaises(ValueError):
            notes.edit(self.db, n, "y")  # a removed note can't change

    def test_note_on_an_event(self):
        """A note on a history row belongs to that row's task, and a row takes one note at a time."""
        with self.db:
            ev = self.db.execute("INSERT INTO work_events (at, task_key, kind, text) VALUES ('2026-11-10 08:00', 't', 'update', 'CI failed')").lastrowid
            other = self.db.execute("INSERT INTO work_events (at, task_key, kind, text) VALUES ('2026-11-10 08:01', NULL, 'update', 'News')").lastrowid
            n = notes.add(self.db, "event", str(ev), "Runner was flaky.")
        self.assertEqual(self.db.execute("SELECT task_key, project_key, event_id FROM work_notes WHERE id = ?", (n,)).fetchone(), ("t", None, ev))
        self.assertEqual(self.events()[-1], ("t", None, "note", "Added: Runner was flaky."))
        for key in [str(ev), str(other), "999", "x"]:  # already has a note, no task, missing, not an id
            with self.subTest(key=key), self.assertRaises(ValueError):
                notes.add(self.db, "event", key, "Again")
        note_ev = self.db.execute("SELECT id FROM work_events WHERE kind = 'note'").fetchone()[0]
        with self.assertRaises(ValueError):
            notes.add(self.db, "event", str(note_ev), "A note on a note")
        # Once removed, the event can take a new one.
        with self.db:
            notes.remove(self.db, n)
            notes.add(self.db, "event", str(ev), "Fixed now.")

    def test_long_note_is_quoted_short(self):
        with self.db:
            notes.add(self.db, "task", "t", "word " * 100)
        text = self.events()[-1][3]
        self.assertLessEqual(len(text), len("Added: ") + notes.QUOTE_LEN)
        self.assertTrue(text.endswith("…"))

    def test_agent_cannot_write_notes(self):
        """db.py exec, the agent's only write path, can read notes but never change them."""
        con = sqlite3.connect(self.path)
        con.set_authorizer(dbmod.guard)
        for sql in ["INSERT INTO work_notes (task_key, text, created_at, updated_at) VALUES ('t', 'x', 'a', 'b')",
                    "UPDATE work_notes SET removed_at = 'now'", "DELETE FROM work_notes"]:
            with self.subTest(sql=sql), self.assertRaises(sqlite3.DatabaseError):
                con.execute(sql)
        con.execute("SELECT * FROM work_notes").fetchall()
        con.close()

    def test_agent_cannot_forge_note_history(self):
        """A history row of kind 'note' says the user changed a note, so db.py exec refuses to add one."""
        self.db.commit()
        with patch.object(dbmod, "DB", self.path), patch.object(sys, "argv", ["db.py", "exec",
                "INSERT INTO work_events (at, task_key, kind, text) VALUES ('x', 't', 'note', 'Added: fake')"]), \
                self.assertRaises(SystemExit) as e:
            dbmod.main()
        self.assertIn("never of kind 'note'", str(e.exception))
        with patch.object(dbmod, "DB", self.path), patch.object(sys, "argv", ["db.py", "exec",
                "INSERT INTO work_events (at, task_key, kind, text) VALUES ('x', 't', 'update', 'Real news')"]), \
                patch("builtins.print"):
            dbmod.main()
        kinds = [r[0] for r in self.db.execute("SELECT kind FROM work_events")]
        self.assertEqual(kinds, ["update"])
        # Nor can it overwrite an old row, the user's note history included.
        with self.db:
            notes.add(self.db, "task", "t", "Real note")
        for sql in ["REPLACE INTO work_events (id, at, kind, text) VALUES (2, 'x', 'note', 'Added: forged')",
                    "REPLACE INTO work_events (id, at, kind, text) VALUES (1, 'x', 'update', 'Rewritten')",
                    "INSERT INTO work_events (at, kind, text) SELECT at, 'note', 'copy' FROM work_events"]:
            with self.subTest(sql=sql), patch.object(dbmod, "DB", self.path), \
                    patch.object(sys, "argv", ["db.py", "exec", sql]), self.assertRaises(SystemExit):
                dbmod.main()
        self.assertEqual([r[0] for r in self.db.execute("SELECT text FROM work_events ORDER BY id")],
                         ["Real news", "Added: Real note"])


class MigrationTests(unittest.TestCase):
    def test_old_notes_table_gains_event_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "work.db")
            db = sqlite3.connect(path)
            db.execute("""CREATE TABLE work_notes (id INTEGER PRIMARY KEY, task_key TEXT, project_key TEXT, text TEXT NOT NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL, removed_at TEXT,
              CHECK ((task_key IS NULL) <> (project_key IS NULL)))""")
            db.execute("INSERT INTO work_notes (task_key, text, created_at, updated_at) VALUES ('t', 'old', 'a', 'a')")
            db.commit()
            with patch.object(config, "DB", path), db:
                config.ensure_schema(db)
            self.assertEqual(db.execute("SELECT task_key, text, event_id FROM work_notes").fetchall(), [("t", "old", None)])
            db.close()

    def test_old_event_table_gains_note_kind_and_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "work.db")
            db = sqlite3.connect(path)
            db.execute("""CREATE TABLE work_events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, task_key TEXT, text TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              kind TEXT NOT NULL DEFAULT 'update' CHECK (kind IN ('added','update','blocked','unblocked','done','priority')))""")
            db.execute("INSERT INTO work_events (at, task_key, text, kind) VALUES ('2026-11-01 09:00', 'a', 'old', 'priority')")
            db.commit()
            with patch.object(config, "DB", path), db:
                config.ensure_schema(db)
            self.assertTrue(os.path.exists(path + ".before-note-kind"))
            self.assertEqual(db.execute("SELECT id, task_key, text, kind, project_key FROM work_events").fetchall(),
                             [(1, "a", "old", "priority", None)])
            with db:
                db.execute("INSERT INTO work_events (at, project_key, text, kind) VALUES ('x', 'p', 'note', 'note')")
            # Running it again changes nothing.
            with patch.object(config, "DB", path), db:
                config.ensure_schema(db)
            self.assertEqual(db.execute("SELECT count(*) FROM work_events").fetchone()[0], 2)
            db.close()


class FocusTests(unittest.TestCase):
    def test_focus_text(self):
        self.assertEqual(config.focus_text(""), "")
        self.assertIn("the task 'winnin-x'", config.focus_text("task:winnin-x"))
        self.assertIn("project_key 'team'", config.focus_text("project:team"))
        for bad in ["task:", "task:a b", "task:a'b", "other:x", "task"]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                config.focus_text(bad)

    def test_last_refresh_is_the_last_full_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(config, "DIR", tmp):
                self.assertIn("past 7 days", config.last_refresh())
                for stamp in ["", "garbage", "2026-11-09"]:
                    with open(os.path.join(tmp, "last_check"), "w") as f:
                        f.write(stamp)
                    self.assertIn("past 7 days", config.last_refresh())
                with open(os.path.join(tmp, "last_check"), "w") as f:
                    f.write("2026-11-09 10:01\n")
                self.assertIn("finished at 2026-11-09 10:01", config.last_refresh())

    def test_prompt_placeholders_filled(self):
        with open(os.path.join(DIR, "prompt.md")) as f:
            text = f.read()
        self.assertIn("{{FOCUS}}", text)
        self.assertIn("{{LAST_REFRESH}}", text)
        self.assertIn("note:ID", text)


if __name__ == "__main__":
    unittest.main()
