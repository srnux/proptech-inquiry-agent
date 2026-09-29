import { describe, expect, it } from "vitest";
import { InMemoryListingRepository } from "../src/domain/repository.js";
import { paths } from "../src/retrieval/open.js";

const repo = InMemoryListingRepository.fromFile(paths.listings);

describe("listing catalogue", () => {
  it("loads and validates every record", () => {
    expect(repo.search({ limit: 25 }).total).toBe(10);
  });
});

describe("search", () => {
  it("matches city ignoring case and umlauts", () => {
    expect(repo.search({ city: "munchen" }).total).toBe(2);
    expect(repo.search({ city: "MÜNCHEN" }).total).toBe(2);
  });

  it("combines hard criteria and sorts by price", () => {
    const r = repo.search({ city: "Hamburg", offerType: "rent", maxPrice: 2000 });
    expect(r.results.map((l) => l.id)).toEqual(["HH-1001", "HH-1002"]);
  });

  it("requires every requested feature", () => {
    const r = repo.search({ features: ["lift", "balcony"] });
    expect(r.results.map((l) => l.id).sort()).toEqual(["B-2003", "K-4001", "M-3001"]);
  });

  it("keeps on-request pet listings but exposes the policy", () => {
    const r = repo.search({ city: "Hamburg", offerType: "rent", hasPet: true });
    expect(r.results).toEqual([expect.objectContaining({ id: "HH-1001", petsAllowed: "on-request" })]);
  });

  it("filters by latest move-in date", () => {
    const r = repo.search({ availableBy: "2026-10-01" });
    expect(r.results.map((l) => l.id).sort()).toEqual(["B-2001", "K-4002", "M-3001"]);
  });

  it("does not leak the description into summaries", () => {
    expect(repo.search({}).results[0]).not.toHaveProperty("description");
  });
});

describe("get", () => {
  it("normalises the id", () => {
    expect(repo.get(" hh-1001 ")?.district).toBe("Eimsbüttel");
  });
  it("returns undefined for unknown ids", () => {
    expect(repo.get("XX-0000")).toBeUndefined();
  });
});
