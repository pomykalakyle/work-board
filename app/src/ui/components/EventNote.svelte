<script lang="ts">
  // What sits under one history row: its note, or the field for a new one when the row's note button
  // opened it. The note belongs to the row's task, so it re-reviews that task, and its status shows here.
  import { tick } from "svelte";
  import { drafts, noteChecks, eventNote, eventEditors, addEventNote, isAction } from "../lib/state.svelte";
  import NoteItem from "./NoteItem.svelte";
  import NoteStatus from "./NoteStatus.svelte";
  let { e }: { e: BoardEvent } = $props();

  const at = $derived(`event:${e.id}`);
  const scope = $derived(`task:${e.key}` as NoteScope);
  const note = $derived(eventNote(e.id));
  const open = $derived(!note && eventEditors.has(e.id));
  const draft = $derived(drafts.get(at) ?? "");
  const busy = $derived(noteChecks.get(scope)?.phase === "saving");

  // Back to the row's note button, which opened the field (Esc or Cancel).
  async function close() {
    eventEditors.delete(e.id);
    await tick();
    document.querySelector<HTMLElement>(`[data-ev-note="${e.id}"]`)?.focus();
  }
  async function save() {
    if (busy || !draft.trim()) return;
    if (await addEventNote(e, draft)) eventEditors.delete(e.id);
  }
  function key(ev: KeyboardEvent) {
    if (ev.isComposing) return;
    if (isAction(ev, "saveNote")) { ev.preventDefault(); if (!ev.repeat) save(); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
  }
  // Focus the field when it opens.
  const focus = (el: HTMLTextAreaElement) => { el.focus(); };
</script>

{#if note}
  <div class="ev-note nt-item"><NoteItem n={note} {scope} origin={at} /></div>
{:else if open}
  <div class="ev-note">
    <textarea class="pf-in nt-in" rows="1" aria-label="Note on this event" {@attach focus}
      bind:value={() => draft, (v) => (v ? drafts.set(at, v) : drafts.delete(at))} onkeydown={key}></textarea>
    <div class="nt-btns">
      <button class="pf-btn primary" disabled={busy || !draft.trim()} onclick={save}>Save</button>
      <button class="pf-btn" onclick={close}>Cancel</button>
    </div>
  </div>
{/if}
<NoteStatus {scope} what="this task" origin={at} />
