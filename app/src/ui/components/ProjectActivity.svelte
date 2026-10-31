<script lang="ts">
  // A project's history in the details panel while no task is selected: the History page's
  // day and task groups, for this project's tasks. Older groups grow in place.
  import { histOpen, actShown, historyGroups, inProject, selectInProject, toggleHistGroup } from "../lib/state.svelte";
  import { dayHeading } from "../lib/text";
  import EventGroup from "./EventGroup.svelte";
  let { p }: { p: Project } = $props();

  const GROUPS = 6; // task groups (one task on one day) shown at first
  const STEP = 5;   // added per "Show older"
  const days = $derived(historyGroups(inProject(p)));
  const total = $derived(days.reduce((n, d) => n + d.groups.length, 0));
  const events = $derived(days.reduce((n, d) => n + d.groups.reduce((m, g) => m + g.events.length, 0), 0));
  const n = $derived(Math.min(total, actShown.get(p.key) || GROUPS));
  const more = $derived(Math.min(STEP, total - n));
  // The newest n groups, still under their days.
  const shown = $derived.by(() => {
    let left = n;
    const out: typeof days = [];
    for (const d of days) {
      if (left <= 0) break;
      out.push({ ...d, groups: d.groups.slice(0, left) });
      left -= d.groups.length;
    }
    return out;
  });

  // A task still on the board opens in the list (done ones too); keys then work on the list.
  const onBoard = (key: string | null) => !!key && p.tasks.some((t) => t.key === key);
  function show(key: string) {
    selectInProject(key);
    document.getElementById("list")?.focus();
  }
</script>

<section class="pa">
  <h3 class="pa-h">Project activity{#if events}<span class="h3-ct">{events}</span>{/if}</h3>
  {#if !total}
    <div class="pa-empty">Nothing recorded yet. Each hourly check adds what changed on this project's tasks.</div>
  {:else}
    {#each shown as day (day.day)}
      <div class="ev-day">{day.date ? dayHeading(day.date) : "Undated"}</div>
      {#each day.groups as g (g.id)}
        <EventGroup {g} open={histOpen.has(g.id)} ontoggle={() => toggleHistGroup(g.id)}
          onopen={onBoard(g.key) ? () => show(g.key!) : null} openHint="Show this task" />
      {/each}
    {/each}
    {#if total > GROUPS}
      <div class="ev-ctl">
        {#if more}<button class="more" onclick={() => actShown.set(p.key, n + more)}>Show {more} older<span class="dimmer">{` · ${total - n} left`}</span></button>{/if}
        {#if n > GROUPS}<button class="more" onclick={() => actShown.set(p.key, GROUPS)}>Show fewer</button>{/if}
      </div>
    {/if}
  {/if}
</section>
