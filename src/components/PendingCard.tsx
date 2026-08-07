import Link from "next/link";
import { REQUEST_TYPES } from "@/lib/catalog";
import {
  confirmIntakeTicketAction,
  dismissIntakeEventAction,
  mergeIntakeIntoTicketAction,
} from "@/lib/desk-actions";
import type { MatchResult, PairResult } from "@/lib/intake-match";
import type { IntakeEvent } from "@/lib/types";

/**
 * One pending intake event on the board: verbatim comm, the engine's
 * recommendation with its reasons, and the three operator moves — Confirm
 * To Ticket, Merge Into, Dismiss. Server component; disclosures are plain
 * <details> so no client state is needed.
 */

export interface PendingPolicyOption {
  id: string;
  policyNumber: string;
  coverageLabel: string;
}

export interface PendingTicketOption {
  id: string;
  srNumber: string;
  title: string;
}

export interface PendingPairInfo {
  result: Extract<PairResult, { kind: "pair" }>;
  /** e.g. `The Email "COI for Palm Court HOA" From 25 Min Ago` */
  otherLabel: string;
}

const CALL_EXCERPT_CHARS = 150;

export function pendingAgeLabel(receivedAt: string, now: string): string {
  const mins = Math.max(
    0,
    Math.round((new Date(now).getTime() - new Date(receivedAt).getTime()) / 60_000),
  );
  if (mins < 1) return "Just Now";
  if (mins < 60) return `${mins} Min Ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} Hr Ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 Day Ago" : `${days} Days Ago`;
}

function channelChip(event: IntakeEvent) {
  if (event.channel === "call" && event.callMissed === true) {
    return (
      <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
        Missed Call
      </span>
    );
  }
  const label =
    event.channel === "email" ? "Email" : event.channel === "text" ? "Text" : "Call";
  return (
    <span className="rounded-full bg-[var(--sand)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ink)] ring-1 ring-[var(--rule)]">
      {label}
    </span>
  );
}

function confidencePct(confidence: number): number {
  return Math.round(confidence * 100);
}

function ReasonChips({ reasons }: { reasons: string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {reasons.map((r) => (
        <li
          key={r}
          className="rounded-full bg-white px-2.5 py-0.5 text-[11px] text-[var(--muted)] ring-1 ring-[var(--rule)]"
        >
          {r}
        </li>
      ))}
    </ul>
  );
}

export function PendingCard({
  event,
  now,
  accountName,
  match,
  pair,
  policies,
  mergeOptions,
}: {
  event: IntakeEvent;
  now: string;
  accountName: string | null;
  match: MatchResult;
  pair: PendingPairInfo | null;
  policies: PendingPolicyOption[];
  mergeOptions: PendingTicketOption[];
}) {
  const isCall = event.channel === "call";
  const isMissedCall = isCall && event.callMissed === true;
  const excerpt = isCall
    ? event.body.length > CALL_EXCERPT_CHARS
      ? `${event.body.slice(0, CALL_EXCERPT_CHARS)}…`
      : event.body
    : event.body;

  // One-line verbatim snippet for the compact row.
  const oneLine = (event.subject ?? event.body).replace(/\s+/g, " ").trim();
  const snippet = oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine;

  // One recommendation signal in the compact row; reasons live inside.
  const recChip =
    match.kind === "ticket" ? (
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
          match.recommendation === "merge"
            ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
            : "bg-[var(--sand)] text-[var(--ink)] ring-[var(--rule)]"
        }`}
      >
        {match.recommendation === "merge"
          ? `Merge ${match.srNumber}`
          : `Possible ${match.srNumber}`}
      </span>
    ) : pair ? (
      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
        Pending Duplicate
      </span>
    ) : !event.accountId ? (
      <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
        No Account Match
      </span>
    ) : (
      <span className="chip shrink-0">New</span>
    );

  return (
    <li
      className={`surface-card overflow-hidden p-0 ${
        isMissedCall ? "ring-2 ring-rose-300" : ""
      }`}
    >
      <details className="disclosure">
        {/* —— Compact row: everything else lives inside —— */}
        <summary className="row-link flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5">
          <span className="disclosure-caret text-xs text-[var(--muted)]" aria-hidden>
            ›
          </span>
          {channelChip(event)}
          <span className="shrink-0 text-sm font-medium text-[var(--ink)]">
            {event.fromName}
          </span>
          {event.accountId && accountName && (
            <span className="shrink-0 text-xs text-[var(--muted)]">
              {accountName}
            </span>
          )}
          <span
            className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]"
            title={snippet}
          >
            {snippet}
          </span>
          {recChip}
          <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">
            {pendingAgeLabel(event.receivedAt, now)}
          </span>
        </summary>

      {/* —— Sender + verbatim body —— */}
      <div className="border-t border-[var(--rule)] px-5 py-4">
        <p className="mb-2 text-xs text-[var(--muted)]">
          {event.fromContact}
          {event.accountId && accountName && (
            <>
              {" · "}
              <Link
                href={`/accounts/${event.accountId}`}
                className="font-semibold text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-2 hover:decoration-[var(--ink)]"
              >
                {accountName}
              </Link>
            </>
          )}
        </p>
        {event.subject && (
          <p className="mb-1.5 text-sm font-medium text-[var(--ink)]">{event.subject}</p>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]/85">
          {excerpt}
        </p>
        {isCall && excerpt !== event.body && (
          <details className="disclosure mt-2">
            <summary className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ink)] hover:underline">
              <span className="disclosure-caret" aria-hidden>
                ›
              </span>
              Read Transcript
            </summary>
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--sand)] px-3 py-2.5 text-sm leading-relaxed text-[var(--ink)]/85">
              {event.body}
            </p>
          </details>
        )}
        {isMissedCall && (
          <p className="mt-2 text-xs font-medium text-rose-700">
            Missed call with no callback recorded yet. This requires a return
            call from an operator.
          </p>
        )}
      </div>

      {/* —— Recommendation strip: the engine shows its work, always —— */}
      {match.kind === "ticket" && (
        <div
          className={`border-t px-5 py-3.5 ${
            match.recommendation === "merge"
              ? "border-emerald-200 bg-emerald-50"
              : "border-[var(--rule)] bg-[var(--sand)]"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--ink)]">
              {match.recommendation === "merge" ? (
                <>High-Confidence Duplicate Of {match.srNumber} ({confidencePct(match.confidence)}%)</>
              ) : (
                <>Possible Match: {match.srNumber} ({confidencePct(match.confidence)}%)</>
              )}
            </p>
            {match.recommendation === "merge" && (
              <form action={mergeIntakeIntoTicketAction}>
                <input type="hidden" name="intakeId" value={event.id} />
                <input type="hidden" name="ticketId" value={match.ticketId} />
                <button type="submit" className="btn-primary px-4 py-1.5 text-xs">
                  Merge Into {match.srNumber}
                </button>
              </form>
            )}
          </div>
          <ReasonChips reasons={match.reasons} />
          {match.recommendation === "review" && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Below the one-click merge threshold. Review the match and use Merge Into if it fits.
            </p>
          )}
        </div>
      )}

      {pair && (
        <div className="border-t border-emerald-200 bg-emerald-50 px-5 py-3.5">
          <p className="text-sm font-semibold text-[var(--ink)]">
            {pair.result.recommendation === "merge"
              ? "High-Confidence Duplicate"
              : "Possible Duplicate"}{" "}
            — Likely Duplicate Of {pair.otherLabel} ({confidencePct(pair.result.confidence)}%)
          </p>
          <ReasonChips reasons={pair.result.reasons} />
          <p className="mt-2 text-xs text-[var(--muted)]">
            Both are still pending. Confirm the earlier one into a ticket
            first, then merge this one into the resulting Service Request (SR).
          </p>
        </div>
      )}

      {match.kind === "none" && !pair && (
        <div className="border-t border-[var(--rule)] px-5 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
            No Existing Match
          </p>
        </div>
      )}

      {/* —— Actions —— */}
      <div className="space-y-3 border-t border-[var(--rule)] bg-white/60 px-5 py-4">
        {event.accountId ? (
          <details className="disclosure group">
            <summary className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-1.5 text-xs font-semibold text-[var(--paper)] transition hover:opacity-90 active:scale-[0.98]">
              <span className="disclosure-caret" aria-hidden>
                ›
              </span>
              Confirm To Ticket
            </summary>
            <form
              action={confirmIntakeTicketAction}
              className="mt-3 space-y-3 rounded-xl border border-[var(--rule)] bg-white p-4"
            >
              <input type="hidden" name="intakeId" value={event.id} />
              <p className="text-[11px] text-[var(--muted)]">
                Request types and terms are defined in the{" "}
                <Link href="/glossary" className="underline underline-offset-2">
                  Glossary
                </Link>
                .
              </p>
              <label className="block text-xs font-semibold text-[var(--ink)]">
                Request Type
                <select name="requestType" className="field mt-1 w-full" required>
                  {REQUEST_TYPES.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.label}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className="text-xs font-semibold text-[var(--ink)]">
                  Policies
                </legend>
                <div className="mt-1 space-y-1.5">
                  {policies.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 text-sm text-[var(--ink)]"
                    >
                      <input type="checkbox" name="policyIds" value={p.id} />
                      <span className="font-mono text-xs">{p.policyNumber}</span>
                      <span className="text-xs text-[var(--muted)]">{p.coverageLabel}</span>
                    </label>
                  ))}
                  {policies.length === 0 && (
                    <p className="text-xs text-[var(--muted)]">
                      No policies on file for this account.
                    </p>
                  )}
                </div>
              </fieldset>
              <label className="block text-xs font-semibold text-[var(--ink)]">
                Holder Name
                <input
                  type="text"
                  name="holderName"
                  className="field mt-1 w-full"
                  placeholder="Certificate holder / party, if any…"
                />
              </label>
              <label className="block text-xs font-semibold text-[var(--ink)]">
                Wording
                <textarea
                  name="wording"
                  rows={4}
                  className="field mt-1 w-full"
                  defaultValue={event.body}
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--ink)]">
                <input type="checkbox" name="namedOnPolicyRequired" />
                Holder Must Be Named On The Policy
              </label>
              <button type="submit" className="btn-primary px-5 py-2 text-xs">
                Create Ticket
              </button>
              {event.channel === "email" && (
                <p className="text-[11px] text-[var(--muted)]">
                  Confirming sends the client acknowledgment with the SR number.
                </p>
              )}
            </form>
          </details>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            <span className="font-semibold">Match To An Account First</span> — this
            sender does not resolve to an account, so no ticket can be opened yet.
            Account matching is manual for now: find or create the account, then triage.
          </p>
        )}

        {event.accountId && mergeOptions.length > 0 && (
          <details className="disclosure">
            <summary className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-[var(--ink)] ring-1 ring-[var(--rule)] transition hover:bg-[var(--sand)] active:scale-[0.98]">
              <span className="disclosure-caret" aria-hidden>
                ›
              </span>
              Merge Into
            </summary>
            <form
              action={mergeIntakeIntoTicketAction}
              className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--rule)] bg-white p-4"
            >
              <input type="hidden" name="intakeId" value={event.id} />
              <select name="ticketId" className="field min-w-0 flex-1" required>
                {mergeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.srNumber} — {t.title}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-ghost px-4 py-2 text-xs">
                Merge
              </button>
            </form>
          </details>
        )}

        <form action={dismissIntakeEventAction} className="inline">
          <input type="hidden" name="intakeId" value={event.id} />
          <button
            type="submit"
            className="text-xs font-medium text-[var(--muted)] underline underline-offset-2 transition-colors hover:text-[var(--ink)]"
          >
            Dismiss
          </button>
        </form>
      </div>
      </details>
    </li>
  );
}
