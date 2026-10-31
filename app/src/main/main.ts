// Work Board: a native-style window over board.json, which the hourly
// refresh job (run.sh, scheduled by install.sh) rewrites. The window
// updates itself when the file changes, and Refresh runs the job right away.

import { app, BrowserWindow, clipboard, ClipboardItem, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// original-fs sees the real file; Electron's patched fs treats app.asar as a cached folder.
import realFs from "original-fs";

// This file compiles to app/build/main.js, so the app folder is one level up.
const APP = path.resolve(__dirname, "..");

// The board folder: WORK_BOARD_DIR if set (for test runs), else what install.sh
// recorded in location.json, else the folder above app/.
function boardDir(): string {
  if (process.env.WORK_BOARD_DIR) return process.env.WORK_BOARD_DIR;
  try {
    return JSON.parse(fs.readFileSync(path.join(APP, "location.json"), "utf8")).dir;
  } catch {
    return path.resolve(APP, "..");
  }
}
const DIR = boardDir();
const DATA = path.join(DIR, "board.json");
const LOCK = path.join(DIR, ".lock");
const PREFS = path.join(DIR, "preferences.md");
// Starter preferences (tracked), shown and used until the first save writes preferences.md.
const PREFS_EXAMPLE = path.join(DIR, "preferences.example.md");
const boundsFile = () => path.join(app.getPath("userData"), "window.json");

// ---------- Themes ----------
// themes.json holds the color sets; the chosen ID lives in userData. This one
// setter serves the View > Theme menu, its shortcuts and the in-window picker.
const THEMES: Theme[] = JSON.parse(fs.readFileSync(path.join(APP, "themes.json"), "utf8"));
const themeFile = () => path.join(app.getPath("userData"), "theme.json");
let themeId = "";

function loadThemeId(): string {
  try {
    const id = JSON.parse(fs.readFileSync(themeFile(), "utf8")).id;
    if (THEMES.some((t) => t.id === id)) return id;
  } catch {}
  return THEMES[0].id;
}

// The sidebar is translucent only over macOS vibrancy; Linux and Reduce Transparency get a solid one.
const opaqueSidebar = () => process.platform !== "darwin" || nativeTheme.prefersReducedTransparency;
const themeState = (): ThemeState => ({ id: themeId, themes: THEMES, opaqueSidebar: opaqueSidebar() });

function setTheme(id: string) {
  if (!THEMES.some((t) => t.id === id) || id === themeId) return;
  themeId = id;
  try { fs.writeFileSync(themeFile(), JSON.stringify({ id })); } catch {}
  buildMenu();
  if (win) win.webContents.send("theme", themeState());
}

// ---------- Keyboard shortcuts ----------
// shortcuts.json lists every action; the user's changes (only those) live in userData/keys.json.
// Shortcuts with ⌘ or ⌃ become menu accelerators; plain keys are handled in the window, so they
// never fire while typing in a field. A binding is "Ctrl+Alt+Shift+Meta+key" (modifiers in that order).
const SHORTCUTS: ShortcutAction[] = JSON.parse(fs.readFileSync(path.join(APP, "shortcuts.json"), "utf8"));
const keysFile = () => path.join(app.getPath("userData"), "keys.json");
let keyOverrides: Record<string, string[]> = {};
let capturing = false;

function loadKeys() {
  try { keyOverrides = JSON.parse(fs.readFileSync(keysFile(), "utf8")); } catch { keyOverrides = {}; }
}
const bindingsOf = (a: ShortcutAction) => keyOverrides[a.id] ?? a.defaults;
const shortcutState = (): ShortcutState => ({
  actions: SHORTCUTS,
  bindings: Object.fromEntries(SHORTCUTS.map((a) => [a.id, bindingsOf(a)])),
  menu: Object.fromEntries(SHORTCUTS.map((a) => [a.id, menuBinding(a.id) ?? null])),
});

// Scopes that can see the same key press: global everywhere, moving in every list, but a task
// list and History never at once.
const overlaps = (a: string, b: string) => a === b || a === "global" || b === "global" || a === "move" || b === "move";

function saveKeys(bindings: Record<string, string[]>): ShortcutState {
  const next: Record<string, string[]> = {};
  for (const a of SHORTCUTS) {
    const keys = (bindings[a.id] ?? bindingsOf(a)).filter((k) => typeof k === "string" && k).slice(0, 2);
    if (keys.some((k) => !/^((Ctrl|Alt|Shift|Meta)\+)*[^+\s]+$|^((Ctrl|Alt|Shift|Meta)\+)*\+$/.test(k))) throw new Error(`Not a shortcut: ${keys.join(", ")}`);
    next[a.id] = keys;
  }
  // The page asks before moving a key, so a clash here is a bug: refuse rather than save it.
  for (const a of SHORTCUTS) for (const b of SHORTCUTS) {
    if (a.id < b.id && overlaps(a.scope, b.scope)) {
      const both = next[a.id].filter((k) => next[b.id].includes(k));
      if (both.length) throw new Error(`${both[0]} is set for both ${a.label} and ${b.label}`);
    }
  }
  // Write first: if saving fails, nothing changes and the page shows the error.
  const overrides = Object.fromEntries(SHORTCUTS.filter((a) => JSON.stringify(next[a.id]) !== JSON.stringify(a.defaults)).map((a) => [a.id, next[a.id]]));
  const tmp = keysFile() + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(overrides, null, 1));
    fs.renameSync(tmp, keysFile());
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  keyOverrides = overrides;
  buildMenu();
  const state = shortcutState();
  if (win) win.webContents.send("keys", state);
  return state;
}

// While the Keyboard page records a shortcut, the menu's shortcuts are off, so pressing ⌘R to
// record it doesn't also start a check.
function setCapturing(on: boolean) {
  capturing = on;
  win?.webContents.setIgnoreMenuShortcuts(on);
}

// The menu shows (and registers) an action's first ⌘ or ⌃ shortcut; the window handles the rest.
const ACCEL_KEYS: Record<string, string> = { ArrowDown: "Down", ArrowUp: "Up", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Return", Space: "Space", Backspace: "Backspace", Delete: "Delete" };
function menuBinding(id: string): string | undefined {
  const a = SHORTCUTS.find((x) => x.id === id);
  return a && bindingsOf(a).find((k) => /(^|\+)(Meta|Ctrl)\+/.test(k));
}
function accelerator(id: string): string | undefined {
  const k = menuBinding(id);
  if (!k) return undefined;
  const parts = k === "+" || k.endsWith("++") ? [...k.slice(0, -2).split("+").filter(Boolean), "Plus"] : k.split("+");
  const key = parts.pop()!;
  const mods = parts.map((m) => ({ Ctrl: "Control", Alt: "Alt", Shift: "Shift", Meta: "Command" })[m] ?? m);
  return [...mods, ACCEL_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key)].join("+");
}

function stepTheme(by: 1 | -1) {
  const i = THEMES.findIndex((t) => t.id === themeId);
  setTheme(THEMES[(i + by + THEMES.length) % THEMES.length].id);
}

// ---------- Preferences ----------
// preferences.md: "- " items under "## People" ("- Name (Title): notes"), "## Preferences" and
// "## Standup" (the standup draft's style; the section is written only when it has items).
// config.py parses the same shape for the hourly check's prompt.
const PREFS_HEADER = `<!--
Your Work Board preferences. Edit them on the app's Preferences page or here;
the next check reads them. Keep the headings; each item is one "- " line,
and a person is "- Name (Title): notes".
-->
`;

function readPrefs(): Prefs {
  const out: Prefs = { people: [], preferences: [], standup: [] };
  let text = "";
  try { text = fs.readFileSync(fs.existsSync(PREFS) ? PREFS : PREFS_EXAMPLE, "utf8"); } catch { return out; }
  let section = "";
  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    if (line.startsWith("## ")) section = line.slice(3).trim().toLowerCase();
    else if (line.startsWith("- ") && line.slice(2).trim()) {
      const item = line.slice(2).trim();
      if (section === "people") {
        const i = item.indexOf(":");
        const head = (i < 0 ? item : item.slice(0, i)).trim();
        const m = head.match(/^([^()]*?)\s*\(([^()]*)\)$/);
        out.people.push({ name: (m ? m[1] : head).trim(), title: m ? m[2].trim() : "", notes: i < 0 ? "" : item.slice(i + 1).trim() });
      } else if (section === "preferences" || section === "standup") out[section].push(item);
    }
  }
  return out;
}

// One line per item, so a pasted newline can't break the file's shape. A name or title can't hold
// a colon or parentheses, which mark where they end.
const oneLine = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();
const bare = (s: string) => oneLine(s).replace(/[:()]/g, "").trim();

function writePrefs(p: Prefs): Prefs {
  const people = (p.people || []).map((x) => ({ name: bare(x.name), title: bare(x.title), notes: oneLine(x.notes) })).filter((x) => x.name);
  const preferences = (p.preferences || []).map(oneLine).filter(Boolean);
  const standup = (p.standup || []).map(oneLine).filter(Boolean);
  const item = (s: string) => `- ${s}\n`;
  const body = PREFS_HEADER
    + "\n## People\n\n" + people.map((x) => item((x.title ? `${x.name} (${x.title})` : x.name) + (x.notes ? `: ${x.notes}` : ""))).join("")
    + "\n## Preferences\n\n" + preferences.map(item).join("")
    + (standup.length ? "\n## Standup\n\n" + standup.map(item).join("") : "");
  // Write a temp file and rename it, so the hourly check never reads half a file.
  const tmp = PREFS + ".tmp";
  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, PREFS);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return readPrefs();
}

// ---------- Settings ----------
// config.py reads and saves config.toml's [schedule] and reports the rest, so the app never
// parses TOML itself. It runs with run.sh's PATH: an app opened from Finder only has /usr/bin,
// whose python3 is too old for config.py.
const RUN_PATH = [path.join(os.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
const CONFIG = path.join(DIR, "config.toml");

function configPy(args: string[]): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: RUN_PATH };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    execFile("python3", ["-I", path.join(DIR, "config.py"), ...args], { cwd: DIR, env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout).trim() || err.message));
      else resolve(stdout);
    });
  });
}

const readSettings = async (): Promise<Settings> => JSON.parse(await configPy(["settings"]));

// Saves [schedule] and reloads the launchd job; config.py puts the old config and job back if that fails.
async function saveSchedule(s: Schedule): Promise<Settings> {
  const hour = (h: number) => String(Math.trunc(Number(h)));
  await configPy(["set-schedule", hour(s.first), hour(s.last), s.weekdaysOnly ? "1" : "0", s.enabled ? "1" : "0"]);
  return readSettings();
}

async function pushSettings() {
  if (!win) return;
  try { win.webContents.send("settings", await readSettings()); } catch {}
}

// Opens config.toml in its default editor (Finder shows it if nothing opens .toml files) or the logs folder.
async function reveal(what: "config" | "logs") {
  const target = what === "config" ? CONFIG : path.join(DIR, "logs");
  if (what === "logs") fs.mkdirSync(target, { recursive: true });
  if (await shell.openPath(target)) shell.showItemInFolder(target);
}

let win: BrowserWindow | null = null;
let sendTimer: NodeJS.Timeout | undefined;
let settingsTimer: NodeJS.Timeout | undefined;
let lastRefreshing: boolean | null = null;

function readBoard(): Board | null {
  try {
    return JSON.parse(fs.readFileSync(DATA, "utf8"));
  } catch {
    return null;
  }
}

function refreshing() {
  return fs.existsSync(LOCK);
}

function pushBoard() {
  if (win) win.webContents.send("board", readBoard());
}

function pushRefreshing() {
  const now = refreshing();
  if (now !== lastRefreshing && win) {
    lastRefreshing = now;
    win.webContents.send("refreshing", now);
  }
}

// board.json is replaced by a rename, so watch the folder, not the file.
function watch() {
  fs.watch(DIR, (_event, name) => {
    if (name === "board.json") {
      clearTimeout(sendTimer);
      sendTimer = setTimeout(pushBoard, 200);
    }
    if (name === ".lock") pushRefreshing();
    // Also picks up hand edits to the file while the app is open.
    if (name === "preferences.md" && win) win.webContents.send("prefs", readPrefs());
    // Hand edits to config.toml, and the stamp a successful check writes.
    if (name === "config.toml" || name === "last_check") {
      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(pushSettings, 200);
    }
  });
  setInterval(pushRefreshing, 3000);
}

function runRefresh() {
  if (refreshing()) return;
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn("/bin/bash", [path.join(DIR, "run.sh")], { detached: true, stdio: "ignore", env }).unref();
  setTimeout(pushRefreshing, 500);
}

// Small minimum so AeroSpace can tile it to a half or a third of the screen; the UI adapts.
const MIN = { width: 420, height: 360 };

function savedBounds(): Electron.Rectangle | { width: number; height: number } {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
    return { ...b, width: Math.max(b.width, MIN.width), height: Math.max(b.height, MIN.height) };
  } catch {
    return { width: 1180, height: 760 };
  }
}

function createWindow() {
  win = new BrowserWindow({
    ...(process.env.WORK_BOARD_DEV ? { width: 1200, height: 800 } : savedBounds()),
    minWidth: MIN.width,
    minHeight: MIN.height,
    title: "Work Board",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(APP, "ui", "index.html"));
  // Test runs stay hidden so they don't pop up over your work.
  win.once("ready-to-show", () => {
    if (!process.env.WORK_BOARD_DEV) {
      win?.show();
      if (process.env.WORK_BOARD_TAKEOVER) app.focus({ steal: true });
    }
    // Tell the copy we're replacing that it can quit now.
    if (process.env.WORK_BOARD_TAKEOVER) {
      delete process.env.WORK_BOARD_TAKEOVER;
      try { fs.writeFileSync(readyFile(), String(process.pid)); } catch {}
    }
  });
  win.webContents.on("did-finish-load", () => {
    lastRefreshing = null;
    pushBoard();
    pushRefreshing();
    if (updateReady) win?.webContents.send("update-ready");
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("close", saveBounds);
  // Recording a shortcut ends when the window loses focus (the page stops too), so the menu's shortcuts come back.
  win.on("blur", () => { if (capturing) setCapturing(false); });
  win.on("closed", () => {
    win = null;
  });
}

function buildMenu() {
  const themeItems: MenuItemConstructorOptions[] = THEMES.map((t) => ({ label: t.name, type: "radio", checked: t.id === themeId, click: () => setTheme(t.id) }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { label: "Restart to Update", click: restartToUpdate },
        { type: "separator" },
        { label: "Settings…", accelerator: accelerator("goSettings"), click: () => win && win.webContents.send("go", "settings") },
        { label: "Keyboard Shortcuts…", click: () => win && win.webContents.send("go", "keys") },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Check Now", accelerator: accelerator("checkNow"), click: runRefresh },
        { label: "Show or Hide Details", accelerator: accelerator("toggleDetails"), click: () => win && win.webContents.send("action", "toggleDetails") },
        { type: "separator" },
        { label: "Do Next", accelerator: accelerator("goNext"), click: () => win && win.webContents.send("go", "next") },
        { label: "Later", accelerator: accelerator("goLater"), click: () => win && win.webContents.send("go", "later") },
        { label: "Blocked", accelerator: accelerator("goBlocked"), click: () => win && win.webContents.send("go", "blocked") },
        { label: "History", accelerator: accelerator("goHistory"), click: () => win && win.webContents.send("go", "history") },
        { type: "separator" },
        {
          label: "Theme",
          submenu: [
            { label: "Next Theme", accelerator: accelerator("nextTheme"), click: () => stepTheme(1) },
            { label: "Previous Theme", accelerator: accelerator("prevTheme"), click: () => stepTheme(-1) },
            { type: "separator" },
            ...themeItems,
          ],
        },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
  ]));
}

// ---------- "Update ready" button ----------
// Installing a new build replaces this bundle's app.asar. Poll it, and once a
// changed copy has stayed the same for one more check (so a copy in progress
// isn't picked up), tell the window to show a Restart button.
const ASAR = path.join(process.resourcesPath, "app.asar");
const asarStamp = () => {
  try {
    const s = realFs.statSync(ASAR);
    return `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch {
    return null;
  }
};
const bootStamp = asarStamp();
let lastSeen = bootStamp;
let updateReady = false as boolean;

function checkForUpdate() {
  if (updateReady || !bootStamp) return;
  const now = asarStamp();
  if (now && now !== bootStamp && now === lastSeen) {
    updateReady = true;
    if (win) win.webContents.send("update-ready");
  }
  lastSeen = now;
}

// Restart without a gap: start the new copy first and quit only once its window
// is up and focused. If this window closed first, macOS would hand focus to
// another app, and a tiling window manager (e.g. AeroSpace) would follow it to
// another workspace and open the new window there.
const readyFile = () => path.join(app.getPath("userData"), "takeover-ready");

function saveBounds() {
  if (!win) return;
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify(win.getBounds()));
  } catch {}
}

function restartToUpdate() {
  // The new copy takes a few seconds to load; show that it's happening (button or menu).
  if (win) win.webContents.send("restarting");
  saveBounds();
  try { fs.rmSync(readyFile(), { force: true }); } catch {}
  app.releaseSingleInstanceLock();
  const env: NodeJS.ProcessEnv = { ...process.env, WORK_BOARD_TAKEOVER: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: "ignore", env }).unref();
  const started = Date.now();
  const timer = setInterval(() => {
    // Quit once the new window says it's ready, or after 15s regardless.
    if (fs.existsSync(readyFile()) || Date.now() - started > 15000) {
      clearInterval(timer);
      app.exit(0);
    }
  }, 150);
}

ipcMain.handle("restart", () => restartToUpdate());
// Sync, so the preload has the theme before the page's first paint (no flash of the default).
ipcMain.on("theme:get", (e) => { e.returnValue = themeState(); });
ipcMain.handle("theme:set", (_e, id: string) => setTheme(id));
ipcMain.handle("theme:step", (_e, by: number) => stepTheme(by === -1 ? -1 : 1));
ipcMain.handle("refresh", () => runRefresh());
ipcMain.handle("prefs:get", () => readPrefs());
ipcMain.handle("prefs:set", (_e, p: Prefs) => writePrefs(p));
ipcMain.handle("settings:get", () => readSettings());
// Sync, like the theme, so the window's key handling has the user's shortcuts from the start.
ipcMain.on("keys:get", (e) => { e.returnValue = shortcutState(); });
ipcMain.handle("keys:set", (_e, b: Record<string, string[]>) => saveKeys(b));
ipcMain.handle("keys:capture", (_e, on: boolean) => setCapturing(!!on));
ipcMain.handle("settings:schedule", (_e, s: Schedule) => saveSchedule(s));
ipcMain.handle("reveal", (_e, what: string) => reveal(what === "logs" ? "logs" : "config"));
ipcMain.handle("copy", (_e, text: string, html: string) =>
  clipboard.write([new ClipboardItem({ "text/plain": String(text), "text/html": String(html) })]));
ipcMain.handle("open", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

// Test runs (WORK_BOARD_DEV=1) get their own profile so they can run next to the installed app.
if (process.env.WORK_BOARD_DEV) app.setPath("userData", path.join(os.tmpdir(), "work-board-dev"));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    if (process.env.WORK_BOARD_DEV && app.dock) app.dock.hide(); // test runs: no second Dock icon
    nativeTheme.themeSource = "dark"; // the board is dark only, even if macOS is in light mode
    themeId = loadThemeId();
    loadKeys();
    // Reduce Transparency can be switched while the app runs.
    nativeTheme.on("updated", () => win && win.webContents.send("theme", themeState()));
    buildMenu();
    createWindow();
    watch();
    if (app.isPackaged) setInterval(checkForUpdate, 4000);
    app.on("activate", () => {
      if (!win) createWindow();
    });
  });
}
