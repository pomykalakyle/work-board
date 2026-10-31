<script lang="ts">
  // One task's day on the History page, time first so the eye can run down it:
  // "11:26am  Pushed the CI filter fix; …  PR #1084 ↗". Status changes lead with their
  // word ("Blocked"); rank and tier moves ('priority') are dimmed.
  import { parseAt, clock, KIND_WORD, eventText } from "../lib/text";
  import Cite from "./Cite.svelte";
  let { evs }: { evs: BoardEvent[] } = $props();
</script>

<ul class="tl">
  <!-- Events have no unique id, so the list is unkeyed (an index key would be wrong). -->
  {#each evs as e}
    {const d = $derived(parseAt(e.at))}
    {const txt = $derived(eventText(e))}
    <li class={["tl-i", { pri: e.kind === "priority" }]}>
      <span class="tl-t" title={e.at}>{d ? clock(d) : e.at}</span>
      <span>{#if KIND_WORD[e.kind]}<span class="tl-k k-{e.kind}">{KIND_WORD[e.kind]}</span>{/if}{txt.sentence}{#each txt.cites as c}{" "}<Cite {c} />{/each}</span>
    </li>
  {/each}
</ul>
