/**
 * Lane pods.
 *
 * Service already splits by lane in the spine, so the incentive uses those
 * seams rather than inventing new ones. Each pod is paid on a different
 * economic verb, because each lane means something different to the business:
 * the cancellations desk keeps money, the binding desk completes money, and
 * the COI desk sells speed.
 *
 * Pool weights are relative shares of one period's variable pool. They are
 * shaped by where the money actually leaks, not by headcount — which is why
 * policy delivery, a large queue by volume, carries the smallest pool. That
 * lane is the automation target; paying humans well there entrenches work that
 * should disappear.
 */

import type { ServiceLaneId } from "@/lib/types";

export type ServicePodId =
  | "cancellations_payments"
  | "onboarding_binding"
  | "coi"
  | "endorsements"
  | "subjectivities_docusign"
  | "policy_delivery";

/** What the pod is actually paid for. Drives which metric is the headline. */
export type EconomicVerb =
  | "money_kept"
  | "money_completed"
  | "speed_first_pass"
  | "accuracy_cycle_time"
  | "decay_clearance"
  | "automation_target";

export const ECONOMIC_VERB_LABELS: Record<EconomicVerb, string> = {
  money_kept: "Money Kept",
  money_completed: "Money Completed",
  speed_first_pass: "Speed And First-Pass Correctness",
  accuracy_cycle_time: "First-Pass Accuracy And Cycle Time",
  decay_clearance: "Clearance Against The Decay Curve",
  automation_target: "Automation Target",
};

export interface ServicePod {
  id: ServicePodId;
  label: string;
  lanes: ServiceLaneId[];
  verb: EconomicVerb;
  /** Share of the period's variable pool. Sums to 1 across pods. */
  poolWeight: number;
  /** The one number this pod is judged on. */
  headlineMetric: string;
  note: string;
}

export const SERVICE_PODS: ServicePod[] = [
  {
    id: "cancellations_payments",
    label: "Cancellations And Payments",
    lanes: ["pending_cancels"],
    verb: "money_kept",
    poolWeight: 0.4,
    headlineMetric: "Retained Commission",
    note: "Largest pool by far — this is the lane where sold revenue stops being revenue.",
  },
  {
    id: "onboarding_binding",
    label: "Onboarding And Binding",
    lanes: ["pending_orders", "instant_binds"],
    verb: "money_completed",
    poolWeight: 0.22,
    headlineMetric: "Bind Completion In Window",
    note: "Money held without a bound policy is not earned revenue. Paid on completion, not on tasks touched.",
  },
  {
    id: "coi",
    label: "COI",
    lanes: ["coi"],
    verb: "speed_first_pass",
    poolWeight: 0.14,
    headlineMetric: "Time To Issue · Issued Without Correction",
    note: "The one email a client reads, and it gates their ability to get paid. Two metrics only.",
  },
  {
    id: "endorsements",
    label: "Endorsements",
    lanes: ["post_sales"],
    verb: "accuracy_cycle_time",
    poolWeight: 0.12,
    headlineMetric: "First-Pass Accuracy",
    note: "Corrections count against the pod that issued them.",
  },
  {
    id: "subjectivities_docusign",
    label: "Subjectivities And DocuSign",
    lanes: ["subjectivities"],
    verb: "decay_clearance",
    poolWeight: 0.09,
    headlineMetric: "Clearance Inside 72 Hours",
    note: "Value decays fast and recovery is near zero past two weeks, so early clearance is worth a multiple of late clearance.",
  },
  {
    id: "policy_delivery",
    label: "Policy Delivery",
    lanes: ["active_service"],
    verb: "automation_target",
    poolWeight: 0.03,
    headlineMetric: "Delivered Without Rework",
    note: "Smallest pool on purpose. High volume, low value per unit, and the right end state is no queue at all.",
  },
];

export const POD_BY_ID: Record<ServicePodId, ServicePod> = Object.fromEntries(
  SERVICE_PODS.map((p) => [p.id, p]),
) as Record<ServicePodId, ServicePod>;

const LANE_TO_POD = new Map<ServiceLaneId, ServicePodId>(
  SERVICE_PODS.flatMap((p) => p.lanes.map((l) => [l, p.id] as const)),
);

/**
 * Communications resolves to no pod on purpose. It is the front door for every
 * lane, not a pool of its own — an inbound call is credited to whichever pod's
 * lane the work lands in once it is triaged. Giving it a pool would pay the
 * desk twice for the same ticket.
 */
export function podForLane(lane: ServiceLaneId): ServicePodId | null {
  return LANE_TO_POD.get(lane) ?? null;
}

export function poolCentsForPod(podId: ServicePodId, periodPoolCents: number): number {
  return Math.round(periodPoolCents * POD_BY_ID[podId].poolWeight);
}

/** Guard against a weight edit that quietly under- or over-allocates the pool. */
export function assertPoolWeightsSumToOne(): void {
  const sum = SERVICE_PODS.reduce((n, p) => n + p.poolWeight, 0);
  if (Math.abs(sum - 1) > 0.0001) {
    throw new Error(`Pod pool weights sum to ${sum.toFixed(4)}, expected 1`);
  }
}
