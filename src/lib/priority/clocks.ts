/**
 * Lane clocks (minutes to breach) — inspired by HTA ticket-priority runbook
 * clocks. Cancellation effective dates override these generic clocks when set
 * on the WorkItem.
 */

import type { ServiceLaneId, WorkItemClock, WorkItemClockKind } from "@/lib/types";

/** Resolve-by targets in minutes per home lane (stated Step Bro defaults). */
export const LANE_CLOCK_TARGET_MINUTES: Record<ServiceLaneId, number> = {
  pending_orders: 240,
  active_service: 1440,
  pending_cancels: 240,
  coi: 120,
  subjectivities: 2880,
  instant_binds: 240,
  communications: 120,
};

export function buildLaneClock(opts: {
  lane: ServiceLaneId;
  createdAt: string;
  cancellationEffectiveAt?: string | null;
  now?: Date;
}): WorkItemClock {
  const now = opts.now ?? new Date();
  if (opts.cancellationEffectiveAt) {
    const at = opts.cancellationEffectiveAt;
    const ms = Date.parse(at) - now.getTime();
    return {
      kind: "cancellation_effective",
      at,
      label: formatDeadlineLabel(at, "Cancels"),
      breached: ms < 0,
    };
  }
  const created = Date.parse(opts.createdAt);
  const targetMin = LANE_CLOCK_TARGET_MINUTES[opts.lane];
  const dueMs = created + targetMin * 60_000;
  const kind: WorkItemClockKind =
    opts.lane === "pending_orders" || opts.lane === "instant_binds"
      ? "bind_deadline"
      : "sla";
  return {
    kind,
    at: new Date(dueMs).toISOString(),
    label: `${Math.round(targetMin / 60)}h clock`,
    breached: now.getTime() > dueMs,
  };
}

function formatDeadlineLabel(iso: string, prefix: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return prefix;
  return `${prefix} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
