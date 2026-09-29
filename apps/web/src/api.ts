import type { AgentResult, HandoffTicket, TraceEntry, Violation } from "@proptech/core";
import type { Turn } from "@proptech/core/conversation";

export type { AgentResult, HandoffTicket, TraceEntry, Violation };

export interface GuardEvent {
  violations: Violation[];
  repairing: boolean;
}

/** GET /sources/:id, as packages/server/src/api/sources.ts returns it. */
export interface Source {
  id: string;
  kind: "listing" | "policy";
  title: string;
  listingId: string | null;
  passage: string | null;
  document: string;
  facts?: Record<string, unknown>;
}

interface Frame {
  event: string;
  data: unknown;
}

function parseFrame(raw: string): Frame | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data.push(line.slice(6));
  }
  return data.length ? { event, data: JSON.parse(data.join("\n")) } : undefined;
}

export interface InquiryHandlers {
  onTrace(entry: TraceEntry): void;
  onGuard(event: GuardEvent): void;
  onResult(result: AgentResult): void;
  onError(message: string): void;
}

/** POST /inquiries and hand each server-sent event to its handler as it arrives. */
export async function sendInquiry(inquiry: string, history: Turn[], on: InquiryHandlers): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inquiry, history }),
    });
  } catch {
    return on.onError("The server is not reachable. Start it with pnpm dev.");
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => undefined);
    return on.onError(body?.error ?? `The server answered ${res.status}.`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = parseFrame(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (!frame) continue;
      if (frame.event === "trace") on.onTrace(frame.data as TraceEntry);
      else if (frame.event === "guard") on.onGuard(frame.data as GuardEvent);
      else if (frame.event === "result") (finished = true), on.onResult(frame.data as AgentResult);
      else if (frame.event === "error") (finished = true), on.onError((frame.data as { message: string }).message);
    }
  }
  if (!finished) on.onError("The connection closed before the agent finished.");
}

/** The live hand-off queue. Returns the function that closes the stream. */
export function watchHandoffs(on: { snapshot(t: HandoffTicket[]): void; ticket(t: HandoffTicket): void; connected(ok: boolean): void }) {
  const source = new EventSource("/handoffs");
  source.addEventListener("snapshot", (e) => {
    on.connected(true);
    on.snapshot(JSON.parse((e as MessageEvent).data));
  });
  source.addEventListener("ticket", (e) => on.ticket(JSON.parse((e as MessageEvent).data)));
  source.onerror = () => on.connected(false);
  return () => source.close();
}

export async function fetchSource(id: string): Promise<Source> {
  const res = await fetch(`/sources/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`No source with id ${id}.`);
  return res.json();
}

export async function fetchModel(): Promise<string | null> {
  try {
    const res = await fetch("/health");
    return res.ok ? ((await res.json()).model as string) : null;
  } catch {
    return null;
  }
}
