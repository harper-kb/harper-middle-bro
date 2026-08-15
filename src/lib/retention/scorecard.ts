/**
 * The Service Scorecard.
 *
 * Seven measures per pod and per person, assembled from parts that come from
 * genuinely different places: the retention ledger, the defect ledger, and the
 * three live spine packs. Every measure therefore carries its own source label
 * rather than inheriting the board's, because the fastest way to lose this team
 * is to print a modeled number next to a measured one and let the reader guess.
 *
 * This team has already been burned by exactly that — first pass rate reading
 * 60% on one dashboard and something else on another. A metric here is allowed
 * to be null. It is not allowed to be unlabeled.
 *
 * Pure: no database, no network, no clock beyond what callers pass in.
 */

import { formatCents } from "./commission";
import { defectsAbsorbedByPod, isActionable, type OriginationDefect } from "./defects";
import type { InternalAgent } from "./agents";
import type { OwnerAssignment } from "./ownership";
import { ECONOMIC_VERB_LABELS, POD_BY_ID, SERVICE_PODS, podForLane, type ServicePodId } from "./pods";
import type { ScorecardPackColumns } from "./packs";
import type { SaveCredit, SavesProjection } from "./saves";
import type { PodSlaAttainment } from "./sla";
import { isDecisive, type AtRiskWindow, type RetentionEvent } from "./types";

export type MetricSource = "live" | "snapshot" | "sample";

export type MetricUnit = "cents" | "ratio" | "hours" | "count";

export type ScorecardMetricKey =
  | "retained_commission"
  | "save_rate"
  | "time_to_first_decisive_action"
  | "repeat_contact_rate"
  | "sla_attainment"
  | "book_sla_attainment"
  | "defects_absorbed"
  | "record_completeness";

export const SCORECARD_METRIC_LABELS: Record<ScorecardMetricKey, string> = {
  retained_commission: "Retained Commission",
  save_rate: "Save Rate",
  time_to_first_decisive_action: "Time To First Decisive Action",
  repeat_contact_rate: "Repeat Contact Rate",
  sla_attainment: "SLA Attainment",
  book_sla_attainment: "Book SLA Attainment",
  defects_absorbed: "Defects Absorbed",
  record_completeness: "Record Completeness",
};

/**
 * Two SLA rows, because there are two honest answers and they measure
 * different populations. `sla_attainment` is the desk's own issues after
 * defect pauses — the number the pod is judged on. `book_sla_attainment` is
 * the whole spine book straight from the `sla_breaches` pack, with no pauses
 * applied, which is the number the customer experiences. Collapsing them into
 * one figure would either flatter the pod or punish it for sales' output.
 */
export const SLA_ROW_NOTE =
  "Desk issues after defect pauses. Book SLA is the spine-wide pack read, unpaused.";

export interface ScorecardMetric {
  key: ScorecardMetricKey;
  label: string;
  value: number | null;
  unit: MetricUnit;
  source: MetricSource;
  lowerIsBetter: boolean;
  note: string | null;
}

export interface PodScorecard {
  podId: ServicePodId;
  label: string;
  verbLabel: string;
  headlineMetric: string;
  metrics: ScorecardMetric[];
  atRiskWindows: number;
  saves: number;
  /** Saved windows that credited nobody — automation, or work off the record. */
  uncreditedSaves: number;
  poolWeight: number;
}

export interface PersonScorecard {
  agentId: string;
  displayName: string;
  /** The only identifier the desk's operator table and the ledger both carry. */
  email: string | null;
  podId: ServicePodId | null;
  podLabel: string | null;
  metrics: ScorecardMetric[];
  ownedAccounts: number;
  decisiveActions: number;
  /** Saves they took a share of, whether earned or via the owner floor. */
  savesContributed: number;
  /** Of those, the ones where the only claim was the owner floor. */
  ownerFloorOnly: number;
  retainedCommissionCents: number;
}

export interface ScorecardInput {
  windows: AtRiskWindow[];
  events: RetentionEvent[];
  projection: SavesProjection;
  assignments: OwnerAssignment[];
  directory: InternalAgent[];
  defects: OriginationDefect[];
  /** Defect-paused attainment over the desk's own issues. */
  deskSla: PodSlaAttainment[];
  /** Live/snapshot columns off the three spine packs. */
  packColumns: ScorecardPackColumns[];
  /** How much of the ledger is real. Sample seed data must say sample. */
  ledgerSource: MetricSource;
}

function metric(
  key: ScorecardMetricKey,
  value: number | null,
  unit: MetricUnit,
  source: MetricSource,
  opts: { lowerIsBetter?: boolean; note?: string | null } = {},
): ScorecardMetric {
  return {
    key,
    label: SCORECARD_METRIC_LABELS[key],
    value,
    unit,
    source,
    lowerIsBetter: opts.lowerIsBetter ?? false,
    note: opts.note ?? null,
  };
}

export function buildPodScorecards(input: ScorecardInput): PodScorecard[] {
  const creditsByPod = groupBy(input.projection.credits, (c) => c.podId);
  const windowsByPod = groupBy(input.windows, (w) => podForLane(w.lane));
  const absorbed = defectsAbsorbedByPod(input.defects);
  const deskSlaByPod = new Map(input.deskSla.map((r) => [r.podId, r]));
  const packByPod = new Map(input.packColumns.map((c) => [c.pod, c]));
  const evidence = evidenceCompletenessByPod(input.windows, input.events);

  return SERVICE_PODS.map((pod) => {
    const credits = creditsByPod.get(pod.id) ?? [];
    const windows = windowsByPod.get(pod.id) ?? [];
    const desk = deskSlaByPod.get(pod.id) ?? null;
    const pack = packByPod.get(pod.id) ?? null;
    const absorbedCount = absorbed.find((a) => a.podId === pod.id)?.count ?? 0;
    const completeness = evidence.get(pod.id) ?? null;

    const retainedCents = credits.reduce((n, c) => n + c.retainedCommissionCents, 0);
    const decided = windows.filter((w) => w.outcome !== "open");

    return {
      podId: pod.id,
      label: pod.label,
      verbLabel: ECONOMIC_VERB_LABELS[pod.verb],
      headlineMetric: pod.headlineMetric,
      atRiskWindows: windows.length,
      saves: credits.length,
      uncreditedSaves: countUncredited(input.projection, pod.id, windowsByPod),
      poolWeight: pod.poolWeight,
      metrics: [
        metric("retained_commission", retainedCents, "cents", input.ledgerSource, {
          note: credits.length === 0 ? "No credited saves in this period" : null,
        }),
        metric(
          "save_rate",
          decided.length > 0 ? credits.length / decided.length : null,
          "ratio",
          input.ledgerSource,
          {
            note:
              decided.length > 0
                ? `${credits.length} credited of ${decided.length} closed at-risk windows`
                : "No at-risk window closed in this period",
          },
        ),
        metric(
          "time_to_first_decisive_action",
          median(
            credits
              .map((c) => c.hoursToFirstDecisiveAction)
              .filter((h): h is number => h != null),
          ),
          "hours",
          input.ledgerSource,
          { lowerIsBetter: true },
        ),
        metric(
          "repeat_contact_rate",
          pack?.repeatContactRate ?? null,
          "ratio",
          pack?.mode ?? "sample",
          {
            lowerIsBetter: true,
            note: pack?.repeatContactIsFloor
              ? "Floor — the pack returns only the worst issues by contact count"
              : null,
          },
        ),
        metric("sla_attainment", desk?.attainment ?? null, "ratio", input.ledgerSource, {
          note:
            desk == null
              ? "No desk issues in this period"
              : desk.breachesAvoidedByPause > 0
                ? `${desk.breachesAvoidedByPause} breach(es) avoided by a defect pause`
                : SLA_ROW_NOTE,
        }),
        metric(
          "book_sla_attainment",
          pack?.slaAttainment ?? null,
          "ratio",
          pack?.mode ?? "sample",
          {
            note: pack ? `${pack.slaBreached} breached spine issues, unpaused` : null,
          },
        ),
        metric("defects_absorbed", absorbedCount, "count", input.ledgerSource, {
          note: "Rework this pod cleaned up for origination — credit, not blame",
        }),
        metric("record_completeness", completeness, "ratio", input.ledgerSource, {
          note: "Share of decisive actions carrying an evidence reference. Work with no record is unpaid.",
        }),
      ],
    };
  });
}

function countUncredited(
  projection: SavesProjection,
  podId: ServicePodId,
  windowsByPod: Map<ServicePodId | null, AtRiskWindow[]>,
): number {
  const podWindowIds = new Set((windowsByPod.get(podId) ?? []).map((w) => w.id));
  return projection.skipped.filter(
    (s) =>
      podWindowIds.has(s.windowId) &&
      (s.reason === "no_decisive_action" ||
        s.reason === "no_human_actor" ||
        s.reason === "no_evidence"),
  ).length;
}

/**
 * Record completeness, measured as the share of decisive human actions that
 * point at something in the ledger.
 *
 * The plan defines this as the share of account communications present in the
 * spine, which nothing currently emits — there is no denominator for
 * conversations that happened in a personal inbox, which is precisely the
 * problem. This proxy measures the same behavior from the paid side: an action
 * with no evidence pointer earns nothing, so the number climbs exactly when
 * work moves onto the record.
 */
function evidenceCompletenessByPod(
  windows: AtRiskWindow[],
  events: RetentionEvent[],
): Map<ServicePodId, number | null> {
  const podByWindow = new Map(windows.map((w) => [w.id, podForLane(w.lane)]));
  const tally = new Map<ServicePodId, { total: number; withEvidence: number }>();
  for (const e of events) {
    if (!isDecisive(e.kind) || e.actorKind !== "human") continue;
    const pod = podByWindow.get(e.windowId);
    if (!pod) continue;
    const row = tally.get(pod) ?? { total: 0, withEvidence: 0 };
    row.total += 1;
    if (e.evidenceRef) row.withEvidence += 1;
    tally.set(pod, row);
  }
  const out = new Map<ServicePodId, number | null>();
  for (const pod of SERVICE_PODS) {
    const row = tally.get(pod.id);
    out.set(pod.id, row && row.total > 0 ? row.withEvidence / row.total : null);
  }
  return out;
}

// ——— Per person ———

/**
 * Spine company ids and desk account ids are the same key wearing a prefix.
 * Exported because the personal view's repeat-contact column can only exist
 * where an owned account joins to a pack row.
 */
export function accountIdForCompanyId(companyId: string | number): string {
  return `acct-h-${companyId}`;
}

export function buildPersonScorecards(input: ScorecardInput): PersonScorecard[] {
  const humans = input.directory.filter((a) => a.kind === "human");
  const ownedByAgent = new Map<string, Set<string>>();
  for (const a of input.assignments) {
    if (!a.ownerAgentId || a.endedAt) continue;
    const set = ownedByAgent.get(a.ownerAgentId) ?? new Set<string>();
    set.add(a.accountId);
    ownedByAgent.set(a.ownerAgentId, set);
  }

  const decisiveByAgent = new Map<string, { total: number; withEvidence: number }>();
  for (const e of input.events) {
    if (!isDecisive(e.kind) || e.actorKind !== "human" || !e.actorAgentId) continue;
    const row = decisiveByAgent.get(e.actorAgentId) ?? { total: 0, withEvidence: 0 };
    row.total += 1;
    if (e.evidenceRef) row.withEvidence += 1;
    decisiveByAgent.set(e.actorAgentId, row);
  }

  const rows: PersonScorecard[] = [];
  for (const agent of humans) {
    const credits = input.projection.credits.filter((c) =>
      c.attributions.some((a) => a.agentId === agent.id),
    );
    const owned = ownedByAgent.get(agent.id) ?? new Set<string>();
    const decisive = decisiveByAgent.get(agent.id) ?? { total: 0, withEvidence: 0 };
    const absorbed = input.defects.filter(
      (d) => d.absorbingAgentId === agent.id && isActionable(d.state),
    ).length;

    // Skip people with no footprint at all rather than printing a row of
    // dashes — an empty row reads as a bad month, not as no involvement.
    if (
      credits.length === 0 &&
      owned.size === 0 &&
      decisive.total === 0 &&
      absorbed === 0
    ) {
      continue;
    }

    const retainedCents = Math.round(
      credits.reduce((n, c) => n + c.retainedCommissionCents * shareFor(c, agent.id), 0),
    );
    const ownedWindows = input.windows.filter(
      (w) => owned.has(w.accountId) && w.outcome !== "open",
    );
    const ownedSaves = ownedWindows.filter(
      (w) => w.outcome === "saved" || w.outcome === "rewritten",
    ).length;
    const firstActions = credits
      .filter((c) => firstDecisiveAgent(c, input.events) === agent.id)
      .map((c) => c.hoursToFirstDecisiveAction)
      .filter((h): h is number => h != null);

    rows.push({
      agentId: agent.id,
      displayName: agent.displayName,
      email: agent.email,
      podId: agent.podId,
      podLabel: agent.podId ? POD_BY_ID[agent.podId].label : null,
      ownedAccounts: owned.size,
      decisiveActions: decisive.total,
      savesContributed: credits.length,
      ownerFloorOnly: credits.filter((c) =>
        c.attributions.some((a) => a.agentId === agent.id && a.viaOwnerFloor && a.weight === 0),
      ).length,
      retainedCommissionCents: retainedCents,
      metrics: [
        metric("retained_commission", retainedCents, "cents", input.ledgerSource, {
          note: "Your weighted share, after the owner floor",
        }),
        metric(
          "save_rate",
          ownedWindows.length > 0 ? ownedSaves / ownedWindows.length : null,
          "ratio",
          input.ledgerSource,
          {
            note:
              ownedWindows.length > 0
                ? `${ownedSaves} of ${ownedWindows.length} closed windows on your book`
                : "No at-risk window closed on your book",
          },
        ),
        metric(
          "time_to_first_decisive_action",
          median(firstActions),
          "hours",
          input.ledgerSource,
          {
            lowerIsBetter: true,
            note: firstActions.length
              ? `${firstActions.length} window(s) where you moved first`
              : "You were not first to act on a credited save",
          },
        ),
        metric("defects_absorbed", absorbed, "count", input.ledgerSource, {
          note: "Origination rework you cleaned up",
        }),
        metric(
          "record_completeness",
          decisive.total > 0 ? decisive.withEvidence / decisive.total : null,
          "ratio",
          input.ledgerSource,
          {
            note:
              decisive.total > 0
                ? `${decisive.withEvidence} of ${decisive.total} decisive actions carry evidence`
                : "No decisive actions recorded this period",
          },
        ),
      ],
    });
  }

  return rows.sort((a, b) => b.retainedCommissionCents - a.retainedCommissionCents);
}

function shareFor(credit: SaveCredit, agentId: string): number {
  return credit.attributions.find((a) => a.agentId === agentId)?.share ?? 0;
}

function firstDecisiveAgent(credit: SaveCredit, events: RetentionEvent[]): string | null {
  const inWindow = events
    .filter(
      (e) =>
        e.windowId === credit.windowId &&
        isDecisive(e.kind) &&
        e.actorKind === "human" &&
        e.actorAgentId &&
        e.evidenceRef,
    )
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return inWindow[0]?.actorAgentId ?? null;
}

// ——— Formatting, shared by every surface that prints these ———

export function formatMetric(m: ScorecardMetric): string {
  if (m.value == null) return "—";
  switch (m.unit) {
    case "cents":
      return formatCents(m.value);
    case "ratio":
      return `${(m.value * 100).toFixed(1)}%`;
    case "hours":
      return `${m.value.toFixed(1)}h`;
    case "count":
      return String(m.value);
  }
}

export { formatCents } from "./commission";

export const SOURCE_LABELS: Record<MetricSource, string> = {
  live: "Live",
  snapshot: "Snapshot",
  sample: "Sample",
};

// ——— helpers ———

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k) ?? [];
    list.push(item);
    out.set(k, list);
  }
  return out;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
