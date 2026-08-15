import { DeskSection } from "@/components/DeskSection";
import type {
  MetricSource,
  PersonScorecard,
  PodScorecard,
  ScorecardMetric,
  ScorecardMetricKey,
} from "@/lib/retention/scorecard";
import {
  formatCents,
  formatMetric,
  SCORECARD_METRIC_LABELS,
  SOURCE_LABELS,
} from "@/lib/retention/scorecard";
import {
  PERIOD_STATE_LABELS,
  type ScorecardDispute,
  type ScorecardPeriod,
} from "@/lib/retention/period";
import { DisputeCard, RaiseDisputeForm } from "@/components/ShadowPeriodPanel";

/**
 * The scorecard surface.
 *
 * Every cell wears its source. A snapshot number and a live number are the
 * same shape and different things, and this board is going to be argued with
 * line by line during the shadow period — so the argument needs the label in
 * front of it, not in a footnote.
 */

const SOURCE_TONE: Record<MetricSource, string> = {
  live: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  snapshot: "bg-sky-50 text-sky-800 ring-sky-200",
  sample: "bg-amber-50 text-amber-900 ring-amber-300",
};

export function SourceChip({ source }: { source: MetricSource }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1 ${SOURCE_TONE[source]}`}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

function MetricCell({ metric }: { metric: ScorecardMetric }) {
  return (
    <td className="px-3 py-3 text-right align-top" title={metric.note ?? undefined}>
      <span className="block text-sm tabular-nums text-[var(--ink)]">
        {formatMetric(metric)}
      </span>
      <span className="mt-0.5 block">
        <SourceChip source={metric.source} />
      </span>
    </td>
  );
}

export function ShadowBanner({
  period,
  ledgerNote,
  packNote,
}: {
  period: ScorecardPeriod;
  ledgerNote: string;
  packNote: string;
}) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-[var(--ink)]">
      <span className="font-semibold">
        {period.label} · {PERIOD_STATE_LABELS[period.state]}
      </span>
      {period.state === "shadow" && (
        <>
          {" — "}
          Nothing here pays anyone. Publish the numbers, argue with them, settle
          every dispute, and only then attach compensation.
        </>
      )}
      <span className="mt-1 block text-[11px] text-[var(--muted)]">
        Ledger: {ledgerNote} · Packs: {packNote}
      </span>
    </div>
  );
}

const POD_COLUMNS: ScorecardMetricKey[] = [
  "retained_commission",
  "save_rate",
  "time_to_first_decisive_action",
  "repeat_contact_rate",
  "sla_attainment",
  "book_sla_attainment",
  "defects_absorbed",
  "record_completeness",
];

const PERSON_COLUMNS: ScorecardMetricKey[] = [
  "retained_commission",
  "save_rate",
  "time_to_first_decisive_action",
  "defects_absorbed",
  "record_completeness",
];

function metricFor(metrics: ScorecardMetric[], key: ScorecardMetricKey): ScorecardMetric {
  return (
    metrics.find((m) => m.key === key) ?? {
      key,
      label: SCORECARD_METRIC_LABELS[key],
      value: null,
      unit: "ratio",
      source: "sample",
      lowerIsBetter: false,
      note: "Not computed for this row",
    }
  );
}

export function PodScorecardTable({ pods }: { pods: PodScorecard[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--rule)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            <th className="px-4 py-2.5">Pod</th>
            {POD_COLUMNS.map((key) => (
              <th key={key} className="px-3 py-2.5 text-right">
                {SCORECARD_METRIC_LABELS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pods.map((pod) => (
            <tr key={pod.podId} className="border-b border-[var(--rule)] last:border-b-0">
              <td className="px-4 py-3 align-top">
                <p className="font-medium text-[var(--ink)]">{pod.label}</p>
                <p className="text-[11px] text-[var(--muted)]">
                  Paid On {pod.verbLabel} · {Math.round(pod.poolWeight * 100)}% Of Pool
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                  {pod.saves} Save{pod.saves === 1 ? "" : "s"} Of {pod.atRiskWindows} At-Risk
                  {pod.uncreditedSaves > 0
                    ? ` · ${pod.uncreditedSaves} Saved With No Record`
                    : ""}
                </p>
              </td>
              {POD_COLUMNS.map((key) => (
                <MetricCell key={key} metric={metricFor(pod.metrics, key)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PersonScorecardTable({ people }: { people: PersonScorecard[] }) {
  if (people.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
        No Individual Activity In This Period.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--rule)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            <th className="px-4 py-2.5">Seat</th>
            <th className="px-3 py-2.5 text-right">Owned Accounts</th>
            <th className="px-3 py-2.5 text-right">Decisive Actions</th>
            {PERSON_COLUMNS.map((key) => (
              <th key={key} className="px-3 py-2.5 text-right">
                {SCORECARD_METRIC_LABELS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.agentId} className="border-b border-[var(--rule)] last:border-b-0">
              <td className="px-4 py-3 align-top">
                <p className="font-medium text-[var(--ink)]">{person.displayName}</p>
                <p className="text-[11px] text-[var(--muted)]">
                  {person.podLabel ?? "No Pod Assigned"}
                  {person.ownerFloorOnly > 0
                    ? ` · ${person.ownerFloorOnly} Save${person.ownerFloorOnly === 1 ? "" : "s"} On The Owner Floor Alone`
                    : ""}
                </p>
              </td>
              <td className="px-3 py-3 text-right align-top text-sm tabular-nums text-[var(--ink)]">
                {person.ownedAccounts}
              </td>
              <td className="px-3 py-3 text-right align-top text-sm tabular-nums text-[var(--ink)]">
                {person.decisiveActions}
              </td>
              {PERSON_COLUMNS.map((key) => (
                <MetricCell key={key} metric={metricFor(person.metrics, key)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The personal slice on /me — the same numbers, one seat, no comparison. */
export function PersonalScorecard({
  person,
  period,
  ledgerNote,
  disputes = [],
  seatNames = {},
}: {
  person: PersonScorecard | null;
  period: ScorecardPeriod;
  ledgerNote: string;
  /** Disputes this seat raised, so an argument does not vanish once made. */
  disputes?: ScorecardDispute[];
  seatNames?: Record<string, string>;
}) {
  if (!person) {
    return (
      <DeskSection title="Your Service Scorecard" summary={period.label}>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          Nothing is attributed to your seat this period. Credit follows decisive
          actions recorded in the ledger — an outbound contact that drew a reply,
          a payment link that got paid, a carrier escalation that changed policy
          state. Work done out of a personal inbox leaves no record to credit.
        </p>
        <p className="mt-2 text-[11px] text-[var(--muted)]">{ledgerNote}</p>
        {/* An empty row is the most disputable row on the board. */}
        <ArgueWithIt
          period={period}
          disputes={disputes}
          seatNames={seatNames}
          subjects={[{ value: "person:me", label: "My Seat Is Missing From The Board" }]}
          lead="If you worked a save this period and this says otherwise, that is the dispute worth raising."
        />
      </DeskSection>
    );
  }

  return (
    <DeskSection
      title="Your Service Scorecard"
      summary={`${period.label} · ${formatCents(person.retainedCommissionCents)}`}
      defaultOpen
    >
      <p className="mb-3 text-xs text-[var(--muted)]">
        {period.state === "shadow"
          ? "Shadow period — these numbers pay nothing yet. Dispute anything that reads wrong."
          : "Pay is attached to this period."}
      </p>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {person.metrics.map((m) => (
          <div
            key={m.key}
            className="rounded-xl border border-[var(--rule)] bg-white px-4 py-3"
          >
            <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
              {m.label}
              <SourceChip source={m.source} />
            </dt>
            <dd className="mt-1 font-display text-2xl text-[var(--ink)]">
              {formatMetric(m)}
            </dd>
            {m.note && (
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                {m.note}
              </p>
            )}
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] text-[var(--muted)]">
        {person.savesContributed} Save{person.savesContributed === 1 ? "" : "s"} Touched ·{" "}
        {person.ownedAccounts} Account{person.ownedAccounts === 1 ? "" : "s"} Owned ·{" "}
        {person.decisiveActions} Decisive Action
        {person.decisiveActions === 1 ? "" : "s"}
      </p>

      <ArgueWithIt
        period={period}
        disputes={disputes}
        seatNames={seatNames}
        subjects={person.metrics.map((m) => ({
          value: `metric:${m.key}`,
          label: m.label,
        }))}
      />
    </DeskSection>
  );
}

function ArgueWithIt({
  period,
  disputes,
  subjects,
  seatNames,
  lead = "Shadow mode exists so wrong numbers get caught before they pay anyone. Raise it here and a manager has to answer it in writing.",
}: {
  period: ScorecardPeriod;
  disputes: ScorecardDispute[];
  subjects: { value: string; label: string }[];
  seatNames: Record<string, string>;
  lead?: string;
}) {
  return (
    <div className="mt-4 border-t border-[var(--rule)] pt-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
        Argue With It
      </p>
      <p className="mt-1 mb-2 text-[11px] leading-relaxed text-[var(--muted)]">{lead}</p>
      {disputes.length > 0 && (
        <ul className="mb-2 space-y-2">
          {disputes.map((d) => (
            <DisputeCard
              key={d.id}
              dispute={d}
              canSettle={false}
              seatNames={seatNames}
            />
          ))}
        </ul>
      )}
      <RaiseDisputeForm
        periodId={period.id}
        subjects={subjects}
        disabled={!period.publishedAt}
        compact
      />
    </div>
  );
}
