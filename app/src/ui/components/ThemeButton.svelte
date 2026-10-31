<script lang="ts">
  import { ui, openPicker, closePicker } from "../lib/state.svelte";
  import { HALF_CIRCLE } from "../lib/icons";
  let btn: HTMLButtonElement | undefined = $state();
  const open = $derived(!!btn && ui.picker.from === btn);
</script>

<!-- Opens the theme picker under it (the picker itself is ThemePicker.svelte). -->
<button class="theme-btn" bind:this={btn} title="Theme (⌘] next, ⌘[ previous)" aria-haspopup="listbox" aria-expanded={open}
  onclick={() => (open ? closePicker(true) : (closePicker(false), btn && openPicker(btn)))}>{@html HALF_CIRCLE}</button>
