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
  !!e.key && (e.project === p.key || p.tasks.some((t) => t.key === e.key));
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
  if (ui.sel < 0 && i >= 0 && isProjectView()) actTop.set(ui.view, el("detail")?.scrollTop ?? 0);
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
    if (isProjectView() && ui.sel >= 0) { showActivity(); e.preventDefault(); }
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
  // No selection (a project's activity) stays that way.
  if (ui.sel < 0) return;
  // In a project, follow the task by key: one that just got done shows the done tasks,
  // and one that's gone goes back to the activity, rather than selecting whatever moved into its place.
  const p = currentProject();
  if (p && keep) {
    revealDone(p, keep);
    ui.sel = items().findIndex((t) => t.key === keep);
    return;
  }
  const idx = items().findIndex((t) => t.key === keep);
  ui.sel = idx >= 0 ? idx : Math.min(ui.sel, Math.max(0, items().length - 1));
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
