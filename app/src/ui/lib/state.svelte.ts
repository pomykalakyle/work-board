// The window's state and the actions that change it. Components read `ui`
// directly; Svelte re-renders whatever read a field when that field changes.

import { tick } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { innerWidth } from "svelte/reactivity/window";
import { parseAt, ymd, TIER_NAME, ruleId } from "./text";

// ---------- keyboard shortcuts ----------

// A key press as a binding string: "Ctrl+Alt+Shift+Meta+key", modifiers in that order. Letters are
// lowercase (Shift is its own part) and the space bar is "Space". null for a modifier on its own.
export function comboOf(e: KeyboardEvent): string | null {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "Dead", "Unidentified"].includes(e.key)) return null;
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta", key].filter(Boolean).join("+");
}

// Whether a key press is typing into a field, where only ⌘ and ⌃ shortcuts apply.
export const inField = (e: KeyboardEvent) =>
  e.target instanceof Element && !!e.target.closest("input, textarea, select, [contenteditable]");

// The action in one of these scopes that a key press runs, if any.
export function actionFor(e: KeyboardEvent, scopes: ShortcutAction["scope"][]): ShortcutAction | null {
  const combo = comboOf(e);
  if (!combo) return null;
  return ui.shortcuts.actions.find((a) => scopes.includes(a.scope) && ui.shortcuts.bindings[a.id]?.includes(combo)) ?? null;
}
export const isAction = (e: KeyboardEvent, id: string) => {
  const a = ui.shortcuts.actions.find((x) => x.id === id);
  return !!a && actionFor(e, [a.scope])?.id === id;
};

type Dir = "down" | "up" | "left" | "right";
// The move a key press means, from the Move shortcuts (the arrow keys unless the user changed them).
export function dirOf(e: KeyboardEvent): Dir | null {
  const id = actionFor(e, ["move"])?.id;
  return id === "down" || id === "up" || id === "left" || id === "right" ? id : null;
}

// Where Esc on a task's History goes back to: the view and the task (by key, so a refresh that reorders the list still finds it).
interface HistoryBack { view: View; key: string | null; detailTop: number }

// The window's state, as a class with reactive fields (Svelte's recommended way to
// share state across components). Nested objects are deeply reactive; board.json
// and the theme list are only ever replaced whole, so they're raw (not proxied).
class AppState {
  data = $state.raw<Board | null>(null);
  view = $state<View>("next");
  // The selected row in the list. -1 is no selection: a project then shows its activity.
  sel = $state(0);
  checking = $state(false);
  updateReady = $state(false);
  restarting = $state(false);
  theme = $state.raw<ThemeState>(window.themes.initial);
  // "Why this ranking": one app-wide preference, closed at first.
  whyOpen = $state(localStorage.getItem("whyOpen") === "1");
  // A task's "Your notes" section: one app-wide preference, closed at first.
  notesOpen = $state(localStorage.getItem("notesOpen") === "1");
  // The project whose notes fill the details panel (its header's notes button), or null.
  notesView = $state<string | null>(null);
  // A task kept in the details panel after a note's check moved it out of this list (null: none).
  held = $state<string | null>(null);
  // A project's full "Done when" text (clamped to two lines when closed): one app-wide preference.
  goalOpen = $state(localStorage.getItem("goalOpen") === "1");
  // The detail panel's width and whether it's hidden.
  layout = $state<{ width: number; collapsed: boolean }>(JSON.parse(localStorage.getItem("detailLayout") || '{"width":380,"collapsed":false}'));
  // History page: an optional task scope (from "Open in History"), where Esc goes back to, the selected group.
  // The selection is a group id (not a position), so an hourly refresh that adds events keeps it on the same group.
  hist = $state<{ scope: string | null; back: HistoryBack | null; selId: string | null }>({ scope: null, back: null, selId: null });
  // Selected rule on the scoring page (null: the first one).
  rule = $state<string | null>(null);
  // Theme picker: the header button it opened from (null when closed) and its keyboard focus row.
  picker = $state<{ from: HTMLButtonElement | null; focus: number }>({ from: null, focus: 0 });
  // preferences.md as last read or saved (null until the main process answers). Replaced whole, so raw.
  prefs = $state.raw<Prefs | null>(null);
  // config.py's Settings data (null until it answers), or why it couldn't be read (e.g. no config.toml).
  settings = $state.raw<Settings | null>(null);
  settingsError = $state("");
  // Every action's keys (shortcuts.json plus the user's changes). Replaced whole, so raw.
  shortcuts = $state.raw<ShortcutState>(window.keys.initial);
  // True while the Keyboard page records a shortcut: every other key handler stands down.
  recording = $state(false);
}

export const ui = new AppState();

// History groups showing their older entries; how far each task's "Recent activity" is opened (until the app quits).
export const histOpen = new SvelteSet<string>();
export const recentShown = new SvelteMap<string, number>();
// How many done tasks each project shows (none until opened), and how many task groups its activity shows (until the app quits).
export const doneShown = new SvelteMap<string, number>();
export const DONE_STEP = 10;
export const actShown = new SvelteMap<string, number>();
// Where each project's activity was scrolled when a task was opened, so going back returns there.
const actTop = new Map<string, number>();
// Scoring page disclosures that are open, remembered across launches.
export const scoringOpen = new SvelteSet<string>(JSON.parse(localStorage.getItem("scoringOpen") || "[]"));

// The window's fixed elements, for focus and scroll restoring.
const el = (id: string) => document.getElementById(id);

// ---------- what's on screen ----------

const PAGES: Record<string, string> = { history: "History", standup: "Standup", scoring: "How scoring works", prefs: "Preferences", settings: "Settings", keys: "Keyboard" };
export const pageTitle = () => PAGES[ui.view] ?? "";
export const onPage = () => ui.view in PAGES;

export function items(): ListTask[] {
  const d = ui.data;
  if (!d || onPage()) return [];
  if (ui.view === "next") return d.ranked.filter((r) => r.section === "next");
  if (ui.view === "later") return d.ranked.filter((r) => r.section === "later");
  if (ui.view === "blocked") return d.blocked;
  const p = currentProject();
  return p ? projectRows(p) : [];
}

export const currentProject = () => ui.data?.projects.find((p) => "project:" + p.key === ui.view) ?? null;
export const isProjectView = () => ui.view.startsWith("project:");

// A project's tasks in list order (render_board.py sorts them: open by rank, then blocked,
// parked, done newest first). Only as many done tasks as are shown, unless `all`.
export function projectRows(p: Project, all = false): Task[] {
  if (all) return p.tasks;
  let left = doneShown.get(p.key) ?? 0;
  return p.tasks.filter((t) => t.status !== "done" || left-- > 0);
}

// Show enough of a project's done tasks to include this one (if it's done).
function revealDone(p: Project, key: string) {
  const i = p.tasks.filter((t) => t.status === "done").findIndex((t) => t.key === key);
  if (i >= 0 && (doneShown.get(p.key) ?? 0) <= i) doneShown.set(p.key, Math.ceil((i + 1) / DONE_STEP) * DONE_STEP);
}

// Whether an event belongs to a project. Events carry their task's project, which also
// covers done tasks that are no longer in board.json; news about no task belongs to none.
export const inProject = (p: Project) => (e: BoardEvent) =>
  e.key ? e.project === p.key || p.tasks.some((t) => t.key === e.key) : e.project === p.key; // the latter: its notes
export const rankedOf = (key: string) => ui.data?.ranked.find((r) => r.key === key);
export const eventsOf = (key: string) => (ui.data?.events || []).filter((e) => e.key === key);

export function viewTitle(): [string, string] {
  if (ui.view === "next") return ["Do next", "Must and Should, best first"];
  if (ui.view === "later") return ["Later", "Everything else, in rank order"];
  if (ui.view === "blocked") return ["Blocked", "Waiting on someone else"];
  const p = currentProject();
  return p ? [p.name, [p.priority && p.priority + " priority", p.stage].filter(Boolean).join(", ")] : ["", ""];
}

// Where a task lives now, so History can jump to it.
export function findTask(key: string | null | undefined): { view: View; i: number } | null {
  const d = ui.data;
  if (!d || !key) return null;
  for (const view of ["next", "later"] as const) {
    const i = d.ranked.filter((r) => r.section === view).findIndex((r) => r.key === key);
    if (i >= 0) return { view, i };
  }
  let i = d.blocked.findIndex((t) => t.key === key);
  if (i >= 0) return { view: "blocked", i };
  for (const p of d.projects) {
    i = projectRows(p, true).findIndex((t) => t.key === key);
    if (i >= 0) return { view: `project:${p.key}`, i };
  }
  return null;
}

// "Now: #2 · Must": where the task stands on the live board (not when the event happened).
export function nowText(key: string, fallbackStatus: string): string | null {
  const d = ui.data;
  const r = d?.ranked.find((r) => r.key === key);
  if (r) return `Now: #${r.rank} · ${TIER_NAME[r.tier]}`;
  const b = d?.blocked.find((t) => t.key === key);
  if (b) return "Now: Blocked" + (b.blockedOn ? " on " + b.blockedOn : "");
  for (const p of d?.projects || []) {
    const t = p.tasks.find((t) => t.key === key);
    if (t) return "Now: " + (t.status === "done" ? "Done" : t.status === "parked" ? "Parked" : t.status);
  }
  return ({ done: "Now: Done", parked: "Now: Parked", blocked: "Now: Blocked" } as Record<string, string>)[fallbackStatus] || null;
}

export function projectOfKey(key: string | null): Project | null {
  for (const p of ui.data?.projects || []) if (p.tasks.some((t) => t.key === key)) return p;
  return null;
}

// A history group's project: its task's, or the one its events name (a done task no longer on the board).
export const projectOfGroup = (g: HistoryGroup) =>
  projectOfKey(g.key) ?? ui.data?.projects.find((p) => g.events[0]?.project === p.key) ?? null;

export interface HistoryGroup { id: string; key: string | null; title: string; status: string; events: BoardEvent[] }

// Day, then one group per task, ordered by each group's newest event. `keep` picks the
// events (a project's); by default, all of them or the History page's one task.
export function historyGroups(keep?: (e: BoardEvent) => boolean): { day: string; date: Date | null; groups: HistoryGroup[] }[] {
  const evs = (ui.data?.events || []).filter(keep ?? ((e) => !ui.hist.scope || e.key === ui.hist.scope));
  // Grouped through maps, so even an out-of-order or malformed date can't produce two
  // groups with the same day (which would be duplicate keys in the page's {#each}).
  const days = new Map<string, { day: string; date: Date | null; groups: HistoryGroup[] }>();
  const byId = new Map<string, HistoryGroup>();
  for (const e of evs) { // events arrive newest first
    const d = parseAt(e.at);
    const day = d ? ymd(d) : "?";
    let g = byId.get(day + "|" + e.key);
    if (!g) {
      if (!days.has(day)) days.set(day, { day, date: d, groups: [] });
      g = { id: day + "|" + e.key, key: e.key, title: e.title, status: e.taskStatus, events: [] };
      byId.set(g.id, g);
      days.get(day)!.groups.push(g);
    }
    g.events.push(e);
  }
  return [...days.values()];
}

export const ruleSections = () => (ui.data?.ranking?.sections || []).filter((s) => s.rows.length);

// The sources config.toml turns on, like "GitHub, Slack and your T3 threads", taken from the stamp's " from ..." part.
export const sourcesText = () => ui.data?.stamp.match(/ from (.*)/)?.[1] || "your sources";

// ---------- actions ----------

export function go(view: View) {
  ui.notesView = null;
  ui.held = null;
  ui.hist.scope = null;
  ui.hist.back = null;
  if (view === "history") ui.hist.selId = null;
  ui.view = view;
  // A project opens on its activity, with no task selected, scrolled to the top.
  const project = view.startsWith("project:");
  if (project) actTop.delete(view);
  ui.sel = project ? -1 : 0;
  // Focus the content, not the sidebar button that was clicked: otherwise Space and Enter
  // would re-click that button instead of acting on the list or page.
  tick().then(() => el(onPage() ? "page" : "list")?.focus());
}

export function select(i: number) {
  if (ui.sel < 0 && i >= 0 && isProjectView() && !ui.notesView && !ui.held) actTop.set(ui.view, el("detail")?.scrollTop ?? 0);
  ui.notesView = null;
  ui.held = null;
  ui.sel = i;
}

// Back from a task to its project's activity (Esc or "← Project activity").
export function showActivity() {
  if (isProjectView()) ui.sel = -1;
}
export const activityTop = (view: View) => actTop.get(view) ?? 0;

// Select a task in the current project, showing the done tasks first if it's one of them.
export function selectInProject(key: string) {
  const p = currentProject();
  if (!p) return;
  revealDone(p, key);
  const i = items().findIndex((t) => t.key === key);
  if (i >= 0) select(i);
}

// Show or hide a project's done tasks (the newest DONE_STEP at first). Hiding them while one is selected goes back to the activity.
export function toggleDone(p: Project) {
  if (!doneShown.has(p.key)) { doneShown.set(p.key, DONE_STEP); return; }
  const selDone = items()[ui.sel]?.status === "done";
  doneShown.delete(p.key);
  if (selDone) ui.sel = -1;
}

export function openLink(t: ListTask | undefined) {
  if (t && t.link) window.board.open(t.link);
}

export function openTask(key: string) {
  const at = findTask(key);
  if (!at) return;
  ui.notesView = null;
  ui.held = null;
  ui.hist.scope = null;
  ui.view = at.view;
  if (at.view.startsWith("project:")) {
    ui.sel = -1;
    selectInProject(key);
  } else ui.sel = at.i;
  showDetail();
  tick().then(() => el("list")?.focus());
}

export function openHistoryFor(key: string) {
  ui.hist.back = { view: ui.view, key: items()[ui.sel]?.key ?? null, detailTop: el("detail")?.scrollTop ?? 0 };
  ui.hist.scope = key;
  ui.hist.selId = null;
  ui.view = "history";
  tick().then(() => el("page")?.focus());
}

export async function leaveScopedHistory() {
  const b = ui.hist.back;
  ui.hist.scope = null;
  ui.hist.back = null;
  if (!b) return;
  ui.view = b.view;
  // The same task if it's still in that view; otherwise a project's activity, or the top of the list.
  const p = currentProject();
  if (p && b.key) revealDone(p, b.key);
  const i = b.key ? items().findIndex((t) => t.key === b.key) : -1;
  ui.sel = i >= 0 ? i : p ? -1 : 0;
  await tick();
  const detail = el("detail");
  if (detail) detail.scrollTop = i >= 0 ? b.detailTop || 0 : 0;
  el("list")?.focus();
}

export function toggleWhy() {
  ui.whyOpen = !ui.whyOpen;
  localStorage.setItem("whyOpen", ui.whyOpen ? "1" : "0");
}

export function toggleGoal() {
  ui.goalOpen = !ui.goalOpen;
  localStorage.setItem("goalOpen", ui.goalOpen ? "1" : "0");
}

export function toggleHistGroup(id: string) {
  histOpen.has(id) ? histOpen.delete(id) : histOpen.add(id);
}

// The History page shows the newest day open and older days collapsed to their header;
// histDays holds the older days opened (until the app quits).
export const histDays = new SvelteSet<string>();
export function visibleHistory() {
  return historyGroups().map((d, i) => ({ ...d, open: i === 0 || histDays.has(d.day) }));
}
export function toggleHistDay(day: string) {
  histDays.has(day) ? histDays.delete(day) : histDays.add(day);
}

export function toggleScoring(id: string) {
  scoringOpen.has(id) ? scoringOpen.delete(id) : scoringOpen.add(id);
  localStorage.setItem("scoringOpen", JSON.stringify([...scoringOpen]));
}

// ---------- the detail panel's size ----------

const MIN_DETAIL = 260;  // narrowest open width
const SNAP_CLOSED = 200; // dragging narrower than this hides the panel

// Called from an $effect in App.svelte, so it re-runs when the window resizes (innerWidth is reactive).
export function applyLayout() {
  const width = innerWidth.current ?? window.innerWidth;
  const rail = width <= 1080;
  const sidebar = rail ? 86 : 210;
  const max = Math.max(MIN_DETAIL, width - sidebar - 300);
  const w = Math.min(Math.max(ui.layout.width, MIN_DETAIL), max);
  document.body.style.setProperty("--detail-w", w + "px");
  document.body.style.setProperty("--detail-w-rail", w + "px");
  document.body.classList.toggle("collapsed", ui.layout.collapsed);
  localStorage.setItem("detailLayout", JSON.stringify(ui.layout));
}

export function toggleDetail() {
  ui.layout.collapsed = !ui.layout.collapsed;
}

export function showDetail() {
  if (ui.layout.collapsed) ui.layout.collapsed = false;
}

// While dragging the divider: the panel's new width, or hidden when dragged nearly shut.
export function dragDetailTo(clientX: number) {
  const w = window.innerWidth - clientX;
  if (w < SNAP_CLOSED) ui.layout.collapsed = true;
  else {
    ui.layout.collapsed = false;
    ui.layout.width = Math.max(MIN_DETAIL, w);
  }
}

// ---------- keys ----------

// Down and up move (arrows, or the Keyboard preset's letters), Enter opens the task's link, r toggles
// "Why this ranking", Esc goes from a project's task back to its activity. With nothing selected, down
// picks the first task and up the last.
export function listKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    if (ui.notesView) { closeProjectNotes(); e.preventDefault(); }
    else if (isProjectView() && ui.sel >= 0) { showActivity(); e.preventDefault(); }
    return;
  }
  const n = items().length;
  if (!n) return;
  // Moving also moves focus to the list, so Enter then opens the task, not a header button that had focus.
  const d = dirOf(e);
  if (d === "down") {
    select(ui.sel < 0 ? 0 : Math.min(n - 1, ui.sel + 1));
    el("list")?.focus();
    e.preventDefault();
  } else if (d === "up") {
    select(ui.sel < 0 ? n - 1 : Math.max(0, ui.sel - 1));
    el("list")?.focus();
    e.preventDefault();
  } else if (isAction(e, "openLink")) {
    openLink(items()[ui.sel]);
    e.preventDefault();
  } else if (isAction(e, "toggleWhy")) {
    toggleWhy();
    e.preventDefault();
  } else if (isAction(e, "addNote")) {
    focusNote();
    e.preventDefault();
  }
}

// The selected History group's position: the one with the selected id, or the first when none is (or it's gone).
export function histSelIndex(flat: HistoryGroup[]) {
  return Math.max(0, flat.findIndex((g) => g.id === ui.hist.selId));
}

// Moves focus back to the page after a click on a button inside it, so the page's keys
// (Space, Enter) act on the selection rather than re-clicking that button.
export const focusPage = () => el("page")?.focus();

// Down and up pick a task row (skipping collapsed days), Space opens its day under the row (narrow
// windows; wide ones show it beside the list), Enter opens the task, Esc leaves a task's history.
export function historyKey(e: KeyboardEvent) {
  if (e.key === "Escape" && ui.hist.scope) { leaveScopedHistory(); e.preventDefault(); return; }
  const flat = visibleHistory().filter((d) => d.open).flatMap((d) => d.groups);
  if (!flat.length || ui.hist.scope) return;
  const i = histSelIndex(flat);
  const g = flat[i];
  const d = dirOf(e);
  if (d === "down") ui.hist.selId = flat[Math.min(flat.length - 1, i + 1)].id;
  else if (d === "up") ui.hist.selId = flat[Math.max(0, i - 1)].id;
  else if (isAction(e, "toggleOlder")) toggleHistGroup(g.id);
  else if (isAction(e, "openTask")) { if (findTask(g.key)) openTask(g.key!); return; }
  else return;
  e.preventDefault();
}

// Down and up move through the rules in reading order; left and right jump to the same level in the previous or next list.
export function scoringKey(e: KeyboardEvent) {
  const secs = ruleSections();
  const flat = secs.flatMap((sec) => sec.rows.map((r) => ({ sec, r })));
  if (!flat.length) return;
  let i = Math.max(0, flat.findIndex((x) => ruleId(x.sec, x.r) === ui.rule)); // none or gone: the first rule
  const d = dirOf(e);
  if (d === "down") i = Math.min(flat.length - 1, i + 1);
  else if (d === "up") i = Math.max(0, i - 1);
  else if (d === "left" || d === "right") {
    const si = secs.indexOf(flat[i].sec);
    const ri = flat[i].sec.rows.indexOf(flat[i].r);
    const to = secs[si + (d === "left" ? -1 : 1)];
    if (!to) return;
    i = flat.findIndex((x) => x.sec === to && x.r === to.rows[Math.min(ri, to.rows.length - 1)]);
  } else return;
  e.preventDefault();
  ui.rule = ruleId(flat[i].sec, flat[i].r);
}

// A global action, from the app menu or a shortcut the window handles.
export function runAction(id: string) {
  const views: Record<string, View> = { goNext: "next", goLater: "later", goBlocked: "blocked", goHistory: "history", goSettings: "settings" };
  if (views[id]) go(views[id]);
  else if (id === "checkNow") window.board.refresh();
  else if (id === "toggleDetails") toggleDetail();
  else if (id === "prevTheme") window.themes.step(-1);
  else if (id === "nextTheme") window.themes.step(1);
}

// ---------- data from the main process ----------

// A new board.json: keep the same task selected if it's still in this view.
export function setData(data: Board | null) {
  const keep = items()[ui.sel]?.key;
  ui.data = data;
  if (data && ((ui.view.startsWith("project:") && !data.projects.some((p) => "project:" + p.key === ui.view)) || (ui.view === "standup" && !data.standup))) {
    ui.view = "next";
    ui.sel = 0;
    return;
  }
  // No selection (a project's activity, or a held task) stays that way.
  if (ui.sel < 0) return;
  // In a project, follow the task by key: one that just got done shows the done tasks,
  // and one that's gone goes back to the activity, rather than selecting whatever moved into its place.
  const p = currentProject();
  if (p && keep) revealDone(p, keep);
  const idx = items().findIndex((t) => t.key === keep);
  // A note's check moved the task out of this list: keep showing it, since the result is what the user is waiting for.
  if (idx < 0 && keep && noteChecks.has("task:" + keep) && taskByKey(keep)) {
    ui.held = keep;
    ui.sel = -1;
    return;
  }
  if (p && keep) ui.sel = idx;
  else ui.sel = idx >= 0 ? idx : Math.min(ui.sel, Math.max(0, items().length - 1));
}

// ---------- notes ----------
// The user's notes on a task or project (board.json's notes, written through notes.py). Saving one
// starts a quick check of that task or project; its state per scope ("task:KEY" or "project:KEY")
// lives in noteChecks until the app quits, so the result stays visible after switching tasks.

export const taskNotes = (key: string) => (ui.data?.notes || []).filter((n) => n.task === key);
export const projectNotes = (key: string) => (ui.data?.notes || []).filter((n) => n.project === key);
export const noteById = (id: number) => (ui.data?.notes || []).find((n) => n.id === id) ?? null;
// The note in force on one history row, if any (a row takes one at a time).
export const eventNote = (id: number) => (ui.data?.notes || []).find((n) => n.event === id) ?? null;
// Whether a history row can take a note: a task's own news that the board still has, not a note change.
export const canNoteEvent = (e: BoardEvent) => !!e.key && e.kind !== "note" && typeof e.id === "number" && !!taskByKey(e.key);
// The history rows whose note field is open (until the app quits).
export const eventEditors = new SvelteSet<number>();
// The task's real project ("No project" can't have notes).
export const notesProjectOf = (taskKey: string) => {
  const p = projectOfKey(taskKey);
  return p && p.key !== "none" ? p : null;
};

// A task wherever it is on the board: ranked (with its numbers), blocked, or in a project's list.
export function taskByKey(key: string): ListTask | null {
  const d = ui.data;
  if (!d) return null;
  return d.ranked.find((r) => r.key === key) ?? d.blocked.find((t) => t.key === key)
    ?? d.projects.flatMap((p) => p.tasks).find((t) => t.key === key) ?? null;
}

// Unsent text per scope, kept across task switches (until the app quits).
export const drafts = new SvelteMap<string, string>();
// How many notes a task or project shows (until the app quits).
export const notesShown = new SvelteMap<string, number>();
export const NOTES_FIRST = 2;

type Snap = Record<string, string>;
export interface NoteCheck {
  phase: "saving" | "saved" | "checking" | "done" | "saveError" | "checkError";
  id: number;        // the check's id, so an older check's result can't stand in for a newer one
  text: string;      // the result ("Re-reviewed · Next step changed") or the error
  before?: Snap;     // the board before the check, to say what it changed
  origin?: string;   // where the change was made ("event:ID" under a history row; unset in the notes section), where its status shows
}
export const noteChecks = new SvelteMap<string, NoteCheck>();

const STATUS_WORD: Record<string, string> = { open: "open", blocked: "blocked", parked: "parked", done: "done", gone: "gone" };

// What the board shows for a task, as text per field, to tell what a check changed.
function taskSnap(key: string): Record<string, string> {
  const t = taskByKey(key);
  const r = rankedOf(key);
  return {
    status: t?.status ?? "gone", next: t?.next ?? "", tier: r?.tier ?? "", rank: String(r?.rank ?? ""),
    blockedOn: t?.blockedOn ?? "", project: t?.project.name ?? "", scores: r ? r.factors.map((f) => f.value).join(",") : "",
  };
}
const scopeKeys = (scope: string): string[] => {
  if (scope.startsWith("task:")) return [scope.slice(5)];
  const p = ui.data?.projects.find((x) => "project:" + x.key === scope);
  return p ? p.tasks.filter((t) => t.status !== "done").map((t) => t.key) : [];
};
function snapshot(scope: string): Snap {
  return Object.fromEntries(scopeKeys(scope).map((k) => [k, JSON.stringify(taskSnap(k))]));
}

const FIELD_WORD: Record<string, string> = { next: "next step", tier: "tier", rank: "rank", blockedOn: "who it waits on", project: "project", scores: "scores" };

// "Re-reviewed · Now parked, next step changed", "Re-reviewed · No board changes", or for a project "Re-reviewed 4 tasks · 2 changed".
function describe(scope: string, before: Snap): string {
  if (scope.startsWith("task:")) {
    const key = scope.slice(5);
    const was = before[key] ? JSON.parse(before[key]) : {};
    const now = taskSnap(key);
    const parts: string[] = [];
    if (was.status !== now.status) parts.push("Now " + STATUS_WORD[now.status]);
    // A status change moves the tier and rank with it, so those aren't worth naming too.
    const fields = Object.keys(FIELD_WORD).filter((f) => was[f] !== now[f] && !(parts.length && ["tier", "rank", "scores"].includes(f)));
    if (fields.length) {
      const names = fields.map((f) => FIELD_WORD[f]);
      const list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0];
      parts.push((parts.length ? list : list[0].toUpperCase() + list.slice(1)) + " changed");
    }
    return "Re-reviewed · " + (parts.length ? parts.join(", ") : "No board changes");
  }
  const keys = [...new Set([...Object.keys(before), ...scopeKeys(scope)])];
  const changed = keys.filter((k) => before[k] !== JSON.stringify(taskSnap(k))).length;
  return `Re-reviewed ${keys.length} task${keys.length === 1 ? "" : "s"} · ` + (changed ? `${changed} changed` : "No board changes");
}

// Start the quick check (or check again after a failure).
export async function checkScope(scope: NoteScope) {
  const before = snapshot(scope);
  const origin = noteChecks.get(scope)?.origin;
  noteChecks.set(scope, { phase: "checking", id: -1, text: "", before, origin });
  try {
    const id = await window.board.checkNotes(scope);
    // A result can't arrive before the id: a check takes at least seconds.
    const c = noteChecks.get(scope);
    if (c && c.phase === "checking" && c.id === -1) noteChecks.set(scope, { ...c, id });
  } catch (e) {
    noteChecks.set(scope, { phase: "checkError", id: 0, text: ipcError(e), origin });
  }
}

// Save a change to a note; checking is a separate button. False (with the error showing) when it didn't save.
async function change(scope: NoteScope, write: () => Promise<unknown>, origin?: string): Promise<boolean> {
  noteChecks.set(scope, { phase: "saving", id: 0, text: "", origin });
  try {
    await write();
  } catch (e) {
    noteChecks.set(scope, { phase: "saveError", id: 0, text: ipcError(e), origin });
    return false;
  }
  noteChecks.set(scope, { phase: "saved", id: 0, text: "", origin });
  return true;
}

export async function addNote(scope: NoteScope, text: string): Promise<boolean> {
  const ok = await change(scope, () => window.board.addNote(scope, text.trim()));
  // Clear the field only if it still holds what was saved: text typed while saving stays.
  if (ok && drafts.get(scope) === text) drafts.delete(scope);
  return ok;
}
// A note on one history row: saved with its task, its status shown under that row. Its draft is kept per row.
export async function addEventNote(e: BoardEvent, text: string): Promise<boolean> {
  const at = `event:${e.id}` as const;
  const ok = await change(`task:${e.key}`, () => window.board.addNote(at, text.trim()), at);
  if (ok && drafts.get(at) === text) drafts.delete(at);
  return ok;
}
export const editNote = (scope: NoteScope, id: number, text: string, origin?: string) => change(scope, () => window.board.editNote(id, text.trim()), origin);
export const removeNote = (scope: NoteScope, id: number, origin?: string) => change(scope, () => window.board.removeNote(id), origin);

// From the main process: a quick check ended. board.json was sent just before, so the board is current.
export function gotNoteCheck(r: NoteCheckResult) {
  const c = noteChecks.get(r.scope);
  if (!c || c.phase !== "checking" || c.id !== r.id) return; // an older check; a newer one is still running
  noteChecks.set(r.scope, r.ok ? { phase: "done", id: r.id, text: describe(r.scope, c.before ?? {}), origin: c.origin }
    : { phase: "checkError", id: r.id, text: "", origin: c.origin });
}

export function toggleNotes() {
  ui.notesOpen = !ui.notesOpen;
  localStorage.setItem("notesOpen", ui.notesOpen ? "1" : "0");
}

// Where a project's notes were opened from (the view, the task shown, the panel's scroll), to go back there.
let notesBack: { view: View; key: string | null; top: number } | null = null;

// A project's notes in the details panel. From a task in another view (a project note on its panel), go to
// the project with that task selected; "Back to task" returns to the view it came from.
export async function openProjectNotes(pkey: string, fromTask: string | null = null) {
  if (!ui.notesView) notesBack = { view: ui.view, key: items()[ui.sel]?.key ?? ui.held, top: el("detail")?.scrollTop ?? 0 };
  if (ui.view !== "project:" + pkey) {
    go(`project:${pkey}`);
    if (fromTask) selectInProject(fromTask);
  }
  ui.notesView = pkey;
  await tick();
  el("detail")!.scrollTop = 0;
}

export async function closeProjectNotes() {
  const b = notesBack;
  notesBack = null;
  ui.notesView = null;
  if (b && b.view !== ui.view) {
    ui.view = b.view;
    const i = b.key ? items().findIndex((t) => t.key === b.key) : -1;
    // The task left that view while its notes were open (a check moved it): keep showing it.
    if (i < 0 && b.key && taskByKey(b.key)) { ui.held = b.key; ui.sel = -1; }
    else ui.sel = i >= 0 ? i : isProjectView() ? -1 : 0;
  }
  await tick();
  const d = el("detail");
  if (d) d.scrollTop = b?.top ?? 0;
  el("list")?.focus();
}

// A cited note: a project's in its notes view, a task's in that task's open notes section.
export function showNote(n: Note) {
  const shown = items()[ui.sel]?.key ?? ui.held;
  if (n.project) { openProjectNotes(n.project, shown); return; }
  if (!n.task) return;
  if (shown !== n.task) openTask(n.task);
  if (!ui.notesOpen) toggleNotes();
  notesShown.set("task:" + n.task, Math.max(notesShown.get("task:" + n.task) ?? 0, taskNotes(n.task).length));
}

// The note field in the details panel (a task's, or a project's notes). c opens the task's notes first.
export async function focusNote() {
  if (!ui.notesView && !ui.notesOpen && (items()[ui.sel] || ui.held)) toggleNotes();
  if (!ui.notesView && !items()[ui.sel] && !ui.held) {
    const p = currentProject();
    if (!p || p.key === "none") return;
    await openProjectNotes(p.key);
  }
  showDetail();
  await tick();
  const input = el("note-input");
  input?.focus();
  input?.scrollIntoView({ block: "nearest" });
}

// ---------- preferences ----------

export function loadPrefs() {
  window.board.getPrefs().then((p) => (ui.prefs = p));
}

// Save a changed copy; the main process writes preferences.md and returns what it saved (trimmed, blanks dropped).
// If the write fails, the page goes back to what was there before and the error is rethrown for the page to show.
// ---------- settings ----------

// The main process's error text, without Electron's "Error invoking remote method" prefix.
export const ipcError = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

export async function loadSettings() {
  try {
    ui.settings = await window.board.getSettings();
    ui.settingsError = "";
  } catch (e) {
    ui.settings = null;
    ui.settingsError = ipcError(e);
  }
}

export function gotSettings(s: Settings) {
  ui.settings = s;
  ui.settingsError = "";
}

// Saves [schedule] and reloads the launchd job. Throws config.py's message, which says whether the old schedule is back.
export async function saveSchedule(s: Schedule) {
  try {
    ui.settings = await window.board.saveSchedule($state.snapshot(s));
  } catch (e) {
    await loadSettings(); // show what's actually saved now
    throw new Error(ipcError(e));
  }
}

// The next hour the saved schedule runs a check at, after now (null when it never does).
export function nextScheduled(s: Schedule, now = new Date()): Date | null {
  for (let i = 1; i <= 24 * 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + i);
    const weekday = d.getDay() >= 1 && d.getDay() <= 5;
    if (d.getHours() >= s.first && d.getHours() <= s.last && (weekday || !s.weekdaysOnly)) return d;
  }
  return null;
}

export async function savePrefs(p: Prefs) {
  const before = ui.prefs;
  ui.prefs = p;
  try {
    ui.prefs = await window.board.setPrefs($state.snapshot(p));
  } catch (e) {
    ui.prefs = before;
    throw e;
  }
}

// ---------- theme picker ----------

export const themeIndex = () => Math.max(0, ui.theme.themes.findIndex((t) => t.id === ui.theme.id));

export function openPicker(btn: HTMLButtonElement) {
  ui.picker.focus = themeIndex();
  ui.picker.from = btn;
}

export function closePicker(restoreFocus: boolean) {
  const from = ui.picker.from;
  if (!from) return;
  ui.picker.from = null;
  if (restoreFocus) from.focus();
}

export function setTheme(state: ThemeState) {
  const stepped = state.id !== ui.theme.id;
  ui.theme = state;
  window.applyTheme(state);
  if (stepped && ui.picker.from) ui.picker.focus = themeIndex();
}
