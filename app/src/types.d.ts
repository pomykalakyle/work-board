// Shared types: the shape of board.json (written by render_board.py) and the API
// preload.ts exposes to the window. Global declarations, so every part of the app
// (main process, Svelte components, and the plain theme.js script) can use them
// without imports.

type Status = "open" | "blocked" | "parked" | "done";
type Tier = "must" | "should" | "later";

interface ProjectRef {
  name: string;
  color: string;
}

interface Factor {
  name: "Impact" | "Urgency" | "Effort";
  value: number | null;
  pinned: boolean;
  reason: string;
}

// Fields every task row has, ranked or not.
interface TaskBase {
  key: string;
  title: string;
  status: Status;
  project: ProjectRef;
  link: string;
  linkLabel: string;
  next: string;
  source: string;
  score: number | null;
}

// A task in "blocked" or a project's list.
interface Task extends TaskBase {
  blockedOn: string;
  doneAt: string;
  rank?: number | null;
}

// An open task in "ranked", with its tier, numbers and reasons.
interface RankedTask extends TaskBase {
  rank: number;
  section: "next" | "later";
  tier: Tier;
  tierReason: string;
  tierPinned: boolean;
  formula: string;
  tie: string;
  factors: Factor[];
}

// What a list row can be: either kind, so the fields only one kind has are optional.
interface ListTask extends TaskBase {
  blockedOn?: string;
  doneAt?: string;
  rank?: number | null;
  tier?: Tier;
}

interface Project {
  key: string;
  name: string;
  color: string;
  priority: string;
  stage: string;
  doneWhen: string;
  tasks: Task[];
}

interface BoardEvent {
  id: number;
  at: string;
  key: string | null;
  // priority: a rank, tier or score move; note: the user added, edited or removed a note (notes.py)
  kind: "added" | "blocked" | "unblocked" | "done" | "update" | "priority" | "note";
  title: string;
  taskStatus: string;
  // The task's project key, or null for news that isn't about one task. Set even for
  // done tasks that have dropped off board.json, so project history stays complete.
  project?: string | null;
  text: string;
}

// ranking.md, parsed by render_board.py's ranking_sections().
interface RuleRow {
  key: string;
  summary: string;
  detail: string;
}
interface RuleSection {
  title: string;
  paras: string[];
  head: string[];
  rows: RuleRow[];
  context: string[];
}
interface Ranking {
  intro: string[];
  sections: RuleSection[];
}

interface Board {
  stamp: string;
  doNext: number;
  ranking: Ranking;
  ranked: RankedTask[];
  blocked: Task[];
  projects: Project[];
  events: BoardEvent[];
  // The newest standup draft, or null when config.toml's [standup] is off.
  // Empty strings until the first check with it on writes one.
  standup: { day: string; text: string; updatedAt: string } | null;
  // The user's notes in force, newest first. Missing from a board.json written before notes existed.
  notes?: Note[];
}

// A note the user wrote on a task (task set) or a whole project (project set). The hourly check
// follows it and cites it as [your note](note:ID) when it changes something because of it.
interface Note {
  id: number;
  task: string | null;
  project: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
  // A task's note written on one of its history rows: that row's id, time and text (null and "" otherwise).
  event?: number | null;
  eventAt?: string;
  eventText?: string;
}
// "task:KEY" or "project:KEY": what a note is on, and what its quick check re-checks.
type NoteScope = `task:${string}` | `project:${string}`;
// Where a new note goes: a task, a project, or one history row of a task ("event:ID", checked with its task).
type NoteTarget = NoteScope | `event:${number}`;
// A quick check finished: ok is false when it failed (the note itself is saved either way).
interface NoteCheckResult {
  scope: NoteScope;
  id: number;
  ok: boolean;
}

interface Theme {
  id: string;
  name: string;
  colors: Record<string, string>;
}
interface ThemeState {
  id: string;
  themes: Theme[];
  opaqueSidebar: boolean;
}

type View = "next" | "later" | "blocked" | "history" | "standup" | "scoring" | "prefs" | "settings" | "keys" | `project:${string}`;

// preferences.md, which the Preferences page edits and the hourly check reads (config.py).
// A person is "- Name (Title): notes" in the file. The hourly check's prompt gets names and titles;
// the notes are read from the file when needed.
interface Person {
  name: string;
  title: string;
  notes: string;
}
interface Prefs {
  people: Person[];
  preferences: string[];
  standup: string[]; // standup style rules, for the optional standup draft
}

// config.toml's [schedule], as the Settings page edits it (config.py set-schedule).
interface Schedule {
  first: number; // hour of the first check, 0 to 23
  last: number; // hour of the last check
  weekdaysOnly: boolean;
  enabled: boolean; // false: launchd still fires, but run.sh --scheduled skips the check
}
// What config.py settings reports for the Settings page.
interface Settings {
  schedule: Schedule;
  scheduled: boolean; // the launchd job is loaded
  lastCheck: string; // last successful check, "YYYY-MM-DD HH:MM", or ""
  sources: { name: string; detail: string }[];
  model: string;
  effort: string;
  timeoutMinutes: number | null;
  configPath: string;
  logsPath: string;
}

// shortcuts.json: every action a key can run, and where it works. "move" works in every list,
// "list" in task lists, "history" on History, "note" in a note's text field, "global" anywhere outside a text field.
interface ShortcutAction {
  id: string;
  group: string;
  label: string;
  where?: string;
  scope: "move" | "list" | "history" | "note" | "global";
  defaults: string[];
}
// Bindings are "Ctrl+Alt+Shift+Meta+key" strings, modifiers in that order, at most two per action.
interface ShortcutState {
  actions: ShortcutAction[];
  bindings: Record<string, string[]>;
  menu: Record<string, string | null>; // the binding the app menu handles, if any; the window handles the rest
}

// Exposed by preload.ts.
interface BoardApi {
  onData(cb: (data: Board | null) => void): void;
  onRefreshing(cb: (on: boolean) => void): void;
  onGo(cb: (view: View) => void): void;
  onUpdateReady(cb: () => void): void;
  onRestarting(cb: () => void): void;
  restart(): Promise<void>;
  refresh(): Promise<void>;
  open(url: string): Promise<void>;
  getPrefs(): Promise<Prefs>;
  setPrefs(p: Prefs): Promise<Prefs>;
  onPrefs(cb: (p: Prefs) => void): void;
  getSettings(): Promise<Settings>;
  saveSchedule(s: Schedule): Promise<Settings>;
  onSettings(cb: (s: Settings) => void): void;
  reveal(what: "config" | "logs"): Promise<void>;
  // Puts both forms on the clipboard: apps like Slack paste the HTML (real links and bullets).
  copy(text: string, html: string): Promise<void>;
  onAction(cb: (id: string) => void): void;
  // Notes: each change rebuilds board.json (and sends it) before it resolves. addNote resolves to the new note's id.
  addNote(scope: NoteTarget, text: string): Promise<number | null>;
  editNote(id: number, text: string): Promise<void>;
  removeNote(id: number): Promise<void>;
  // Starts the quick check of a task or project and resolves to its id; onNoteCheck reports when it ends.
  checkNotes(scope: NoteScope): Promise<number>;
  onNoteCheck(cb: (r: NoteCheckResult) => void): void;
}
interface KeysApi {
  initial: ShortcutState;
  set(bindings: Record<string, string[]>): Promise<ShortcutState>;
  capture(on: boolean): Promise<void>;
  onChange(cb: (state: ShortcutState) => void): void;
}
interface ThemesApi {
  initial: ThemeState;
  set(id: string): Promise<void>;
  step(by: 1 | -1): Promise<void>;
  onChange(cb: (state: ThemeState) => void): void;
}

interface Window {
  board: BoardApi;
  themes: ThemesApi;
  keys: KeysApi;
  applyTheme(state: ThemeState): void;
}
