/**
 * Checks that run in code on the model's final answer. The prompt asks for citations and quoted figures;
 * these checks make sure the answer actually has them (DECISIONS.md 20).
 */

export interface Evidence {
  /** chunkIds returned by search_knowledge in this run. */
  chunkIds: ReadonlySet<string>;
  /** Listing ids that appeared in any tool result in this run. */
  listingIds: ReadonlySet<string>;
  /** Raw text of every tool result in this run. */
  toolTexts: readonly string[];
  /** The inquirer's own messages, this one and earlier turns: figures they stated are not invented. */
  inquiry: string;
}

export interface Violation {
  guard: "citation" | "number" | "empty";
  message: string;
}

export interface Citation {
  listingId: string | null;
  chunkId: string | null;
}

export type FigureKind = "price" | "area" | "percent";
export interface Figure {
  kind: FigureKind;
  /** The number as written, e.g. "1.650". */
  raw: string;
  /** The whole match, e.g. "1.650 €". */
  text: string;
}

const LISTING = String.raw`[A-Z]{1,3}-\d{3,5}`;
const MARKER = new RegExp(String.raw`\[(policy:[^\]\s]+|${LISTING}(?:#s\d+)?)\]`, "g");

export function extractCitations(reply: string): { citations: Citation[] } {
  const citations: Citation[] = [];
  for (const m of reply.matchAll(MARKER)) {
    const id = m[1]!;
    if (id.startsWith("policy:")) citations.push({ listingId: null, chunkId: id });
    else if (id.includes("#")) citations.push({ listingId: id.split("#")[0]!, chunkId: id });
    else citations.push({ listingId: id, chunkId: null });
  }
  return { citations };
}

const NUM = String.raw`\d+(?:[.,]\d+)*`;
const FIGURE_PATTERNS: { kind: FigureKind; re: RegExp }[] = [
  { kind: "price", re: new RegExp(String.raw`(${NUM})\s*(?:€|EUR\b|Euro\b)`, "gi") },
  { kind: "price", re: new RegExp(String.raw`(?:€|\bEUR\b)\s*(${NUM})`, "gi") },
  { kind: "area", re: new RegExp(String.raw`(${NUM})\s*(?:m²|m2(?![\w²])|qm\b|sqm\b|Quadratmeter\b|square\s*met(?:er|re)s?\b)`, "gi") },
  { kind: "percent", re: new RegExp(String.raw`(${NUM})\s*(?:%|percent\b|Prozent\b)`, "gi") },
];

/** Prices, areas and percentages in a text, in order of appearance. Bare digits (ids, dates, floors) are ignored. */
export function extractFigures(text: string): Figure[] {
  const found: (Figure & { index: number })[] = [];
  for (const { kind, re } of FIGURE_PATTERNS) {
    for (const m of text.matchAll(re)) found.push({ kind, raw: m[1]!, text: m[0], index: m.index });
  }
  return found.sort((a, b) => a.index - b.index).map(({ index: _i, ...f }) => f);
}

/**
 * Every value a written number can mean. "1.650" is 1650 in German and 1.65 in English, so both count;
 * "2,5" is 2.5 or 25, and the check errs on the side of accepting what the record actually contains.
 */
function values(token: string): number[] {
  if (/^\d+$/.test(token)) return [Number(token)];
  const seps = token.match(/[.,]/g)!;
  const lastDot = token.lastIndexOf("."), lastComma = token.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const other = decimal === "." ? "," : ".";
    return [Number(token.split(other).join("").replace(decimal, "."))];
  }
  const sep = seps[0]!;
  const parts = token.split(sep);
  const decimal = Number(`${parts.slice(0, -1).join("")}.${parts.at(-1)}`);
  const thousands = parts.slice(1).every((p) => p.length === 3) ? [Number(parts.join(""))] : [];
  return [...thousands, ...(seps.length === 1 ? [decimal] : [])];
}

function corpusValues(texts: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const text of texts) for (const m of text.matchAll(new RegExp(NUM, "g"))) for (const v of values(m[0])) out.add(v);
  return out;
}

export function checkReply(reply: string, evidence: Evidence): Violation[] {
  if (!reply.trim()) return [{ guard: "empty", message: "The reply is empty. Write the answer for the inquirer." }];

  const violations: Violation[] = [];
  const { citations } = extractCitations(reply);

  const unknown = citations.flatMap((c) => [
    ...(c.chunkId && !evidence.chunkIds.has(c.chunkId) ? [c.chunkId] : []),
    ...(!c.chunkId && c.listingId && !evidence.listingIds.has(c.listingId) ? [c.listingId] : []),
  ]);
  if (unknown.length) {
    violations.push({
      guard: "citation",
      message:
        `You cited ${unknown.map((u) => `[${u}]`).join(", ")}, which no tool returned in this conversation. ` +
        "Cite only chunkIds from search_knowledge results and listing ids from tool results, or remove the claim.",
    });
  }

  const figures = extractFigures(reply);
  if (figures.length && !citations.length) {
    violations.push({
      guard: "citation",
      message: "The reply states figures but cites no source. Add [listingId] or [chunkId] markers after each fact.",
    });
  }

  const known = corpusValues([...evidence.toolTexts, evidence.inquiry]);
  const invented = figures.filter((f) => !values(f.raw).some((v) => known.has(v)));
  if (invented.length) {
    violations.push({
      guard: "number",
      message:
        `These figures appear in no tool result: ${invented.map((f) => `"${f.text}"`).join(", ")}. ` +
        "Quote figures exactly as the tools returned them, do no arithmetic, or remove them.",
    });
  }
  return violations;
}
