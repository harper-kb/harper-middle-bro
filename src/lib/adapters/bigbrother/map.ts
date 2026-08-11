import type {
  ServiceLaneId,
  UrgencyTier,
  WorkItem,
} from "@/lib/types";
import type { BigBrotherLaneCompany, BigBrotherLaneId } from "./client";

/** BigBrother's four swim lanes → Step Bro home lanes. */
export const BB_LANE_TO_SERVICE: Record<BigBrotherLaneId, ServiceLaneId> = {
  pending_orders: "pending_orders",
  active_service: "active_service",
  pending_cancellation: "pending_cancels",
  post_sales: "post_sales",
};

export const SERVICE_TO_BB_LANE: Partial<Record<ServiceLaneId, BigBrotherLaneId>> = {
  pending_orders: "pending_orders",
  active_service: "active_service",
  pending_cancels: "pending_cancellation",
  post_sales: "post_sales",
};

export function resolveUrgencyTier(row: BigBrotherLaneCompany): UrgencyTier {
  const override = row.urgency_override?.tier?.toUpperCase();
  if (override === "A" || override === "B" || override === "C") return override;
  if (override === "NONE") return "none";
  const tier = row.urgency?.tier?.toUpperCase();
  if (tier === "A" || tier === "B" || tier === "C") return tier;
  if (tier === "NONE") return "none";
  return "none";
}

export function mapCompanyToWorkItem(row: BigBrotherLaneCompany): WorkItem {
  const homeLane = BB_LANE_TO_SERVICE[row.lane];
  const tier = resolveUrgencyTier(row);
  const actionRequired =
    row.dominant_action_state === "action_required" ||
    Boolean(row.gate_label);
  const title =
    row.stage_summary?.trim() ||
    row.headline_stage?.trim() ||
    row.gate_label?.trim() ||
    "Open service work";
  const daysStuck = Math.max(0, row.days_stuck ?? 0);
  const now = new Date();
  const createdAt = new Date(now.getTime() - daysStuck * 86_400_000).toISOString();

  return {
    id: `bb:${row.lane}:${row.company_id}:${row.primary_service_log_id ?? "company"}`,
    externalId: row.primary_service_log_id ?? row.company_id,
    homeLane,
    accountId: row.company_id,
    accountName: row.company_name,
    title,
    summary: [
      row.gate_label,
      row.open_ticket_count ? `${row.open_ticket_count} open ticket(s)` : null,
      daysStuck ? `${daysStuck}d stuck` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    owner: {
      operatorId: null,
      displayName: row.service_owner,
      team: null,
    },
    urgencyTier: tier,
    urgencyScore:
      typeof row.urgency?.score === "number" ? row.urgency.score : null,
    isOnFire: row.is_on_fire === true,
    actionRequired,
    clock: {
      kind: homeLane === "pending_cancels" ? "cancellation_effective" : "sla",
      at: null,
      label: daysStuck ? `${daysStuck}d in lane` : "Fresh",
      breached: daysStuck >= 3,
    },
    blocker: row.gate_label
      ? { code: "gate", label: row.gate_label, capabilityId: null }
      : null,
    nextActionLabel: actionRequired ? "Open Account" : "Review",
    priorityReasons: [
      ...(row.is_on_fire === true
        ? [{ code: "fire_flag" as const, label: "On Fire" }]
        : []),
      ...(row.urgency_override?.tier
        ? [
            {
              code: "operator_override" as const,
              label: "Operator Override",
              detail: String(row.urgency_override.tier),
            },
          ]
        : []),
      { code: "urgency_tier" as const, label: `Tier ${tier.toUpperCase()}` },
      ...(actionRequired
        ? [{ code: "action_required" as const, label: "Action Required" }]
        : []),
      { code: "age" as const, label: `${daysStuck}d stuck` },
    ],
    createdAt,
    updatedAt: now.toISOString(),
    parkedUntil: null,
    parkReason: null,
  };
}
