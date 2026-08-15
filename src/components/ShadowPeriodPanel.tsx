import { DeskSection } from "@/components/DeskSection";
import {
  DISPUTE_STATE_LABELS,
  PERIOD_STATE_LABELS,
  type ReadinessCheck,
  type ScorecardDispute,
  type ScorecardPeriod,
} from "@/lib/retention/period";
import {
  attachPayAction,
  publishPeriodAction,
  raiseDisputeAction,
  settleDisputeAction,
} from "@/lib/retention/scorecard-actions";
import {
  formatCents,
  SCORECARD_METRIC_LABELS,
  type PersonScorecard,
  type PodScorecard,
} from "@/lib/retention/scorecard";

/**
 * The shadow period, as a surface people can actually work.
 *
 * The ritual is four steps — publish, argue, settle, attach — and each one is
 * a thing somebody has to do rather than a state the system drifts into. The
 * panel shows all four at once, including the ones already done, because the
 * argument this period is designed to invite only happens if people can see
 * that the numbers are open for it.
 *
 * Publishing and attaching are manager-only. Raising a dispute is not: the
 * person whose number is wrong is usually not the manager.
 */

const DISPUTE_TONE: Record<ScorecardDispute["state"], string> = {
  open: "bg-amber-50 text-amber-900 ring-amber-300",
  upheld: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  rejected: "bg-white text-[var(--muted)] ring-[var(--rule)]",
  withdrawn: "bg-white text-[var(--muted)] ring-[var(--rule)]",
};

export interface DisputeSubjectOption {
  /** `subject:subjectId` — the action splits it back apart. */
  value: string;
  label: string;
}

/**
 * What a dispute can be raised against. Metrics come first because the common
 * complaint is that a number is wrong, not that a pod is.
 */
export function disputeSubjects(
  pods: PodScorecard[],
  people: PersonScorecard[],
): DisputeSubjectOption[] {
  const metricKeys = [...new Set(pods.flatMap((p) => p.metrics.map((m) => m.key)))];
  return [
    ...metricKeys.map((key) => ({
      value: `metric:${key}`,
      label: `Metric · ${SCORECARD_METRIC_LABELS[key]}`,
    })),
    ...pods.map((p) => ({ value: `pod:${p.podId}`, label: `Pod · ${p.label}` })),
    ...people.map((p) => ({
      value: `person:${p.agentId}`,
      label: `Seat · ${p.displayName}`,
    })),
  ];
}

function Step({
  index,
  label,
  done,
  detail,
}: {
  index: number;
  label: string;
  done: boolean;
  detail: string;
}) {
  return (
    <li className="flex gap-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          done
            ? "bg-emerald-600 text-white"
            : "bg-white text-[var(--muted)] ring-1 ring-[var(--rule)]"
        }`}
        aria-hidden
      >
        {done ? "✓" : index}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[var(--ink)]">
          {label}
        </span>
        <span className="block text-[11px] leading-relaxed text-[var(--muted)]">
          {detail}
        </span>
      </span>
    </li>
  );
}

export function DisputeCard({
  dispute,
  canSettle,
  seatNames = {},
}: {
  dispute: ScorecardDispute;
  canSettle: boolean;
  /** Operator id → display name. Ids are what is stored; names are what is read. */
  seatNames?: Record<string, string>;
}) {
  const raiser = seatNames[dispute.raisedBy] ?? dispute.raisedBy;
  return (
    <li className="rounded-xl border border-[var(--rule)] bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-[var(--ink)]">{dispute.claim}</p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {dispute.subject}:{dispute.subjectId} · raised by {raiser} on{" "}
            {dispute.raisedAt.slice(0, 10)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${DISPUTE_TONE[dispute.state]}`}
        >
          {DISPUTE_STATE_LABELS[dispute.state]}
          {dispute.correctionApplied ? " · Corrected" : ""}
        </span>
      </div>

      {dispute.resolutionNote && (
        <p className="mt-2 border-l-2 border-[var(--rule)] pl-3 text-[11px] leading-relaxed text-[var(--muted)]">
          {dispute.resolutionNote}
          {dispute.resolvedBy
            ? ` — ${seatNames[dispute.resolvedBy] ?? dispute.resolvedBy}`
            : ""}
        </p>
      )}

      {dispute.state === "open" && canSettle && (
        <form action={settleDisputeAction} className="mt-3 space-y-2">
          <input type="hidden" name="disputeId" value={dispute.id} />
          <textarea
            name="resolutionNote"
            rows={2}
            required
            placeholder="Why this lands the way it does — a rejection with no reason teaches people to stop raising them."
            className="field text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select name="state" defaultValue="upheld" className="field w-auto py-1.5 text-xs">
              <option value="upheld">Upheld</option>
              <option value="rejected">Rejected</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <input type="checkbox" name="correctionApplied" value="1" />
              Number Changed
            </label>
            <button type="submit" className="btn-primary ml-auto text-xs">
              Settle Dispute
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function RaiseDisputeForm({
  periodId,
  subjects,
  disabled,
  compact = false,
}: {
  periodId: string;
  subjects: DisputeSubjectOption[];
  /** Nothing published yet — there is no frozen figure to argue with. */
  disabled: boolean;
  compact?: boolean;
}) {
  if (disabled) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-3 text-[11px] leading-relaxed text-[var(--muted)]">
        Nothing has been published for this period yet. A dispute argues with a
        frozen board, so there is nothing to raise one against.
      </p>
    );
  }

  return (
    <form action={raiseDisputeAction} className="space-y-2">
      <input type="hidden" name="periodId" value={periodId} />
      <div className={compact ? "space-y-2" : "flex flex-wrap gap-2"}>
        <select
          name="target"
          defaultValue={subjects[0]?.value ?? "metric:board"}
          className={`field text-xs ${compact ? "" : "w-auto min-w-[16rem] py-2"}`}
        >
          {subjects.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          name="claim"
          required
          placeholder="What reads wrong, and what the record says instead"
          className={`field text-xs ${compact ? "" : "min-w-[18rem] flex-1 py-2"}`}
        />
        <button type="submit" className="btn-ghost shrink-0 text-xs">
          Raise Dispute
        </button>
      </div>
    </form>
  );
}

export function ShadowPeriodPanel({
  period,
  readiness,
  disputes,
  subjects,
  canManage,
  seatNames = {},
}: {
  period: ScorecardPeriod;
  readiness: ReadinessCheck | null;
  disputes: ScorecardDispute[];
  subjects: DisputeSubjectOption[];
  canManage: boolean;
  seatNames?: Record<string, string>;
}) {
  const open = disputes.filter((d) => d.state === "open");
  const published = Boolean(period.publishedAt);
  const settledAll = published && disputes.length > 0 && open.length === 0;
  const attached = period.state !== "shadow";
  const blockers = readiness?.blockers ?? [
    "Numbers were never published — nobody has had a chance to argue with them",
  ];

  return (
    <DeskSection
      title="Shadow Period"
      summary={
        open.length > 0
          ? `${open.length} Open Dispute${open.length === 1 ? "" : "s"}`
          : PERIOD_STATE_LABELS[period.state]
      }
      defaultOpen={open.length > 0 || !published}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div>
          <ol className="space-y-2.5">
            <Step
              index={1}
              label="Publish The Numbers"
              done={published}
              detail={
                published
                  ? `Frozen ${period.publishedAt?.slice(0, 10)} — disputes argue with that board, not with today's`
                  : "Freezes the board so an argument three weeks from now is about the figures people saw"
              }
            />
            <Step
              index={2}
              label="Let Both Sides Argue"
              done={disputes.length > 0}
              detail={
                disputes.length > 0
                  ? `${disputes.length} raised · ${readiness?.disputesUpheld ?? 0} upheld`
                  : "No disputes raised yet"
              }
            />
            <Step
              index={3}
              label="Settle Every Dispute"
              done={settledAll}
              detail={
                open.length > 0
                  ? `${open.length} still open`
                  : `${readiness?.correctionsApplied ?? 0} correction(s) applied`
              }
            />
            <Step
              index={4}
              label="Attach Compensation"
              done={attached}
              detail={
                attached
                  ? `Pay attached · pool ${formatCents(period.poolCents)}`
                  : `Pool ${formatCents(period.poolCents)} modeled, ${formatCents(0)} payable`
              }
            />
          </ol>

          {canManage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <form action={publishPeriodAction}>
                <button type="submit" className="btn-ghost text-xs">
                  {published ? "Republish Numbers" : "Publish Numbers"}
                </button>
              </form>
              <form action={attachPayAction}>
                <input type="hidden" name="periodId" value={period.id} />
                <button
                  type="submit"
                  disabled={!readiness?.ready || attached}
                  className="btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {attached ? "Pay Attached" : "Attach Pay"}
                </button>
              </form>
            </div>
          )}

          {!attached && (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                Pay Stays Detached
              </p>
              <ul className="mt-1 space-y-1">
                {blockers.map((b) => (
                  <li
                    key={b}
                    className="text-[11px] leading-relaxed text-[var(--muted)]"
                  >
                    · {b}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
              Disputes
            </p>
            {disputes.length === 0 ? (
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                Nothing has been argued with yet. On a first run that usually
                means the board has not been read, not that it is right.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {disputes.map((d) => (
                  <DisputeCard
                    key={d.id}
                    dispute={d}
                    canSettle={canManage}
                    seatNames={seatNames}
                  />
                ))}
              </ul>
            )}
          </div>

          <RaiseDisputeForm
            periodId={period.id}
            subjects={subjects}
            disabled={!published}
          />
        </div>
      </div>
    </DeskSection>
  );
}
