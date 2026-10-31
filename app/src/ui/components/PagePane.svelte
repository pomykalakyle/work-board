<script lang="ts">
  import { ui, onPage, pageTitle } from "../lib/state.svelte";
  import { scrollTopOn } from "../lib/attach";
  import HistoryPage from "./HistoryPage.svelte";
  import ScoringPage from "./ScoringPage.svelte";
  import PreferencesPage from "./PreferencesPage.svelte";
  import StandupPage from "./StandupPage.svelte";
  import SettingsPage from "./SettingsPage.svelte";
  import KeyboardPage from "./KeyboardPage.svelte";
  import ThemeButton from "./ThemeButton.svelte";
  // A different page (or a different task's history) starts at the top; updates on the same page keep the scroll.
  const key = $derived(ui.view + "|" + (ui.hist.scope || ""));
</script>

<section id="page-pane">
  <header class="drag pane-head"><h1 id="page-title">{pageTitle()}</h1><ThemeButton /></header>
  <!-- Focusable (not tabbable) so the page's keys work after leaving the sidebar, like #list. -->
  <div id="page" tabindex="-1" {@attach scrollTopOn(key)}>
    {#if onPage()}
      <article class={ui.view}>
        {#if ui.view === "history"}<HistoryPage />{:else if ui.view === "prefs"}<PreferencesPage />{:else if ui.view === "standup"}<StandupPage />{:else if ui.view === "settings"}<SettingsPage />{:else if ui.view === "keys"}<KeyboardPage />{:else}<ScoringPage />{/if}
      </article>
    {/if}
  </div>
</section>
