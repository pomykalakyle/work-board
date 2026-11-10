<script lang="ts">
  // One note: its text clamped to two lines ("Show full note" when it runs longer), when it was
  // written, and Edit and Remove, which show on hover or keyboard focus. Editing and removing
  // happen in place; removing asks first, since the check then stops applying the note.
  import type { Attachment } from "svelte/attachments";
  import { tick } from "svelte";
  import { editNote, removeNote, noteChecks, isAction } from "../lib/state.svelte";
  import { parseAt, whenShort, clock, MON, splitReason } from "../lib/text";
  // origin: set under a history row, so a change's status shows there. compact: an event's note listed in
  // the notes section, one line plus the row it's on (the full note sits under that row).
  let { n, scope, origin, compact = false }: { n: Note; scope: NoteScope; origin?: string; compact?: boolean } = $props();

  let mode = $state<"view" | "edit" | "remove">("view");
  let draft = $state("");
  let full = $state(false);
  let long = $state(false);
  let longSrc = $state(false);
  // The history row a compact note is on: "Nov 10, 8:00am · Offline tests still fail in CI".
  const src = $derived.by(() => {
    if (!compact || !n.eventText) return "";
    const d = parseAt(n.eventAt);
    return (d ? `${MON[d.getMonth()]} ${d.getDate()}, ${clock(d)} · ` : "") + splitReason(n.eventText).sentence;
  });
  const busy = $derived(noteChecks.get(scope)?.phase === "saving");
  const when = $derived.by(() => {
    const d = parseAt(n.updatedAt);
    if (!d) return "";
    const w = whenShort(d);
    return n.updatedAt !== n.createdAt ? "Edited " + w : w[0].toUpperCase() + w.slice(1);
  });

  // Whether the text runs past its two lines, so "Show full note" only shows when it does something.
  const measure = (text: string, set: (v: boolean) => void): Attachment<HTMLElement> => (el) => {
    void text; // re-measure when the text changes
    const check = () => set(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  };

  async function startEdit() {
    draft = n.text;
    mode = "edit";
    await tick();
    document.querySelector<HTMLTextAreaElement>(`[data-note-edit="${n.id}"]`)?.focus();
  }
  async function saveEdit() {
    if (busy || !draft.trim() || draft.trim() === n.text) return;
    if (await editNote(scope, n.id, draft, origin)) mode = "view";
  }
  async function remove() {
    if (busy) return;
    if (await removeNote(scope, n.id, origin)) mode = "view";
  }
  function editKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (isAction(e, "saveNote")) { e.preventDefault(); if (!e.repeat) saveEdit(); }
    else if (e.key === "Escape") { e.preventDefault(); mode = "view"; }
  }
</script>

{#if mode === "edit"}
  <textarea class="pf-in nt-in" data-note-edit={n.id} aria-label="Edit note" bind:value={draft} onkeydown={editKey}></textarea>
  <div class="nt-btns">
    <button class="pf-btn primary" disabled={busy || !draft.trim() || draft.trim() === n.text} onclick={saveEdit}>Save changes</button>
    <button class="pf-btn" onclick={() => (mode = "view")}>Cancel</button>
  </div>
{:else}
  <div class={["nt-text", { clamp: !full, one: compact }]} {@attach measure(n.text, (v) => (long = v))}>{n.text}</div>
  {#if src}<div class={["nt-src", { one: !full }]} title={full ? undefined : src} {@attach measure(src, (v) => (longSrc = v))}>On {src}</div>{/if}
  {#if mode === "remove"}
    <div class="nt-btns">
      <span class="nt-ask">Stop applying this note?</span>
      <button class="pf-btn primary" disabled={busy} onclick={remove}>Remove</button>
      <button class="pf-btn" onclick={() => (mode = "view")}>Cancel</button>
    </div>
  {:else}
    <div class="nt-meta">
      <span class="nt-when" title={n.updatedAt}>{when}</span>
      {#if long || longSrc || full}<button class="more" onclick={() => (full = !full)}>{full ? "Show less" : "Show full note"}</button>{/if}
      <span class="nt-acts">
        <button class="pf-btn" onclick={startEdit}>Edit</button>
        <button class="pf-btn" onclick={() => (mode = "remove")}>Remove</button>
      </span>
    </div>
  {/if}
{/if}
