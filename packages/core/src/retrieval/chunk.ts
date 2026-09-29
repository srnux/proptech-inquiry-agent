import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Listing } from "../domain/listing.js";

export interface Chunk {
  /** Stable id, e.g. `HH-1001#s2` or `policy:deposit#amount`. Cited by the agent. */
  chunkId: string;
  source: "listing" | "policy";
  /** Set for listing chunks, null for policy chunks. */
  listingId: string | null;
  /** Policy slug for policy chunks (`deposit`), null for listing chunks. */
  policy: string | null;
  /** The passage returned to the model and shown to the user. */
  text: string;
  /**
   * What gets embedded and keyword-indexed: the passage plus a short header naming what it belongs to.
   * A sentence like "Deposit is three months' cold rent" means nothing without knowing which flat.
   */
  indexText: string;
}

export interface PolicyPage {
  slug: string;
  title: string;
  markdown: string;
}

const slugify = (s: string) =>
  s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Split at sentence ends followed by a capital letter. Decimal numbers ("3.57 percent") and
 * abbreviations inside a sentence stay intact because no space follows the dot.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ"(])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function chunkListings(listings: Listing[]): Chunk[] {
  return listings.flatMap((l) =>
    splitSentences(l.description).map((sentence, i) => ({
      chunkId: `${l.id}#s${i + 1}`,
      source: "listing" as const,
      listingId: l.id,
      policy: null,
      text: sentence,
      indexText: `${l.title} (${l.id}, ${l.district}, ${l.city}). ${sentence}`,
    })),
  );
}

export function loadPolicies(dir: string): PolicyPage[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const markdown = readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");
      const title = /^# (.+)$/m.exec(markdown)?.[1]?.trim();
      if (!title) throw new Error(`policy ${f} has no "# " title`);
      return { slug: f.replace(/\.md$/, ""), title, markdown };
    });
}

/** One chunk per `## ` section. The page title goes into the index text for context. */
export function chunkPolicies(pages: PolicyPage[]): Chunk[] {
  return pages.flatMap((page) =>
    page.markdown
      .split(/^## /m)
      .slice(1)
      .map((section) => {
        const [heading = "", ...body] = section.split("\n");
        const text = body.join(" ").replace(/\s+/g, " ").trim();
        return {
          chunkId: `policy:${page.slug}#${slugify(heading)}`,
          source: "policy" as const,
          listingId: null,
          policy: page.slug,
          text: `${heading.trim()}: ${text}`,
          indexText: `${page.title}. ${heading.trim()}. ${text}`,
        };
      })
      .filter((c) => c.text.length > 0),
  );
}
