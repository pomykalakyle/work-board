<script lang="ts">
  // One event looks the same in the task panel and on the History page: a dot on a faint
  // rail, colored by kind, then "Done · what happened  Source ↗  6:01pm". The sentence
  // comes first and the time last; rank and tier moves ('priority') are dimmed.
  import { parseAt, isToday, clock, MON, KIND_WORD, eventText } from "../lib/text";
  import Cite from "./Cite.svelte";
  // withDay: prefix the date on entries from before today.
  // quiet: an event whose kind word is already shown above it (a group's header).
  let { evs, withDay = false, quiet = null }: { evs: BoardEvent[]; withDay?: boolean; quiet?: BoardEvent | null } = $props();

  function when(e: BoardEvent) {
    const d = parseAt(e.at);
    return d ? (withDay && !isToday(d) ? `${MON[d.getMonth()]} ${d.getDate()}, ` : "") + clock(d) : e.at;
  }
</script>

<ul class="evs">
  <!-- Events have no unique id, so the list is unkeyed (an index key would be wrong). -->
  {#each evs as e}
    {const kind = $derived(KIND_WORD[e.kind] || e.kind === "priority" ? e.kind : "update")}
    {const txt = $derived(eventText(e))}
    <li class="ev k-{kind}">
      <span class="ev-dot"></span>
      <div class="ev-b">
        {#if KIND_WORD[kind] && e !== quiet}<span class="ev-kind">{KIND_WORD[kind]} · </span>{/if}
        <span class="ev-txt">{txt.sentence}</span>{#each txt.cites as c}{" "}<Cite {c} />{/each}{" "}<span class="ev-when" title={e.at}>{when(e)}</span>
      </div>
    </li>
  {/each}
</ul>
