import { describe, expect, it } from "vitest";
import { replyParts } from "../src/reply";

describe("replyParts", () => {
  it("turns citation markers into citation parts", () => {
    expect(replyParts("Heating is included [HH-1001#s5].")).toEqual([
      { kind: "text", text: "Heating is included ", bold: false },
      { kind: "cite", id: "HH-1001#s5" },
      { kind: "text", text: ".", bold: false },
    ]);
  });

  it("renders **bold** as bold text without the asterisks", () => {
    expect(replyParts("**Heizung:** Ja, inklusive [HH-1001].")).toEqual([
      { kind: "text", text: "Heizung:", bold: true },
      { kind: "text", text: " Ja, inklusive ", bold: false },
      { kind: "cite", id: "HH-1001" },
      { kind: "text", text: ".", bold: false },
    ]);
  });

  it("drops asterisks that do not pair up within a passage, so none show literally", () => {
    // The bold span would cross a citation chip; both halves become plain text.
    expect(replyParts("**Rent [HH-1001] is 1650 EUR** a month.")).toEqual([
      { kind: "text", text: "Rent ", bold: false },
      { kind: "cite", id: "HH-1001" },
      { kind: "text", text: " is 1650 EUR a month.", bold: false },
    ]);
    expect(replyParts("Pets **on request.")).toEqual([{ kind: "text", text: "Pets on request.", bold: false }]);
  });

  it("leaves single asterisks and other Markdown alone", () => {
    expect(replyParts("2 * 3 rooms, *maybe*")).toEqual([{ kind: "text", text: "2 * 3 rooms, *maybe*", bold: false }]);
  });

  it("does not bold across lines", () => {
    expect(replyParts("**one\ntwo**")).toEqual([{ kind: "text", text: "one\ntwo", bold: false }]);
  });
});
