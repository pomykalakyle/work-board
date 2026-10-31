<script lang="ts">
  // The theme picker, opened from a header's ThemeButton. The main process owns the
  // chosen theme (it also drives View > Theme and ⌘[ ⌘]); the picker asks it to change,
  // and the change comes back through App.svelte. Arrows step through themes and keep it
  // open; clicking a name picks it and closes.
  import type { Attachment } from "svelte/attachments";
  import { ui, closePicker, dirOf } from "../lib/state.svelte";
  import { arrow } from "../lib/icons";
  import { keepInView } from "../lib/attach";

  let pop: HTMLDivElement | undefined = $state();
  const from = $derived(ui.picker.from);
  const optionId = (id: string) => `theme-opt-${id}`;
  const focused = $derived(ui.theme.themes[ui.picker.focus]);

  // When it opens: right-aligned under the button, kept inside the window (the list scrolls
  // on short windows), and focused so its keys work. Sets the position through the CSSOM,
  // which the page's CSP allows.
  const placeUnder = (btn: HTMLButtonElement): Attachment<HTMLElement> => (el) => {
    const b = btn.getBoundingClientRect();
    const top = b.bottom + 6;
    el.style.top = top + "px";
    el.style.left = Math.max(8, Math.min(b.right - 240, innerWidth - 248)) + "px";
    el.style.maxHeight = Math.max(120, innerHeight - top - 10) + "px";
    el.focus();
  };

  // What the theme looks like on screen: the background, the selected-row tint (the
  // accent at the same 16% that style.css's --sel uses, over the background) and the text.
  const swatches = (t: Theme) => [t.colors.pane, `color-mix(in srgb, ${t.colors.accent} 16%, ${t.colors.pane})`, t.colors.fg];

  function pick(id: string) {
    window.themes.set(id);
    closePicker(true);
  }

  // The picker keeps its keys: down and up move, Enter or Space picks, left and right
  // step through themes, Esc or Tab closes (arrows or the Keyboard preset's letters). None of them reach the task list.
  function onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopPropagation();
    const n = ui.theme.themes.length;
    const k = e.key;
    // The arrow keys always work here, like any list control, on top of the user's Move shortcuts.
    const d = dirOf(e) ?? ({ ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" } as const)[e.key as "ArrowDown"] ?? null;
    if (d === "down") ui.picker.focus = (ui.picker.focus + 1) % n;
    else if (d === "up") ui.picker.focus = (ui.picker.focus - 1 + n) % n;
    else if (d === "left") window.themes.step(-1);
    else if (d === "right") window.themes.step(1);
    else if (k === "Enter" || k === " ") pick(ui.theme.themes[ui.picker.focus].id);
    else if (k === "Escape" || k === "Tab") closePicker(true);
    else return;
    e.preventDefault();
  }

  // Clicking elsewhere closes it and lets that click do its own thing.
  function onPointerDown(e: PointerEvent) {
    const target = e.target as Node | null;
    if (from && !pop?.contains(target) && !from.contains(target)) closePicker(false);
  }
</script>

<svelte:document onpointerdowncapture={onPointerDown} />
<svelte:window onblur={() => closePicker(false)} onresize={() => closePicker(false)} />

{#if from}
  <!-- The listbox keeps focus; aria-activedescendant points at the highlighted theme, so
       screen readers follow n/e the same way sighted users follow the highlight. -->
  <div id="theme-pop" role="listbox" aria-label="Theme" tabindex="-1" bind:this={pop} onkeydown={onKey}
    aria-activedescendant={focused ? optionId(focused.id) : undefined} {@attach placeUnder(from)}>
    <div class="tp-head">
      <span>Theme</span>
      <button class="tp-step" title="Previous theme (⌘[)" tabindex="-1" onclick={() => window.themes.step(-1)}>{@html arrow("M10 3.5L5.5 8l4.5 4.5")}</button>
      <button class="tp-step" title="Next theme (⌘])" tabindex="-1" onclick={() => window.themes.step(1)}>{@html arrow("M6 3.5l4.5 4.5L6 12.5")}</button>
    </div>
    <div class="tp-list">
      {#each ui.theme.themes as t, i (t.id)}
        <!-- WAI-ARIA listbox with aria-activedescendant: the listbox handles the keys, options only take clicks. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div id={optionId(t.id)} class={["tp-row", { focus: i === ui.picker.focus }]} role="option" aria-selected={t.id === ui.theme.id} tabindex="-1"
          onclick={() => pick(t.id)} {@attach i === ui.picker.focus && keepInView}>
          <span class="tp-check">{t.id === ui.theme.id ? "✓" : ""}</span>
          <span class="tp-name">{t.name}</span>
          <span class="tp-sw">{#each swatches(t) as c}<i style:background={c}></i>{/each}</span>
        </div>
      {/each}
    </div>
  </div>
{/if}
