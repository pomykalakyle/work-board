<script lang="ts">
  import { ui, items, currentProject, showActivity, activityTop, taskByKey, findTask, openTask, viewTitle } from "../lib/state.svelte";
  import { scrollTopOn } from "../lib/attach";
  import TaskDetail from "./TaskDetail.svelte";
  import ProjectActivity from "./ProjectActivity.svelte";
  import ProjectNotes from "./ProjectNotes.svelte";
  // The selected task, or one a note's check moved out of this list (held, so its result stays in view).
  const t = $derived(items()[ui.sel] ?? (ui.held ? taskByKey(ui.held) ?? undefined : undefined));
  const p = $derived(currentProject());
  const notes = $derived(!!p && ui.notesView === p.key);
  // Where a held task is now, for "Show it in Later".
  const now = $derived.by(() => {
    const at = ui.held ? findTask(ui.held) : null;
    if (!at) return null;
    const names: Record<string, string> = { next: "Do next", later: "Later", blocked: "Blocked" };
    return names[at.view] ?? ui.data?.projects.find((x) => "project:" + x.key === at.view)?.name ?? null;
  });
  // A different task starts at the top and going back to a project's activity returns to where it was;
  // toggles, "Show older" and hourly refreshes keep the scroll where it is.
  const key = $derived(notes ? "notes:" + p!.key : t?.key ?? (p ? "activity:" + p.key : undefined));
  const top = $derived(t || !p || notes ? 0 : activityTop(ui.view));
</script>

<section id="detail-pane">
  <header class="drag pane-head"></header>
  <div id="detail" {@attach scrollTopOn(key, top)}>
    {#if notes}
      <ProjectNotes p={p!} back={t ? "Back to task" : "Project activity"} />
    {:else if t}
      {#if ui.held}
        <div class="held">No longer in {viewTitle()[0] || "this list"}{#if now}<button class="more" onclick={() => openTask(ui.held!)}>Show it in {now} →</button>{/if}</div>
      {:else if p}<button class="more d-back" title="Back to the project's activity (Esc)" onclick={showActivity}>← Project activity</button>{/if}
      <TaskDetail {t} />
    {:else if p}
      <ProjectActivity {p} />
    {:else}
      <div class="empty">Select a task</div>
    {/if}
  </div>
</section>
