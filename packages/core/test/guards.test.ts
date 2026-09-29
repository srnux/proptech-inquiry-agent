import { describe, expect, it } from "vitest";
import { checkReply, extractCitations, extractFigures, type Evidence } from "../src/agent/guards.js";

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  chunkIds: new Set(["HH-1001#s4", "policy:pets#pets-on-request"]),
  listingIds: new Set(["HH-1001"]),
  toolTexts: [JSON.stringify({ id: "HH-1001", price: 1650, livingAreaSqm: 78, description: "Utilities 240 EUR per month" })],
  inquiry: "Ich suche etwas unter 2.000 € in Hamburg.",
  ...over,
});

describe("extractCitations", () => {
  it("reads listing and chunk markers and ignores other brackets", () => {
    const { citations } = extractCitations("Heizung inklusive [HH-1001#s4]. Hunde nur auf Anfrage [policy:pets#pets-on-request] [HH-1001] (siehe [1]).");
    expect(citations).toEqual([
      { listingId: "HH-1001", chunkId: "HH-1001#s4" },
      { listingId: null, chunkId: "policy:pets#pets-on-request" },
      { listingId: "HH-1001", chunkId: null },
    ]);
  });
});

describe("extractFigures", () => {
  it("finds prices, areas and percentages in German and English notation", () => {
    const figures = extractFigures("Miete 1.650 €, Nebenkosten EUR 240, 78 m², 64 sqm, 3 % pro Jahr, 2,5 Prozent, 1,650 EUR");
    expect(figures.map((f) => [f.kind, f.raw])).toEqual([
      ["price", "1.650"],
      ["price", "240"],
      ["area", "78"],
      ["area", "64"],
      ["percent", "3"],
      ["percent", "2,5"],
      ["price", "1,650"],
    ]);
  });

  it("does not treat digits inside listing ids or dates as figures", () => {
    expect(extractFigures("HH-1001 ist ab 2026-11-01 frei, Etage 3.")).toEqual([]);
  });
});

describe("checkReply", () => {
  it("passes a cited reply whose numbers come from tool results", () => {
    expect(checkReply("Die Wohnung HH-1001 kostet 1.650 € kalt, 78 m², Nebenkosten 240 EUR [HH-1001].", evidence())).toEqual([]);
  });

  it("accepts a figure the inquirer stated themselves", () => {
    expect(checkReply("Ihr Budget von 2.000 € wird eingehalten [HH-1001].", evidence())).toEqual([]);
  });

  it("citation guard: a chunk that no tool returned is rejected", () => {
    const v = checkReply("Heizung inklusive [HH-1001#s9].", evidence());
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ guard: "citation" });
    expect(v[0]?.message).toContain("HH-1001#s9");
  });

  it("citation guard: a listing that no tool returned is rejected", () => {
    const v = checkReply("Schauen Sie sich B-2002 an [B-2002].", evidence());
    expect(v.map((x) => x.guard)).toEqual(["citation"]);
  });

  it("citation guard: figures without any citation are rejected", () => {
    const v = checkReply("Die Wohnung kostet 1.650 €.", evidence());
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ guard: "citation" });
  });

  it("number guard: an invented price is rejected, and named", () => {
    const v = checkReply("Die Wohnung kostet 1.450 € kalt [HH-1001].", evidence());
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ guard: "number" });
    expect(v[0]?.message).toContain("1.450");
  });

  it("number guard: a derived sum is not a quoted figure", () => {
    expect(checkReply("Warmmiete: 1.890 € [HH-1001].", evidence()).map((x) => x.guard)).toEqual(["number"]);
  });

  it("rejects an empty reply", () => {
    expect(checkReply("   ", evidence()).map((x) => x.guard)).toEqual(["empty"]);
  });
});
