<script lang="ts">
  import { ui, rankedOf, openLink, toggleWhy } from "../lib/state.svelte";
  import { TIER_NAME, fmt, splitReason, sentences, type Cite as CiteT } from "../lib/text";
  import { CHEVRON } from "../lib/icons";
  import Dot from "./Dot.svelte";
  import Cite from "./Cite.svelte";
  import RecentActivity from "./RecentActivity.svelte";
  import TaskNotes from "./TaskNotes.svelte";
  let { t }: { t: ListTask } = $props();

  const r = $derived(rankedOf(t.key));
  const total = $derived(ui.data?.ranked.length ?? 0);
  const hasRecent = $derived((ui.data?.events || []).some((e) => e.key === t.key));

  // One "Why this ranking" line. Effort's reason is a fixed phrase ("under an hour"), shown without a period.
  function why(reason: string, phrase: boolean): { sentence: string; cites: CiteT[] } {
    return phrase ? { sentence: (reason || "").replace(/^./, (c) => c.toUpperCase()), cites: [] } : splitReason(reason);
  }
</script>

<!-- Long text reads as a blob in the side panel: each sentence gets its own line. -->
{#snippet lines(text: string)}
  {const parts = $derived(sentences(text))}
  {#if parts.length < 2}<div class="txt">{text}</div>
  {:else}<ul class="lines txt">{#each parts as s}<li>{s}</li>{/each}</ul>{/if}
{/snippet}

{#snippet whyItem(label: string, value: string | number, reason: string, pinned: boolean, phrase: boolean)}
  {const w = $derived(why(reason, phrase))}
  <div class="why-item">
    <div class="why-h"><span class="k">{label}</span> · <span class="v">{value}</span>{#if pinned}<span class="pin"> · you set it</span>{/if}</div>
    {#if w.sentence}<div class="why-s">{w.sentence}</div>{/if}
    {#if w.cites.length}<div class="why-src">{#each w.cites as c, i}{i ? " · " : ""}<Cite {c} />{/each}</div>{/if}
  </div>
{/snippet}

<div class="d-head">
  <div class="d-title">{t.title}</div>
  <div class="d-head-row">
    <div class="d-proj"><Dot color={t.project.color} />{t.project.name}</div>
    {#if t.link}<button class="btn" onclick={() => openLink(t)}>{t.linkLabel || "Open link"} ↗</button>{/if}
  </div>
</div>
<!-- When the panel is wide (CSS container query), the left column holds the
     numbers and reasons and the right column the activity; narrow, they stack. -->
<div class={["d-cols", { single: !hasRecent }]}>
  <div class="d-left">
    {#if r}
      <!-- Scannable summary: rank, tier and score, then the three numbers. The reasons
           live in one "Why this ranking" section that stays open or closed across tasks. -->
      <section class="d-sec summary">
        <div class="sum-1">#{r.rank} of {total} · {TIER_NAME[r.tier]} · Score {fmt(r.score)}</div>
        <div class="sum-2">
          {#each r.factors as f, i (f.name)}<span class="pair">{i ? " · " : ""}<span class="k">{f.name + " "}</span><span class="v">{f.value ?? "?"}</span></span>{/each}
        </div>
      </section>
      {#if t.next}<section class="d-sec"><h3>Next step</h3>{@render lines(t.next)}</section>{/if}
      <TaskNotes {t} />
      <section class={["why-box", { open: ui.whyOpen }]}>
        <button class="why-toggle" aria-expanded={ui.whyOpen} title="Show or hide the reasons (r)" onclick={toggleWhy}>
          <span class="chev">{@html CHEVRON}</span><span class="why-lbl">Why this ranking</span>
          <span class="why-hint">{ui.whyOpen ? "Hide" : "Show"}<kbd>r</kbd></span>
        </button>
        {#if ui.whyOpen}
          <div class="why-body">
            {@render whyItem("Tier", TIER_NAME[r.tier], r.tierReason, r.tierPinned, false)}
            {#each r.factors as f (f.name)}{@render whyItem(f.name, f.value ?? "?", f.reason, f.pinned, f.name === "Effort")}{/each}
            {#if r.tie}<div class="why-tie">{r.tie[0].toUpperCase() + r.tie.slice(1)}.</div>{/if}
          </div>
        {/if}
      </section>
    {:else}
      {#if t.status === "blocked"}
        <section class="d-sec"><h3>Waiting on</h3><div class="txt"><span class="who">{t.blockedOn || "?"}</span></div></section>
      {:else}
        <section class="d-sec"><h3>Status</h3>
          <div class="txt">{t.status === "parked" ? "Parked: nothing to do for now." : t.status === "done" ? "Done " + (t.doneAt || "") : t.status}</div>
        </section>
      {/if}
      {#if t.next}<section class="d-sec"><h3>{t.status === "blocked" ? "Then" : "Next step"}</h3>{@render lines(t.next)}</section>{/if}
      <TaskNotes {t} />
    {/if}
  </div>
  {#if hasRecent}<div class="d-right"><RecentActivity {t} /></div>{/if}
</div>
