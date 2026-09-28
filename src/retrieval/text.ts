/** Shared tokeniser for BM25 and the offline embedder. German and English, no stemming. */

const STOPWORDS = new Set(
  (
    "a an and are as at be but by can do does for from has have how i if in is it its me my of on or our " +
    "so than that the their there these this to us was we what when where which who will with would you your " +
    "any also much many " +
    "der die das den dem des ein eine einen einem einer und oder aber ist sind wird werden hat haben " +
    "ich du er sie es wir ihr mein meine mit von zu zum zur im in an auf fur für bei aus ob wie was wo wann " +
    "kann können gibt es auch noch nicht kein keine hoch viel"
  ).split(/\s+/),
);

export function normalise(s: string): string {
  return s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function tokenise(s: string): string[] {
  return normalise(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stripPlural);
}

/** Minimal plural folding ("pets" and "pet", "cats" and "cat"). Anything more is left to the embedder. */
function stripPlural(t: string): string {
  return t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}
