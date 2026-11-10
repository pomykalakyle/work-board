<script lang="ts">
  // A task's or project's notes, open: the field for a new note first (one line that grows as you
  // type; Enter saves, Shift+Enter is a new line; checking is a separate button once saved), then the project's notes that apply
  // (on a task, read-only), then the notes themselves, newest first, two at first.
  import { drafts, notesShown, NOTES_FIRST, noteChecks, addNote, isAction } from "../lib/state.svelte";
  import NoteItem from "./NoteItem.svelte";
  import NoteStatus from "./NoteStatus.svelte";
  let { scope, notes, what, label, pnotes = [], onproject = null }: {
    scope: NoteScope;
    notes: Note[];
    what: string;                       // what the check covers: "this task", "this project's 4 tasks"
    label: string;                      // the field's accessible name
    pnotes?: Note[];                    // on a task: its project's notes
    onproject?: (() => void) | null;    // opens the project's notes
  } = $props();

  const draft = $derived(drafts.get(scope) ?? "");
  const busy = $derived(noteChecks.get(scope)?.phase === "saving");
  const n = $derived(Math.min(notes.length, notesShown.get(scope) ?? NOTES_FIRST));
  const more = $derived(Math.min(5, notes.length - n));

  function save() {
    if (!busy && draft.trim()) addNote(scope, draft);
  }
  function key(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (isAction(e, "saveNote")) { e.preventDefault(); if (!e.repeat) save(); }
    else if (e.key === "Escape") { e.preventDefault(); document.getElementById("list")?.focus(); }
  }
</script>

<textarea id="note-input" class="pf-in nt-in" rows="1" placeholder="Correct something or add context" aria-label={label}
  bind:value={() => draft, (v) => (v ? drafts.set(scope, v) : drafts.delete(scope))} onkeydown={key}></textarea>
{#if draft.trim()}
  <div class="nt-btns">
    <button class="pf-btn primary" disabled={busy} onclick={save}>Save</button>
  </div>
{/if}
<NoteStatus {scope} {what} />
{#if pnotes.length}
  <ul class="nt-list">
    {#each pnotes as pn (pn.id)}
      <li><button class="nt-proj" title="Open the project's notes" onclick={() => onproject?.()}><span class="nt-k">Project note:</span> {pn.text}</button></li>
    {/each}
  </ul>
{/if}
{#if notes.length}
  <ul class="nt-list">
    {#each notes.slice(0, n) as note (note.id)}<li class="nt-item"><NoteItem n={note} {scope} compact={!!note.event} /></li>{/each}
  </ul>
  {#if notes.length > NOTES_FIRST}
    <div class="ev-ctl">
      {#if more}<button class="more" onclick={() => notesShown.set(scope, n + more)}>Show {more} more {more === 1 ? "note" : "notes"}</button>{/if}
      {#if n > NOTES_FIRST}<button class="more" onclick={() => notesShown.set(scope, NOTES_FIRST)}>Show fewer</button>{/if}
    </div>
  {/if}
{/if}
