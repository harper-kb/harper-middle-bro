import Link from "next/link";
import { getRequestType } from "@/lib/catalog";
import { formatDate } from "@/lib/format";
import { loopReasonLabel } from "@/lib/types";
import type { CommsRow } from "@/lib/comms";

/** Every message, with the touch counter that makes sprawl visible per row. */
export function CommsEmails({ rows }: { rows: CommsRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[var(--rule)] px-4 py-16 text-center text-sm text-[var(--muted)]">
        Nothing matches these filters.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map(({ message: m, thread, ticket, touch }) => (
        <div key={m.id} className="queue-card glass rounded-2xl px-4 py-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  m.direction === "inbound"
                    ? "bg-amber-50 text-amber-800"
                    : m.party === "client"
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-slate-100 text-slate-700"
                }`}
              >
                {m.direction === "inbound"
                  ? "In"
                  : m.party === "client"
                    ? "To Insured"
                    : "Out"}
              </span>
              <Link
                href={`/tickets/${ticket.id}?tab=comms`}
                className="truncate text-sm font-semibold text-[var(--ink)] hover:underline"
              >
                {ticket.account.name}
              </Link>
              <span className="truncate text-xs text-[var(--muted)]">
                {m.direction === "inbound"
                  ? `from ${thread.underwriter.name}`
                  : `to ${m.toName || thread.underwriter.name}`}
              </span>
            </div>
            <span className="shrink-0 text-[10px] text-[var(--muted)]">
              {formatDate(m.createdAt)}
            </span>
          </div>

          <p className="mt-1 truncate text-xs text-[var(--ink)]/75">
            {m.subject || thread.subject}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded-full bg-[var(--sand)] px-2 py-0.5 font-medium text-[var(--muted)]">
              {getRequestType(ticket.requestType).shortLabel}
            </span>
            <span className="rounded-full bg-[var(--sand)] px-2 py-0.5 font-medium text-[var(--muted)]">
              {thread.policy.carrier}
            </span>
            {m.channel !== "email" && (
              <span className="rounded-full bg-[var(--sand)] px-2 py-0.5 font-medium text-[var(--muted)]">
                {m.channel}
              </span>
            )}
            {m.loopReason && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                {loopReasonLabel(m.loopReason)}
              </span>
            )}
            <Link
              href={`/trace?ticket=${ticket.id}`}
              className="ml-auto font-semibold text-[var(--coral)] hover:underline"
            >
              Why This One
            </Link>
            <span
              className={`font-semibold ${touch > 2 ? "text-[var(--coral)]" : "text-[var(--muted)]"}`}
              title="Which touch this was on the ticket"
            >
              Touch {touch}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
