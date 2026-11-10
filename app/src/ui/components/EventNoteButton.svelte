<script lang="ts">
  // A history row's note button, a quiet speech bubble after its time: it opens the note field under
  // the row. Rows that can't take a note (no task, a note change) and rows with one already get none.
  import { canNoteEvent, eventNote, eventEditors } from "../lib/state.svelte";
  import { BUBBLE } from "../lib/icons";
  let { e }: { e: BoardEvent } = $props();
  const show = $derived(canNoteEvent(e) && !eventNote(e.id));
</script>

{#if show}
  <button class={["ev-nb", { on: eventEditors.has(e.id) }]} data-ev-note={e.id} title="Add note" aria-label="Add note"
    aria-expanded={eventEditors.has(e.id)}
    onclick={(ev) => { ev.stopPropagation(); if (eventEditors.has(e.id)) eventEditors.delete(e.id); else eventEditors.add(e.id); }}>{@html BUBBLE}</button>
{/if}
