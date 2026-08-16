import {
  escalateTicketAction,
  resolveEscalationAction,
} from "@/lib/desk-actions";
import { formatDate } from "@/lib/format";
import type { Operator, Ticket } from "@/lib/types";

/**
 * Escalation state for one ticket, server-rendered. Three faces:
 * an active "Flagged For Help" banner, a quiet "Escalation Handled" chip,
 * or a compact <details> disclosure to flag the ticket up. The promise a
 * flag makes is explicit — the flagged person gets to it by end of day.
 */
export function EscalationPanel({
  ticket,
  operators,
  currentOperatorId,
}: {
  ticket: Ticket;
  operators: Operator[];
  currentOperatorId: string | null;
}) {
  const flaggedTo = ticket.escalatedToId
    ? (operators.find((o) => o.id === ticket.escalatedToId) ?? null)
    : null;

  // —— Active flag: loud banner until someone marks it handled ——
  if (ticket.escalatedToId && !ticket.escalationResolvedAt) {
    const overdue =
      ticket.escalationDueBy != null &&
      // This status intentionally reflects wall-clock time at render.
      // eslint-disable-next-line react-hooks/purity
      new Date(ticket.escalationDueBy).getTime() < Date.now();
    return (
      <section
        className={`rounded-2xl border p-4 ${
          overdue
            ? "border-rose-300 bg-rose-50"
            : "border-[var(--gold)] bg-[color-mix(in_srgb,var(--gold)_10%,white)]"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Flagged For Help</p>
            <p className="mt-1 text-sm font-medium text-[var(--ink)]">
              Waiting On {flaggedTo?.displayName ?? "The Flagged Desk"}
            </p>
            {ticket.escalationNote && (
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">
                {ticket.escalationNote}
              </p>
            )}
            {ticket.escalatedAt && (
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Flagged {formatDate(ticket.escalatedAt)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {ticket.escalationDueBy && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  overdue
                    ? "bg-rose-100 text-rose-800 ring-1 ring-rose-300"
                    : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)]"
                }`}
              >
                {overdue ? "Past Due — " : "Due By "}
                {formatDate(ticket.escalationDueBy)}
              </span>
            )}
            <form action={resolveEscalationAction}>
              <input type="hidden" name="ticketId" value={ticket.id} />
              <button type="submit" className="btn-primary px-4 py-1.5 text-xs">
                Mark Handled
              </button>
            </form>
          </div>
        </div>
      </section>
    );
  }

  // —— Resolved: quiet receipt ——
  if (ticket.escalationResolvedAt) {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
        Escalation Handled
        <span className="font-normal text-emerald-700">
          {formatDate(ticket.escalationResolvedAt)}
        </span>
      </p>
    );
  }

  // —— Never flagged: compact disclosure to flag it up ——
  if (!currentOperatorId) {
    return (
      <p className="text-[11px] text-[var(--muted)]">
        Sign in to flag this ticket for help.
      </p>
    );
  }

  const managers = operators.filter((o) => o.role === "manager");
  const others = operators.filter(
    (o) => o.role !== "manager" && o.id !== currentOperatorId,
  );

  return (
    <details className="disclosure group rounded-2xl border border-[var(--rule)] bg-white">
      <summary className="flex list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-[var(--sand)]/60 [&::-webkit-details-marker]:hidden">
        <span className="text-xs font-semibold text-[var(--ink)]">
          Flag To Manager
        </span>
        <span className="font-mono text-[10px] text-[var(--muted)] group-open:hidden">
          Open
        </span>
        <span className="hidden font-mono text-[10px] text-[var(--muted)] group-open:inline">
          Close
        </span>
      </summary>
      <form
        action={escalateTicketAction}
        className="space-y-3 border-t border-[var(--rule)] px-4 py-3"
      >
        <input type="hidden" name="ticketId" value={ticket.id} />
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Flag To
          <select
            name="toOperatorId"
            required
            defaultValue={managers[0]?.id ?? ""}
            className="field mt-1 px-3 py-2 text-sm font-normal"
          >
            {managers.length > 0 && (
              <optgroup label="Managers">
                {managers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName} — {o.title}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Operators">
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName} — {o.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Note
          <textarea
            name="note"
            required
            rows={3}
            placeholder="Describe what you need. The flagged person responds by end of day."
            className="field mt-1 px-3 py-2 text-sm font-normal"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--muted)]">
            Escalations are handled by end of day unless noted otherwise.
          </p>
          <button type="submit" className="btn-primary px-4 py-1.5 text-xs">
            Flag It
          </button>
        </div>
      </form>
    </details>
  );
}
