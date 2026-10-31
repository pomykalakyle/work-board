// Builds the window (src/ui, Svelte) into app/ui, which main.ts loads from disk.
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  root: "src/ui",
  base: "./", // relative asset paths, since the page loads from file://
  plugins: [svelte()],
  build: {
    outDir: "../../ui",
    emptyOutDir: true,
    target: "esnext", // Electron's Chromium runs modern JS as is
    modulePreload: { polyfill: false },
  },
});
