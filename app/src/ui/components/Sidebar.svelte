<script lang="ts">
  import { ui, go, sourcesText } from "../lib/state.svelte";
  import { ICONS, REFRESH, UP_ARROW } from "../lib/icons";
  import Dot from "./Dot.svelte";

  // The sidebar's views. cap is the short caption shown under the icon when the sidebar is narrow.
  const shortName = (name: string) => name.split(":")[0].replace(/ tool$/, "");
  const sources = $derived(sourcesText());
  const status = $derived(ui.checking ? `Checking ${sources}…` : ui.data ? ui.data.stamp.replace(/ from .*/, "") : "Not checked yet");
</script>

{#snippet item(view: View, label: string, count: number | string, icon: string | null, color: string | null, cap: string)}
  <button class={["nav-i", { proj: view.startsWith("project:"), on: ui.view === view }]} title={label} aria-current={ui.view === view ? "page" : undefined} onclick={() => go(view)}>
    {#if icon}<span class="ic">{@html ICONS[icon]}</span>{:else}<span class="ic"><Dot color={color ?? ""} /></span>{/if}
    <span class="lbl">{label}</span><span class="cap">{cap}</span><span class="ct">{count}</span>
  </button>
{/snippet}

<aside id="sidebar">
  <div class="drag sb-top"></div>
  <nav id="nav">
    <!-- Tasks and projects need board.json; the Settings group shows from the first launch. -->
    {#if ui.data}
      {const d = $derived(ui.data)}
      <div class="nav-h">Tasks</div>
      {@render item("next", "Do next", d.ranked.filter((r) => r.section === "next").length, "next", null, "Do next")}
      {@render item("later", "Later", d.ranked.filter((r) => r.section === "later").length, "later", null, "Later")}
      {@render item("blocked", "Blocked", d.blocked.length, "blocked", null, "Blocked")}
      {@render item("history", "History", "", "history", null, "History")}
      {#if d.standup}{@render item("standup", "Standup", "", "standup", null, "Standup")}{/if}
      <div class="nav-h">Projects</div>
      {#each d.projects as p (p.key)}
        {@render item(`project:${p.key}`, p.name, p.tasks.filter((t) => t.status === "open").length || "", null, p.color, shortName(p.name))}
      {/each}
    {/if}
    <div class="nav-h">Settings</div>
    {@render item("settings", "Settings", "", "settings", null, "Settings")}
    {@render item("keys", "Keyboard", "", "keys", null, "Keys")}
    {@render item("prefs", "Preferences", "", "prefs", null, "Prefs")}
    {#if ui.data}{@render item("scoring", "How scoring works", "", "help", null, "Scoring")}{/if}
  </nav>
  <div id="sb-foot">
    <!-- Shown once a new build is installed. Restarting takes a few seconds, so it spins until the new window takes over. -->
    <button id="update" hidden={!ui.updateReady} class={{ busy: ui.restarting }} disabled={ui.restarting}
      title="A new version is installed. Click to restart into it." onclick={() => window.board.restart()}>
      {@html ui.restarting ? REFRESH : UP_ARROW}
      <span>{ui.restarting ? "Restarting…" : "Update ready · Restart"}</span>
    </button>
    <div id="status">{status}</div>
    <button id="refresh" class={{ spin: ui.checking }} disabled={ui.checking}
      title={`Check ${sources} for changes now. Takes about a minute. (⌘R)`} onclick={() => window.board.refresh()}>
      {@html REFRESH}
      <span id="refresh-label">{ui.checking ? "Checking…" : "Check now"}</span>
    </button>
    <!-- Narrow windows only (style.css): the scrolling toolbar can push Settings out of view. -->
    <button id="settings-btn" class={{ on: ui.view === "settings" }} title="Settings (⌘,)" aria-label="Settings" onclick={() => go("settings")}>{@html ICONS.settings}</button>
  </div>
</aside>
