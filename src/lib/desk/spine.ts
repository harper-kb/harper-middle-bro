import { explainWhyNext, pickNextWorkItem } from "@/lib/priority";
import type { WorkItem, WorkItemPriorityReason } from "@/lib/types";

export type SpineProjection = {
  activation: "active" | "ready_off" | "not_configured";
  drivesDesk: boolean;
  proposedNextId: string | null;
  whyNext: WorkItemPriorityReason[];
  laneClock: string | null;
  urgency: string | null;
  statusLabel: string;
};

/**
 * Build the Service Spine's next-action projection without necessarily
 * applying it. While activation is off, the projection is visible for parity
 * and review but `drivesDesk` remains false, so it cannot reorder or
 * auto-advance an operator's Desk.
 */
export function projectSpineNext(
  items: WorkItem[],
  activation: SpineProjection["activation"],
): SpineProjection {
  const proposed = pickNextWorkItem(items);
  const active = activation === "active";
  return {
    activation,
    drivesDesk: active,
    proposedNextId: proposed?.id ?? null,
    whyNext: proposed ? explainWhyNext(proposed) : [],
    laneClock: proposed?.clock.label ?? null,
    urgency: proposed ? `Tier ${proposed.urgencyTier.toUpperCase()}` : null,
    statusLabel:
      activation === "active"
        ? "Service Spine active"
        : activation === "ready_off"
          ? "Service Spine available · not activated"
          : "Service Spine plumbing installed · credentials required",
  };
}
