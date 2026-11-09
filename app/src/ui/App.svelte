<script lang="ts">
  // The Work Board window: board.json (written by render_board.py) as a three-pane
  // app with a sidebar of views, a ranked task list and a detail panel. "History",
  // "How scoring works", "Preferences" and "Settings" are full pages instead of the list and detail panes; a project
  // adds a header above both panes. The panes are direct children of <body>, whose CSS
  // grid lays them out (style.css).
  import { ui, onPage, isProjectView, setData, go, setTheme, applyLayout, listKey, historyKey, scoringKey, loadPrefs, loadSettings, gotSettings, actionFor, comboOf, inField, runAction, gotNoteCheck } from "./lib/state.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import ListPane from "./components/ListPane.svelte";
  import DetailPane from "./components/DetailPane.svelte";
  import PagePane from "./components/PagePane.svelte";
  import ProjectHead from "./components/ProjectHead.svelte";
  import ThemePicker from "./components/ThemePicker.svelte";

  // Messages from the main process (main.ts, through preload.ts).
  window.board.onData(setData);
  window.board.onRefreshing((on) => (ui.checking = on));
  window.board.onGo(go);
  window.board.onUpdateReady(() => (ui.updateReady = true));
  window.board.onRestarting(() => (ui.restarting = true));
  window.themes.onChange(setTheme);
  window.board.onPrefs((p) => (ui.prefs = p));
  window.board.onSettings(gotSettings);
  window.board.onAction(runAction);
  window.board.onNoteCheck(gotNoteCheck);
  window.keys.onChange((s) => (ui.shortcuts = s));
  loadPrefs();
  loadSettings();

  $effect(() => { document.body.classList.toggle("page", onPage()); });
  $effect(() => { document.body.classList.toggle("proj", isProjectView()); });
  // Sync state Svelte doesn't render (body's class and CSS variables, localStorage): the documented
  // use of $effect. applyLayout reads the layout and the reactive window width, so it re-fits on resize.
  $effect(() => { applyLayout(); });

  // Whether a key press came from a focused button or link, which handles Enter and Space itself.
  const onControl = (e: Event) => e.target instanceof Element && !!e.target.closest("button, a");

  function onKey(e: KeyboardEvent) {
    if (ui.recording) return; // the Keyboard page is recording this key
    // Global actions. The app menu runs the ⌘ or ⌃ shortcut it shows; the window runs the rest,
    // and plain keys never while typing in a field.
    const g = actionFor(e, ["global"]);
    const combo = comboOf(e);
    if (g && ui.shortcuts.menu[g.id] !== combo && (!inField(e) || /(^|\+)(Meta|Ctrl)\+/.test(combo ?? ""))) {
      runAction(g.id);
      e.preventDefault();
      return;
    }
    // Enter and Space on a focused button or link belong to that control; other keys
    // still navigate, so a sidebar or toggle button keeping focus after a click doesn't block moving.
    if ((e.key === "Enter" || e.key === " ") && onControl(e)) return;
    if (inField(e)) return;
    if (ui.view === "prefs" || ui.view === "settings" || ui.view === "keys") return; // pages of form fields and buttons
    if (ui.view === "history") historyKey(e);
    else if (ui.view === "scoring") scoringKey(e);
    else listKey(e);
  }
</script>

<svelte:document onkeydown={onKey} />

<Sidebar />
<ListPane />
<DetailPane />
<PagePane />
<ProjectHead />
<ThemePicker />
