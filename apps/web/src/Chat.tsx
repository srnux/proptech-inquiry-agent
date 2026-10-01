import { EXAMPLE_INQUIRIES } from "@proptech/core/examples";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Run } from "./App";
import { citationLabel, FORCED, TOOLS } from "./labels";
import { replyParts } from "./reply";

interface Props {
  runs: Run[];
  busy: boolean;
  selected: number | null;
  onSelect(id: number): void;
  onAsk(inquiry: string): void;
  /** Clears the thread, so the next inquiry is sent without history. */
  onRestart(): void;
  onCite(id: string): void;
}

export function Chat({ runs, busy, selected, onSelect, onAsk, onRestart, onCite }: Props) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [runs]);

  const send = (text: string) => {
    const inquiry = text.trim();
    if (inquiry.length < 3 || busy) return;
    onAsk(inquiry);
    setDraft("");
  };

  return (
    <section className="pane chat" aria-labelledby="chat-title">
      <h2 id="chat-title">
        Conversation
        {runs.length > 0 && (
          <button type="button" className="example restart" disabled={busy} onClick={onRestart} title="Start over: the next inquiry is sent without the earlier ones">
            New conversation
          </button>
        )}
      </h2>
      <div className="thread" aria-live="polite">
        {runs.length === 0 && <p className="empty">Ask about a listing, or start with one of the examples below.</p>}
        {runs.map((run) => (
          <article key={run.id} className={`exchange${run.id === selected ? " is-selected" : ""}`} onClick={() => onSelect(run.id)}>
            <p className="bubble from-inquirer">{run.inquiry}</p>
            <AgentBubble run={run} onCite={onCite} />
          </article>
        ))}
        <div ref={end} />
      </div>

      <div className="examples" role="group" aria-label="Example inquiries">
        {EXAMPLE_INQUIRIES.map((e) => (
          <button key={e.id} type="button" className="example" disabled={busy} title={e.inquiry} onClick={() => send(e.inquiry)} data-example={e.id}>
            {e.label}
          </button>
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor="inquiry" className="visually-hidden">
          Your inquiry
        </label>
        <textarea
          id="inquiry"
          rows={2}
          value={draft}
          maxLength={2000}
          placeholder="Is the flat in Eimsbüttel still available in November?"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <button type="submit" disabled={busy || draft.trim().length < 3}>
          {busy ? "Working" : "Send"}
        </button>
      </form>
    </section>
  );
}

function AgentBubble({ run, onCite }: { run: Run; onCite(id: string): void }) {
  if (run.error)
    return (
      <p className="bubble from-agent is-error">
        <span className="error-label status" data-status="alarm">
          Could not answer
        </span>
        <br />
        {run.error}
      </p>
    );
  if (!run.result) {
    const last = run.steps.at(-1);
    const status = run.guards.length ? "Checking the draft against the sources" : last ? (TOOLS[last.tool]?.doing ?? `Running ${last.tool}`) : "Reading your inquiry";
    return (
      <p className="bubble from-agent is-pending" role="status">
        {status}…
      </p>
    );
  }
  const { reply, outcome, handoffs } = run.result;
  return (
    <div className="bubble from-agent" data-testid="reply">
      <p>{withChips(reply, onCite)}</p>
      {outcome.status === "forced_handoff" && <p className="note" data-status="handoff">Handed off by the code, because {FORCED[outcome.cause] ?? outcome.cause}.</p>}
      {handoffs.length > 0 && outcome.status === "answered" && (
        <p className="note" data-status="handoff">
          {handoffs.length === 1 ? "One ticket" : `${handoffs.length} tickets`} created for a colleague.
        </p>
      )}
    </div>
  );
}

/** The reply with each citation marker turned into a button that opens its source, and **bold** as bold. */
function withChips(reply: string, onCite: (id: string) => void): ReactNode[] {
  return replyParts(reply).map((part, i) => {
    if (part.kind === "text") return part.bold ? <strong key={i}>{part.text}</strong> : part.text;
    const { id } = part;
    return (
      <button
        key={i}
        type="button"
        className="chip"
        onClick={(e) => {
          e.stopPropagation();
          onCite(id);
        }}
        title={`Open the source ${id}`}
      >
        {citationLabel(id)}
      </button>
    );
  });
}
