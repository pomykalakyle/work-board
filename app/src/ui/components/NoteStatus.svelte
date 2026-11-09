<script lang="ts">
  // Where a note change and its quick check stand: saving, saved (with the button that starts the
  // check), checking, what the check changed, or what failed. It sits outside the notes' disclosure,
  // so it shows with the notes closed too.
  import { noteChecks, checkScope } from "../lib/state.svelte";
  let { scope, what }: { scope: NoteScope; what: string } = $props();
  const c = $derived(noteChecks.get(scope));
</script>

{#if c}
  <div class={["nt-status", "nt-" + c.phase]} role="status" aria-live="polite">
    {#if c.phase === "saving"}<span class="nt-spin" aria-hidden="true"></span>Saving…
    {:else if c.phase === "saved"}Saved<button class="pf-btn" title={`Claude reviews ${what} again with your notes (about a minute)`} onclick={() => checkScope(scope)}>Re-review</button>
    {:else if c.phase === "checking"}<span class="nt-spin" aria-hidden="true"></span>Re-reviewing…
    {:else if c.phase === "done"}{c.text}
    {:else if c.phase === "saveError"}Couldn't save the note{c.text ? `: ${c.text}` : ""}
    {:else}Re-review failed{c.text ? `: ${c.text}` : ""}<button class="more nt-again" onclick={() => checkScope(scope)}>Try again</button>{/if}
  </div>
{/if}
