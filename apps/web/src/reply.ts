import { CITATION } from "./labels";

export type ReplyPart = { kind: "text"; text: string; bold: boolean } | { kind: "cite"; id: string };

const BOLD = /\*\*([^*\n]+?)\*\*/g;

/**
 * A reply split into text and citation markers. The only Markdown rendered is **bold**, which the model sometimes
 * uses for a topic word ("**Heizung:** Ja"). Pairs that do not close within one passage between citations are
 * dropped rather than shown as literal asterisks; everything else stays as the model wrote it.
 */
export function replyParts(reply: string): ReplyPart[] {
  const out: ReplyPart[] = [];
  let at = 0;
  for (const m of reply.matchAll(CITATION)) {
    out.push(...textParts(reply.slice(at, m.index)));
    out.push({ kind: "cite", id: m[1]! });
    at = m.index + m[0].length;
  }
  out.push(...textParts(reply.slice(at)));
  return out;
}

function textParts(text: string): ReplyPart[] {
  const out: ReplyPart[] = [];
  const plain = (t: string) => {
    const s = t.replaceAll("**", "");
    if (s) out.push({ kind: "text", text: s, bold: false });
  };
  let at = 0;
  for (const m of text.matchAll(BOLD)) {
    plain(text.slice(at, m.index));
    out.push({ kind: "text", text: m[1]!, bold: true });
    at = m.index + m[0].length;
  }
  plain(text.slice(at));
  return out;
}
