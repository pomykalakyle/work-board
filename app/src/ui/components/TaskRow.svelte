<script lang="ts">
  import { ui, select, showDetail, rankedOf, isProjectView } from "../lib/state.svelte";
  import { fmt, splitReason, parseAt, whenShort } from "../lib/text";
  import { keepInView } from "../lib/attach";
  import Dot from "./Dot.svelte";
  let { t, i }: { t: ListTask; i: number } = $props();
  const ranked = $derived(rankedOf(t.key));
  const selected = $derived(i === ui.sel);
  // In a project's list every row is the same project, so rows show the next step instead, and wrap.
  const inProject = $derived(isProjectView());
  const doneAt = $derived(parseAt(t.doneAt));
</script>

<!-- One option in the task listbox (ListPane). The list keeps keyboard focus and points at the
     selected option with aria-activedescendant (a click hands focus back to the list);
     n/e and Enter are handled in App.svelte.
     A click shows the task in the details panel (opening it if hidden); the link opens
     only with Enter or the panel's button. -->
<!-- WAI-ARIA listbox with aria-activedescendant: the list handles the keys, options only take clicks. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div id="task-{t.key}" role="option" tabindex="-1" aria-selected={selected}
  class={["row", { on: selected, muted: t.status === "parked", done: t.status === "done", wrap: inProject }]}
  onclick={() => { select(i); showDetail(); document.getElementById("list")?.focus(); }} {@attach selected && keepInView}>
  <span class="rk">{ranked ? ranked.rank : ""}</span>
  <span class="tt">{t.title}</span>
  {#if ranked}<span class="sc" title="Score">{fmt(ranked.score)}</span>{:else}<span></span>{/if}
  <span class="sub">
    {#if t.status === "blocked"}
      <span class="who">{t.blockedOn || "?"}</span><span>{t.next}</span>
    {:else if inProject && t.status === "done"}
      <span>Done {doneAt ? whenShort(doneAt) : t.doneAt}</span>
    {:else if inProject}
      <span>{t.next}</span>
    {:else if ranked}
      <Dot color={t.project.color} /><span>{t.project.name} · {splitReason(ranked.tierReason || ranked.factors[1].reason).sentence}</span>
    {:else if t.status === "parked"}
      <span>Parked · {t.next}</span>
    {:else if t.status === "done"}
      <span>Done {(t.doneAt || "").slice(5, 10)}</span>
    {:else}
      <Dot color={t.project.color} /><span>{t.project.name}</span>
    {/if}
  </span>
</div>
