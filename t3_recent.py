"""Print the user's T3 Code threads updated since a time, with their latest messages.

Usage: python3 -I t3_recent.py 2026-10-29T05:00 [messages_per_thread] [chars]
The time is UTC, as T3 stores it. Opens T3's database (config.toml [t3] db) read-only.
"""
import json
import os
import sqlite3
import sys
import tomllib
import urllib.parse

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.toml"), "rb") as _f:
    _path = os.path.expanduser(tomllib.load(_f)["t3"]["db"])
DB = "file:" + urllib.parse.quote(_path) + "?mode=ro"


def text(payload):
    try:
        d = json.loads(payload)
    except ValueError:
        return payload
    for k in ("text", "content", "body"):
        v = d.get(k)
        if isinstance(v, str):
            return v
        if isinstance(v, list):
            return " ".join(x.get("text", "") for x in v if isinstance(x, dict))
    return ""


def main():
    since = sys.argv[1]
    per = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    chars = int(sys.argv[3]) if len(sys.argv) > 3 else 600
    db = sqlite3.connect(DB, uri=True)
    threads = db.execute(
        """select t.thread_id, t.updated_at, coalesce(p.title, 'No project'), t.title
           from orchestration_v2_projection_threads t
           left join projection_projects p on p.project_id = t.project_id
           where t.deleted_at is null and t.archived_at is null and t.updated_at >= ?
           order by t.updated_at desc""", (since,)).fetchall()
    print(f"{len(threads)} threads updated since {since} UTC")
    for tid, upd, project, title in threads:
        print(f"\n## {upd[:16]} | {project} | {title}")
        msgs = db.execute(
            """select role, created_at, payload_json from orchestration_v2_projection_messages
               where thread_id = ? and streaming = 0 and role in ('user', 'assistant')
               order by created_at desc limit ?""", (tid, per * 3)).fetchall()
        kept = [(r, c, text(p).strip()) for r, c, p in msgs]
        kept = [m for m in kept if m[0] == "user" or len(m[2]) >= 40][:per]
        for role, created, body in reversed(kept):
            print(f"--- {created[:16]} {role}\n{body[:chars]}")


if __name__ == "__main__":
    main()
