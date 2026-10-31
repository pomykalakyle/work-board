<script lang="ts">
  import { safeColor } from "../lib/text";
  let { color }: { color: string } = $props();
</script>

<!-- style: sets the property through the DOM, which the page's CSP allows (a style="" attribute it wouldn't). -->
<span class="dot" style:background={safeColor(color)}></span>
