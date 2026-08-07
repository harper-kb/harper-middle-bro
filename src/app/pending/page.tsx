import Link from "next/link";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { DeskSection } from "@/components/DeskSection";
import { Nav } from "@/components/Nav";
import {
  PendingCard,
  pendingAgeLabel,
  type PendingPairInfo,
  type PendingPolicyOption,
  type PendingTicketOption,
} from "@/components/PendingCard";
import { coverageLabels, getRequestType } from "@/lib/catalog";
import { getAccountDetail, listIntakeEvents, listTickets } from "@/lib/db";
import {
  priorityOrder,
  scoreIntakeAgainstTickets,
  scorePendingPair,
  type MatchResult,
  type TicketLike,
} from "@/lib/intake-match";
import { getSessionOperator } from "@/lib/session";
import type { IntakeEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The Pending intake board — raw comms (emails, texts, calls) on their way
 * to becoming SR tickets. Explicitly not the ticket queue: everything here
 * is pre-ticket. The engine recommends with visible reasons; the operator
 * commits with one click. Nothing merges on its own.
 */
export default async function PendingPage() {
  const operator = await getSessionOperator();

  const header = (
    <div className="mb-6">
      <p className="eyebrow">Communications Intake</p>
      <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">Pending</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
        Raw communications on their way to becoming tickets. Nothing merges
        without your confirmation.
      </p>
    </div>
  );

  if (!operator) {
    return (
      <>
        <Nav active="/pending" operator={operator} />
        <main className="mx-auto max-w-3xl px-4 py-8">
          {header}
          <section className="surface-card space-y-4 p-6">
            <p className="eyebrow">Sign In To Triage</p>
            <p className="text-sm text-[var(--muted)]">
              The Pending board holds real client communications. Sign in so
              triage is recorded under your name.
            </p>
            <div className="flex flex-wrap gap-2">
              <SignInButton mode="modal">
                <button type="button" className="btn-primary px-5 py-2.5">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button type="button" className="btn-ghost px-5 py-2.5">
                  Create Account
                </button>
              </SignUpButton>
            </div>
          </section>
        </main>
      </>
    );
  }

  const now = new Date().toISOString();
  const pending = priorityOrder(listIntakeEvents("pending"), now);
  const triaged = listIntakeEvents().filter((e) => e.status !== "pending");
  const openTickets = listTickets({ openOnly: true });
  const allTickets = listTickets();
  const srByTicketId = new Map(allTickets.map((t) => [t.id, t.srNumber]));

  const ticketLikes: TicketLike[] = openTickets.map((t) => ({
    id: t.id,
    srNumber: t.srNumber,
    accountId: t.accountId,
    title: t.title,
    subject: t.subject,
    requestType: t.requestType,
    requestTypeLabel: getRequestType(t.requestType).label,
    holderName: t.holderName,
    requestedBy: t.requestedBy,
    requestedByEmail: t.requestedByEmail,
    createdAt: t.createdAt,
  }));

  // Account details fetched once per account — names for the header row,
  // policies for the Confirm To Ticket checkboxes.
  const accountIds = [...new Set(pending.map((e) => e.accountId).filter(Boolean))] as string[];
  const accounts = new Map(accountIds.map((id) => [id, getAccountDetail(id)]));

  return (
    <>
      <Nav active="/pending" operator={operator} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        {header}

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-xl text-[var(--ink)]">
              Awaiting Triage
            </h2>
            <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
              {pending.length} Pending
            </span>
          </div>
          {pending.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
              Nothing pending. The intake queue is clear.
            </p>
          ) : (
            <ul className="space-y-4">
              {pending.map((event) => {
                const account = event.accountId
                  ? accounts.get(event.accountId)
                  : null;
                const match: MatchResult = scoreIntakeAgainstTickets(
                  event,
                  ticketLikes,
                  now,
                );
                const pair = bestPendingPair(event, pending, now);
                const policies: PendingPolicyOption[] = (account?.policies ?? []).map(
                  (p) => ({
                    id: p.id,
                    policyNumber: p.policyNumber,
                    coverageLabel: coverageLabels(p.coverages),
                  }),
                );
                const mergeOptions: PendingTicketOption[] = openTickets
                  .filter((t) => t.accountId === event.accountId)
                  .map((t) => ({ id: t.id, srNumber: t.srNumber, title: t.title }));
                return (
                  <PendingCard
                    key={event.id}
                    event={event}
                    now={now}
                    accountName={account?.name ?? null}
                    match={match}
                    pair={pair}
                    policies={policies}
                    mergeOptions={mergeOptions}
                  />
                );
              })}
            </ul>
          )}
        </section>

        <div className="mt-8">
          <DeskSection title="Triaged" count={triaged.length} flush>
            {triaged.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                Nothing triaged yet. Confirmed, merged, and dismissed communications are recorded here.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--rule)]">
                {triaged.map((event) => (
                  <TriagedRow
                    key={event.id}
                    event={event}
                    srNumber={event.ticketId ? (srByTicketId.get(event.ticketId) ?? null) : null}
                  />
                ))}
              </ul>
            )}
          </DeskSection>
        </div>
      </main>
    </>
  );
}

/**
 * Best duplicate candidate among the other still-pending events — how the
 * Greenleaf follow-up pair finds each other before either is a ticket.
 */
function bestPendingPair(
  event: IntakeEvent,
  pending: IntakeEvent[],
  now: string,
): PendingPairInfo | null {
  let best: PendingPairInfo | null = null;
  for (const other of pending) {
    if (other.id === event.id) continue;
    const result = scorePendingPair(event, other, now);
    if (result.kind !== "pair") continue;
    if (best && result.confidence <= best.result.confidence) continue;
    const channelLabel =
      other.channel === "email" ? "Email" : other.channel === "text" ? "Text" : "Call";
    const what = other.subject ?? `${other.body.slice(0, 60)}…`;
    best = {
      result,
      otherLabel: `The ${channelLabel} "${what}" From ${pendingAgeLabel(other.receivedAt, now)}`,
    };
  }
  return best;
}

function TriagedRow({
  event,
  srNumber,
}: {
  event: IntakeEvent;
  srNumber: string | null;
}) {
  const channelLabel =
    event.channel === "email" ? "Email" : event.channel === "text" ? "Text" : "Call";
  return (
    <li className="row-link flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {channelLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">
        {event.fromName}
        {event.subject && (
          <span className="text-[var(--muted)]"> — {event.subject}</span>
        )}
      </span>
      <span className="text-xs font-medium text-[var(--ink)]">
        {event.status === "ticketed" && event.ticketId ? (
          <Link href={`/tickets/${event.ticketId}`} className="underline underline-offset-2 hover:text-[var(--coral)]">
            Became {srNumber ?? "Its SR"}
          </Link>
        ) : event.status === "merged" && event.ticketId ? (
          <Link href={`/tickets/${event.ticketId}`} className="underline underline-offset-2 hover:text-[var(--coral)]">
            Merged Into {srNumber ?? "Its SR"}
          </Link>
        ) : (
          <span className="text-[var(--muted)]">Dismissed</span>
        )}
      </span>
      {event.ackSentAt && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          Acknowledgment Sent
        </span>
      )}
    </li>
  );
}
