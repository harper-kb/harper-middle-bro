/**
 * Periods, shadow mode, and the gate between a number and a paycheck.
 *
 * The scorecard runs for one full period with no money attached. That is not
 * caution for its own sake: this team has already been burned by metrics that
 * disagreed across dashboards, and a comp plan that inherits a definition bug
 * is a comp plan nobody believes again. So shadow mode is enforced in code
 * rather than remembered in a meeting — `payoutFor` refuses to return money
 * while a period is in shadow, and a period cannot leave shadow until every
 * dispute raised against it has been settled.
 *
 * The dispute log is the other half. Publishing numbers and inviting argument
 * is the point of the shadow period; a dispute that was upheld and silently
 * dropped teaches people that arguing is pointless.
 */

import type { ServicePodId } from "./pods";
import { poolCentsForPod } from "./pods";
import type { MetricSource } from "./scorecard";

export type PeriodState =
  /** Numbers published, no compensation attached. */
  | "shadow"
  /** Shadow complete, disputes settled, pay attached. */
  | "attached"
  /** Closed and paid. */
  | "closed";

export const PERIOD_STATE_LABELS: Record<PeriodState, string> = {
  shadow: "Shadow — No Pay Attached",
  attached: "Pay Attached",
  closed: "Closed",
};

export interface ScorecardPeriod {
  id: string;
  label: string;
  from: string;
  to: string;
  state: PeriodState;
  /** Total variable pool for the period, split across pods by weight. */
  poolCents: number;
  publishedAt: string | null;
}

export type DisputeSubject = "pod" | "person" | "window" | "defect" | "metric";

export type DisputeState = "open" | "upheld" | "rejected" | "withdrawn";

export const DISPUTE_STATE_LABELS: Record<DisputeState, string> = {
  open: "Open",
  upheld: "Upheld",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export interface ScorecardDispute {
  id: string;
  periodId: string;
  subject: DisputeSubject;
  /** Pod id, agent id, window id, defect id, or metric key. */
  subjectId: string;
  raisedBy: string;
  raisedAt: string;
  claim: string;
  state: DisputeState;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  /** Whether upholding it changed a number, as opposed to only a definition. */
  correctionApplied: boolean;
}

export function isSettled(dispute: ScorecardDispute): boolean {
  return dispute.state !== "open";
}

/**
 * Whether the period may leave shadow.
 *
 * Three conditions, all of them things that have gone wrong here before: the
 * period has to be over, every dispute has to be settled, and no metric that
 * feeds pay may still be reading off sample data. The last one is the reason
 * every metric carries its own source label — without it this check would have
 * nothing to inspect.
 */
export interface ReadinessCheck {
  ready: boolean;
  blockers: string[];
  disputesOpen: number;
  disputesUpheld: number;
  correctionsApplied: number;
}

export function periodReadiness(
  period: ScorecardPeriod,
  disputes: ScorecardDispute[],
  metricSources: { key: string; source: MetricSource }[],
  now: Date = new Date(),
): ReadinessCheck {
  const mine = disputes.filter((d) => d.periodId === period.id);
  const open = mine.filter((d) => !isSettled(d));
  const blockers: string[] = [];

  if (now.toISOString() < period.to) {
    blockers.push(
      `Period closes ${period.to.slice(0, 10)} — attach pay only after a full period`,
    );
  }
  if (!period.publishedAt) {
    blockers.push("Numbers were never published — nobody has had a chance to argue with them");
  }
  if (open.length > 0) {
    blockers.push(`${open.length} dispute(s) still open`);
  }
  // Count distinct measures, not cells. Six measures reading sample across six
  // pods is one problem stated six times, and "36 metrics" overstates it.
  const modeled = [
    ...new Set(metricSources.filter((m) => m.source === "sample").map((m) => m.key)),
  ];
  if (modeled.length > 0) {
    blockers.push(
      `${modeled.length} measure(s) still sample-labeled: ${modeled.join(", ")}`,
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    disputesOpen: open.length,
    disputesUpheld: mine.filter((d) => d.state === "upheld").length,
    correctionsApplied: mine.filter((d) => d.correctionApplied).length,
  };
}

export class ShadowPeriodError extends Error {
  constructor(readonly periodId: string) {
    super(
      `Period ${periodId} is in shadow mode — publish the numbers and settle disputes before attaching pay`,
    );
    this.name = "ShadowPeriodError";
  }
}

/**
 * The pod's pool in money, or nothing at all.
 *
 * In shadow the answer is always zero with the modeled figure alongside it, so
 * a board can show people what they would have earned without any code path
 * being able to turn that into a payment.
 */
export interface PodPayout {
  podId: ServicePodId;
  /** What the pod would earn if pay were attached. Always populated. */
  modeledCents: number;
  /** What is actually owed. Zero in shadow, by construction. */
  payableCents: number;
  state: PeriodState;
}

export function payoutFor(period: ScorecardPeriod, podId: ServicePodId): PodPayout {
  const modeled = poolCentsForPod(podId, period.poolCents);
  return {
    podId,
    modeledCents: modeled,
    payableCents: period.state === "shadow" ? 0 : modeled,
    state: period.state,
  };
}

/** Hard gate for anything that would actually move money. */
export function assertPayable(period: ScorecardPeriod): void {
  if (period.state === "shadow") throw new ShadowPeriodError(period.id);
}

export function attachPay(
  period: ScorecardPeriod,
  readiness: ReadinessCheck,
): ScorecardPeriod {
  if (!readiness.ready) {
    throw new Error(
      `Cannot attach pay to ${period.id}: ${readiness.blockers.join("; ")}`,
    );
  }
  return { ...period, state: "attached" };
}

/** The current period, monthly, keyed the way the desk already talks about time. */
export function currentPeriod(
  poolCents: number,
  now: Date = new Date(),
  state: PeriodState = "shadow",
): ScorecardPeriod {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const label = from.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    id: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`,
    label,
    from: from.toISOString(),
    to: to.toISOString(),
    state,
    poolCents,
    publishedAt: null,
  };
}
