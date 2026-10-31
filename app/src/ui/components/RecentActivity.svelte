<script lang="ts">
  // The task panel's "Recent activity": the newest five, then "Show 5 older"
  // grows the list in place. How far each task is opened lasts until the app quits.
  import { eventsOf, recentShown, openHistoryFor } from "../lib/state.svelte";
  import { parseAt, ymd, isToday, dayHeading } from "../lib/text";
  import Events from "./Events.svelte";
  let { t }: { t: ListTask } = $props();

  const RECENT = 5;
  const evs = $derived(eventsOf(t.key));
  const n = $derived(Math.min(evs.length, recentShown.get(t.key) || RECENT));
  const shown = $derived(evs.slice(0, n));
  const left = $derived(evs.length - n);
  const more = $derived(Math.min(RECENT, left));
  // Day dividers only when something shown isn't from today; each day gets its own rail.
  const days = $derived.by(() => {
    // A map, so a repeated or malformed date can't make two groups with the same key.
    const out = new Map<string, { k: string; d: Date | null; evs: BoardEvent[] }>();
    for (const e of shown) {
      const d = parseAt(e.at);
      const k = d ? ymd(d) : "?";
      if (!out.has(k)) out.set(k, { k, d, evs: [] });
      out.get(k)!.evs.push(e);
    }
    return [...out.values()];
  });
  const allToday = $derived(days.every((x) => x.d && isToday(x.d)));
</script>

{#if evs.length}
  <section class="d-sec">
    <h3>Recent activity<span class="h3-ct">{evs.length}</span></h3>
    {#if allToday}
      <Events evs={shown} />
    {:else}
      {#each days as x (x.k)}
        <div class="ev-day">{x.d ? dayHeading(x.d) : "Undated"}</div>
        <Events evs={x.evs} />
      {/each}
    {/if}
    {#if evs.length > RECENT}
      <div class="ev-ctl">
        {#if left}<button class="more" onclick={() => recentShown.set(t.key, n + more)}>Show {more} older<span class="dimmer">{` · ${left} left`}</span></button>{/if}
        {#if n > RECENT}<button class="more" onclick={() => recentShown.set(t.key, RECENT)}>Show fewer</button>{/if}
        <button class="more" onclick={() => openHistoryFor(t.key)}>Open in History →</button>
      </div>
    {/if}
  </section>
{/if}
