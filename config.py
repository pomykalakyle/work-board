"""Read config.toml for run.sh, install.sh and the app. Needs Python 3.11+ (tomllib).

Usage:
  python3 -I config.py get SECTION.KEY       print one setting, e.g. claude.model
  python3 -I config.py prompt                print prompt.md filled in (reads NOW from the environment)
  python3 -I config.py mcp                   print the --mcp-config JSON, or nothing without [slack]
  python3 -I config.py tools                 print the allowed tools, one per line
  python3 -I config.py sources               print the sources for the page's time stamp
  python3 -I config.py standup-on            print 1 if [standup] enabled = true, else 0
  python3 -I config.py checks-on             print 1 if [schedule] enabled (the default), else 0
  python3 -I config.py init                  create work.db's tables if missing and sync [[projects]]
  python3 -I config.py check                 check the config and the tools the hourly run needs
  python3 -I config.py schedule              install the launchd job for [schedule] and load it
  python3 -I config.py settings              print the app's Settings page data as JSON
  python3 -I config.py set-schedule FIRST LAST WEEKDAYS_ONLY ENABLED
                                             save [schedule] (0/1 flags) and reload the job; on failure
                                             put the old config and job back

The refresh agent can't run this file, so projects stay under the user's control.
"""
import datetime
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tomllib
from xml.sax.saxutils import escape

# The real path, so a symlinked folder gives one plist no matter how config.py was called.
DIR = os.path.dirname(os.path.realpath(__file__))
CONFIG = os.path.join(DIR, "config.toml")
LOCK = os.path.join(DIR, ".lock")
# The launchd job. WORK_BOARD_LABEL lets a test copy schedule itself without touching the real job.
LABEL = os.environ.get("WORK_BOARD_LABEL", "local.work-board")
PLIST = os.path.expanduser(f"~/Library/LaunchAgents/{LABEL}.plist")
# The same PATH run.sh uses, so checks find the tools the hourly run will find.
RUN_PATH = os.path.expanduser("~/.local/bin") + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DB = os.path.join(DIR, "work.db")
PREFS = os.path.join(DIR, "preferences.md")
# Starter preferences (tracked), used until the user saves their own preferences.md.
PREFS_EXAMPLE = os.path.join(DIR, "preferences.example.md")


def load():
    if not os.path.exists(CONFIG):
        sys.exit(f"No config.toml in {DIR}. Copy config.example.toml to config.toml and fill it in.")
    with open(CONFIG, "rb") as f:
        return tomllib.load(f)


def schedule(c):
    s = c.get("schedule", {})
    return s.get("first_hour", 8), s.get("last_hour", 22), s.get("weekdays_only", True)


def checks_on(c):
    """[schedule] enabled: whether the hourly launchd runs do anything. Off keeps the job
    loaded but run.sh --scheduled exits at once, so turning it off never kills a running check."""
    return c.get("schedule", {}).get("enabled", True)


def about(c):
    you = c.get("you", {})
    lines = [f"Who: {you.get('name', 'the user')}" + (f", {you['role']}" if you.get("role") else "") + "."]
    if you.get("github_login"):
        lines.append(f"GitHub login {you['github_login']} (gh is signed in).")
    if you.get("slack_user_id"):
        lines.append(f"Slack user ID {you['slack_user_id']}.")
    if you.get("repos"):
        lines.append("Main repos: " + ", ".join(you["repos"]) + ".")
    return " ".join(lines)


def load_prefs():
    """preferences.md, which the app's Preferences page writes: {"people": [(name, role)], "preferences": [text]}.
    Items are "- " lines under a "## People", "## Preferences" or "## Standup" heading; a person is "- Name (Title): notes",
    with the title and notes optional. People come back as (name, title, notes)."""
    out = {"people": [], "preferences": [], "standup": []}
    path = PREFS if os.path.exists(PREFS) else PREFS_EXAMPLE
    if not os.path.exists(path):
        return out
    with open(path) as f:
        text = re.sub(r"<!--.*?-->", "", f.read(), flags=re.S)
    section = None
    for line in text.splitlines():
        if line.startswith("## "):
            section = line[3:].strip().lower()
        elif line.startswith("- ") and section in out and line[2:].strip():
            item = line[2:].strip()
            if section == "people":
                head, _, notes = item.partition(":")
                m = re.fullmatch(r"([^()]*?)\s*\(([^()]*)\)", head.strip())
                name, title = (m[1], m[2]) if m else (head, "")
                out["people"].append((name.strip(), title.strip(), notes.strip()))
            else:
                out[section].append(item)
    return out


def preferences():
    """The People and Preferences blocks of the prompt. People go in as names and titles only, to keep
    the prompt short; the agent reads their notes from preferences.md when it needs them."""
    p = load_prefs()
    parts = []
    if p["people"]:
        names = ", ".join(f"{n} ({t})" if t else n for n, t, _ in p["people"])
        parts.append(f"People the user works with: {names}. Notes on how to weigh and handle each one's asks"
                     " are under \"## People\" in preferences.md in your current directory (written to the user,"
                     " so \"you\" means the user). Read that file before you set a tier or urgency from an ask by"
                     " someone listed, or when what a listed person said changes a task.")
    if p["preferences"]:
        parts.append("The user's preferences, set on the app's Preferences page. They override the generic rules in this prompt,"
                     " the ranking rules included, wherever the two conflict:\n" + "\n".join(f"- {t}" for t in p["preferences"]))
    return "\n\n".join(parts) or "The user hasn't set any preferences."


def standup_on(c):
    return bool(c.get("standup", {}).get("enabled"))


def standup(c):
    """standup.md filled in, or nothing when [standup] isn't enabled."""
    if not standup_on(c):
        return ""
    with open(os.path.join(DIR, "standup.md")) as f:
        t = re.sub(r"<!--.*?-->\s*", "", f.read(), flags=re.S).strip()
    ch = c["standup"].get("channel")
    style = load_prefs()["standup"]
    fill = {
        "CHANNEL": f" in {ch['name']} ({ch['id']})" if ch else "",
        "PAST_POSTS": ("On the first run of the day, read the user's last few posts there (conversations_history, limit 7d)"
                       " and match their length and tone.") if ch and "slack" in c else "",
        "STYLE": ("The user's standup style, which wins over the rules above:\n" + "\n".join(f" - {s}" for s in style)) if style else "",
    }
    for k, v in fill.items():
        t = t.replace("{{" + k + "}}", v)
    return t.strip()


def sources(c):
    """What the refresh agent can read, as tools and starting points rather than fixed queries:
    it decides what to read for each task."""
    out = []
    if "slack" in c:
        slack_id = c.get("you", {}).get("slack_user_id")
        chans = ", ".join(f"{ch['name']} {ch['id']}" + (" (customer)" if ch.get("customer") else "")
                          for ch in c["slack"].get("channels", []))
        line = (" - Slack, through the mcp__slack__* tools: search messages (conversations_search_messages, by user, mention,"
                " channel or date), read a channel's or DM's history (conversations_history) and read a whole thread"
                " (conversations_replies).")
        if slack_id:
            line += f" The user's Slack ID is {slack_id}."
        if chans:
            line += f" Channels the user watches: {chans}. A customer stuck or waiting in a customer channel is top urgency."
        out.append(line)
    if "github" in c:
        out.append(" - GitHub, read-only through gh (signed in as the user, so @me works): gh search prs and gh search issues"
                   " (e.g. --author, --review-requested, --involves, --mentions), gh pr view (state, reviews, comments, mergeable),"
                   " gh pr checks, gh pr diff, gh issue view and gh run view.")
    if "t3" in c:
        out.append(" - T3 Code threads (the user's coding agent sessions, for work they finished, started or decided):"
                   " python3 -I t3_recent.py <since, UTC as YYYY-MM-DDTHH:MM> [messages per thread] [characters per message]."
                   " Raise the limits when you need more of a thread.")
    return "\n".join(out)


def ranking():
    """ranking.md without its leading comment: the rules the prompt and the app's scoring page share."""
    with open(os.path.join(DIR, "ranking.md")) as f:
        return re.sub(r"<!--.*?-->\s*", "", f.read(), flags=re.S).strip()


def prompt(c):
    first, _, _ = schedule(c)
    kind = "the first run of the day" if datetime.datetime.now().hour == first else "a later run, not the first of the day"
    with open(os.path.join(DIR, "prompt.md")) as f:
        t = f.read()
    for k, v in {"NOW": os.environ["NOW"], "RUN_KIND": kind, "ABOUT": about(c), "PREFERENCES": preferences(), "SOURCES": sources(c), "RANKING": ranking(), "STANDUP": standup(c)}.items():
        t = t.replace("{{" + k + "}}", v)
    return t


def mcp(c):
    if "slack" not in c:
        return ""
    cmd = [os.path.expanduser(a) for a in c["slack"]["mcp_command"]]
    return json.dumps({"mcpServers": {"slack": {"type": "stdio", "command": cmd[0], "args": cmd[1:]}}})


def tools(c):
    """The agent's allowed tools. run.sh runs it in dontAsk mode, which allows file reads inside the
    board folder and denies anything not listed here, so it can't read the rest of the disk, write
    files, or call any Slack tool but these three read-only ones (some Slack servers can post)."""
    t = ["Bash(python3 -I db.py query:*)", "Bash(python3 -I db.py exec:*)", "Bash(date:*)"]
    if "slack" in c:
        t += ["mcp__slack__conversations_history", "mcp__slack__conversations_replies", "mcp__slack__conversations_search_messages"]
    if "github" in c:
        # Read-only gh commands only.
        t += ["Bash(gh search prs:*)", "Bash(gh search issues:*)", "Bash(gh pr view:*)", "Bash(gh pr checks:*)",
              "Bash(gh pr diff:*)", "Bash(gh issue view:*)", "Bash(gh run view:*)"]
    if "t3" in c:
        t.append("Bash(python3 -I t3_recent.py:*)")
    return "\n".join(t)


def stamp_sources(c):
    names = [n for k, n in (("github", "GitHub"), ("slack", "Slack"), ("t3", "your T3 threads")) if k in c]
    if len(names) < 2:
        return names[0] if names else "nothing"
    return ", ".join(names[:-1]) + " and " + names[-1]


# The kinds of history event. 'priority' (added 2026-10-30) is a rank, tier or score move.
KIND_CHECK = "CHECK (kind IN ('added','update','blocked','unblocked','done','priority'))"

TASKS_SCHEMA = """CREATE TABLE IF NOT EXISTS {name} (id INTEGER PRIMARY KEY, task_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','blocked','parked','done')),
  tier TEXT CHECK (tier IN ('must','should','later')), tier_reason TEXT,
  impact INTEGER CHECK (impact BETWEEN 1 AND 5), urgency INTEGER CHECK (urgency BETWEEN 1 AND 5), effort INTEGER CHECK (effort BETWEEN 1 AND 5),
  impact_reason TEXT, urgency_reason TEXT, pinned TEXT, next_step TEXT, blocked_on TEXT, link TEXT, source TEXT, checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  done_at TEXT, project_key TEXT)"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS work_projects (id INTEGER PRIMARY KEY, project_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')), stage TEXT, done_when TEXT, color TEXT, rank INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','dropped')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
""" + TASKS_SCHEMA.format(name="work_tasks") + """;
CREATE TABLE IF NOT EXISTS work_events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, task_key TEXT, text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'update' {kind_check},
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS work_events_task ON work_events (task_key, at);
CREATE TABLE IF NOT EXISTS work_standup (day TEXT PRIMARY KEY, text TEXT NOT NULL, updated_at TEXT);
""".replace("{kind_check}", KIND_CHECK)


def migrate_1_to_5(db):
    """Boards made before 2026-10-29 scored 1 to 3 and had no tier. Rebuild the
    table on the 1 to 5 scale (3 -> 5, 2 -> 3, 1 -> 1) with a starting tier; the
    next refresh rescores every task against the new rubric."""
    sql = db.execute("SELECT sql FROM sqlite_master WHERE name = 'work_tasks'").fetchone()
    if not sql or "BETWEEN 1 AND 3" not in sql[0]:
        return
    shutil.copy(DB, DB + ".before-1-to-5")
    remap = lambda col: f"CASE {col} WHEN 3 THEN 5 WHEN 2 THEN 3 WHEN 1 THEN 1 END"
    cols = "id, task_key, title, status, urgency_reason, pinned, next_step, blocked_on, link, source, checked_at, created_at, updated_at, done_at, project_key"
    db.execute(TASKS_SCHEMA.format(name="work_tasks_new"))
    db.execute(f"""INSERT INTO work_tasks_new ({cols}, impact, urgency, effort, tier)
                   SELECT {cols}, {remap('impact')}, {remap('urgency')}, {remap('effort')},
                     CASE WHEN status != 'open' THEN NULL WHEN urgency = 3 THEN 'must' WHEN impact = 1 THEN 'later' ELSE 'should' END
                   FROM work_tasks""")
    db.execute("DROP TABLE work_tasks")
    db.execute("ALTER TABLE work_tasks_new RENAME TO work_tasks")


def migrate_event_kinds(db):
    """SQLite can't change a CHECK in place, so rebuild work_events to allow the
    'priority' kind (added 2026-10-30). Rows and ids are kept as they are."""
    sql = db.execute("SELECT sql FROM sqlite_master WHERE name = 'work_events'").fetchone()
    if not sql or "kind" not in sql[0] or "'priority'" in sql[0]:
        return
    shutil.copy(DB, DB + ".before-priority-kind")
    cols = "id, at, task_key, text, created_at, kind"
    db.execute(f"""CREATE TABLE work_events_new (id INTEGER PRIMARY KEY, at TEXT NOT NULL, task_key TEXT, text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, kind TEXT NOT NULL DEFAULT 'update' {KIND_CHECK})""")
    db.execute(f"INSERT INTO work_events_new ({cols}) SELECT {cols} FROM work_events")
    db.execute("DROP TABLE work_events")  # drops its index too; SCHEMA recreates it
    db.execute("ALTER TABLE work_events_new RENAME TO work_events")


def init(c):
    """Create the tables if missing, then make work_projects match [[projects]]."""
    db = sqlite3.connect(DB)
    with db:
        migrate_1_to_5(db)
        migrate_event_kinds(db)
        db.executescript(SCHEMA)
        cols = {r[1] for r in db.execute("PRAGMA table_info(work_tasks)")}
        if "impact_reason" not in cols:  # added 2026-10-29
            db.execute("ALTER TABLE work_tasks ADD COLUMN impact_reason TEXT")
        ev_cols = {r[1] for r in db.execute("PRAGMA table_info(work_events)")}
        if "kind" not in ev_cols:  # added 2026-10-29
            db.execute("ALTER TABLE work_events ADD COLUMN kind TEXT NOT NULL DEFAULT 'update' " + KIND_CHECK)
        keys = []
        for rank, p in enumerate(c.get("projects", []), 1):
            keys.append(p["key"])
            db.execute(
                """INSERT INTO work_projects (project_key, name, priority, stage, done_when, color, rank, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(project_key) DO UPDATE SET name=excluded.name, priority=excluded.priority, stage=excluded.stage,
                     done_when=excluded.done_when, color=excluded.color, rank=excluded.rank, status=excluded.status,
                     updated_at=CURRENT_TIMESTAMP""",
                (p["key"], p["name"], p["priority"], p.get("stage"), p.get("done_when"), p.get("color"), rank, p.get("status", "active")))
        # Projects removed from the config drop off the board.
        db.execute(f"UPDATE work_projects SET status = 'dropped', updated_at = CURRENT_TIMESTAMP"
                   f" WHERE status != 'dropped' AND project_key NOT IN ({','.join('?' * len(keys))})", keys)


def plist(c):
    first, last, weekdays = schedule(c)
    days = range(1, 6) if weekdays else [None]
    slots = "".join(
        "<dict>" + (f"<key>Weekday</key><integer>{d}</integer>" if d else "")
        + f"<key>Hour</key><integer>{h}</integer><key>Minute</key><integer>0</integer></dict>\n"
        for d in days for h in range(first, last + 1))
    log = escape(os.path.join(DIR, "logs", "launchd.log"))
    # --scheduled tells run.sh this is an automatic run, which [schedule] enabled = false skips.
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>Label</key><string>{escape(LABEL)}</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>{escape(os.path.join(DIR, "run.sh"))}</string><string>--scheduled</string></array>
<key>StandardOutPath</key><string>{log}</string>
<key>StandardErrorPath</key><string>{log}</string>
<key>StartCalendarInterval</key><array>
{slots}</array>
</dict>
</plist>"""


# ---------- The launchd job ----------

def _launchctl(*args):
    return subprocess.run(["launchctl", *args], capture_output=True, text=True)


def job_loaded():
    return _launchctl("print", f"gui/{os.getuid()}/{LABEL}").returncode == 0


def _read(path):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return None


def _write(path, data):
    """Write through a temp file and a rename, so a reader never sees half a file."""
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(data)
    os.replace(tmp, path)


def load_job(plist_text):
    """Write the plist and (re)load the job. Raises RuntimeError with launchctl's message on failure."""
    os.makedirs(os.path.dirname(PLIST), exist_ok=True)
    os.makedirs(os.path.join(DIR, "logs"), exist_ok=True)
    _write(PLIST, plist_text)
    domain = f"gui/{os.getuid()}"
    _launchctl("bootout", f"{domain}/{LABEL}")  # fails harmlessly when it isn't loaded
    # Right after a bootout, bootstrap can briefly fail with "Input/output error", so retry a few times.
    for _ in range(6):
        r = _launchctl("bootstrap", domain, PLIST)
        if r.returncode == 0:
            return
        subprocess.run(["sleep", "0.5"])
    # The first line only: the rest suggests rerunning as root, which wouldn't help here.
    msg = (r.stderr or r.stdout).strip().splitlines()
    raise RuntimeError(msg[0] if msg else f"launchctl bootstrap exited {r.returncode}")


def install_schedule(c):
    """Used by install.sh: put the job in place for config.toml's [schedule]."""
    try:
        load_job(plist(c))
    except (RuntimeError, OSError) as e:
        sys.exit(f"Couldn't schedule the hourly check: {e}")
    print(f"Scheduled the hourly check ({PLIST})")


# ---------- Saving [schedule] from the app ----------

SCHEDULE_KEYS = ("first_hour", "last_hour", "weekdays_only", "enabled")
TABLE_RE = re.compile(r"^\s*\[")
SCHEDULE_RE = re.compile(r"^\s*\[\s*schedule\s*\]\s*(#.*)?$")


def toml_value(v):
    return ("true" if v else "false") if isinstance(v, bool) else str(v)


def patch_schedule(text, values):
    """Set the given keys in config.toml's [schedule] table, keeping every comment and
    other line as it was. Adds missing keys, or the table itself, when needed."""
    lines = text.splitlines(keepends=True)
    heads = [i for i, line in enumerate(lines) if SCHEDULE_RE.match(line)]
    if len(heads) > 1:
        raise ValueError("config.toml has more than one [schedule] table")
    if not heads:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines += ["\n", "[schedule]\n"] + [f"{k} = {toml_value(v)}\n" for k, v in values.items()]
        return "".join(lines)
    start = heads[0] + 1
    end = next((i for i in range(start, len(lines)) if TABLE_RE.match(lines[i])), len(lines))
    last_key = heads[0]
    missing = []
    for key, v in values.items():
        key_re = re.compile(rf"^(\s*{key}\s*=\s*)([^#\r\n]*?)(\s*(?:#.*)?)(\r?\n)?$")
        hits = [i for i in range(start, end) if key_re.match(lines[i])]
        if len(hits) > 1:
            raise ValueError(f"[schedule] sets {key} more than once")
        if hits:
            i = hits[0]
            lines[i] = key_re.sub(lambda m: m.group(1) + toml_value(v) + m.group(3) + (m.group(4) or ""), lines[i])
        else:
            missing.append(f"{key} = {toml_value(v)}\n")
    for i in range(start, end):
        if re.match(r"^\s*[A-Za-z_]+\s*=", lines[i]):
            last_key = i
    lines[last_key + 1:last_key + 1] = missing
    return "".join(lines)


def set_schedule(first, last, weekdays_only, enabled):
    """Save [schedule] from the app's Settings page. Exits nonzero with a message on any problem;
    if reloading the job fails, the old config.toml and job are put back first."""
    if not (0 <= first <= last <= 23):
        sys.exit("The first check has to be at or before the last one, between 0 and 23.")
    with open(CONFIG) as f:
        old_text = f.read()
    try:
        old = tomllib.loads(old_text)
        new_text = patch_schedule(old_text, {"first_hour": first, "last_hour": last,
                                             "weekdays_only": weekdays_only, "enabled": enabled})
        new = tomllib.loads(new_text)
    except (tomllib.TOMLDecodeError, ValueError) as e:
        sys.exit(f"config.toml wasn't changed: {e}")
    s = new.get("schedule", {})
    if (s.get("first_hour"), s.get("last_hour"), s.get("weekdays_only"), s.get("enabled")) != (first, last, weekdays_only, enabled) \
            or {k: v for k, v in new.items() if k != "schedule"} != {k: v for k, v in old.items() if k != "schedule"}:
        sys.exit("config.toml wasn't changed: the edit didn't come out as expected.")
    if new_text == old_text and job_loaded() and _read(PLIST) == plist(new):
        return
    # Turning checks on or off alone needs no launchd change, since run.sh reads it at each scheduled
    # run. Reload when the job is missing or its plist is out of date (e.g. from before --scheduled).
    old_plist = _read(PLIST)
    was_loaded = job_loaded()
    reload = not was_loaded or old_plist != plist(new)
    # Reloading the job would stop a running check, so wait for it. Turning checks on or off is fine mid-check.
    if reload and os.path.isdir(LOCK):
        sys.exit("A check is running. Save again when it finishes.")
    _write(CONFIG, new_text)
    if not reload:
        return
    try:
        load_job(plist(new))
    except (RuntimeError, OSError) as e:
        _write(CONFIG, old_text)
        if old_plist is not None and was_loaded:
            try:
                load_job(old_plist)
                undo = "Your previous schedule is back and running."
            except (RuntimeError, OSError) as e2:
                undo = f"Your previous schedule couldn't be restored either ({e2}), so no checks are scheduled. Run ./install.sh."
        else:
            undo = "config.toml is unchanged. No checks were scheduled before, and none are now."
            if old_plist is not None:
                try:
                    _write(PLIST, old_plist)
                except OSError:
                    pass
        sys.exit(f"Couldn't apply the new schedule: {e}\n{undo}")


# ---------- The Settings page and the preflight check ----------

def source_list(c):
    out = []
    if "github" in c:
        login = c.get("you", {}).get("github_login")
        out.append({"name": "GitHub", "detail": f"as {login}" if login else ""})
    if "slack" in c:
        n = len(c["slack"].get("channels", []))
        out.append({"name": "Slack", "detail": f"{n} channel{'' if n == 1 else 's'} watched" if n else ""})
    if "t3" in c:
        out.append({"name": "T3 Code threads", "detail": ""})
    return out


def settings(c):
    first, last, weekdays = schedule(c)
    cl = c.get("claude", {})
    try:
        with open(os.path.join(DIR, "last_check")) as f:
            last_check = f.read().strip()
    except OSError:
        last_check = ""
    return {
        "schedule": {"first": first, "last": last, "weekdaysOnly": weekdays, "enabled": checks_on(c)},
        "scheduled": job_loaded(),
        "lastCheck": last_check,
        "sources": source_list(c),
        "model": cl.get("model", ""), "effort": cl.get("effort", ""), "timeoutMinutes": cl.get("timeout_minutes"),
        "configPath": CONFIG, "logsPath": os.path.join(DIR, "logs"),
    }


def check(c):
    """Look for the config mistakes and missing tools that would make the hourly run fail. Finding a
    tool doesn't prove its sign-in works; ./run.sh is the real test."""
    problems = []
    which = lambda cmd: shutil.which(os.path.expanduser(cmd), path=RUN_PATH)
    if not c.get("you", {}).get("name"):
        problems.append("[you] needs a name.")
    projects = c.get("projects", [])
    if not projects:
        problems.append("Add at least one [[projects]] entry.")
    for p in projects:
        if not p.get("key") or not p.get("name"):
            problems.append("Every [[projects]] entry needs a key and a name.")
        elif p.get("priority") not in ("high", "medium", "low"):
            problems.append(f"Project {p['key']}: priority must be high, medium or low.")
    first, last, weekdays = schedule(c)
    if not all(isinstance(h, int) and not isinstance(h, bool) for h in (first, last)) or not (0 <= first <= last <= 23):
        problems.append("[schedule] first_hour and last_hour must be whole hours from 0 to 23, first at or before last.")
    if not isinstance(weekdays, bool) or not isinstance(checks_on(c), bool):
        problems.append("[schedule] weekdays_only and enabled must be true or false.")
    cl = c.get("claude", {})
    if not cl.get("model") or not cl.get("effort"):
        problems.append("[claude] needs a model and an effort.")
    t = cl.get("timeout_minutes")
    if not isinstance(t, int) or isinstance(t, bool) or t <= 0:
        problems.append("[claude] timeout_minutes must be a whole number of minutes.")
    if not which("claude"):
        problems.append("Claude Code (claude) isn't on the PATH the hourly run uses.")
    if not any(k in c for k in ("github", "slack", "t3")):
        problems.append("Turn on at least one source: [github], [slack] or [t3].")
    if "github" in c:
        if not which("gh"):
            problems.append("[github] is on, but the GitHub CLI (gh) isn't installed.")
        elif subprocess.run([which("gh"), "auth", "status"], capture_output=True).returncode != 0:
            problems.append("[github] is on, but gh isn't signed in. Run: gh auth login")
    if "slack" in c:
        cmd = c["slack"].get("mcp_command") or [""]
        if not which(cmd[0]):
            problems.append(f"[slack] mcp_command: {cmd[0] or '(empty)'} isn't installed or isn't on the PATH.")
    if "t3" in c and not os.path.exists(os.path.expanduser(c["t3"].get("db", ""))):
        problems.append(f"[t3] db: {c['t3'].get('db')} doesn't exist.")
    return problems


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    c = load()
    cmd = args[0]
    if cmd == "get":
        section, key = args[1].split(".", 1)
        print(c.get(section, {})[key])
    elif cmd == "prompt":
        print(prompt(c))
    elif cmd == "mcp":
        print(mcp(c))
    elif cmd == "tools":
        print(tools(c))
    elif cmd == "sources":
        print(stamp_sources(c))
    elif cmd == "standup-on":
        print(1 if standup_on(c) else 0)
    elif cmd == "checks-on":
        print(1 if checks_on(c) else 0)
    elif cmd == "init":
        init(c)
    elif cmd == "check":
        problems = check(c)
        for p in problems:
            print("Fix: " + p)
        if problems:
            sys.exit(1)
        print("Config and tools look right. This doesn't test your sign-ins; run ./run.sh once for a real check.")
    elif cmd == "schedule":
        install_schedule(c)
    elif cmd == "settings":
        print(json.dumps(settings(c)))
    elif cmd == "set-schedule" and len(args) == 5:
        try:
            first, last = int(args[1]), int(args[2])
        except ValueError:
            sys.exit("Hours must be whole numbers.")
        set_schedule(first, last, args[3] == "1", args[4] == "1")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
