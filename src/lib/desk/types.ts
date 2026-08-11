import type { WorkItem, WorkItemPriorityReason } from "@/lib/types";
import type { AgentStatusBundle, DeskAgentLane, WorkItemAgentView } from "@/lib/agent-status";
import type { ServiceActivationGate } from "@/lib/service-activation";
import type { GatedRecommendation } from "./recommendations";
import type { SpineProjection } from "./spine";

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
