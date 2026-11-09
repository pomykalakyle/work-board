// Compiled to app/build/preload.js. Runs sandboxed, so it can only use Electron's renderer modules.
import { contextBridge, ipcRenderer } from "electron";

const board: BoardApi = {
  onData: (cb) => ipcRenderer.on("board", (_e, data: Board | null) => cb(data)),
  onRefreshing: (cb) => ipcRenderer.on("refreshing", (_e, on: boolean) => cb(on)),
  onGo: (cb) => ipcRenderer.on("go", (_e, view: View) => cb(view)),
  onUpdateReady: (cb) => ipcRenderer.on("update-ready", () => cb()),
  onRestarting: (cb) => ipcRenderer.on("restarting", () => cb()),
  restart: () => ipcRenderer.invoke("restart"),
  refresh: () => ipcRenderer.invoke("refresh"),
  open: (url) => ipcRenderer.invoke("open", url),
  getPrefs: () => ipcRenderer.invoke("prefs:get"),
  setPrefs: (p) => ipcRenderer.invoke("prefs:set", p),
  onPrefs: (cb) => ipcRenderer.on("prefs", (_e, p: Prefs) => cb(p)),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSchedule: (s) => ipcRenderer.invoke("settings:schedule", s),
  onSettings: (cb) => ipcRenderer.on("settings", (_e, s: Settings) => cb(s)),
  reveal: (what) => ipcRenderer.invoke("reveal", what),
  copy: (text, html) => ipcRenderer.invoke("copy", text, html),
  onAction: (cb) => ipcRenderer.on("action", (_e, id: string) => cb(id)),
  addNote: (scope, text) => ipcRenderer.invoke("notes:add", scope, text),
  editNote: (id, text) => ipcRenderer.invoke("notes:edit", id, text),
  removeNote: (id) => ipcRenderer.invoke("notes:remove", id),
  checkNotes: (scope) => ipcRenderer.invoke("notes:check", scope),
  onNoteCheck: (cb) => ipcRenderer.on("note-check", (_e, r: NoteCheckResult) => cb(r)),
};
contextBridge.exposeInMainWorld("board", board);

// The theme is read synchronously here so ui/theme.js can apply it before the first paint.
const themes: ThemesApi = {
  initial: ipcRenderer.sendSync("theme:get"),
  set: (id) => ipcRenderer.invoke("theme:set", id),
  step: (by) => ipcRenderer.invoke("theme:step", by),
  onChange: (cb) => ipcRenderer.on("theme", (_e, state: ThemeState) => cb(state)),
};
contextBridge.exposeInMainWorld("themes", themes);

// Shortcuts, read synchronously so key handling uses the user's keys from the first key press.
const keys: KeysApi = {
  initial: ipcRenderer.sendSync("keys:get"),
  set: (b) => ipcRenderer.invoke("keys:set", b),
  capture: (on) => ipcRenderer.invoke("keys:capture", on),
  onChange: (cb) => ipcRenderer.on("keys", (_e, s: ShortcutState) => cb(s)),
};
contextBridge.exposeInMainWorld("keys", keys);
