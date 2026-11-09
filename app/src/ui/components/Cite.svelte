<script lang="ts">
  import type { Cite } from "../lib/text";
  import { noteById, showNote } from "../lib/state.svelte";
  let { c }: { c: Cite } = $props();
  // A cited note ("note:12") opens where the note is; one since removed is plain text.
  const noteId = $derived(c.url.startsWith("note:") ? Number(c.url.slice(5)) : null);
  const note = $derived(noteId === null ? null : noteById(noteId));
</script>

{#if noteId === null}
  <!-- Opens in the browser through the main process; the window itself never navigates. -->
  <a class="cite" href={c.url} title={c.url} onclick={(e) => { e.preventDefault(); window.board.open(c.url); }}>{c.label} ↗</a>
{:else if note}
  <button class="cite note-cite" title={note.text} onclick={() => showNote(note)}>{c.label}</button>
{:else}
  <span class="cite" title="This note has since been removed">{c.label}</span>
{/if}
