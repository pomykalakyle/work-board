<script lang="ts">
  // Where a note change and its quick check stand: saving, checking, what the check changed, or
  // what failed. It sits outside the notes' disclosure, so it shows with the notes closed too.
  import { noteChecks, checkScope } from "../lib/state.svelte";
  let { scope, what }: { scope: NoteScope; what: string } = $props();
  const c = $derived(noteChecks.get(scope));
</script>

{#if c}
  <div class={["nt-status", "nt-" + c.phase]} role="status" aria-live="polite">
    {#if c.phase === "saving"}<span class="nt-spin" aria-hidden="true"></span>Saving note…
    {:else if c.phase === "checking"}<span class="nt-spin" aria-hidden="true"></span>Note saved · Checking {what}…
    {:else if c.phase === "done"}{c.text}
    {:else if c.phase === "saveError"}Couldn't save the note{c.text ? `: ${c.text}` : ""}
    {:else}Note saved · Check failed{c.text ? `: ${c.text}` : ""}<button class="more nt-again" onclick={() => checkScope(scope)}>Check again</button>{/if}
  </div>
{/if}
