<script lang="ts">
  // One task's day on the History page, time first so the eye can run down it:
  // "11:26am  Pushed the CI filter fix; …  PR #1084 ↗". Status changes lead with their
  // word ("Blocked"); rank and tier moves ('priority') are dimmed.
  import { parseAt, clock, KIND_WORD, eventText } from "../lib/text";
  import Cite from "./Cite.svelte";
  import EventNote from "./EventNote.svelte";
  import EventNoteButton from "./EventNoteButton.svelte";
  let { evs }: { evs: BoardEvent[] } = $props();
</script>

<ul class="tl">
  <!-- Keyed by the event's id, so a row's note keeps its state as new events arrive. A board.json
       written before events had ids falls back to the index until the next redraw. -->
  {#each evs as e, i (e.id ?? "i" + i)}
    {const d = $derived(parseAt(e.at))}
    {const txt = $derived(eventText(e))}
    <li class={["tl-i", { pri: e.kind === "priority" }]}>
      <span class="tl-t" title={e.at}>{d ? clock(d) : e.at}</span>
      <div>
        <span>{#if KIND_WORD[e.kind]}<span class="tl-k k-{e.kind}">{KIND_WORD[e.kind]}</span>{/if}{txt.sentence}{#each txt.cites as c}{" "}<Cite {c} />{/each}</span><EventNoteButton {e} />
        <EventNote {e} />
      </div>
    </li>
  {/each}
</ul>
