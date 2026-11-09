<script lang="ts">
  // One task's events from one day. The header row holds the title, its project, that day's
  // status change and where it stands now; under it, the two newest real updates and a toggle
  // for the rest. Shared by the History page and a project's activity.
  import type { Attachment } from "svelte/attachments";
  import { nowText, type HistoryGroup } from "../lib/state.svelte";
  import { shortProject } from "../lib/text";
  import { preview, hiddenNote, groupStatus } from "../lib/history";
  import Dot from "./Dot.svelte";
  import Events from "./Events.svelte";

  let { g, open, ontoggle, project = null, onopen = null, openHint = "Open this task", on = false, onpick, attach }: {
    g: HistoryGroup;
    open: boolean;            // showing all its entries
    ontoggle: () => void;
    project?: Project | null; // shown in the header (left out inside a project's own page)
    onopen?: (() => void) | null; // makes the title a button
    openHint?: string;
    on?: boolean;             // the History page's keyboard selection
    onpick?: () => void;      // a click anywhere on the group
    attach?: Attachment<HTMLElement> | false;
  } = $props();

  const picked = $derived(preview(g.events));
  const hidden = $derived(g.events.filter((e) => !picked.includes(e)));
  const shown = $derived(open ? g.events : picked);
  const liveNow = $derived(g.key ? nowText(g.key, g.status) : null);
  const status = $derived(groupStatus(g.events, liveNow));
  const now = $derived(status ? status.now : liveNow);
  const note = $derived(hiddenNote(hidden));
  // The header already names this event's kind, so its line doesn't repeat it.
  const quiet = $derived(status ? g.events.find((e) => e.kind === status.kind) ?? null : null);
</script>

<!-- Clicking a group only moves the History page's selection to it; its own actions are the
     buttons inside, so the click needs no key handler or role. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class={["hg", { on }]} data-id={g.id} onclick={onpick} {@attach attach}>
  <div class="hg-head">
    <span class="hg-name">
      {#if project}<Dot color={project.color} />{/if}
      {#if onopen}
        <button class="hg-title link" title={openHint} onclick={(ev) => { ev.stopPropagation(); onopen(); }}>{g.title || g.key}</button>
      {:else}
        <span class="hg-title">{g.title || g.key || "General"}</span>
      {/if}
    </span>
    {#if project || status || now}
      <span class="hg-info">
        {#if project}<span>{shortProject(project.name)}</span>{/if}
        {#if status}<span class="hg-chg k-{status.kind}">{status.label}</span>{/if}
        {#if now}<span>{now}</span>{/if}
      </span>
    {/if}
  </div>
  <Events evs={shown} {quiet} />
  {#if hidden.length}
    <button class="more" title="Show or hide (Space on the History page)" onclick={(ev) => { ev.stopPropagation(); ontoggle(); }}>
      {open ? "▾ Show less" : `▸ Show ${hidden.length} more${note ? " · " + note : ""}`}
    </button>
  {/if}
</div>
