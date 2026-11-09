<script lang="ts">
  // "Your notes" on a task's panel, between the next step and "Why this ranking": a disclosure
  // like that one, open or closed across tasks. Closed, it still shows the newest note and one
  // project note in force on one line each, and the check's status, so a correction never hides.
  import { ui, rankedOf, taskNotes, projectNotes, notesProjectOf, toggleNotes, openProjectNotes } from "../lib/state.svelte";
  import { keyLabel } from "../lib/text";
  import { CHEVRON } from "../lib/icons";
  import NotesBody from "./NotesBody.svelte";
  import NoteStatus from "./NoteStatus.svelte";
  let { t }: { t: ListTask } = $props();

  const scope = $derived(`task:${t.key}` as NoteScope);
  const notes = $derived(taskNotes(t.key));
  const p = $derived(notesProjectOf(t.key));
  const pnotes = $derived(p ? projectNotes(p.key) : []);
  // The project note to preview: one the task's next step or reasons cite, else the newest.
  const cited = $derived.by(() => {
    const r = rankedOf(t.key);
    const text = [t.next, r?.tierReason, ...(r?.factors.map((f) => f.reason) ?? [])].join(" ");
    return pnotes.find((n) => text.includes(`(note:${n.id})`)) ?? pnotes[0];
  });
  const key = $derived(ui.shortcuts.bindings.addNote?.[0]);
  const openProject = () => p && openProjectNotes(p.key, t.key);
</script>

<section class={["why-box notes-box", { open: ui.notesOpen }]}>
  <button class="why-toggle" aria-expanded={ui.notesOpen} title="Show or hide your notes on this task" onclick={toggleNotes}>
    <span class="chev">{@html CHEVRON}</span>
    <span class="why-lbl">Your notes{#if notes.length}<span class="h3-ct">{notes.length}</span>{/if}</span>
    <span class="why-hint">{ui.notesOpen ? "Hide" : "Show"}{#if key}<kbd>{key.length === 1 ? key : keyLabel(key)}</kbd>{/if}</span>
  </button>
  {#if ui.notesOpen}
    <div class="why-body nt-body">
      <NotesBody {scope} {notes} what="this task" label="New note on this task" {pnotes} onproject={openProject} />
    </div>
  {:else}
    {#if notes.length || cited}
      <div class="nt-peeks">
        {#if notes.length}<button class="nt-peek" title={notes[0].text} onclick={toggleNotes}><span class="nt-peek-t">{notes[0].text}</span></button>{/if}
        {#if cited}
          <button class="nt-peek" title="Open the project's notes" onclick={openProject}>
            <span class="nt-peek-t"><span class="nt-k">Project note:</span> {cited.text}</span>
            {#if pnotes.length > 1}<span class="nt-peek-n">{pnotes.length - 1} more</span>{/if}
          </button>
        {/if}
      </div>
    {/if}
    <div class="nt-closed-status"><NoteStatus {scope} what="this task" /></div>
  {/if}
</section>
