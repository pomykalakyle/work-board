<script lang="ts">
  // Settings: when the hourly agent runs (config.toml's [schedule], saved through config.py,
  // which reloads the launchd job and puts the old one back if that fails) and what it runs with
  // (read-only, from config.toml). Checks and Agent sit side by side on wide pages and share a
  // label column; shortcuts have their own Keyboard page.
  import { ui, saveSchedule, nextScheduled, ipcError, go } from "../lib/state.svelte";
  import { clock, parseAt, whenShort } from "../lib/text";

  const s = $derived(ui.settings);
  const saved = $derived(s?.schedule ?? null);
  // The hours and days being edited; null while they match what's saved.
  let draft = $state<Schedule | null>(null);
  const form = $derived(draft ?? saved);
  let saving = $state(false);
  // A failed save, shown under its buttons until the next save or Cancel.
  let error = $state("");

  const HOURS = Array.from({ length: 24 }, (_, h) => h);
  const hourLabel = (h: number) => clock(new Date(2000, 0, 1, h));

  // "today 7:00pm", "tomorrow 8:00am", or "Mon 8:00am".
  function whenNext(d: Date) {
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 864e5);
    const day = days === 0 ? "today" : days === 1 ? "tomorrow" : d.toLocaleDateString("en-US", { weekday: "short" });
    return `${day} ${clock(d)}`;
  }

  const next = $derived(saved ? nextScheduled(saved) : null);
  const stateLine = $derived.by(() => {
    if (!s || !saved) return "";
    if (!s.scheduled) return "Not scheduled yet.";
    if (!saved.enabled) return "Off · Check now is still available." + (ui.checking ? " Current check continues." : "");
    return next ? `On · Next scheduled check ${whenNext(next)}` : "On";
  });
  const lastLine = $derived.by(() => {
    const d = parseAt(s?.lastCheck);
    return d ? `Last successful check ${whenShort(d).replace(/^([A-Z][a-z]{2} \d+)$/, "on $1")}` : "No successful check yet.";
  });

  const dirty = $derived(!!draft && !!saved && (draft.first !== saved.first || draft.last !== saved.last || draft.weekdaysOnly !== saved.weekdaysOnly));
  const perDay = $derived(form ? form.last - form.first + 1 : 0);
  const badHours = $derived(!!form && form.first > form.last);

  function edit(change: Partial<Schedule>) {
    if (!saved || saving) return;
    draft = { ...(draft ?? saved), ...change };
    error = "";
  }

  async function apply(next: Schedule) {
    saving = true;
    error = "";
    try {
      await saveSchedule(next);
      draft = null;
    } catch (e) {
      error = ipcError(e);
    } finally {
      saving = false;
    }
  }

  const save = () => form && apply({ ...form, enabled: saved?.enabled ?? true });
  const cancel = () => { draft = null; error = ""; };
  const toggle = () => saved && apply({ ...saved, enabled: !saved.enabled });


</script>

<div class="st-cols">
<section>
<h2>Checks</h2>
{#if !s || !saved || !form}
  {#if ui.settingsError}
    <p class="st-err">{ui.settingsError}</p>
    <div class="st-acts"><button type="button" class="pf-btn" onclick={() => window.board.reveal("config")}>Open config.toml</button></div>
  {:else}
    <p class="note">Loading…</p>
  {/if}
{:else}
  <div class="st-switch">
    <label for="st-auto">Automatic checks</label>
    <input id="st-auto" type="checkbox" role="switch" checked={saved.enabled} disabled={dirty || saving} onchange={toggle} />
  </div>
  <p class="st-state">{stateLine}</p>
  {#if ui.checking && saved.enabled}<p class="st-state">Checking now.</p>{/if}
  <p class="st-state">{lastLine}</p>

  <div class="st-grid st-form">
    <label for="st-first">First check</label>
    <select id="st-first" value={form.first} disabled={saving} onchange={(e) => edit({ first: +e.currentTarget.value })}>
      {#each HOURS as h (h)}<option value={h}>{hourLabel(h)}</option>{/each}
    </select>
    <label for="st-last">Last check</label>
    <select id="st-last" value={form.last} disabled={saving} onchange={(e) => edit({ last: +e.currentTarget.value })}>
      {#each HOURS as h (h)}<option value={h}>{hourLabel(h)}</option>{/each}
    </select>
    <span class="st-k">Days</span>
    <span class="st-radios" role="radiogroup" aria-label="Days">
      <label><input type="radio" name="st-days" checked={form.weekdaysOnly} disabled={saving} onchange={() => edit({ weekdaysOnly: true })} /> Weekdays</label>
      <label><input type="radio" name="st-days" checked={!form.weekdaysOnly} disabled={saving} onchange={() => edit({ weekdaysOnly: false })} /> Every day</label>
    </span>
  </div>
  <p class="note st-sum">
    {#if badHours}The last check has to be at or after the first.{:else}{perDay} check{perDay === 1 ? "" : "s"} per scheduled day, on the hour, local time.{/if}
  </p>

  {#if dirty || !s.scheduled}
    <div class="st-acts">
      <button type="button" class="pf-btn primary" disabled={saving || ui.checking || badHours} onclick={save}>
        {saving ? "Saving…" : dirty ? "Save schedule" : "Schedule checks"}
      </button>
      {#if dirty}<button type="button" class="pf-btn" disabled={saving} onclick={cancel}>Cancel</button>{/if}
    </div>
    {#if ui.checking && !saving}<p class="note st-sum">A check is running. Save when it finishes.</p>{/if}
  {/if}
  {#if error}<p class="st-err" role="alert">{error}</p>{/if}
{/if}
</section>

<section>
{#if s}
  <h2>Agent</h2>
  <div class="st-grid">
    <span class="st-k">Configured sources</span>
    <span>{s.sources.length ? s.sources.map((x) => x.name + (x.detail ? ` (${x.detail})` : "")).join(", ") : "None"}</span>
    <span class="st-k">Model</span><span>{s.model || "Not set"}</span>
    <span class="st-k">Effort</span><span>{s.effort ? s.effort[0].toUpperCase() + s.effort.slice(1) : "Not set"}</span>
    <span class="st-k">Time limit</span><span>{s.timeoutMinutes ? `${s.timeoutMinutes} minutes` : "Not set"}</span>
  </div>
  <p class="note">Change these in config.toml.</p>
  <div class="st-acts">
    <button type="button" class="pf-btn" onclick={() => window.board.reveal("config")}>Open config.toml</button>
    <button type="button" class="pf-btn" onclick={() => window.board.reveal("logs")}>Open logs</button>
  </div>
{/if}

<h2>Keyboard</h2>
<p class="note">Every shortcut can be changed, one action at a time.</p>
<div class="st-acts"><button type="button" class="pf-btn" onclick={() => go("keys")}>Keyboard shortcuts</button></div>
</section>
</div>
