// Attachments ({@attach ...}): small DOM jobs tied to an element's lifetime,
// which current Svelte guidance prefers over $effect plus querySelector.
import type { Attachment } from "svelte/attachments";
import { on } from "svelte/events";
import { dragDetailTo, toggleDetail } from "./state.svelte";

// Scroll an element into view when attached. Use conditionally, e.g.
// {@attach selected && keepInView}, so it runs each time the row becomes selected.
export const keepInView: Attachment<HTMLElement> = (el) => {
  el.scrollIntoView({ block: "nearest" });
};

// Reset a scroll container to `top` (the top by default) whenever `key` changes (a different task or page).
export const scrollTopOn = (key: unknown, top = 0): Attachment<HTMLElement> => (el) => {
  void key;
  el.scrollTop = top;
};

// The divider between the list and the detail panel: drag to resize, drag nearly shut
// to hide, double-click to toggle. A drag always ends cleanly, even if it's cancelled
// or the element goes away mid-drag.
export const resizeHandle: Attachment<HTMLElement> = (bar) => {
  let endDrag: (() => void) | null = null;
  const start = (e: PointerEvent) => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const offs = [
      on(bar, "pointermove", (ev) => dragDetailTo(ev.clientX)),
      on(bar, "pointerup", () => endDrag?.()),
      on(bar, "pointercancel", () => endDrag?.()),
      on(bar, "lostpointercapture", () => endDrag?.()),
    ];
    endDrag = () => {
      offs.forEach((off) => off());
      document.body.classList.remove("resizing");
      endDrag = null;
    };
  };
  const offDown = on(bar, "pointerdown", start);
  const offDbl = on(bar, "dblclick", toggleDetail);
  return () => {
    endDrag?.();
    offDown();
    offDbl();
  };
};
