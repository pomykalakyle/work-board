// Pure helpers for history groups (one task's events from one day) and day summaries.
import { KIND_WORD, parseAt, ymd } from "./text";

const TRANSITIONS = new Set(["added", "blocked", "unblocked", "done"]);
export const isTransition = (e: BoardEvent) => TRANSITIONS.has(e.kind);

// A collapsed group shows its newest real updates. Rank and tier moves ('priority')
// only show when the group has nothing else, so a bare title never stands alone.
export function preview(evs: BoardEvent[], n = 2): BoardEvent[] {
  const real = evs.filter((e) => e.kind !== "priority");
  return real.length ? real.slice(0, n) : evs.slice(0, 1);
}

// What the "Show N more" toggle hides that matters: "includes Blocked, Unblocked, 2 priority changes".
export function hiddenNote(hidden: BoardEvent[]): string {
  const oldestFirst = [...hidden].reverse();
  const words = [...new Set(oldestFirst.filter(isTransition).map((e) => KIND_WORD[e.kind]))];
  const pri = hidden.filter((e) => e.kind === "priority").length;
  if (pri) words.push(`${pri} priority ${pri === 1 ? "change" : "changes"}`);
  return words.length ? "includes " + words.join(", ") : "";
}

function dayWord(d: Date | null): string {
  if (!d) return "";
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (ymd(d) === ymd(today)) return "today";
  if (ymd(d) === ymd(yesterday)) return "yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

// A group's latest status change (events are newest first), for the History row's change slot.
export const latestChange = (evs: BoardEvent[]) => evs.find(isTransition) ?? null;

// The day's latest status change next to where the task stands now, without saying the
// same thing twice: "Done today" (not also "Now: Done"), "Blocked today on Alex",
// or "Unblocked yesterday" plus "Now: Done". The change comes from each event's kind,
// never its taskStatus, which is the task's status now rather than at the time.
export function groupStatus(evs: BoardEvent[], now: string | null): { kind: string; label: string; now: string | null } | null {
  const t = latestChange(evs);
  if (!t) return null;
  const word = KIND_WORD[t.kind];
  const label = `${word} ${dayWord(parseAt(t.at))}`.trim();
  const same = now?.match(new RegExp(`^Now: ${word}(.*)$`));
  return same ? { kind: t.kind, label: label + same[1], now: null } : { kind: t.kind, label, now };
}

// "7 tasks changed · 2 done · 2 added" for one day's groups. Counts tasks, not events,
// so a task blocked and unblocked twice still counts once. Zero counts are left out.
export function daySummary(groups: { key: string | null; events: BoardEvent[] }[]): string {
  const tasks = groups.filter((g) => g.key);
  if (!tasks.length) return "";
  const withKind = (k: string) => tasks.filter((g) => g.events.some((e) => e.kind === k)).length;
  const parts = [`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} changed`];
  const done = withKind("done"), added = withKind("added");
  if (done) parts.push(`${done} done`);
  if (added) parts.push(`${added} added`);
  return parts.join(" · ");
}
