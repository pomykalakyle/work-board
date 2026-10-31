<!--
The standup draft rules. config.py adds them to the hourly prompt (prompt.md's
{{STANDUP}}) only when config.toml has [standup] enabled = true. Written to the
agent; {{CHANNEL}} and {{STYLE}} are filled in from config.toml and preferences.md.
-->
Then update the standup draft. The user posts an end-of-day update{{CHANNEL}}, and the app shows this draft with a copy button so they can paste it.
 - It lives in work_standup: day (local date 'YYYY-MM-DD', primary key), text, updated_at (local time like '2026-10-29 17:00'). Read today's row (there may be none yet), then write the whole draft with db.py exec "INSERT INTO work_standup (day, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at". If nothing changed and the draft is still right, leave it alone.
 - It covers the whole day so far, not just this run: build it from today's work_events rows, the existing draft, and what you found this run.
 - Shape, as plain text: one short line saying what the day was about; then one "- " line per item; then a blank line, "Blockers:" and one "- " line per blocker. No headings, bold or emoji. Links are Markdown, [#412](https://...), and only to PRs, issues or docs you actually saw.
 - Items are work the user got done today, at outcome level: PRs opened, pushed, reviewed or merged, investigations and what they found, plans and docs. Messages sent don't count as work. Merge small things into one item; aim for about four.
 - Blockers are the asks the user is waiting on, mostly the board's blocked tasks: "- Waiting on @Name for the migration tool scope." Use the name the user works with them by. With none, write "Blockers: none" on its own.
 - Write as the user, first person without starting items with "I", plain and specific. No em or en dashes, filler, hype or "successfully". {{PAST_POSTS}}
 - Don't mention draft updates in your report.
{{STYLE}}
