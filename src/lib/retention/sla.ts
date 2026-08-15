/**
 * SLA attainment with defect pauses.
 *
 * Without this, service is punished twice for an origination defect: once for
 * doing the rework, and again for the breach the rework caused. That single
 * asymmetry matters more for morale than any dollar in the incentive plan, so
 * the pause is part of the scorecard rather than a footnote to it.
 *
 * The pause is also the reason the ledger cannot be gamed from the service
 * side. A raised defect pauses the clock only provisionally; if adjudication
 * rejects it, the excluded time comes straight back and the original due date
 * stands. Raising a bogus defect to dodge a breach buys nothing.
 */

import { LANE_CLOCK_TARGET_MINUTES } from "@/lib/priority/clocks";
import type { ServiceLaneId } from "@/lib/types";
import { isActionable, type OriginationDefect } from "./defects";
import { podForLane, type ServicePodId } from "./pods";

export interface SlaIssue {
  issueId: string;
  accountId: string;
  lane: ServiceLaneId;
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  openedAt: string;
  /** Carrier or policy deadline when one exists; otherwise derived from the lane clock. */
  slaDueAt: string | null;
  resolvedAt: string | null;
}

export type SlaAdjustmentKind = "none" | "paused" | "reset";

export interface SlaAdjustment {
  issueId: string;
  kind: SlaAdjustmentKind;
  /** Due date the pod is actually measured against. */
  effectiveDueAt: string;
  /** Hours removed from this issue's clock. Reported, not hidden. */
  excludedHours: number;
  basis: string;
}

export function laneDueAt(issue: SlaIssue): string {
  if (issue.slaDueAt) return issue.slaDueAt;
  const target = LANE_CLOCK_TARGET_MINUTES[issue.lane];
  return new Date(Date.parse(issue.openedAt) + target * 60_000).toISOString();
}

/**
 * Apply a defect to one issue's clock.
 *
 * A confirmed defect resets the clock at adjudication: the ticket exists
 * because of how the deal was sold, so the pod's obligation starts when the
 * defect is settled, not when the customer first called.
 */
export function adjustSlaForDefect(
  issue: SlaIssue,
  defect: OriginationDefect | null,
  now: Date = new Date(),
): SlaAdjustment {
  const baseDue = laneDueAt(issue);
  if (!defect) {
    return {
      issueId: issue.issueId,
      kind: "none",
      effectiveDueAt: baseDue,
      excludedHours: 0,
      basis: "No defect on this issue",
    };
  }

  if (isActionable(defect.state)) {
    const settledAt = defect.adjudicatedAt ?? defect.raisedAt;
    const target = LANE_CLOCK_TARGET_MINUTES[issue.lane];
    const effectiveDueAt = new Date(
      Date.parse(settledAt) + target * 60_000,
    ).toISOString();
    return {
      issueId: issue.issueId,
      kind: "reset",
      effectiveDueAt,
      excludedHours: hoursBetween(baseDue, effectiveDueAt),
      basis: `Confirmed ${defect.kind} — clock restarts at adjudication`,
    };
  }

  if (defect.state === "rejected" || defect.state === "withdrawn") {
    return {
      issueId: issue.issueId,
      kind: "none",
      effectiveDueAt: baseDue,
      excludedHours: 0,
      basis: `Defect ${defect.state} — excluded time returned to the clock`,
    };
  }

  // Proposed, raised, or disputed: pause provisionally while adjudication runs.
  const pausedFrom = defect.raisedAt;
  const pausedTo = now.toISOString();
  const paused = Math.max(0, hoursBetween(pausedFrom, pausedTo));
  return {
    issueId: issue.issueId,
    kind: "paused",
    effectiveDueAt: new Date(
      Date.parse(baseDue) + paused * 3_600_000,
    ).toISOString(),
    excludedHours: paused,
    basis: `Defect ${defect.state} — clock paused pending adjudication`,
  };
}

export function isBreached(
  issue: SlaIssue,
  adjustment: SlaAdjustment,
  now: Date = new Date(),
): boolean {
  const measuredAt = issue.resolvedAt ?? now.toISOString();
  return measuredAt > adjustment.effectiveDueAt;
}

export interface PodSlaAttainment {
  podId: ServicePodId | null;
  total: number;
  met: number;
  breached: number;
  /** Null rather than 1 when the pod had no issues — an empty pod is not perfect. */
  attainment: number | null;
  /** How much of the pod's result is explained by defects it absorbed. */
  defectsAbsorbed: number;
  excludedHours: number;
  /** Breaches the pod would have carried without the defect pause. */
  breachesAvoidedByPause: number;
}

/**
 * Pod attainment, computed after pauses. `breachesAvoidedByPause` is published
 * alongside the rate on purpose: a pod whose number only looks good because
 * sales handed it a bad month should be readable as exactly that.
 */
export function computePodSlaAttainment(
  issues: SlaIssue[],
  defects: OriginationDefect[],
  now: Date = new Date(),
): PodSlaAttainment[] {
  const defectByIssue = new Map(defects.map((d) => [d.issueId, d]));
  const rows = new Map<string, PodSlaAttainment>();

  for (const issue of issues) {
    const podId = podForLane(issue.lane);
    const key = podId ?? "unassigned";
    const row =
      rows.get(key) ??
      ({
        podId,
        total: 0,
        met: 0,
        breached: 0,
        attainment: null,
        defectsAbsorbed: 0,
        excludedHours: 0,
        breachesAvoidedByPause: 0,
      } satisfies PodSlaAttainment);

    const defect = defectByIssue.get(issue.issueId) ?? null;
    const adjustment = adjustSlaForDefect(issue, defect, now);
    const breached = isBreached(issue, adjustment, now);
    const breachedUnadjusted = isBreached(
      issue,
      {
        issueId: issue.issueId,
        kind: "none",
        effectiveDueAt: laneDueAt(issue),
        excludedHours: 0,
        basis: "unadjusted",
      },
      now,
    );

    row.total += 1;
    if (breached) row.breached += 1;
    else row.met += 1;
    row.excludedHours += adjustment.excludedHours;
    if (defect && isActionable(defect.state)) row.defectsAbsorbed += 1;
    if (breachedUnadjusted && !breached) row.breachesAvoidedByPause += 1;
    rows.set(key, row);
  }

  for (const row of rows.values()) {
    row.attainment = row.total > 0 ? Math.round((row.met / row.total) * 1000) / 1000 : null;
    row.excludedHours = Math.round(row.excludedHours * 10) / 10;
  }

  return [...rows.values()].sort((a, b) => b.total - a.total);
}

function hoursBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return (to - from) / 3_600_000;
}
