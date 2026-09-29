import { useCallback, useEffect, useRef, useState } from "react";
import { fetchModel, sendInquiry, watchHandoffs, type AgentResult, type GuardEvent, type HandoffTicket, type TraceEntry } from "./api";
import { Chat } from "./Chat";
import { Queue } from "./Queue";
import { SourceDialog } from "./SourceDialog";
import { Trace } from "./Trace";

export interface Run {
  id: number;
  inquiry: string;
  steps: TraceEntry[];
  guards: GuardEvent[];
  result?: AgentResult;
  error?: string;
}

export function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [queueLive, setQueueLive] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    // The server may still be loading its index when the page opens: ask again until it answers.
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      void fetchModel().then((m) => {
        setModel(m);
        if (!m) timer = setTimeout(poll, 2000);
      });
    poll();
    const stop = watchHandoffs({
      snapshot: setTickets,
      ticket: (t) => {
        setTickets((all) => (all.some((x) => x.ticketId === t.ticketId) ? all : [...all, t]));
        setFresh((f) => new Set(f).add(t.ticketId));
      },
      connected: setQueueLive,
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);

  const update = (id: number, change: (r: Run) => Run) => setRuns((all) => all.map((r) => (r.id === id ? change(r) : r)));

  const ask = useCallback(async (inquiry: string) => {
    const id = nextId.current++;
    setRuns((all) => [...all, { id, inquiry, steps: [], guards: [] }]);
    setSelected(id);
    await sendInquiry(inquiry, {
      onTrace: (entry) => update(id, (r) => ({ ...r, steps: [...r.steps, entry] })),
      onGuard: (event) => update(id, (r) => ({ ...r, guards: [...r.guards, event] })),
      onResult: (result) => update(id, (r) => ({ ...r, result })),
      onError: (error) => update(id, (r) => ({ ...r, error })),
    });
  }, []);

  const busy = runs.some((r) => !r.result && !r.error);
  const shown = runs.find((r) => r.id === selected) ?? runs.at(-1);

  return (
    <div className="desk">
      <header className="masthead" data-theme="dark">
        <div>
          <h1>Inquiry desk</h1>
          <p className="lede">Answers questions about listings from the record, with a source for every fact. Viewings, negotiation, legal questions and anything the record does not cover go to a person.</p>
        </div>
        <ModelBadge model={model} />
      </header>
      <main className="panes">
        <Chat runs={runs} busy={busy} selected={shown?.id ?? null} onSelect={setSelected} onAsk={ask} onCite={setSource} />
        <Trace run={shown} />
        <Queue tickets={tickets} fresh={fresh} live={queueLive} />
      </main>
      <SourceDialog id={source} onClose={() => setSource(null)} />
    </div>
  );
}

function ModelBadge({ model }: { model: string | null }) {
  if (!model) return <p className="model label model-off" data-status="alarm">Server not reachable</p>;
  if (model === "demo") {
    return (
      <p className="model label" title="No model credentials are set, so a rule-based stand-in drives the same tools and checks. Set ANTHROPIC_API_KEY for the real model.">
        Demo model, no API key
      </p>
    );
  }
  return (
    <p className="model label" data-status="ok">
      {model}
    </p>
  );
}
