<script lang="ts">
  // Keyboard: every action from shortcuts.json with its keys (up to two each), editable one action
  // at a time. Wide pages show the selected action's editor in a panel beside the list (like How
  // scoring works); narrow ones show it under the action's row. Changes save through main.ts, which
  // rebuilds the menu's ⌘ shortcuts. While a key is being recorded, the menu's shortcuts are off
  // and every other key handler stands down (ui.recording), so ⌘R records instead of starting a check.
  import { ui, comboOf, ipcError } from "../lib/state.svelte";
  import { keyLabel } from "../lib/text";

  const actions = $derived(ui.shortcuts.actions);
  const bindings = $derived(ui.shortcuts.bindings);
  const groups = $derived([...new Set(actions.map((a) => a.group))].map((g) => ({ name: g, actions: actions.filter((a) => a.group === g) })));

  // The selected action, kept across resizes (the panel and the inline editor show the same state).
  let sel = $state("down");
  const cur = $derived(actions.find((a) => a.id === sel) ?? actions[0]);

  // Recording a key for an action: slot is the binding being changed, or null to add one.
  let rec = $state<{ id: string; slot: number | null } | null>(null);
  // A key or reset that would take keys from other actions, waiting for Move or Cancel. Nothing is saved yet.
  let pending = $state<{ id: string; next: string[]; taken: { action: ShortcutAction; key: string }[] } | null>(null);
  // A message beside the action: a key that can't be used, or a save that failed.
  let notice = $state<{ id: string; text: string; err: boolean } | null>(null);
  let confirmAll = $state(false);
  let saving = $state(false);

  const SCOPE_TEXT: Record<ShortcutAction["scope"], string> = {
    move: "Works in every list.",
    list: "Works in task lists.",
    history: "Works on History.",
    global: "Works anywhere. Plain keys pause while you type in a field; ⌘ and ⌃ shortcuts don't.",
  };
  // Shortcuts macOS and every app reserve, or keys that move between controls.
  const RESERVED: Record<string, string> = {
    "Meta+q": "quits apps", "Meta+w": "closes windows", "Meta+h": "hides apps", "Alt+Meta+h": "hides other apps", "Meta+m": "minimizes windows",
    "Meta+c": "copies", "Meta+v": "pastes", "Meta+x": "cuts", "Meta+a": "selects all", "Meta+z": "undoes", "Shift+Meta+z": "redoes",
    "Meta+`": "switches windows", "Meta+Tab": "switches apps", "Meta+Space": "opens Spotlight", "Tab": "moves between controls", "Shift+Tab": "moves between controls",
  };

  const overlaps = (a: string, b: string) => a === b || a === "global" || b === "global" || a === "move" || b === "move";
  const changed = (a: ShortcutAction) => JSON.stringify(bindings[a.id] ?? []) !== JSON.stringify(a.defaults);
  const changedCount = $derived(actions.filter(changed).length);
  const labelOf = (id: string) => actions.find((a) => a.id === id)?.label ?? id;

  // Other actions that already use a key where this action's key would also work.
  const takenBy = (a: ShortcutAction, keys: string[]) =>
    actions.flatMap((b) => (b.id !== a.id && overlaps(a.scope, b.scope) ? keys.filter((k) => bindings[b.id]?.includes(k)).map((key) => ({ action: b, key })) : []));

  async function save(next: Record<string, string[]>, id: string) {
    saving = true;
    try {
      await window.keys.set($state.snapshot(next));
      notice = null;
    } catch (e) {
      notice = { id, text: "Couldn't save: " + ipcError(e), err: true };
    } finally {
      saving = false;
    }
  }

  // Applies a new key list for one action, taking each key off the actions listed.
  function apply(id: string, keys: string[], taken: { action: ShortcutAction; key: string }[]) {
    const next: Record<string, string[]> = { ...$state.snapshot(bindings) };
    for (const t of taken) next[t.action.id] = (next[t.action.id] ?? []).filter((k) => k !== t.key);
    next[id] = keys;
    pending = null;
    return save(next, id);
  }

  // Asks first when keys would move from other actions; otherwise saves.
  function propose(a: ShortcutAction, keys: string[]) {
    const taken = takenBy(a, keys);
    if (taken.length) pending = { id: a.id, next: keys, taken };
    else apply(a.id, keys, []);
  }

  // ---------- recording ----------
  // One cleanup path for Esc, a recorded key, the window losing focus (main.ts says so) and leaving the page.
  function stopRecording() {
    if (!rec) return;
    rec = null;
    ui.recording = false;
    window.removeEventListener("keydown", onRecordKey, true);
    window.keys.capture(false);
  }

  function startRecording(id: string, slot: number | null) {
    stopRecording();
    pending = null;
    notice = null;
    confirmAll = false;
    sel = id;
    rec = { id, slot };
    ui.recording = true;
    window.keys.capture(true);
    // Added during the click, so the Enter or Space that pressed the button is never recorded.
    window.addEventListener("keydown", onRecordKey, true);
  }

  function onRecordKey(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!rec || e.repeat) return;
    const a = actions.find((x) => x.id === rec!.id)!;
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { stopRecording(); return; }
    const combo = comboOf(e);
    if (!combo) return; // a modifier on its own: keep waiting for the key
    if (e.isComposing) return;
    if (RESERVED[combo]) { notice = { id: a.id, text: `${keyLabel(combo)} ${RESERVED[combo]}, so it can't be a shortcut here. Press another key.`, err: true }; return; }
    const keys = [...(bindings[a.id] ?? [])];
    const slot = rec.slot;
    stopRecording();
    if (keys.includes(combo)) { notice = { id: a.id, text: `${keyLabel(combo)} is already one of its shortcuts.`, err: false }; return; }
    if (slot === null) keys.push(combo);
    else keys[slot] = combo;
    propose(a, keys);
  }

  // Leaving the page while recording turns the menu's shortcuts back on.
  $effect(() => () => stopRecording());

  function remove(a: ShortcutAction, i: number) {
    stopRecording();
    apply(a.id, (bindings[a.id] ?? []).filter((_, j) => j !== i), []);
  }

  function select(id: string) {
    if (rec && rec.id !== id) stopRecording();
    if (pending && pending.id !== id) pending = null;
    sel = id;
  }

  const resetAll = () => {
    confirmAll = false;
    stopRecording();
    pending = null;
    save(Object.fromEntries(actions.map((a) => [a.id, [...a.defaults]])), sel);
  };
</script>

<!-- Recording ends when the window loses focus (main.ts turns the menu's shortcuts back on too). -->
<svelte:window onblur={stopRecording} />

{#snippet chips(keys: string[])}
  {#if keys.length}{#each keys as k (k)}<kbd>{keyLabel(k)}</kbd>{/each}{:else}<span class="kb-none">None</span>{/if}
{/snippet}

{#snippet editor(a: ShortcutAction)}
  {const keys = $derived(bindings[a.id] ?? [])}
  {const recording = $derived(rec?.id === a.id)}
  <!-- While a move waits for an answer, it's the only choice shown. -->
  {const asking = $derived(pending?.id === a.id)}
  <div class="kb-ed">
    <div class="kb-ed-t">{a.label}</div>
    <p class="note kb-ed-scope">{a.where ? `Works on ${a.where}.` : SCOPE_TEXT[a.scope]}</p>
    <ul class="kb-binds">
      {#each keys as k, i (k)}
        <li>
          {#if recording && rec?.slot === i}
            <span class="kb-rec" aria-live="polite">Press a shortcut… <span class="kb-hint">Esc cancels</span></span>
            <button type="button" class="pf-btn" onclick={stopRecording}>Cancel</button>
          {:else}
            <kbd>{keyLabel(k)}</kbd>
            {#if !asking}
              <span class="kb-acts">
                <button type="button" class="pf-btn" disabled={saving} onclick={() => startRecording(a.id, i)}>Change</button>
                <button type="button" class="pf-btn" disabled={saving} onclick={() => remove(a, i)}>Remove</button>
              </span>
            {/if}
          {/if}
        </li>
      {:else}
        {#if !(recording && rec?.slot === null)}<li class="kb-none">No shortcut.</li>{/if}
      {/each}
      {#if recording && rec?.slot === null}
        <li>
          <span class="kb-rec" aria-live="polite">Press a shortcut… <span class="kb-hint">Esc cancels</span></span>
          <button type="button" class="pf-btn" onclick={stopRecording}>Cancel</button>
        </li>
      {/if}
    </ul>
    {#if !asking}
    <div class="st-acts">
      {#if keys.length < 2 && !recording}
        <button type="button" class="pf-btn" disabled={saving} onclick={() => startRecording(a.id, null)}>Add shortcut</button>
      {/if}
      {#if changed(a) && !recording}
        <button type="button" class="pf-btn" disabled={saving} onclick={() => propose(a, [...a.defaults])}>
          Reset to {a.defaults.length ? a.defaults.map(keyLabel).join(" and ") : "no shortcut"}
        </button>
      {/if}
    </div>
    {/if}
    {#if pending?.id === a.id}
      <div class="kb-conflict" role="alert">
        <p class="kb-result">New shortcut{pending.next.length === 1 ? "" : "s"} for {a.label}: {#each pending.next as k (k)}<kbd>{keyLabel(k)}</kbd>{:else}none{/each}</p>
        {#each pending.taken as t (t.action.id + t.key)}
          {const left = $derived((bindings[t.action.id] ?? []).filter((k) => k !== t.key))}
          <p>
            <kbd>{keyLabel(t.key)}</kbd> is used by {t.action.label}, which would
            {left.length ? `keep only ${left.map(keyLabel).join(" and ")}.` : "be left with no shortcut."}
          </p>
        {/each}
        <div class="st-acts">
          <button type="button" class="pf-btn primary" disabled={saving} onclick={() => pending && apply(pending.id, pending.next, pending.taken)}>Move {pending.taken.length > 1 ? "them" : "it"} here</button>
          <button type="button" class="pf-btn" onclick={() => (pending = null)}>Cancel</button>
        </div>
      </div>
    {/if}
    {#if notice?.id === a.id}<p class={["kb-notice", { err: notice.err }]} role={notice.err ? "alert" : undefined}>{notice.text}</p>{/if}
  </div>
{/snippet}

<div class="kb-head">
  <p class="note">Select an action to change its shortcuts. Each can have up to two.</p>
  {#if changedCount}
    {#if confirmAll}
      <span class="kb-all">
        <span class="kb-hint">Put all {changedCount} changed action{changedCount === 1 ? "" : "s"} back to the defaults?</span>
        <button type="button" class="pf-btn primary" disabled={saving} onclick={resetAll}>Reset all</button>
        <button type="button" class="pf-btn" onclick={() => (confirmAll = false)}>Cancel</button>
      </span>
    {:else}
      <button type="button" class="pf-btn" onclick={() => (confirmAll = true)}>Reset all to defaults</button>
    {/if}
  {/if}
</div>

<div class="kb-wrap">
  <div class="kb-list"><div class="kb-cols">
    {#each groups as g (g.name)}
      <section class="kb-grp">
      <h2>{g.name}</h2>
      {#each g.actions as a (a.id)}
        <button type="button" class={["kb-row", { on: cur?.id === a.id }]} aria-current={cur?.id === a.id || undefined} onclick={() => select(a.id)}>
          <span class="kb-label">{a.label}{#if changed(a)}<span class="kb-changed">changed</span>{/if}</span>
          <span class="kb-keys">{@render chips(bindings[a.id] ?? [])}</span>
        </button>
        <!-- Narrow pages: the editor sits under its row (style.css hides the side panel). -->
        {#if cur?.id === a.id}<div class="kb-inline">{@render editor(a)}</div>{/if}
      {/each}
      </section>
    {/each}
  </div></div>
  {#if cur}<aside class="kb-panel">{@render editor(cur)}</aside>{/if}
</div>
