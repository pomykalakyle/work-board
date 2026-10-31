<script lang="ts">
  // The end-of-day standup draft (optional: config.toml's [standup]). Every hourly check
  // rewrites it from the day's work and the board's blocked tasks; this page shows the
  // newest one and copies it so it pastes into Slack with working links and bullets.
  import { ui } from "../lib/state.svelte";
  import { parse, toHtml, toText } from "../lib/standup";
  import { parseAt, dayHeading, clock } from "../lib/text";

  const s = $derived(ui.data?.standup);
  const blocks = $derived(parse(s?.text || ""));
  const day = $derived(parseAt(s?.day));
  const updated = $derived(parseAt(s?.updatedAt));
  const when = $derived([day ? dayHeading(day) : s?.day, updated && "updated " + clock(updated)].filter(Boolean).join(" · "));

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    await window.board.copy(toText(blocks), toHtml(blocks));
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 2000);
  }

  const open = (e: MouseEvent, url: string) => {
    e.preventDefault();
    window.board.open(url);
  };
</script>

{#snippet parts(list: import("../lib/standup").Inline[])}
  {#each list as p, i (i)}{#if p.url}<a href={p.url} title={p.url} onclick={(e) => open(e, p.url!)}>{p.text}</a>{:else if p.code}<code>{p.text}</code>{:else}{p.text}{/if}{/each}
{/snippet}

{#if !s}
  <div class="empty">The standup draft is off. Turn it on with [standup] enabled = true in config.toml.</div>
{:else if !blocks.length}
  <div class="empty">No draft yet. The next check writes one (hourly, or Check now).</div>
{:else}
  <div class="su-head">
    <div class="su-when">{when}</div>
    <button type="button" class={["pf-btn primary su-copy", { done: copied }]} onclick={copy}
      title="Copies the draft with its links and bullets, ready to paste into Slack">{copied ? "Copied" : "Copy for Slack"}</button>
  </div>
  <div class="su-draft">
    {#each blocks as b, i (i)}
      {#if b.kind === "p"}<p>{@render parts(b.parts)}</p>
      {:else}<ul>{#each b.items as item, j (j)}<li>{@render parts(item)}</li>{/each}</ul>{/if}
    {/each}
  </div>
  <p class="note">Every check rewrites this from your day's work and the board's blocked tasks. In Slack, pick each @name again after pasting so it becomes a real mention.</p>
{/if}
