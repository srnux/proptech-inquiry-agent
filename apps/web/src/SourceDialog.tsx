import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchSource, type Source } from "./api";

const FACTS: [string, string, (v: any) => string][] = [
  ["price", "Price", (v) => String(v)],
  ["priceUnit", "Unit", String],
  ["city", "City", String],
  ["district", "District", String],
  ["rooms", "Rooms", String],
  ["livingAreaSqm", "Living area (m²)", String],
  ["availableFrom", "Available from", String],
  ["petsAllowed", "Pets", String],
];

/** The source behind a citation chip: the cited passage, marked inside the document it comes from. */
export function SourceDialog({ id, onClose }: { id: string | null; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<Source | { error: string } | null>(null);

  useEffect(() => {
    if (!id) {
      dialog.current?.close();
      return;
    }
    setSource(null);
    dialog.current?.showModal();
    let current = true;
    fetchSource(id)
      .then((s) => current && setSource(s))
      .catch((e: Error) => current && setSource({ error: e.message }));
    return () => {
      current = false;
    };
  }, [id]);

  return (
    <dialog ref={dialog} className="source" onClose={onClose} onClick={(e) => e.target === dialog.current && dialog.current.close()} aria-labelledby="source-title">
      <form method="dialog" className="source-close">
        <button type="submit">Close</button>
      </form>
      {!source && <p className="empty">Loading the source…</p>}
      {source && "error" in source && <p className="empty">{source.error}</p>}
      {source && !("error" in source) && (
        <>
          <p className="source-kind">{source.kind === "policy" ? "Agency policy" : `Listing ${source.listingId}`}</p>
          <h2 id="source-title">{source.title}</h2>
          {source.facts && (
            <dl className="facts">
              {FACTS.filter(([k]) => source.facts![k] !== undefined).map(([k, label, fmt]) => (
                <div key={k}>
                  <dt>{label}</dt>
                  <dd>{fmt(source.facts![k])}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="document">{source.kind === "policy" ? policy(source) : marked(source.document, source.passage)}</div>
          <p className="source-id">Cited as [{source.id}]</p>
        </>
      )}
    </dialog>
  );
}

function marked(text: string, passage: string | null): ReactNode {
  const at = passage ? text.indexOf(passage) : -1;
  if (!passage || at < 0) return <p>{text}</p>;
  return (
    <p>
      {text.slice(0, at)}
      <mark>{passage}</mark>
      {text.slice(at + passage.length)}
    </p>
  );
}

/** A policy page, split into its sections; the cited one is marked. Policy chunks are "Heading: body". */
function policy(source: Source): ReactNode {
  const cited = source.passage?.split(":")[0]?.trim();
  const sections = source.document.split(/^## /m).slice(1);
  return sections.map((section) => {
    const [heading = "", ...body] = section.split("\n");
    const text = body.join(" ").replace(/\s+/g, " ").trim();
    const isCited = heading.trim() === cited;
    return (
      <section key={heading} className={isCited ? "is-cited" : undefined}>
        <h3>{heading}</h3>
        <p>{isCited ? <mark>{text}</mark> : text}</p>
      </section>
    );
  });
}
