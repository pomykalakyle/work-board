// Applies the chosen theme as CSS variables on <html>. Loaded in <head>, before
// style.css, so the first paint already has the right colors. The picker
// (ThemePicker.svelte) and the View > Theme menu both go through the main
// process, and App.svelte calls applyTheme with every change it sends back.
(function () {
  const root = document.documentElement;
  window.applyTheme = (state) => {
    const t = state.themes.find((x) => x.id === state.id) || state.themes[0];
    for (const [k, v] of Object.entries(t.colors)) root.style.setProperty("--" + k, v);
    root.dataset.theme = t.id;
    root.classList.toggle("opaque-side", !!state.opaqueSidebar);
  };
  if (window.themes) window.applyTheme(window.themes.initial);
})();
