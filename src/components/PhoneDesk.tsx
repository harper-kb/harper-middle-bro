import Link from "next/link";
import {
  CommsMassText,
  type MassTextRecipient,
} from "@/components/CommsMassText";
import { DeskSection } from "@/components/DeskSection";
import { formatDate, relativeAge } from "@/lib/format";
import type { IntakeEvent, IntakeStatus } from "@/lib/types";

/**
 * The Quo phone desk — every call (with its verbatim transcript), every
 * text, and the mass-text composer. Seeded sandbox data: no live phone
 * hookup, which the UI says out loud rather than pretending.
 */

const STATUS_LABELS: Record<IntakeStatus, string> = {
  pending: "Pending Triage",
  ticketed: "Ticketed",
  merged: "Merged",
  dismissed: "Dismissed",
};

const STATUS_CHIP_CLASSES: Record<IntakeStatus, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  ticketed: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  merged: "bg-sky-100 text-sky-800 ring-sky-200",
  dismissed: "bg-neutral-100 text-neutral-600 ring-neutral-200",
};

function StatusChip({ status }: { status: IntakeStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${STATUS_CHIP_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function durationLabel(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function PhoneDesk({
  calls,
  texts,
  accountNamesById,
  srByTicketId,
  recipients,
}: {
  calls: IntakeEvent[];
  texts: IntakeEvent[];
  accountNamesById: Record<string, string>;
  srByTicketId: Record<string, string>;
  recipients: MassTextRecipient[];
}) {
  const accountName = (id: string | null) =>
    id ? (accountNamesById[id] ?? id) : null;

  return (
    <section className="space-y-8">
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-xl text-[var(--ink)]">All Calls</h2>
          <span className="text-[11px] text-[var(--muted)]">
            Sandbox — seeded calls and texts with verbatim transcripts; no live
            phone sync.
          </span>
        </div>
        <div className="surface-card divide-y divide-[var(--rule)] p-0">
          {calls.map((c) => {
            const acct = accountName(c.accountId);
            const sr = c.ticketId ? srByTicketId[c.ticketId] : undefined;
            return (
              <div key={c.id} className="row-link px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
                    {formatDate(c.receivedAt)}
                  </span>
                  <span className="min-w-0 text-sm font-medium text-[var(--ink)]">
                    {c.fromName}
                    <span className="ml-2 font-mono text-[11px] font-normal text-[var(--muted)]">
                      {c.fromContact}
                    </span>
                  </span>
                  <span className="chip">{acct ?? "Unknown Caller"}</span>
                  {c.callMissed ? (
                    <span className="inline-flex items-center rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                      Missed Call
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
                      Answered
                      {c.callDurationSec != null &&
                        ` · ${durationLabel(c.callDurationSec)}`}
                    </span>
                  )}
                  <StatusChip status={c.status} />
                  {c.ticketId && (
                    <Link
                      href={`/tickets/${c.ticketId}`}
                      className="text-xs font-medium text-[var(--coral)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--coral)]"
                    >
                      {sr ? `Open ${sr}` : "Open Ticket"}
                    </Link>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-[var(--muted)]">
                    {relativeAge(c.receivedAt)} ago
                  </span>
                </div>
                <details className="disclosure mt-2.5">
                  <summary className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--ink)]">
                    <span className="disclosure-caret" aria-hidden>
                      ›
                    </span>
                    Read Transcript
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-[var(--rule)] bg-white px-4 py-3 font-mono text-[12px] leading-relaxed text-[var(--ink)]/90">
                    {c.body}
                  </pre>
                </details>
              </div>
            );
          })}
          {calls.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-[var(--muted)]">
              No Calls In The Stream.
            </p>
          )}
        </div>
      </div>

      <DeskSection title="Texts" count={texts.length}>
        <ul className="space-y-3">
          {texts.map((t) => {
            const acct = accountName(t.accountId);
            const sr = t.ticketId ? srByTicketId[t.ticketId] : undefined;
            return (
              <li
                key={t.id}
                className="surface-card max-w-2xl px-5 py-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-sm font-medium text-[var(--ink)]">
                    {t.fromName}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--muted)]">
                    {t.fromContact}
                  </span>
                  <span className="chip">{acct ?? "No Account Match"}</span>
                  <StatusChip status={t.status} />
                  {t.ticketId && (
                    <Link
                      href={`/tickets/${t.ticketId}`}
                      className="text-xs font-medium text-[var(--coral)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--coral)]"
                    >
                      {sr ? `Open ${sr}` : "Open Ticket"}
                    </Link>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-[var(--muted)]">
                    {relativeAge(t.receivedAt)} ago
                  </span>
                </div>
                <p className="rounded-2xl rounded-tl-sm bg-[var(--sand)] px-4 py-3 text-[13px] leading-relaxed text-[var(--ink)]/90">
                  {t.body}
                </p>
              </li>
            );
          })}
          {texts.length === 0 && (
            <li className="surface-card px-5 py-10 text-center text-sm text-[var(--muted)]">
              No Texts In The Stream.
            </li>
          )}
        </ul>
      </DeskSection>

      <DeskSection
        title="Mass Text"
        summary={`${recipients.length} Recipients`}
      >
        <div className="max-w-2xl">
          <CommsMassText recipients={recipients} />
        </div>
      </DeskSection>
    </section>
  );
}
