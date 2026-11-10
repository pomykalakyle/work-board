"""Render the work board HTML from two db.py query results.

Usage:
  python3 -I render_board.py tasks.json projects.json "stamp text" [--standalone] [--out board.html] [--json-out board.json] [--events events.json]

--json-out also writes the ranked board as data for the Work Board app.
--events adds the history (newest first) to that data, for the task panel, the History page and project activity:
  SELECT e.id, e.at, e.task_key, e.kind, e.text, t.title, t.status, t.project_key FROM work_events e
  LEFT JOIN work_tasks t ON t.task_key = e.task_key ORDER BY e.at DESC, e.id DESC

With --out the page is written atomically (temp file, then rename) and made
read-only, so a stray `> board.html` redirect can't blank it. Without --out
it prints to stdout.

tasks.json:
  SELECT task_key, title, status, tier, tier_reason, impact, urgency, effort, impact_reason, urgency_reason, pinned,
         next_step, blocked_on, link, done_at, project_key, source
  FROM work_tasks
All done tasks go into board.json's project lists (newest first); board.html shows only today's.
projects.json:
  SELECT project_key, name, priority, stage, done_when, color, rank
  FROM work_projects WHERE status = 'active' ORDER BY rank

Open tasks rank by tier (must, should, later), then score = (impact + urgency)
/ effort, then urgency, then impact. The first DO_NEXT Must and Should tasks go
under "Do next"; Later-tier tasks never do. Without --standalone the page
expects the host to supply theme variables; with it, the page adds its own
dark background for a browser tab.
"""
import datetime
import html
import json
import os
import re
import sys
import tempfile

DIR = os.path.dirname(os.path.abspath(__file__))


def ranking_sections(path=os.path.join(DIR, "ranking.md")):
    """ranking.md for the app's scoring page. It's the one copy of the ranking
    rules; config.py puts the same file in the hourly prompt. Returns
    {"intro": [paragraphs], "sections": [{"title", "paras", "head", "rows":
    [{"key", "summary", "detail"}], "context": [paragraphs]}]}. Read line by
    line, so a missing blank line around a heading or table loses nothing."""
    text = re.sub(r"<!--.*?-->", "", open(path).read(), flags=re.S)
    out = {"intro": [], "sections": []}
    cur, in_context, para, table = None, False, [], []

    def flush():
        if para:
            (out["intro"] if cur is None else cur["context"] if in_context else cur["paras"]).append(" ".join(para))
            para.clear()
        if table:
            if cur is None:
                sys.exit("ranking.md: a table must come after a ## heading")
            cells = [[c.strip() for c in l.strip("|").split("|")] for l in table if not re.fullmatch(r"\|[\s|:-]+\|", l)]
            if len(cells) < 2 or any(len(r) < 2 for r in cells):
                sys.exit(f"ranking.md: the table under '{cur['title']}' needs a header row and rows of at least two cells")
            cur["head"] = cells[0]
            cur["rows"] = [{"key": r[0], "summary": r[1], "detail": r[2] if len(r) > 2 else ""} for r in cells[1:]]
            table.clear()

    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            flush()
            level = len(line) - len(line.lstrip("#"))
            if level == 2:
                cur = {"title": line[2:].strip(), "paras": [], "head": [], "rows": [], "context": []}
                out["sections"].append(cur)
                in_context = False
            elif level == 3:
                in_context = True  # "### Context": the paragraphs after it explain the section
        elif line.startswith("|"):
            if para:
                flush()
            table.append(line)
        elif not line:
            flush()
        else:
            if table:
                flush()
            para.append(line)
    flush()
    return out


RANKING = ranking_sections()
# The Do next count and the effort labels come from ranking.md too, so the page and the prompt agree.
_m = re.search(r"Do next takes the first (\d+) ", " ".join(RANKING["intro"]))
if not _m:
    sys.exit('ranking.md must say "Do next takes the first N ..."')
DO_NEXT = int(_m.group(1))
_effort = next(s["rows"] for s in RANKING["sections"] if s["title"] == "Effort")
EFFORT_WORD = {int(r["key"]): r["summary"][0].lower() + r["summary"][1:] for r in _effort}

STYLE = """
:root{--fg:var(--foreground,#e8e6e3);--mut:var(--muted-foreground,#9a978f);--line:var(--border,#34322e);
--hi:#d9a441;--ok:var(--chart-3,#6fae8f);--mono:var(--font-mono,ui-monospace,SFMono-Regular,monospace)}
body{font:14px/1.45 var(--font-sans,-apple-system,BlinkMacSystemFont,sans-serif);color:var(--fg);margin:0;padding:2px 0 8px}
a{color:inherit;text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px}
a:hover{text-decoration-color:var(--fg)}
code{font:12.5px var(--mono)}
.top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline;font-size:12px;color:var(--mut);margin-bottom:14px}
h2{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:20px 0 6px}
.task{display:grid;grid-template-columns:20px 1fr 54px;gap:1px 10px;padding:9px 0;border-top:1px solid var(--line)}
.task:first-of-type{border-top:0}
.n{color:var(--mut);font-variant-numeric:tabular-nums;padding-top:1px}
.title{font-weight:600}
.why{grid-column:2;font-size:12.5px;color:var(--mut)}
.why .h{color:var(--hi)}
.step{grid-column:2;font-size:13px;opacity:.85}
.proj{display:inline-flex;align-items:center;gap:5px}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none}
.score{grid-row:1/4;grid-column:3;text-align:right;font:600 15px var(--mono);padding-top:1px}
.bar{height:3px;background:var(--line);border-radius:2px;margin-top:5px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--hi)}
.blk{display:grid;grid-template-columns:76px 1fr;gap:0 10px;padding:6px 0;border-top:1px solid var(--line);font-size:13px}
.blk:first-of-type{border-top:0}
.who{font-size:12px;border:1px solid var(--ok);color:var(--ok);border-radius:4px;padding:0 6px;justify-self:start;align-self:start;margin-top:1px;white-space:nowrap}
.then{color:var(--mut)}
.empty{font-size:13px;color:var(--mut);padding:4px 0}
details.p{border-top:1px solid var(--line)}
details.p:last-of-type{border-bottom:1px solid var(--line)}
details.p>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:14px 1fr auto;gap:0 10px;padding:9px 0}
details.p>summary::-webkit-details-marker{display:none}
.car{color:var(--mut);font-size:10px;padding-top:4px;transition:transform .15s}
details[open]>summary .car{transform:rotate(90deg)}
.pname{font-weight:600}
.pri{font-size:11px;letter-spacing:.04em;text-transform:uppercase;margin-left:8px;color:var(--mut)}
.pri.high{color:var(--hi)}
.done-when{grid-column:2/4;font-size:12.5px;color:var(--mut)}
.counts{font-size:12px;color:var(--mut);white-space:nowrap}
.inner{padding:0 0 10px 24px}
.mini{display:grid;grid-template-columns:1fr auto;gap:0 10px;font-size:13px;padding:4px 0}
.mini .s{font:12px var(--mono);color:var(--mut)}
.mini.blkd .s{color:var(--ok);font-family:inherit}
.mini.parked{color:var(--mut)}
.mini.parked .s{font-family:inherit}
.mini.dn{color:var(--mut)}
.mini.dn>span:first-child{text-decoration:line-through;text-decoration-color:var(--line)}
details.rubric{margin-top:18px;font-size:12.5px;color:var(--mut)}
details.rubric summary{cursor:pointer;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
table{border-collapse:collapse;margin-top:8px;width:100%}
td,th{text-align:left;padding:4px 8px 4px 0;border-top:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--fg)}
"""

STANDALONE = """
html{background:#171614;color-scheme:dark}
body{max-width:780px;margin:28px auto;padding:0 20px}
"""

URGENCY_WORD = {5: "customer waiting", 4: "someone chased it", 3: "asked recently", 2: "your work in flight", 1: "nobody waiting"}
PRIORITY_NUM = {"high": 4, "medium": 3, "low": 2}
TIERS = ("must", "should", "later")

RANK_STYLE = """
table.rank{margin:0;width:100%;table-layout:fixed}
table.rank th{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);border-top:0;padding-bottom:6px}
table.rank td{padding:9px 10px 9px 0}
table.rank col.c-n{width:28px}table.rank col.c-f{width:118px}table.rank col.c-s{width:86px}
table.rank .n{font:600 15px var(--mono);color:var(--fg)}
table.rank.later .n,table.rank.later .title{color:var(--mut);font-weight:500}
.v{font:600 14px var(--mono)}
.v.hot{color:var(--hi)}
.r{display:block;font-size:12px;color:var(--mut);line-height:1.35;margin-top:1px}
.nx{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;font-size:12.5px;color:var(--mut);margin-top:3px}
.nx b{font-weight:500;color:var(--fg);opacity:.75}
.math{display:block;font:12px var(--mono);color:var(--mut);margin-top:2px;white-space:nowrap}
.tie{display:block;font-size:11.5px;color:var(--mut);margin-top:2px}
"""


def esc(s):
    return html.escape(str(s) if s is not None else "")


LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def with_links(text):
    """Escape text, turning Markdown links [label](https://...) into anchors."""
    out, last = [], 0
    for m in LINK.finditer(text or ""):
        out.append(esc(text[last:m.start()]))
        out.append(f'<a href="{esc(m.group(2))}">{esc(m.group(1))}</a>')
        last = m.end()
    out.append(esc((text or "")[last:]))
    return "".join(out)



def rows_of(path):
    data = json.load(open(path))
    return [dict(zip(data["columns"], v)) for v in data["rows"]]


def score(t):
    if not (t.get("impact") and t.get("urgency") and t.get("effort")):
        return 0.0
    return (t["impact"] + t["urgency"]) / t["effort"]


def tier_of(t):
    return t.get("tier") if t.get("tier") in TIERS else "should"


def rank_key(t):
    return (TIERS.index(tier_of(t)), -score(t), -(t.get("urgency") or 0), -(t.get("impact") or 0))


def sections(open_tasks):
    """'next' for the first DO_NEXT Must and Should tasks, 'later' for the rest."""
    out, n = [], 0
    for t in open_tasks:
        nxt = tier_of(t) != "later" and n < DO_NEXT
        n += nxt
        out.append("next" if nxt else "later")
    return out


def linked(t, text=None):
    label = esc(text if text is not None else t["title"])
    return f'<a href="{esc(t["link"])}">{label}</a>' if t.get("link") else label


def dot(color):
    return f'<span class="dot" style="background:{esc(color or "#777")}"></span>'


def short_name(p):
    return esc(p["name"].split(":")[0].removesuffix(" tool")) if p else "No project"


def impact_reason(t, proj):
    pri = (proj or {}).get("priority")
    base = PRIORITY_NUM.get(pri)
    name = short_name(proj)
    if base is None:
        return "no project"
    if t.get("impact") == base:
        return f"{name} is {esc(pri)} priority"
    if t.get("impact", 0) < base:
        return f"lower than {name} ({esc(pri)})"
    return f"above {name} ({esc(pri)})"


def factor(value, reason, pinned_field, pinned):
    mark = " · you set it" if pinned_field in pinned else ""
    return f'<td><span class="v">{esc(value if value else "?")}</span><span class="r">{reason}{mark}</span></td>'


def tie_text(t, prev):
    """Why this task sits below the one above it when their scores match."""
    if not prev or tier_of(prev) != tier_of(t) or round(score(prev), 2) != round(score(t), 2):
        return ""
    if (prev.get("urgency") or 0) > (t.get("urgency") or 0):
        return "tie: the one above is more urgent"
    if (prev.get("impact") or 0) > (t.get("impact") or 0):
        return "tie: the one above has more impact"
    return "tie: same numbers"


def tie_note(t, prev):
    text = tie_text(t, prev)
    return f'<span class="tie">{esc(text)}</span>' if text else ""


def link_label(url):
    if not url:
        return ""
    if "/pull/" in url:
        return "Open PR #" + url.rstrip("/").rsplit("/", 1)[-1]
    if "slack.com" in url:
        return "Open Slack thread"
    if "github.com" in url:
        return "Open on GitHub"
    return "Open link"


def board_data(tasks, projects, stamp, events=(), standup=None, notes=()):
    """The ranked board as plain data, for the Work Board app (board.json)."""
    by_key = {p["project_key"]: p for p in projects}
    open_tasks = sorted((t for t in tasks if t["status"] == "open"), key=rank_key)
    section = sections(open_tasks)

    def proj_of(t):
        p = by_key.get(t.get("project_key"))
        return {"name": html.unescape(short_name(p)), "color": (p or {}).get("color") or "#777"}

    def ranked(i, t):
        pinned = {x.strip() for x in (t.get("pinned") or "").split(",") if x.strip()}
        imp, urg, eff = t.get("impact"), t.get("urgency"), t.get("effort")
        return {
            "key": t["task_key"], "rank": i + 1, "title": t["title"], "status": "open",
            "section": section[i], "tier": tier_of(t), "tierReason": t.get("tier_reason") or "",
            "tierPinned": "tier" in pinned,
            "project": proj_of(t), "link": t.get("link") or "", "linkLabel": link_label(t.get("link")),
            "score": round(score(t), 2), "formula": f"({imp}+{urg})÷{eff}",
            "tie": tie_text(t, open_tasks[i - 1] if i else None),
            "factors": [
                {"name": "Impact", "value": imp, "pinned": "impact" in pinned,
                 "reason": t.get("impact_reason") or html.unescape(impact_reason(t, by_key.get(t.get("project_key"))))},
                {"name": "Urgency", "value": urg, "pinned": "urgency" in pinned,
                 "reason": t.get("urgency_reason") or URGENCY_WORD.get(urg, "")},
                {"name": "Effort", "value": eff, "pinned": "effort" in pinned,
                 "reason": EFFORT_WORD.get(eff, "")},
            ],
            "next": t.get("next_step") or "", "source": t.get("source") or "",
        }

    def plain(t):
        return {"key": t["task_key"], "title": t["title"], "status": t["status"],
                "project": proj_of(t), "link": t.get("link") or "", "linkLabel": link_label(t.get("link")),
                "blockedOn": t.get("blocked_on") or "", "next": t.get("next_step") or "",
                "source": t.get("source") or "", "doneAt": t.get("done_at") or "",
                "score": round(score(t), 2) if t["status"] == "open" else None}

    ranked_rows = [ranked(i, t) for i, t in enumerate(open_tasks)]
    rank_of = {r["key"]: r["rank"] for r in ranked_rows}
    project_rows = []
    for p in projects + ([{"project_key": None, "name": "No project", "priority": "low", "color": "#777"}]
                         if any(t.get("project_key") not in by_key for t in tasks) else []):
        mine = [t for t in tasks if (t.get("project_key") in by_key and t.get("project_key") == p["project_key"])
                or (p["project_key"] is None and t.get("project_key") not in by_key)]
        project_rows.append({
            "key": p["project_key"] or "none", "name": p["name"], "color": p.get("color") or "#777",
            "priority": p.get("priority") or "", "stage": p.get("stage") or "", "doneWhen": p.get("done_when") or "",
            # Open by rank, then blocked, parked, and done with the newest first.
            "tasks": [dict(plain(t), rank=rank_of.get(t["task_key"])) for t in
                      sorted((t for t in mine if t["status"] != "done"),
                             key=lambda t: ({"open": 0, "blocked": 1, "parked": 2}[t["status"]], rank_key(t)))
                      + sorted((t for t in mine if t["status"] == "done"), key=lambda t: t.get("done_at") or "", reverse=True)],
        })
    return {
        "stamp": stamp, "doNext": DO_NEXT, "ranking": RANKING,
        "ranked": ranked_rows,
        "blocked": [plain(t) for t in tasks if t["status"] == "blocked"],
        "projects": project_rows,
        # An event about a project and no task is a change to that project's notes.
        "events": [{"id": e.get("id"), "at": e["at"], "key": e.get("task_key"), "kind": e.get("kind") or "update",
                    "title": e.get("title") or ("Project notes" if not e.get("task_key") and e.get("project_key") else ""),
                    "taskStatus": e.get("status") or "", "project": e.get("project_key"), "text": e["text"]} for e in events],
        # The user's notes in force, newest first: on a task (task set) or a whole project (project set).
        "notes": [{"id": n["id"], "task": n.get("task_key"), "project": n.get("project_key"), "text": n["text"],
                   "createdAt": n.get("created_at") or "", "updatedAt": n.get("updated_at") or "",
                   # On a task's note written on one of its history rows: that row's id, time and text.
                   "event": n.get("event_id"), "eventAt": n.get("event_at") or "", "eventText": n.get("event_text") or ""}
                  for n in notes],
        # None when [standup] is off; with it on, the newest draft (empty before the first one is written).
        "standup": standup,
    }


def rank_table(rows, by_key, start, later=False):
    head = ('<table class="rank{}"><colgroup><col class="c-n"><col><col class="c-f"><col class="c-f">'
            '<col class="c-f"><col class="c-s"></colgroup><tr><th>#</th><th>Task</th><th>Impact</th>'
            '<th>Urgency</th><th>Effort</th><th>Score</th></tr>').format(" later" if later else "")
    out = [head]
    for i, t in enumerate(rows):
        proj = by_key.get(t.get("project_key"))
        pinned = {p.strip() for p in (t.get("pinned") or "").split(",") if p.strip()}
        imp, urg, eff = t.get("impact"), t.get("urgency"), t.get("effort")
        step = f'<span class="nx" title="{esc(t["next_step"])}"><b>Next:</b> {esc(t["next_step"])}</span>' if t.get("next_step") else ""
        prev = rows[i - 1] if i else None
        out.append(
            f'<tr><td class="n">{start + i}</td>'
            f'<td><span class="title">{linked(t)}</span><span class="r">{tier_of(t).title()} · <span class="proj">{dot(proj.get("color") if proj else None)}{short_name(proj)}</span></span>{step}</td>'
            + factor(imp, with_links(t["impact_reason"]) if t.get("impact_reason") else impact_reason(t, proj), "impact", pinned)
            + factor(urg, with_links(t.get("urgency_reason") or URGENCY_WORD.get(urg, "")), "urgency", pinned)
            + factor(eff, esc(EFFORT_WORD.get(eff, "")), "effort", pinned)
            + f'<td><span class="v">{score(t):.1f}</span>'
              f'<span class="math">({esc(imp)}+{esc(urg)})÷{esc(eff)}</span>{tie_note(t, prev)}</td></tr>')
    out.append("</table>")
    return "".join(out)


def mini_row(t):
    st = t["status"]
    if st == "open":
        return f'<div class="mini"><span>{linked(t)}</span><span class="s">{score(t):.1f}</span></div>'
    if st == "blocked":
        return f'<div class="mini blkd"><span>{linked(t)}</span><span class="s">{esc(t.get("blocked_on") or "?")}</span></div>'
    if st == "parked":
        return f'<div class="mini parked"><span>{linked(t)}</span><span class="s">ignore</span></div>'
    when = (t.get("done_at") or "")[5:10]
    return f'<div class="mini dn"><span>{linked(t)}</span><span class="s">{esc(when)}</span></div>'


def project_block(p, tasks):
    order = {"open": 0, "blocked": 1, "parked": 2, "done": 3}
    tasks = sorted(tasks, key=lambda t: (order[t["status"]], rank_key(t)))
    counts = {s: sum(1 for t in tasks if t["status"] == s) for s in ("open", "blocked", "done")}
    count_txt = " · ".join(f"{n} {s}" for s, n in counts.items() if n) or "nothing open"
    pri = esc(p["priority"]) + (f' · {esc(p["stage"])}' if p.get("stage") else "")
    pri_cls = "pri high" if p["priority"] == "high" else "pri"
    inner = "".join(mini_row(t) for t in tasks) or '<div class="empty">No tasks yet.</div>'
    done_when = f'<span class="done-when">{esc(p["done_when"])}</span>' if p.get("done_when") else ""
    return (f'<details class="p"><summary><span class="car">▶</span>'
            f'<span>{dot(p.get("color"))} <span class="pname">{esc(p["name"])}</span><span class="{pri_cls}">{pri}</span></span>'
            f'<span class="counts">{count_txt}</span>{done_when}</summary><div class="inner">{inner}</div></details>')


def rubric_html():
    """The same ranking.md the app shows, for board.html."""
    r = RANKING
    out = [f"<p>{esc(p)}</p>" for p in r["intro"]]
    for sec in r["sections"]:
        out.append(f"<p><b>{esc(sec['title'])}</b></p>" + "".join(f"<p>{esc(p)}</p>" for p in sec["paras"]))
        if sec["rows"]:
            out.append("<table>" + "".join(f"<tr><th>{esc(x['key'])}</th><td>{esc(x['detail'] or x['summary'])}</td></tr>" for x in sec["rows"]) + "</table>")
        out += [f"<p>{esc(p)}</p>" for p in sec["context"]]
    return ('<details class="rubric"><summary>How scoring works</summary>' + "".join(out)
            + '<p>To override a number or a tier, ask an agent to pin it, e.g. "pin api-docs urgency 4". Pinned values stick.</p></details>')


def main():
    tasks = rows_of(sys.argv[1])
    projects = rows_of(sys.argv[2])
    stamp = sys.argv[3]
    style = STYLE + RANK_STYLE + (STANDALONE if "--standalone" in sys.argv[4:] else "")
    by_key = {p["project_key"]: p for p in projects}

    open_tasks = sorted((t for t in tasks if t["status"] == "open"), key=rank_key)
    section = sections(open_tasks)
    do_next = [t for t, sec in zip(open_tasks, section) if sec == "next"]
    later = [t for t, sec in zip(open_tasks, section) if sec == "later"]
    blocked = [t for t in tasks if t["status"] == "blocked"]
    # The page lists only tasks finished today; board.json gets every done task.
    today = datetime.date.today().isoformat()
    recent = [t for t in tasks if t["status"] != "done" or (t.get("done_at") or "") >= today]

    out = [f"<!doctype html><html><head><meta charset='utf-8'><title>Work board</title><style>{style}</style></head><body>",
           f'<div class="top"><span>{esc(stamp)}</span><span>{len(do_next)} to do · '
           f'{len(blocked)} blocked · {len(projects)} projects</span></div>',
           "<h2>Do next</h2>"]
    if do_next:
        out.append(rank_table(do_next, by_key, 1))
    else:
        out.append('<div class="empty">Nothing to do next.</div>')
    if later:
        out.append("<h2>Later, in rank order</h2>")
        out.append(rank_table(later, by_key, len(do_next) + 1, later=True))

    if blocked:
        out.append("<h2>Blocked</h2><div>")
        for t in blocked:
            then = f'<span class="nx" title="{esc(t["next_step"])}">{esc(t["next_step"])}</span>' if t.get("next_step") else ""
            out.append(f'<div class="blk"><span class="who">{esc(t.get("blocked_on") or "?")}</span><span>{linked(t)}{then}</span></div>')
        out.append("</div>")

    out.append("<h2>Projects</h2><div>")
    for p in projects:
        out.append(project_block(p, [t for t in recent if t.get("project_key") == p["project_key"]]))
    loose = [t for t in recent if t.get("project_key") not in by_key]
    if loose:
        out.append(project_block({"name": "No project", "priority": "low", "color": "#777",
                                  "done_when": "Tasks that don't fit a project yet."}, loose))
    out.append("</div>")
    out.append(rubric_html())
    out.append("</body></html>")
    page = "\n".join(out)

    flags = sys.argv[4:]
    if "--json-out" in flags:
        target = os.path.abspath(flags[flags.index("--json-out") + 1])
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            events = rows_of(flags[flags.index("--events") + 1]) if "--events" in flags else []
            standup = None
            if "--standup" in flags:
                rows = rows_of(flags[flags.index("--standup") + 1])
                standup = ({"day": rows[0]["day"], "text": rows[0]["text"], "updatedAt": rows[0]["updated_at"] or ""}
                           if rows else {"day": "", "text": "", "updatedAt": ""})
            notes = rows_of(flags[flags.index("--notes") + 1]) if "--notes" in flags else []
            json.dump(board_data(tasks, projects, stamp, events, standup, notes), f, indent=1)
        os.chmod(tmp, 0o644)
        os.replace(tmp, target)
    if "--out" in flags:
        target = os.path.abspath(flags[flags.index("--out") + 1])
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            f.write(page + "\n")
        os.chmod(tmp, 0o444)
        os.replace(tmp, target)
    else:
        print(page)


if __name__ == "__main__":
    main()
