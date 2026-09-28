import { readFileSync } from "node:fs";

export interface GoldenSet {
  positives: { q: string; listingId?: string; expect: string[]; semantic?: boolean }[];
  negatives: { q: string; listingId?: string }[];
}

export function loadGolden(file: string): GoldenSet {
  return JSON.parse(readFileSync(file, "utf8")) as GoldenSet;
}
