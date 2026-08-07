import Link from "next/link";
import { claimTicketAction } from "@/lib/actions";
import { getRequestType } from "@/lib/catalog";
import { formatMoney, relativeAge } from "@/lib/format";
import {
  premiumOnFileCents,
  queueHref,
  type QueueQuery,
  type QueueSortId,
} from "@/lib/queue";
import { TICKET_STATUS_STYLES, ticketStatusLabel } from "@/lib/tickets";
import type { Operator, TicketDetail } from "@/lib/types";

const GRID =
  "md:grid-cols-[6rem_minmax(0,1fr)_7.5rem_8.5rem_4.5rem_7.5rem_7rem_5.5rem]";

const COLUMNS: { id: QueueSortId; label: string; align?: "right" }[] = [
  { id: "sr", label: "SR" },
  { id: "account", label: "Account / Request" },
  { id: "type", label: "Type" },
  { id: "status", label: "Status" },
  { id: "age", label: "Age" },
  { id: "owner", label: "Owner" },
  { id: "premium", label: "Premium On File", align: "right" },
];

function SortHeader({
  column,
  query,
}: {
  column: (typeof COLUMNS)[number];
  query: QueueQuery;
}) {
  const active = query.sort === column.id;
  const nextDir = active ? (query.dir === "asc" ? "desc" : "asc") : "asc";
  return (
    <Link
      href={queueHref({ ...query, sort: column.id, dir: nextDir })}
      className={`inline-flex items-center gap-1 transition hover:text-[var(--ink)] ${
        active ? "text-[var(--ink)]" : ""
      } ${column.align === "right" ? "justify-end" : ""}`}
    >
      {column.label}
      <span
        className={`text-[8px] leading-none ${active ? "text-[var(--gold)]" : "text-[var(--rule)]"}`}
        aria-hidden
      >
        {active ? (query.dir === "asc" ? "▲" : "▼") : "▲▼"}
      </span>
    </Link>
  );
}

export function TicketQueue({
  tickets,
  operator,
  operatorsById,
  query,
  filtered,
}: {
  tickets: TicketDetail[];
  operator: Operator | null;
  operatorsById: Record<string, string>;
  query: QueueQuery;
  /** Whether any filter is active — tunes the empty-state copy. */
  filtered: boolean;
}) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--rule)] px-6 py-16 text-center">
        <p className="font-display text-xl text-[var(--ink)]">
          {filtered ? "Nothing Matches These Filters" : "Pile Is Empty"}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {filtered ? (
            <>
              Clear a chip above, or{" "}
              <Link href="/queue" className="underline hover:text-[var(--ink)]">
                reset the board
              </Link>
              .
            </>
          ) : (
            "When new requests land, they show up here for anyone with capacity to claim."
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--paper)]">
      <div
        className={`hidden gap-3 border-b border-[var(--rule)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] md:grid ${GRID}`}
      >
        {COLUMNS.map((c) => (
          <span key={c.id} className={c.align === "right" ? "text-right" : ""}>
            <SortHeader column={c} query={query} />
          </span>
        ))}
        <span className="text-right">Action</span>
      </div>
      <ul className="divide-y divide-[var(--rule)]">
        {tickets.map((t) => (
          <TicketRow
            key={t.id}
            ticket={t}
            operator={operator}
            ownerName={
              t.operatorId ? (operatorsById[t.operatorId] ?? "Assigned") : null
            }
          />
        ))}
      </ul>
    </div>
  );
}

function OpenTicketIcon({ ticketId }: { ticketId: string }) {
  return (
    <Link
      href={`/tickets/${ticketId}`}
      title="Open Ticket"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] ring-1 ring-[var(--rule)] transition hover:text-[var(--ink)] hover:ring-[var(--gold)]"
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden
      >
        <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
        <path d="M2 4.5l6 4.5 6-4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

function TicketRow({
  ticket,
  operator,
  ownerName,
}: {
  ticket: TicketDetail;
  operator: Operator | null;
  ownerName: string | null;
}) {
  const type = getRequestType(ticket.requestType);
  const mine = operator && ticket.operatorId === operator.id;
  const unclaimed = !ticket.operatorId;

  return (
    <li
      className={`grid grid-cols-1 items-center gap-2 px-4 py-3.5 transition hover:bg-[var(--sand)]/40 md:gap-3 ${GRID} md:grid`}
    >
      <Link
        href={`/tickets/${ticket.id}`}
        className="font-mono text-sm font-semibold tracking-tight text-[var(--ink)] hover:underline"
      >
        {ticket.srNumber || "—"}
      </Link>

      <Link href={`/tickets/${ticket.id}`} className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--ink)]">
          {ticket.account.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
          {ticket.subject}
        </p>
      </Link>

      <span className="text-xs text-[var(--ink)]">{type.shortLabel}</span>

      <span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${TICKET_STATUS_STYLES[ticket.status]}`}
        >
          {ticketStatusLabel(ticket.status)}
        </span>
      </span>

      <span className="text-xs text-[var(--muted)]">
        {relativeAge(ticket.createdAt)}
      </span>

      <span className="truncate text-xs text-[var(--muted)]">
        {mine ? "You" : (ownerName ?? "Unclaimed")}
      </span>

      <span className="text-right font-mono text-xs text-[var(--ink)]">
        {formatMoney(premiumOnFileCents(ticket))}
      </span>

      <div className="flex items-center justify-start gap-1.5 md:justify-end">
        {unclaimed && operator && (
          <form action={claimTicketAction}>
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input type="hidden" name="open" value="1" />
            <button type="submit" className="btn-primary px-3 py-1 text-[11px]">
              Claim
            </button>
          </form>
        )}
        <OpenTicketIcon ticketId={ticket.id} />
      </div>
    </li>
  );
}
