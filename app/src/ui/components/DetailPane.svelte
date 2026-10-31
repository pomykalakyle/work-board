<script lang="ts">
  import { ui, items, currentProject, showActivity, activityTop } from "../lib/state.svelte";
  import { scrollTopOn } from "../lib/attach";
  import TaskDetail from "./TaskDetail.svelte";
  import ProjectActivity from "./ProjectActivity.svelte";
  const t = $derived(items()[ui.sel]);
  const p = $derived(currentProject());
  // A different task starts at the top and going back to a project's activity returns to where it was;
  // toggles, "Show older" and hourly refreshes keep the scroll where it is.
  const key = $derived(t?.key ?? (p ? "activity:" + p.key : undefined));
  const top = $derived(t || !p ? 0 : activityTop(ui.view));
</script>

<section id="detail-pane">
  <header class="drag pane-head"></header>
  <div id="detail" {@attach scrollTopOn(key, top)}>
    {#if t}
      {#if p}<button class="more d-back" title="Back to the project's activity (Esc)" onclick={showActivity}>← Project activity</button>{/if}
      <TaskDetail {t} />
    {:else if p}
      <ProjectActivity {p} />
    {:else}
      <div class="empty">Select a task</div>
    {/if}
  </div>
</section>
