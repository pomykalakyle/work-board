<script lang="ts">
  // The ranking rules come from ranking.md (the same file the hourly job reads),
  // passed through board.json as sections. The page is an overview (tiers, score,
  // the three 1-to-5 scales) plus a panel with the full rule for the selected row:
  // beside the overview when the window is wide, under it when narrow, and under
  // the row itself at a third of the screen (CSS picks). Selecting a row changes
  // only the panel, so the overview never moves. Pinning is about the app, so it
  // lives here; the keyboard shortcuts are on Settings.
  import { ui, ruleSections, scoringOpen, toggleScoring, openTask } from "../lib/state.svelte";
  import { TIER_NAME, fmt, ruleId, isScale, sameRule } from "../lib/text";
  import { CHEVRON } from "../lib/icons";
  import { keepInView } from "../lib/attach";

  const rk = $derived(ui.data?.ranking);
  const secs = $derived(ruleSections());
  const all = $derived(secs.flatMap((sec) => sec.rows.map((r) => ({ sec, r }))));
  // The selected rule, or the first one when nothing (or a rule that's gone) is selected.
  const cur = $derived(all.find((x) => ruleId(x.sec, x.r) === ui.rule) ?? all[0]);
  const curId = $derived(cur ? ruleId(cur.sec, cur.r) : null);

  const intro = $derived((rk?.intro[0] || "").split(/(?<=\.)\s+/));
  const scoreSec = $derived(rk?.sections.find((s) => !s.rows.length));
  const tiers = $derived(secs.find((s) => !isScale(s)));
  const about = $derived(cur ? [...cur.sec.paras, ...cur.sec.context] : []);

  // The live #1 task, worked through, so the formula has real numbers in it.
  const top = $derived(ui.data?.ranked[0]);
  const val = (name: Factor["name"]) => top?.factors.find((f) => f.name === name)?.value;

</script>

{#snippet list(sec: RuleSection)}
  <div class="sc-list {isScale(sec) ? 'levels' : 'tiers'}">
    {#each sec.rows as r (r.key)}
      {const id = $derived(ruleId(sec, r))}
      {const on = $derived(id === curId)}
      <!-- Keeps the selected rule in view as n/e and m/i move it (it can leave the screen on narrow windows). -->
      <button type="button" class={["sc-row", { on }]} aria-current={on || undefined} data-id={id} onclick={() => (ui.rule = id)} {@attach on && keepInView}>
        <span class="sc-k">{r.key}</span>
        <span class="sc-s">{r.summary}{#if on && (!sameRule(r) || about.length)}<span class="sc-inline">
          {#if !sameRule(r)}<span class="sc-inline-d">{r.detail}</span>{/if}
          {#each about as p (p)}<span class="sc-inline-about">{p}</span>{/each}
        </span>{/if}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet box(id: string, label: string, body: import("svelte").Snippet)}
  {const open = $derived(scoringOpen.has(id))}
  <section class={["why-box sc-box", { open }]}>
    <button class="why-toggle" aria-expanded={open} onclick={() => toggleScoring(id)}>
      <span class="chev">{@html CHEVRON}</span><span class="why-lbl">{label}</span><span class="why-hint">{open ? "Hide" : "Show"}</span>
    </button>
    {#if open}<div class="why-body">{@render body()}</div>{/if}
  </section>
{/snippet}

{#snippet pinBody()}
  <p>Ask an agent to pin it, for example "pin api-docs urgency 4" or "pin api-docs tier must". The hourly check never changes a pinned value, and the task shows "you set it" next to it.</p>
{/snippet}

{#if !rk}
  <div class="empty">No board yet.</div>
{:else}
  <div class="sc-wrap">
    <div class="sc-left">
      <div class="sc-lead">{intro[0]}</div>
      {#if intro.length > 1}<p class="sc-sub">{intro.slice(1).join(" ")}</p>{/if}
      <div class="sc-top">
        {#if tiers}<section><h2>{tiers.title}</h2>{@render list(tiers)}</section>{/if}
        {#if scoreSec}
          <section>
            <h2>{scoreSec.title}</h2>
            <div class="sc-formula">{(scoreSec.paras[0] || "").replace(/^Score\s*=\s*/, "")}</div>
            {#each scoreSec.paras.slice(1) as p (p)}<p class="sc-note">{p}</p>{/each}
            {#if top}
              <div class="sc-ex">
                <div class="sc-ex-h">Current #1 · {TIER_NAME[top.tier]}</div>
                <button class="sc-ex-t" title="Open this task" onclick={() => openTask(top.key)}>{top.title}</button>
                <div class="sc-ex-m">({val("Impact")} impact + {val("Urgency")} urgency) / {val("Effort")} effort = {fmt(top.score)}</div>
              </div>
            {/if}
          </section>
        {/if}
      </div>
      <div class="sc-scales">
        {#each secs.filter(isScale) as sec (sec.title)}<section><h2>{sec.title}</h2>{@render list(sec)}</section>{/each}
      </div>
    </div>
    {#if cur}
      <aside class="sc-panel">
        <div class="sc-p-k">{isScale(cur.sec) ? `${cur.sec.title} ${cur.r.key}` : `${cur.r.key} tier`}</div>
        <div class="sc-p-t">{cur.r.summary}</div>
        {#if !sameRule(cur.r)}<p class="sc-p-d">{cur.r.detail}</p>{/if}
        {#if about.length}
          <div class="sc-p-about"><h3>About {cur.sec.title.toLowerCase()}</h3>{#each about as p (p)}<p>{p}</p>{/each}</div>
        {/if}
      </aside>
    {/if}
  </div>
  <div class="sc-boxes">
    {@render box("pin", "Changing a number", pinBody)}
  </div>
{/if}
