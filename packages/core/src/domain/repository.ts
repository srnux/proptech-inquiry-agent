import { readFileSync } from "node:fs";
import { ListingCatalogue, summarise, type Listing, type ListingSummary } from "./listing.js";

export interface ListingQuery {
  city?: string;
  offerType?: Listing["offerType"];
  propertyType?: Listing["propertyType"];
  maxPrice?: number;
  minRooms?: number;
  minAreaSqm?: number;
  features?: string[];
  /** The inquirer has a pet. Excludes listings that forbid pets; keeps "on-request" ones. */
  hasPet?: boolean;
  availableBy?: string;
  limit?: number;
}

export interface ListingRepository {
  search(q: ListingQuery): { total: number; results: ListingSummary[] };
  get(id: string): Listing | undefined;
}

const norm = (s: string) => s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Structured search only. Free-text questions ("is the heating included?") are
 * deliberately not answered here: that is the retrieval layer's job, so the two
 * failure modes stay separable in tests and evals.
 */
export class InMemoryListingRepository implements ListingRepository {
  private readonly byId: Map<string, Listing>;

  constructor(private readonly listings: Listing[]) {
    this.byId = new Map(listings.map((l) => [l.id, l]));
  }

  static fromFile(path: string): InMemoryListingRepository {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return new InMemoryListingRepository(ListingCatalogue.parse(raw));
  }

  get(id: string): Listing | undefined {
    return this.byId.get(id.trim().toUpperCase());
  }

  search(q: ListingQuery) {
    const matches = this.listings.filter((l) => {
      if (q.city && norm(l.city) !== norm(q.city)) return false;
      if (q.offerType && l.offerType !== q.offerType) return false;
      if (q.propertyType && l.propertyType !== q.propertyType) return false;
      if (q.maxPrice !== undefined && l.price > q.maxPrice) return false;
      if (q.minRooms !== undefined && l.rooms < q.minRooms) return false;
      if (q.minAreaSqm !== undefined && l.livingAreaSqm < q.minAreaSqm) return false;
      if (q.features?.length && !q.features.every((f) => l.features.includes(f))) return false;
      // "on-request" stays in the results, but the summary carries the policy so the agent cannot promise a yes.
      if (q.hasPet && l.petsAllowed === "no") return false;
      if (q.availableBy && l.availableFrom > q.availableBy) return false;
      return true;
    });
    matches.sort((a, b) => a.price - b.price);
    return { total: matches.length, results: matches.slice(0, q.limit ?? 10).map(summarise) };
  }
}
