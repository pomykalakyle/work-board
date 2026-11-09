<script lang="ts">
  // A project's header, above both the task list and the details panel so it stays
  // visible while a task is open: name, priority and stage, one line of counts, and
  // the "Done when" goal clamped to two lines.
  import type { Attachment } from "svelte/attachments";
  import { ui, currentProject, viewTitle, toggleDetail, toggleGoal, inProject, projectNotes, openProjectNotes, closeProjectNotes } from "../lib/state.svelte";
  import { parseAt, whenShort } from "../lib/text";
  import { PANEL } from "../lib/icons";
  import ThemeButton from "./ThemeButton.svelte";

  const p = $derived(currentProject());
  const title = $derived(viewTitle());
  // The project's notes open in the details panel ("No project" has none).
  const nNotes = $derived(p && p.key !== "none" ? projectNotes(p.key).length : 0);
  const notesOn = $derived(!!p && ui.notesView === p.key);
  // "2 open · 1 blocked · 5 done · last activity today 11:31am".
  const values = $derived.by(() => {
    if (!p) return "";
    const c: Record<Status, number> = { open: 0, blocked: 0, parked: 0, done: 0 };
    for (const t of p.tasks) c[t.status]++;
    const last = parseAt((ui.data?.events || []).find(inProject(p))?.at); // events are newest first
    return [c.open && `${c.open} open`, c.blocked && `${c.blocked} blocked`, c.parked && `${c.parked} parked`,
      c.done && `${c.done} done`, last && "last activity " + whenShort(last)].filter(Boolean).join(" · ");
  });

  // Whether the goal runs past two lines, so the toggle only shows when it does something.
  let long = $state(false);
  const measure = (text: string): Attachment<HTMLElement> => (el) => {
    void text; // re-measure when the text changes
    const check = () => (long = el.scrollHeight > 2 * parseFloat(getComputedStyle(el).lineHeight) + 2);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  };
</script>

{#if p}
  <header id="proj-head">
    <div class="drag pane-head ph-top">
      <h1 id="proj-title">{title[0]}</h1><span class="ph-sub">{title[1]}</span>
      <button id="toggle-detail" title="Show or hide details (⌘\)" onclick={toggleDetail}>{@html PANEL}</button>
      <ThemeButton />
    </div>
    <div class="ph-body">
      {#if values || (p.key !== "none")}
        <div class="ph-vals">
          {values}{#if values && p.key !== "none"}<span aria-hidden="true">{" · "}</span>{/if}
          {#if p.key !== "none"}
            <button class={["more", "ph-notes", { on: notesOn }]} aria-pressed={notesOn} title="Notes that apply to every task in this project"
              onclick={() => (notesOn ? closeProjectNotes() : openProjectNotes(p.key))}>{nNotes ? `Your project notes · ${nNotes}` : "Add a project note"}</button>
          {/if}
        </div>
      {/if}
      {#if p.doneWhen}
        <div class="ph-goalrow">
          <div class={["ph-goal", { open: ui.goalOpen }]} {@attach measure(p.doneWhen)}>{p.doneWhen}</div>
          {#if long}<button class="more" aria-expanded={ui.goalOpen} onclick={toggleGoal}>{ui.goalOpen ? "Show less" : "Show full goal"}</button>{/if}
        </div>
      {/if}
    </div>
  </header>
{/if}
