<script lang="ts">
  // preferences.md as a page: plain-English preferences, the people you work with, and
  // (with [standup] on) your standup style. The hourly check's prompt (config.py) gets every
  // preference, which wins over the built-in rules where they conflict, each person's name
  // and title (it reads their notes from the file when their ask matters), and the standup
  // style when it writes the draft. Every change saves right away.
  import { tick } from "svelte";
  import { ui, savePrefs } from "../lib/state.svelte";

  // The two plain lists, and people.
  type List = "preferences" | "standup";
  type Kind = List | "person";

  // The row being edited, by position, and what it held when editing started (to catch a change on disk meanwhile).
  let editing = $state<{ kind: Kind; i: number; was: string } | null>(null);
  // The row being edited, and the "add" fields at the bottom of each list.
  let draft = $state({ text: "", name: "", title: "", notes: "" });
  let add = $state({ preferences: "", standup: "", name: "", title: "", notes: "" });
  // The status line under the intro: saved, or why a change didn't go through.
  let status = $state<{ kind: "saved" | "error"; text: string } | null>(null);
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  const prefs = $derived(ui.prefs);
  // The Standup style list shows when the standup draft is on, or if it already has lines.
  const showStandup = $derived(ui.data?.standup != null || !!prefs?.standup.length);

  function show(kind: "saved" | "error", text: string) {
    status = { kind, text };
    clearTimeout(statusTimer);
    if (kind === "saved") statusTimer = setTimeout(() => (status = null), 2500);
  }

  // True once saved; on failure the page is back as it was and the error shows.
  async function save(p: Prefs): Promise<boolean> {
    try {
      await savePrefs(p);
      show("saved", "Saved. The next check uses it.");
      return true;
    } catch (e) {
      show("error", "Couldn't save preferences.md: " + (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': /, "") : String(e)));
      return false;
    }
  }

  // A row's content, to tell whether it changed while being edited.
  const rowKey = (p: Prefs, kind: Kind, i: number) => JSON.stringify(kind === "person" ? p.people[i] : p[kind][i]);

  async function startEdit(kind: Kind, i: number) {
    if (!prefs) return;
    editing = { kind, i, was: rowKey(prefs, kind, i) };
    if (kind === "person") ({ name: draft.name, title: draft.title, notes: draft.notes } = prefs.people[i]);
    else draft.text = prefs[kind][i];
    await tick();
    document.querySelector<HTMLElement>(".pf-edit textarea, .pf-edit input")?.focus();
  }

  function cancelEdit() {
    editing = null;
  }

  function commitEdit() {
    if (!prefs || !editing) return;
    const { kind, i, was } = editing;
    // The file changed underneath (e.g. edited by hand): don't overwrite whatever is in this position now.
    if (rowKey(prefs, kind, i) !== was) {
      editing = null;
      show("error", "That item changed in preferences.md while you were editing it. Edit it again.");
      return;
    }
    editing = null;
    if (kind === "person") {
      const person = { name: draft.name.trim(), title: draft.title.trim(), notes: draft.notes.trim() };
      const old = prefs.people[i];
      if (person.name === old.name && person.title === old.title && person.notes === old.notes) return;
      save({ ...prefs, people: person.name ? prefs.people.with(i, person) : prefs.people.toSpliced(i, 1) });
    } else {
      const text = draft.text.trim();
      if (text === prefs[kind][i]) return;
      save({ ...prefs, [kind]: text ? prefs[kind].with(i, text) : prefs[kind].toSpliced(i, 1) });
    }
  }

  function remove(kind: Kind, i: number) {
    if (!prefs) return;
    editing = null;
    if (kind === "person") save({ ...prefs, people: prefs.people.toSpliced(i, 1) });
    else save({ ...prefs, [kind]: prefs[kind].toSpliced(i, 1) });
  }

  async function addText(list: List) {
    const text = add[list].trim();
    if (!prefs || !text) return;
    const typed = add[list];
    add[list] = "";
    if (!(await save({ ...prefs, [list]: [...prefs[list], text] }))) add[list] = typed; // keep it to retry
  }

  async function addPerson() {
    const name = add.name.trim();
    if (!prefs || !name) return;
    const typed = { name: add.name, title: add.title, notes: add.notes };
    const person = { name, title: add.title.trim(), notes: add.notes.trim() };
    add.name = add.title = add.notes = "";
    if (await save({ ...prefs, people: [...prefs.people, person] })) document.getElementById("pf-add-name")?.focus();
    else Object.assign(add, typed); // keep it to retry
  }

  // Enter saves (these are one-line items; a pasted newline becomes a space), Esc cancels.
  function editKeys(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
  }
  const enterTo = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fn(); }
  };
  const isEditing = (kind: Kind, i: number) => editing?.kind === kind && editing.i === i;
</script>

{#snippet actions(kind: Kind, i: number)}
  <span class="pf-acts">
    <button type="button" class="pf-btn" onclick={() => startEdit(kind, i)}>Edit</button>
    <button type="button" class="pf-btn" onclick={() => remove(kind, i)}>Remove</button>
  </span>
{/snippet}

{#snippet editButtons()}
  <span class="pf-acts shown">
    <button type="button" class="pf-btn primary" onclick={commitEdit}>Save</button>
    <button type="button" class="pf-btn" onclick={cancelEdit}>Cancel</button>
  </span>
{/snippet}

{#snippet textList(p: Prefs, list: List, label: string, placeholder: string)}
  <ul class="pf-list">
    {#each p[list] as text, i (i + "|" + text)}
      <li class={["pf-row", { "pf-edit": isEditing(list, i) }]}>
        {#if isEditing(list, i)}
          <textarea class="pf-in" rows="1" bind:value={draft.text} onkeydown={editKeys} aria-label={label}></textarea>
          {@render editButtons()}
        {:else}
          <span class="pf-text">{text}</span>
          {@render actions(list, i)}
        {/if}
      </li>
    {:else}
      <li class="pf-none">None yet.</li>
    {/each}
  </ul>
  <div class="pf-add">
    <textarea class="pf-in" rows="1" bind:value={add[list]} onkeydown={enterTo(() => addText(list))} aria-label={"New " + label.toLowerCase()} {placeholder}></textarea>
    <button type="button" class="pf-btn" disabled={!add[list].trim()} onclick={() => addText(list)}>Add</button>
  </div>
{/snippet}

{#if !prefs}
  <div class="empty">Loading…</div>
{:else}
  <p class="lead">The hourly check follows your preferences on every run, and they win where they conflict with the built-in rules.</p>
  <p class={["note pf-status", { err: status?.kind === "error" }]} aria-live="polite">{status?.text ?? "Changes save right away and apply from the next check."}</p>

  <h2>Preferences</h2>
  {@render textList(prefs, "preferences", "Preference", "Add a preference, e.g. Wait 3 working days before suggesting I ping someone")}

  <h2>People</h2>
  <p class="note pf-sub">Every check knows each person's name and title. It reads their notes when one of their asks affects a task.</p>
  <ul class="pf-list">
    {#each prefs.people as person, i (i + "|" + person.name)}
      <li class={["pf-row person", { "pf-edit": isEditing("person", i) }]}>
        {#if isEditing("person", i)}
          <span class="pf-who">
            <input class="pf-in" bind:value={draft.name} onkeydown={editKeys} aria-label="Name" placeholder="Name" />
            <input class="pf-in" bind:value={draft.title} onkeydown={editKeys} aria-label="Title" placeholder="Title" />
          </span>
          <textarea class="pf-in" rows="1" bind:value={draft.notes} onkeydown={editKeys} aria-label="Notes" placeholder="Notes"></textarea>
          {@render editButtons()}
        {:else}
          <span class="pf-who"><span class="pf-name">{person.name}</span>{#if person.title}<span class="pf-title">{person.title}</span>{/if}</span>
          <span class="pf-text">{person.notes}</span>
          {@render actions("person", i)}
        {/if}
      </li>
    {:else}
      <li class="pf-none">None yet.</li>
    {/each}
  </ul>
  <div class="pf-add person">
    <span class="pf-who">
      <input id="pf-add-name" class="pf-in" bind:value={add.name} onkeydown={enterTo(addPerson)} aria-label="New person's name" placeholder="Name" />
      <input class="pf-in" bind:value={add.title} onkeydown={enterTo(addPerson)} aria-label="Their title" placeholder="Title, e.g. CTO" />
    </span>
    <textarea class="pf-in" rows="1" bind:value={add.notes} onkeydown={enterTo(addPerson)} aria-label="Notes on them"
      placeholder="Notes, e.g. reviews your PRs; wants open PRs finished first"></textarea>
    <button type="button" class="pf-btn" disabled={!add.name.trim()} onclick={addPerson}>Add</button>
  </div>

  {#if showStandup}
    <h2>Standup style</h2>
    <p class="note pf-sub">How your end-of-day standup draft should read. Only the standup part of each check uses these.</p>
    {@render textList(prefs, "standup", "Standup rule", "Add a rule, e.g. About four one-line items")}
  {/if}
{/if}
