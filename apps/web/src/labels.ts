import type { HandoffTicket } from "./api";

/** Tool names as the trace pane shows them, and what the chat says while the tool runs. */
export const TOOLS: Record<string, { label: string; doing: string }> = {
  search_listings: { label: "Search listings", doing: "Searching the listings" },
  get_listing: { label: "Read a listing", doing: "Reading the listing" },
  search_knowledge: { label: "Search listing texts and policies", doing: "Searching listing texts and policies" },
  hand_off_to_human: { label: "Hand off to a person", doing: "Creating a ticket for a colleague" },
};
export const toolLabel = (name: string) => TOOLS[name]?.label ?? name;

export const REASONS: Record<HandoffTicket["reason"], string> = {
  viewing_request: "Viewing request",
  price_negotiation: "Price negotiation",
  contract_or_legal: "Contract or legal question",
  complaint: "Complaint",
  personal_data_request: "Personal data request",
  not_answerable_from_listing: "Not in the record",
};

/** Why the code, not the model, ended a run. */
export const FORCED: Record<string, string> = {
  guard_failed: "the answer failed the checks twice",
  turn_limit: "the turn limit was reached",
  token_budget: "the token budget ran out",
  model_timeout: "the model did not answer in time",
  truncated: "the answer was cut off",
  refused: "the model declined to answer",
};

/** `HH-1001#s5` -> "HH-1001, sentence 5"; `policy:graduated-rent#increase` -> "Graduated rent policy". */
export function citationLabel(id: string): string {
  if (id.startsWith("policy:")) {
    const slug = id.slice(7).split("#")[0] ?? "";
    const name = slug.replace(/-/g, " ");
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} policy`;
  }
  const [listing, sentence] = id.split("#s");
  return sentence ? `${listing}, sentence ${sentence}` : `${listing}`;
}

/** Citation markers as the prompt defines them (DECISIONS.md 22) and the guards parse them. */
export const CITATION = /\[(policy:[^\]\s]+|[A-Z]{1,3}-\d{3,5}(?:#s\d+)?)\]/g;

export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
