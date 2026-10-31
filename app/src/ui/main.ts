// Entry point: mounts the Svelte app into <body>. The theme is already applied by
// theme.js, a plain script in <head>, so the first paint has the right colors.
import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";

mount(App, { target: document.body });
