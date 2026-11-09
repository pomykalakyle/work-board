<script lang="ts">
  // A project's notes in the details panel, opened from its header: the same field and list as a
  // task's notes. A project note applies to every task in the project, new ones included, so its
  // check covers all of the project's open and blocked tasks.
  import { projectNotes, closeProjectNotes } from "../lib/state.svelte";
  import Dot from "./Dot.svelte";
  import NotesBody from "./NotesBody.svelte";
  let { p, back }: { p: Project; back: string } = $props();

  const scope = $derived(`project:${p.key}` as NoteScope);
  const notes = $derived(projectNotes(p.key));
  const live = $derived(p.tasks.filter((t) => t.status !== "done").length);
  const what = $derived(live === 1 ? "this project's task" : `this project's ${live} tasks`);
</script>

<button class="more d-back" title="Back (Esc)" onclick={closeProjectNotes}>← {back}</button>
<div class="d-head">
  <div class="d-title">Project notes</div>
  <div class="d-proj"><Dot color={p.color} />{p.name}</div>
</div>
<section class="d-sec nt-page">
  <NotesBody {scope} {notes} {what} label="New note on this project" />
</section>
