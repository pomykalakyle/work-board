// Pure text and date helpers shared by the components.

export const TIER_NAME: Record<Tier, string> = { must: "Must", should: "Should", later: "Later" };
export const KIND_WORD: Record<string, string> = { added: "Added", blocked: "Blocked", unblocked: "Unblocked", done: "Done", note: "Your note" };
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : Number(n).toFixed(1));
// Project colors come from the data, so only accept a plain hex color.
export const safeColor = (color: string) => (/^#[0-9a-f]{3,8}$/i.test(color) ? color : "#777");
export const shortProject = (name: string) => name.split(":")[0];

export interface Cite { label: string; url: string }

// Reasons can cite sources as Markdown links, [label](https://...), or the user's notes as [your note](note:12).
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|note:\d+)\)/g;
// A reason is one sentence followed by its citations. Split them so the
// sentence reads clean and the sources sit on their own line under it.
const TRAILING_CITES = /[\s(]*(\[[^\]]+\]\((?:https?:\/\/[^)\s]+|note:\d+)\)[\s,;]*)+\)?\s*\.?\s*$/;
export function splitReason(text: string | null | undefined): { sentence: string; cites: Cite[] } {
  const t = text || "";
  const tail = t.match(TRAILING_CITES);
  const body = tail ? t.slice(0, tail.index) : t;
  const sentence = body.replace(LINK, "$1").trim().replace(/[\s,;:(]+$/, "")
    .replace(/^(must|should|later)\s*[:\-]\s*/i, "") // the tier is already shown next to it
    .replace(/^./, (c) => c.toUpperCase());
  const cites = [...(tail ? tail[0] : "").matchAll(LINK)].map((m) => ({ label: m[1], url: m[2] }));
  return { sentence: sentence && !/[.!?…]$/.test(sentence) ? sentence + "." : sentence, cites };
}

// Long text reads as a blob in the side panel: split it into sentences to show one per line.
export const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z#])/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean);

// Event times are local "YYYY-MM-DD HH:MM".
export function parseAt(at: string | null | undefined): Date | null {
  const m = (at || "").match(/^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d))?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
}
export const clock = (d: Date) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}${d.getHours() < 12 ? "am" : "pm"}`;
export const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export const isToday = (d: Date) => ymd(d) === ymd(new Date());
export function dayHeading(d: Date) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const date = `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
  if (ymd(d) === ymd(today)) return "Today · " + date;
  if (ymd(d) === ymd(yesterday)) return "Yesterday · " + date;
  return date;
}

// A short relative time: "today 11:31am", "yesterday 8:00pm", or "Oct 28" further back.
export function whenShort(d: Date) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (ymd(d) === ymd(today)) return "today " + clock(d);
  if (ymd(d) === ymd(yesterday)) return "yesterday " + clock(d);
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

// An event's line, kept lowercase when the text starts that way (a command like "gh").
export function eventText(e: BoardEvent) {
  let { sentence, cites } = splitReason(e.text);
  if (/^[a-z]/.test(e.text.trim())) sentence = sentence.charAt(0).toLowerCase() + sentence.slice(1);
  return { sentence, cites };
}

// ranking.md helpers. A detail that only repeats its summary ("Nice to have.") isn't worth showing.
export const ruleId = (sec: RuleSection, r: RuleRow) => sec.title + ":" + r.key;
export const isScale = (sec: RuleSection) => /^\d+$/.test(sec.rows[0].key);
const normRule = (t: string) => t.toLowerCase().replace(/^(a|an|the) /, "").replace(/\.$/, "");
export const sameRule = (r: RuleRow) => !r.detail || normRule(r.detail) === normRule(r.summary);

// A shortcut binding ("Shift+Meta+]") as macOS shows it: modifier symbols in the order ⌃⌥⇧⌘, then the key.
const KEY_NAMES: Record<string, string> = {
  ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→", Enter: "Return", Space: "Space",
  Backspace: "Delete", Delete: "Forward Delete", Escape: "Esc", Tab: "Tab", PageUp: "Page Up", PageDown: "Page Down",
};
const MOD_SYMBOLS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
export function keyLabel(binding: string) {
  const plus = binding === "+" || binding.endsWith("++");
  const parts = plus ? [...binding.slice(0, -2).split("+").filter(Boolean), "+"] : binding.split("+");
  const key = parts.pop()!;
  return parts.map((m) => MOD_SYMBOLS[m] ?? m).join("") + (KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key));
}
