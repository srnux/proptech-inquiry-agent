import { call, say, type Block, type Message, type ModelClient, type ModelRequest, type ModelResponse } from "./model.js";

/**
 * A rule-based stand-in for the model, so the web app runs from a clean clone without a key (DECISIONS.md 28).
 * It calls the real tools over MCP, like the model does, and writes its reply only from what they returned,
 * so the guards check it like any other answer. It understands the example inquiries and little else: it
 * shows the loop, the trace and the hand-offs, not the quality of an answer. In a follow-up without a listing id
 * ("and the deposit?") it takes the listing the conversation was last about.
 */
export class DemoModel implements ModelClient {
  readonly id = "demo";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const content = nextStep(request.messages);
    return {
      content,
      stop: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

interface Intent {
  german: boolean;
  listingId: string | null;
  city: string | null;
  maxPrice: number | null;
  pet: boolean;
  viewing: boolean;
  email: string | null;
  /** The part of the inquiry that asks for a fact, without the listing id and the viewing request. */
  question: string | null;
}

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: any;
  isError: boolean;
}

const LISTING_ID = /\b[A-Z]{1,2}-\d{4}\b/;
const LISTING_REF = /\s+(?:(?:for|of|at|bei|für|von)\s+)?[A-Z]{1,2}-\d{4}\b/g;
const VIEWING = /besichtig|anschauen|\bview(?:ing)?\b|\bvisit/i;
const GERMAN = /\b(ich|ist|und|die|der|das|kann|wohnung|gibt|bitte)\b/i;
const PET = /\b(hund|katze|haustier|dog|cat|pet)s?\b/i;
const MAX_PRICE = /(?:unter|bis|under|below|up to)\s*(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:€|eur)/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const CITIES: [RegExp, string][] = [
  [/hamburg/i, "Hamburg"],
  [/berlin/i, "Berlin"],
  [/münchen|munich/i, "München"],
  [/köln|cologne/i, "Köln"],
];

export function parseIntent(inquiry: string): Intent {
  const price = MAX_PRICE.exec(inquiry)?.[1];
  const questions = inquiry
    .split(/(?<=[.?!])\s+/)
    .filter((s) => s.trim().endsWith("?"))
    .flatMap((s) => s.split(/,\s*(?:und|and)\s+/i))
    .filter((part) => !VIEWING.test(part))
    .map((part) => part.replace(LISTING_REF, "").replace(/[\s,.?!]+$/, "").trim())
    .filter(Boolean);
  return {
    german: GERMAN.test(inquiry),
    listingId: LISTING_ID.exec(inquiry)?.[0] ?? null,
    city: CITIES.find(([re]) => re.test(inquiry))?.[1] ?? null,
    maxPrice: price ? Number(price.replace(/[.,]/g, "")) : null,
    pet: PET.test(inquiry),
    viewing: VIEWING.test(inquiry),
    email: EMAIL.exec(inquiry)?.[0] ?? null,
    question: questions.length ? `${questions.join(", ")}?` : null,
  };
}

function toolCalls(messages: Message[]): ToolCall[] {
  const uses = new Map<string, { name: string; input: Record<string, unknown> }>();
  const done: ToolCall[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_use") uses.set(b.id, { name: b.name, input: b.input });
      if (b.type === "tool_result") {
        const use = uses.get(b.toolUseId);
        if (!use) continue;
        let result: unknown;
        try {
          result = JSON.parse(b.content);
        } catch {
          result = undefined;
        }
        done.push({ ...use, result, isError: b.isError === true });
      }
    }
  }
  return done;
}

/** Earlier turns come first, as plain text; the current inquiry is the last user message that is a string. */
function split(messages: Message[]): { inquiry: string; earlier: string } {
  let at = messages.length - 1;
  while (at >= 0 && !(messages[at]!.role === "user" && typeof messages[at]!.content === "string")) at--;
  const text = (m: Message) =>
    typeof m.content === "string" ? m.content : m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ");
  const inquiry = at >= 0 ? (messages[at]!.content as string) : "";
  return { inquiry, earlier: messages.slice(0, Math.max(at, 0)).map(text).join("\n") };
}

function nextStep(messages: Message[]): Block[] {
  const { inquiry, earlier } = split(messages);
  const intent = parseIntent(inquiry);
  if (!intent.listingId && !intent.city) intent.listingId = earlier.match(new RegExp(LISTING_ID, "g"))?.at(-1) ?? null;
  const done = toolCalls(messages);
  const first = (name: string) => done.find((d) => d.name === name);
  const handedOff = (reason: string) => done.some((d) => d.name === "hand_off_to_human" && d.input.reason === reason);
  const turn = messages.filter((m) => m.role === "assistant").length;
  const calls: Block[] = [];
  const add = (name: string, input: Record<string, unknown>) => calls.push(call(name, input, `toolu_demo_${turn}_${calls.length}`));

  // Which listing: named in the inquiry, or the cheapest match for the stated criteria.
  let listingId = intent.listingId;
  const search = first("search_listings");
  if (!listingId && intent.city) {
    if (!search) {
      add("search_listings", {
        city: intent.city,
        ...(intent.maxPrice && { maxPrice: intent.maxPrice }),
        ...(intent.pet && { hasPet: true }),
        ...(/wohnung|flat|apartment|miete|rent/i.test(inquiry) && { offerType: "rent" }),
      });
      return calls;
    }
    listingId = search.result?.results?.[0]?.id ?? null;
  }

  const question = intent.question ?? (intent.viewing || intent.city ? null : inquiry);
  const knowledge = first("search_knowledge");
  if (question && !knowledge && (listingId || !intent.city)) {
    add("search_knowledge", { query: question, ...(listingId && { listingId }) });
  }
  const validListing = knowledge?.isError ? null : listingId;
  const summary = (what: string) => `${what}${validListing ? ` (${validListing})` : ""}. Inquiry: ${inquiry}`.slice(0, 500);
  if (intent.viewing && !handedOff("viewing_request")) {
    add("hand_off_to_human", {
      reason: "viewing_request",
      listingId: validListing,
      summary: summary("Wants to book a viewing"),
      contactEmail: intent.email,
    });
  }
  const unanswered = knowledge && (knowledge.isError || knowledge.result?.found === false);
  if (unanswered && !handedOff("not_answerable_from_listing")) {
    add("hand_off_to_human", {
      reason: "not_answerable_from_listing",
      listingId: validListing,
      summary: summary("Asks something the listing record does not answer"),
      contactEmail: intent.email,
    });
  }
  if (calls.length) return calls;
  return [say(reply(intent, search?.result, knowledge?.result, unanswered === true))];
}

function reply(intent: Intent, search: any, knowledge: any, unanswered: boolean): string {
  const de = intent.german;
  const parts: string[] = [];
  if (search) {
    const s = search.results?.[0];
    if (!s) parts.push(de ? "Zu diesen Kriterien habe ich kein Angebot gefunden." : "No listing matches those criteria.");
    else {
      const unit = s.priceUnit === "EUR/month" ? (de ? " im Monat" : " per month") : "";
      parts.push(de ? `Passend ist ${s.id}: ${s.title}, ${s.price} EUR${unit} [${s.id}].` : `${s.id} matches: ${s.title}, ${s.price} EUR${unit} [${s.id}].`);
      if (intent.pet && s.petsAllowed === "on-request") {
        parts.push(de ? `Haustiere sind dort nur auf Anfrage möglich, zusagen kann ich das nicht [${s.id}].` : `Pets are on request there, so I cannot promise yours is allowed [${s.id}].`);
      }
      if (intent.pet && s.petsAllowed === "yes") parts.push(de ? `Haustiere sind erlaubt [${s.id}].` : `Pets are allowed [${s.id}].`);
    }
  }
  const hit = knowledge?.found ? knowledge.results[0] : undefined;
  if (hit) parts.push(de ? `Zu Ihrer Frage steht in den Unterlagen: „${hit.text}“ [${hit.chunkId}]` : `On your question, the record says: "${hit.text}" [${hit.chunkId}]`);
  if (unanswered) {
    parts.push(de ? "Dazu steht nichts in den Unterlagen, deshalb habe ich die Frage an einen Kollegen weitergegeben." : "The listing record does not answer that, so I have passed the question to a colleague.");
  }
  if (intent.viewing) {
    parts.push(de ? "Besichtigungen vereinbart unser Team: Ich habe Ihre Anfrage weitergegeben, ein Kollege meldet sich bei Ihnen." : "Viewings are booked by our team: I have passed your request on, and a colleague will get back to you to arrange a time.");
  }
  if (!parts.length) parts.push(de ? "Dazu kann ich aus den Unterlagen nichts sagen." : "I cannot answer that from the listing record.");
  return parts.join(" ");
}
