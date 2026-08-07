import Link from "next/link";
import type { AdditionalInsuredRecord } from "@/lib/db";
import { formatMoney } from "@/lib/format";

export function TicketAdditionalInsureds({
  rows,
  accountId,
}: {
  rows: AdditionalInsuredRecord[];
  accountId: string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          Parties added (or quoted) as additional insureds on this account —
          who, when, form, and endorsement premium. Feeds pricing memory across
          the book.
        </p>
        <Link
          href={`/accounts/${accountId}`}
          className="text-xs underline decoration-[var(--rule)] underline-offset-4 hover:text-[var(--ink)]"
        >
          Account file →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-[var(--rule)] py-12 text-sm text-[var(--muted)]">
          No additional insureds recorded yet. Quotes and binds on AI requests
          write here automatically.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
          {rows.map((r) => (
            <li key={r.id} className="py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-xl leading-tight text-[var(--ink)]">
                    {r.name}
                  </p>
                  {r.address && (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {r.address}
                    </p>
                  )}
                </div>
                <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                  {r.status}
                </p>
              </div>
              <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="font-mono uppercase tracking-[0.1em] text-[var(--muted)]">
                    Added
                  </dt>
                  <dd className="mt-0.5 text-[var(--ink)]">
                    {r.effectiveAt ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono uppercase tracking-[0.1em] text-[var(--muted)]">
                    Form
                  </dt>
                  <dd className="mt-0.5 font-mono text-[var(--ink)]">
                    {r.formUsed ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono uppercase tracking-[0.1em] text-[var(--muted)]">
                    Premium
                  </dt>
                  <dd className="mt-0.5 text-[var(--ink)]">
                    {r.premiumCents == null
                      ? "—"
                      : r.premiumCents === 0
                        ? "$0"
                        : formatMoney(r.premiumCents)}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono uppercase tracking-[0.1em] text-[var(--muted)]">
                    SR
                  </dt>
                  <dd className="mt-0.5">
                    {r.ticketId && r.srNumber ? (
                      <Link
                        href={`/tickets/${r.ticketId}`}
                        className="font-mono text-[var(--coral)] hover:underline"
                      >
                        {r.srNumber}
                      </Link>
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}
                  </dd>
                </div>
              </dl>
              {r.notes && (
                <p className="mt-3 text-xs text-[var(--muted)]">{r.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
