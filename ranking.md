<!--
The ranking rules, in one place, written to the user. The hourly job's prompt
includes this file (prompt.md's {{RANKING}}), and the app's "How scoring works"
page shows it: Summary is what the page lists, Detail is the full rule shown for
the selected row, and a "### Context" section shows with every row of its section.
render_board.py also reads the Do next count and the Effort summaries from here.
Keep the shape: "## Section", paragraphs, one | table | per section, optional "### Context".
-->
# How tasks are ranked

Tier first, then score. Do next takes the first 4 Must and Should tasks. Later tasks never go there, however quick they are.

## Tiers

| Tier | Summary | Detail |
|---|---|---|
| Must | Customer stuck, outage, chased, or told to do it first | A customer or prospect is stuck or waiting on you, production is broken, someone has re-pinged you or said they're waiting on you, or one of the people you work with said to do it first (e.g. finish open PRs before new work). |
| Should | High or medium priority project work | Moves a high or medium priority project forward. |
| Later | Cleanup or side work, nobody waiting | Cleanup, nice-to-have or side work (upstream PRs, small fixes) with nobody waiting. |

### Context

Who says what comes first is a tier question, not urgency.

## Score

Score = (impact + urgency) / effort, from 0.4 to 10.

Within a tier, higher scores go first. Ties go to the more urgent task, then the one with more impact.

## Impact

How much finishing it matters.

| Level | Summary | Detail |
|---|---|---|
| 5 | Customer or company priority | A customer or company priority. |
| 4 | Core project work | Core work on a high-priority project. |
| 3 | Progress or teammate unblocked | Moves your work forward or unblocks a teammate. |
| 2 | Nice to have | Nice to have. |
| 1 | Cleanup | Cleanup. |

### Context

Start from the project's priority (high 4, medium 3, low 2) and move it up or down for this task.

## Urgency

Who is waiting on you, and have they chased it?

| Level | Summary | Detail |
|---|---|---|
| 5 | Live customer or production outage | A customer or prospect is stuck or waiting in a live thread, or production is broken for users. |
| 4 | Chased, due today, or overdue | Someone re-pinged you or said they're waiting on you, set a today or "first thing" cutoff, or a direct ask has gone past when your team expects an answer without you delivering. |
| 3 | Recent direct ask | A teammate asked you directly (a Slack ask, a review request, a question), it's still within when your team expects an answer, and nobody has chased it. |
| 2 | Your work in flight | Your own work in flight that the team expects you to finish though nobody is chasing it: review feedback on your PRs, approved PRs not yet merged, open drafts. |
| 1 | Nobody waiting | Nobody is waiting, or someone said it can wait ("no rush", "not a priority", "after the freeze"). |

### Context

When your team expects an answer, and how lateness shows up, come from your preferences. A today cutoff is something like a feature freeze announced for today.

## Effort

How long it takes.

| Level | Summary |
|---|---|
| 5 | A week or more |
| 4 | 2 to 3 days |
| 3 | About a day |
| 2 | Half a day |
| 1 | Under an hour |
