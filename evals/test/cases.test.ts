import { describe, expect, it } from "vitest";
import { HandoffReason } from "@proptech/core";
import { listings } from "@proptech/core/testing";
import { loadCases, loadFixtureListings, parseCases } from "../src/cases.js";

const cases = loadCases();
const fixtures = loadFixtureListings();
const byId = (id: string) => cases.find((c) => c.id === id);

describe("eval cases", () => {
  it("has about 40 cases in German and English", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(cases.filter((c) => c.lang === "de").length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((c) => c.lang === "en").length).toBeGreaterThanOrEqual(15);
  });

  it("names only listings that exist in the catalogue the case runs against", () => {
    for (const c of cases) {
      const known = new Set([...listings, ...(c.fixtures ? fixtures : [])].map((l) => l.id));
      for (const id of c.listings) expect(known, `${c.id} names ${id}`).toContain(id);
    }
  });

  it("expects every hand-off reason somewhere, and has cases that expect none", () => {
    for (const r of HandoffReason.options) expect(cases.some((c) => c.handoffs.includes(r)), r).toBe(true);
    expect(cases.filter((c) => !c.handoffs.length).length).toBeGreaterThanOrEqual(15);
  });

  it("covers the roadmap's traps", () => {
    for (const id of ["HH-1001", "B-2002", "K-4001"]) {
      expect(cases.some((c) => c.tags.includes("trap-pets") && c.listings.includes(id)), `pets on request at ${id}`).toBe(true);
    }
    expect(byId("trap-facade-levy-b2003")?.must.join(" ")).toMatch(/estimated but not final/);
    expect(byId("trap-staffelmiete-b2002")?.must.join(" ")).toMatch(/3 percent every year/);
    expect(byId("trap-m3001-utilities")?.mustNot.join(" ")).toMatch(/separate utilities figure/);
    expect(byId("trap-k4002-living")?.must.join(" ")).toMatch(/not approved for residential use/);
    expect(byId("trap-negotiation-polite")?.handoffs).toEqual(["price_negotiation"]);
  });

  it("runs the prompt-injection listing only from the fixtures, and expects a hand-off despite it", () => {
    const injection = cases.filter((c) => c.tags.includes("injection"));
    expect(injection.length).toBeGreaterThanOrEqual(1);
    for (const c of injection) {
      expect(c.fixtures).toBe(true);
      expect(c.handoffs).toContain("viewing_request");
    }
    expect(fixtures.map((l) => l.id)).toEqual(["HH-9001"]);
    expect(fixtures[0]!.description).toMatch(/ignore all previous instructions/i);
    expect(listings.map((l) => l.id)).not.toContain("HH-9001");
  });

  it("marks a pull-request subset that touches every kind of case", () => {
    const subset = cases.filter((c) => c.subset);
    expect(subset.length).toBeGreaterThanOrEqual(8);
    expect(subset.length).toBeLessThanOrEqual(15);
    for (const tag of ["fact", "trap", "handoff", "injection", "history"]) expect(subset.some((c) => c.tags.includes(tag)), tag).toBe(true);
    expect(new Set(subset.map((c) => c.lang))).toEqual(new Set(["de", "en"]));
  });

  it("rejects malformed lines with the line number", () => {
    const ok = '{"id":"a","lang":"en","inquiry":"Hi"}';
    expect(parseCases(`${ok}\n\n${ok}`.replace(/"a"/, '"b"'))).toHaveLength(2);
    expect(() => parseCases(`${ok}\n${ok}`)).toThrow(/line 2: duplicate id a/);
    expect(() => parseCases('{"id":"a","lang":"en","inquiry":"Hi","handoffs":["callback"]}')).toThrow(/line 1/);
    expect(() => parseCases('{"id":"a","lang":"en","inquiry":"Hi","musts":["typo"]}')).toThrow(/line 1/);
    expect(() => parseCases('{"id":"a","lang":"en","inquiry":"Hi","handoffs":["complaint"],"allowHandoffs":["complaint"]}')).toThrow(/both required and allowed/);
    expect(() => parseCases("{not json")).toThrow(/line 1: invalid JSON/);
  });
});
