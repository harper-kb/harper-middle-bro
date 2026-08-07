import { formatDate } from "@/lib/format";
import { ticketStatusLabel } from "@/lib/tickets";
import type { Ticket, TicketStatus } from "@/lib/types";

/**
 * Ascend-style horizontal stage strip for a ticket. Stages come from the
 * real TicketStatus values; `closed` renders as the Delivered stage done.
 *
 * Timestamps only appear where the record actually carries them (createdAt,
 * updatedAt, closedAt) — no per-stage timestamps get invented. A ticket that
 * took the blanket fast path (fastPathBasis set) jumped from Intake straight
 * to Ready To Issue: the market stages render as skipped, honestly.
 */

const STAGES: TicketStatus[] = [
  "intake",
  "drafting",
  "waiting_market",
  "needs_you",
  "ready_to_issue",
  "delivered",
];

/** Stages the blanket fast path jumps over entirely. */
const FAST_PATH_SKIPPED = new Set<TicketStatus>([
  "drafting",
  "waiting_market",
  "needs_you",
]);

type StageState = "done" | "current" | "skipped" | "pending";

export function TicketPipeline({ ticket }: { ticket: Ticket }) {
  const closed = ticket.status === "closed";
  const currentIdx = closed ? STAGES.length - 1 : STAGES.indexOf(ticket.status);
  const fastPath = ticket.fastPathBasis != null;

  const stages = STAGES.map((stage, i) => {
    let state: StageState;
    if (i < currentIdx) {
      state =
        fastPath && FAST_PATH_SKIPPED.has(stage) ? "skipped" : "done";
    } else if (i === currentIdx) {
      state = closed ? "done" : "current";
    } else {
      state = "pending";
    }

    // Only stamps the record actually has: createdAt on Intake, updatedAt on
    // the current stage, closedAt on Delivered. Everything else stays blank.
    let stamp: string | null = null;
    if (stage === "intake") {
      stamp = formatDate(ticket.createdAt);
    } else if (stage === "delivered" && (i === currentIdx || closed)) {
      stamp = ticket.closedAt
        ? formatDate(ticket.closedAt)
        : formatDate(ticket.updatedAt);
    } else if (i === currentIdx) {
      stamp = formatDate(ticket.updatedAt);
    }

    return { stage, state, stamp };
  });

  return (
    <section className="surface-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Ticket Pipeline</p>
        {closed && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
            Closed{ticket.closedAt ? ` · ${formatDate(ticket.closedAt)}` : ""}
          </span>
        )}
      </div>

      <ol className="mt-3 flex items-start">
        {stages.map(({ stage, state, stamp }, i) => (
          <li key={stage} className="min-w-0 flex-1">
            <div className="flex items-center">
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${
                  state === "done"
                    ? "bg-emerald-500"
                    : state === "current"
                      ? "bg-[var(--coral)] ring-4 ring-[var(--coral)]/15"
                      : state === "skipped"
                        ? "border-2 border-dashed border-[var(--gold)] bg-transparent"
                        : "border border-[var(--rule)] bg-[var(--sand)]"
                }`}
              />
              {i < stages.length - 1 && (
                <span
                  className={`mx-1 h-px flex-1 ${
                    state === "skipped" || stages[i + 1].state === "skipped"
                      ? "border-t border-dashed border-[var(--gold)]/60 bg-transparent"
                      : state === "done"
                        ? "bg-emerald-400/60"
                        : "bg-[var(--rule)]"
                  }`}
                />
              )}
            </div>
            <p
              className={`mt-2 pr-2 text-[11px] font-semibold leading-tight ${
                state === "current"
                  ? "text-[var(--ink)]"
                  : state === "done"
                    ? "text-[var(--ink)]/80"
                    : state === "skipped"
                      ? "text-[var(--gold)]"
                      : "text-[var(--muted)]"
              }`}
            >
              {ticketStatusLabel(stage)}
            </p>
            {state === "skipped" ? (
              <p className="mt-0.5 pr-2 text-[10px] leading-tight text-[var(--gold)]">
                Skipped — Blanket Fast Path
              </p>
            ) : stamp ? (
              <p className="mt-0.5 pr-2 text-[10px] leading-tight text-[var(--muted)]">
                {stamp}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {ticket.fastPathBasis && (
        <p className="mt-3">
          <span className="inline-flex rounded-full border border-emerald-600/25 bg-emerald-50 px-3 py-1 text-[11px] font-semibold leading-snug text-emerald-700">
            {ticket.fastPathBasis}
          </span>
        </p>
      )}
    </section>
  );
}
