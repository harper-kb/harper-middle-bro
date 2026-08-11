import type { WorkItem, WorkItemPriorityReason } from "@/lib/types";
import type { AgentStatusBundle, DeskAgentLane, WorkItemAgentView } from "@/lib/agent-status";
import type { ServiceActivationGate } from "@/lib/service-activation";
import type { GatedRecommendation } from "./recommendations";
import type { SpineProjection } from "./spine";

/** True while a park wake time is still in the future. Expired parks are outstanding again. */
export function isActivelyParked(
  item: Pick<WorkItem, "parkedUntil">,
  now: Date = new Date(),
): boolean {
  return (
    item.parkedUntil != null && Date.parse(item.parkedUntil) > now.getTime()
  );
}

export function outstandingWorkItems(
  items: WorkItem[],
  excludeIds: Iterable<string> = [],
  now: Date = new Date(),
): WorkItem[] {
  const excluded = new Set(excludeIds);
  return items.filter(
    (item) => !excluded.has(item.id) && !isActivelyParked(item, now),
  );
}

export type PersonalStrip = {
  assigned: WorkItem[];
  parked: WorkItem[];
  followUps: WorkItem[];
  handoffs: WorkItem[];
  doneToday: {
    id: string;
    title: string;
    accountName: string;
    completedAt: string;
  }[];
};

export type DeskBundle = {
  queue: WorkItem[];
  /** Open session queue excluding completed/parked items. */
  outstandingCount: number;
  next: WorkItem | null;
  whyNext: WorkItemPriorityReason[];
  strip: PersonalStrip;
  mode: "sample" | "live";
  modeReason: string;
  activation: {
    spine: ServiceActivationGate;
    agent: ServiceActivationGate;
  };
  spine: SpineProjection;
  /** Service Agent run-status presence (live or clearly labeled sample). */
  agent: AgentStatusBundle;
  /** Per-work-item agent classification (agent-working vs human-action). */
  agentViews: Record<string, WorkItemAgentView>;
  /** Desk-level lane rollup for the agent presence banner. */
  deskLaneCounts: Record<DeskAgentLane, number>;
  /** AI-native next-step recommendations per work item, capability-gated. */
  recommendations: Record<string, GatedRecommendation[]>;
};
