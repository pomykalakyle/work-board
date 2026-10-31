<script lang="ts">
  // The History page. Each day lists one row per task: that day's status change, the title and
  // how many updates it had, so it scans without reading sentences. The selected task's day
  // shows beside the list when the window is wide, or under its row when narrow. Days before
  // the newest start collapsed to their header. From a task's "Open in History", it shows
  // just that task's events instead.
  import { ui, histOpen, historyGroups, visibleHistory, histSelIndex, findTask, nowText, projectOfKey, projectOfGroup, openTask, leaveScopedHistory, toggleHistGroup, toggleHistDay, focusPage, type HistoryGroup } from "../lib/state.svelte";
  import { dayHeading, shortProject, KIND_WORD } from "../lib/text";
  import { daySummary, latestChange } from "../lib/history";
  import { keepInView } from "../lib/attach";
  import Dot from "./Dot.svelte";
  import Events from "./Events.svelte";
  import Timeline from "./Timeline.svelte";

  const days = $derived(visibleHistory());
  const flat = $derived(days.filter((d) => d.open).flatMap((d) => d.groups));
  const sel = $derived(flat[histSelIndex(flat)]);
  const selDay = $derived(days.find((d) => d.groups.includes(sel)));
  const scoped = $derived(ui.hist.scope ? historyGroups() : []);
  const scopeProject = $derived(ui.hist.scope ? projectOfKey(ui.hist.scope) : null);

  // A click selects a row; clicking the selected row again opens or closes its day under it.
  function pick(g: HistoryGroup) {
    if (ui.hist.selId === g.id || (!ui.hist.selId && g === sel)) toggleHistGroup(g.id);
    else { ui.hist.selId = g.id; histOpen.add(g.id); }
    focusPage(); // so n/e, Space and Enter act on the page, not on the clicked button
  }
  const titleOf = (g: HistoryGroup) => (g.key ? g.title || g.key : "General");
</script>

<!-- A project and "Now: ..." line, joined with dots. -->
{#snippet meta(p: Project | null, now: string | null)}
  <div class="hg-meta">
    {#if p}<Dot color={p.color} /> {shortProject(p.name)}{/if}{#if p && now}{" · "}{/if}{#if now}{now}{/if}
  </div>
{/snippet}

{#if ui.hist.scope}
  {const first = $derived(scoped[0]?.groups[0])}
  <div class="hs-head">
    <button class="more back" onclick={leaveScopedHistory} title="Back (Esc)">← Back</button>
    <div class="d-title">{first?.title || ui.hist.scope}</div>
    {@render meta(scopeProject, nowText(ui.hist.scope, first?.status ?? ""))}
  </div>
  {#each scoped as day (day.day)}
    <h2 class="tl-day">{day.date ? dayHeading(day.date) : "Undated"}</h2>
    {#each day.groups as g (g.id)}<div class="hg scoped"><Events evs={g.events} /></div>{/each}
  {/each}
{:else if !days.length}
  <div class="empty">No history yet. Each hourly check adds what changed.</div>
{:else}
  <div class="hx">
    <div class="hx-list">
      {#each days as day, i (day.day)}
        {const label = $derived(day.date ? dayHeading(day.date) : "Undated")}
        {const summary = $derived(daySummary(day.groups))}
        {#if i === 0}
          <div class="hx-day"><span class="hx-date">{label}</span><span class="hx-sum">{summary}</span></div>
        {:else}
          <button class="hx-day" aria-expanded={day.open} onclick={() => toggleHistDay(day.day)}>
            <span class="hx-date">{label}</span><span class="hx-sum">{summary}</span>
            <span class="hx-tog">{day.open ? "Hide" : "Show"}<span class={["hx-chev", { open: day.open }]}>›</span></span>
          </button>
        {/if}
        {#if day.open}
          {#each day.groups as g (g.id)}
            {const on = $derived(g === sel)}
            {const open = $derived(histOpen.has(g.id))}
            {const change = $derived(latestChange(g.events))}
            {const p = $derived(projectOfGroup(g))}
            <!-- Scrolls into view only when it becomes the selection, not on refreshes. -->
            <button class={["hx-row", { on, open }]} title={titleOf(g)} onclick={() => pick(g)} {@attach on && keepInView}>
              <span class={["hx-chg", change && "k-" + change.kind]}>{change ? KIND_WORD[change.kind] : ""}</span>
              <span class="hx-title">{#if p}<Dot color={p.color} />{/if}{titleOf(g)}</span>
              <span class="hx-ct">{g.events.length}<span class={["hx-chev", { open }]}>›</span></span>
            </button>
            {#if open}<div class="hx-inline"><Timeline evs={g.events} /></div>{/if}
          {/each}
        {/if}
      {/each}
    </div>
    {#if sel}
      {const p = $derived(projectOfGroup(sel))}
      {const now = $derived(sel.key ? nowText(sel.key, sel.status) : null)}
      <aside class="hx-detail">
        <div class="hx-dtitle">{titleOf(sel)}</div>
        <div class="hx-dmeta">
          {#if p}<span><Dot color={p.color} /> {shortProject(p.name)}</span>{/if}
          {#if now}<span>{now}</span>{/if}
          {#if findTask(sel.key)}<button class="more" title="Open this task in its list (↵)" onclick={() => openTask(sel.key!)}>Open task ↵</button>{/if}
        </div>
        {#if selDay?.date}<div class="hx-dday">{dayHeading(selDay.date)}</div>{/if}
        <Timeline evs={sel.events} />
      </aside>
    {/if}
  </div>
{/if}
