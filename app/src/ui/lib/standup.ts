// The standup draft (work_standup.text, written by the hourly check): a few lines of plain
// text with "- " bullets and Markdown links. Parsed into blocks for the page, and turned
// into HTML (real links and bullets, which Slack pastes) plus a plain-text fallback for copying.

export type Inline = { text: string; url?: string; code?: boolean };
export type Block = { kind: "p"; parts: Inline[] } | { kind: "ul"; items: Inline[][] };

const INLINE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`/g;

function inline(line: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index > at) out.push({ text: line.slice(at, m.index) });
    out.push(m[3] !== undefined ? { text: m[3], code: true } : { text: m[1], url: m[2] });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out;
}

export function parse(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const last = blocks.at(-1);
    if (bullet) {
      if (last?.kind === "ul") last.items.push(inline(bullet[1]));
      else blocks.push({ kind: "ul", items: [inline(bullet[1])] });
    } else blocks.push({ kind: "p", parts: inline(line) });
  }
  return blocks;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const partsHtml = (parts: Inline[]) =>
  parts.map((p) => (p.url ? `<a href="${esc(p.url)}">${esc(p.text)}</a>` : p.code ? `<code>${esc(p.text)}</code>` : esc(p.text))).join("");
const partsText = (parts: Inline[]) => parts.map((p) => (p.url ? `${p.text} (${p.url})` : p.code ? `\`${p.text}\`` : p.text)).join("");

export function toHtml(blocks: Block[]): string {
  return blocks.map((b) => (b.kind === "p" ? `<p>${partsHtml(b.parts)}</p>` : `<ul>${b.items.map((i) => `<li>${partsHtml(i)}</li>`).join("")}</ul>`)).join("");
}

export function toText(blocks: Block[]): string {
  // A blank line before each paragraph after the first, so "Blockers:" stands apart from the list above it.
  return blocks.map((b, i) => (b.kind === "p" ? (i ? "\n" : "") + partsText(b.parts) : b.items.map((x) => "• " + partsText(x)).join("\n"))).join("\n");
}
