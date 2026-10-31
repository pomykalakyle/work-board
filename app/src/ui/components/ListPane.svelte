<script lang="ts">
  import { ui, items, viewTitle, toggleDetail, currentProject, doneShown, toggleDone, DONE_STEP, go } from "../lib/state.svelte";
  import { TIER_NAME } from "../lib/text";
  import { PANEL, CHEVRON } from "../lib/icons";
  import { resizeHandle } from "../lib/attach";
  import TaskRow from "./TaskRow.svelte";
  import ThemeButton from "./ThemeButton.svelte";

  const rows = $derived(items());
  const title = $derived(viewTitle());
  const active = $derived(rows[ui.sel]);
  // A project's list has its own header (ProjectHead) above both panes.
  const p = $derived(currentProject());
  const doneCount = $derived(p ? p.tasks.filter((t) => t.status === "done").length : 0);
  const doneLeft = $derived(p && doneShown.has(p.key) ? Math.max(0, doneCount - (doneShown.get(p.key) ?? 0)) : 0);
  const STATUS_NAME: Record<Status, string> = { open: "Open", blocked: "Blocked", parked: "Parked", done: "Done" };
  // Ranked views are grouped under their tier, projects under each status; other views are one unlabeled group.
  const groups = $derived.by(() => {
    const ranked = ui.view === "next" || ui.view === "later";
    const out: { label: string | null; rows: { t: ListTask; i: number }[] }[] = [];
    rows.forEach((t, i) => {
      const label = ranked ? TIER_NAME[t.tier ?? "should"] : p ? STATUS_NAME[t.status] : null;
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, rows: [] });
      out[out.length - 1].rows.push({ t, i });
    });
    return out;
  });
</script>

<!-- A project's done tasks: a heading row that shows or hides them. Focus goes back to the list so n/e keep working. -->
{#snippet doneToggle(open: boolean)}
  <button class={["done-tog", { open }]} aria-expanded={open} title={open ? "Hide done tasks" : "Show done tasks"}
    onclick={() => { if (p) toggleDone(p); document.getElementById("list")?.focus(); }}>
    <span class="chev">{@html CHEVRON}</span><span class="dt-lbl">Done<span class="sep-ct">{doneCount}</span></span>
    <span class="dt-hint">{open ? "Hide" : "Show"}</span>
  </button>
{/snippet}

<main id="list-pane">
  {#if !p}
    <header class="drag pane-head">
      <h1 id="list-title">{title[0]}</h1><span id="list-sub">{title[1]}</span>
      <button id="toggle-detail" title="Show or hide details (⌘\)" onclick={toggleDetail}>{@html PANEL}</button>
      <ThemeButton />
    </header>
  {/if}
  <div id="resizer" role="separator" aria-orientation="vertical" title="Drag to resize details, double-click to hide" {@attach resizeHandle}></div>
  <div id="list" tabindex="0" role="listbox" aria-labelledby={p ? "proj-title" : "list-title"} aria-activedescendant={active ? `task-${active.key}` : undefined}>
    {#if !ui.data}
      <div class="empty">
        No board yet. It appears after the first check.
        <span class="empty-acts">
          <button type="button" class="pf-btn" disabled={ui.checking} onclick={() => window.board.refresh()}>{ui.checking ? "Checking…" : "Check now"}</button>
          <button type="button" class="pf-btn" onclick={() => go("settings")}>Settings</button>
        </span>
      </div>
    {:else if !rows.length && !doneCount}
      <div class="empty">Nothing here.</div>
    {:else}
      {#each groups as g (g.label ?? "all")}
        <div class="grp" role="group" aria-label={g.label ?? undefined}>
          {#if p && g.rows[0].t.status === "done"}{@render doneToggle(true)}
          {:else if g.label}<div class="sep" aria-hidden="true">{g.label}{#if p}<span class="sep-ct">{g.rows.length}</span>{/if}</div>{/if}
          {#each g.rows as { t, i } (t.key)}<TaskRow {t} {i} />{/each}
        </div>
      {/each}
      {#if p && doneCount && !doneShown.has(p.key)}<div class="grp">{@render doneToggle(false)}</div>{/if}
      <!-- Older done tasks grow in place, newest first. -->
      {#if p && doneLeft}
        <button class="more done-more" onclick={() => { doneShown.set(p.key, (doneShown.get(p.key) ?? 0) + DONE_STEP); document.getElementById("list")?.focus(); }}>
          Show {Math.min(DONE_STEP, doneLeft)} older<span class="dimmer">{` · ${doneLeft} left`}</span>
        </button>
      {/if}
    {/if}
  </div>
</main>
