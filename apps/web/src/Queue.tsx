import type { HandoffTicket } from "./api";
import { REASONS, time } from "./labels";

export function Queue({ tickets, fresh, live }: { tickets: HandoffTicket[]; fresh: Set<string>; live: boolean }) {
  const newestFirst = [...tickets].reverse();
  return (
    <section className="pane queue" aria-labelledby="queue-title">
      <h2 id="queue-title">
        For a colleague <span className="count">{tickets.length}</span>
      </h2>
      {!live && <p className="empty">Waiting for the server.</p>}
      {live && tickets.length === 0 && <p className="empty">No tickets yet. Viewing requests, negotiation and questions the record cannot answer land here.</p>}
      <ul className="tickets" aria-live="polite">
        {newestFirst.map((t) => (
          <li key={t.ticketId} className={`ticket${fresh.has(t.ticketId) ? " is-new" : ""}`} data-reason={t.reason}>
            <p className="ticket-reason">{REASONS[t.reason] ?? t.reason}</p>
            <p className="ticket-summary">{t.summary}</p>
            <dl>
              {t.listingId && (
                <>
                  <dt>Listing</dt>
                  <dd>{t.listingId}</dd>
                </>
              )}
              {t.contactEmail && (
                <>
                  <dt>Email</dt>
                  <dd>{t.contactEmail}</dd>
                </>
              )}
              <dt>Created</dt>
              <dd>
                <time dateTime={t.createdAt}>{time(t.createdAt)}</time>
              </dd>
              <dt>Ticket</dt>
              <dd>{t.ticketId}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
