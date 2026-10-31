<script lang="ts">
  import type { Cite } from "../lib/text";
  let { c }: { c: Cite } = $props();
</script>

<!-- Opens in the browser through the main process; the window itself never navigates. -->
<a class="cite" href={c.url} title={c.url} onclick={(e) => { e.preventDefault(); window.board.open(c.url); }}>{c.label} ↗</a>
