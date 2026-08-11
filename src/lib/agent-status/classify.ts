/**
 * Desk agent classification — projects each work item into ONE lane the
 * operator can act on: is the Service Agent working it, is it waiting on the
 * human, is the agent blocked (a system door), or is it plain human action?
 *
 * This is the projection the AI-native Desk needs: it separates "the agent has
 * this handled / will wake you" from "you must act now" so operators trust the
 * queue instead of re-checking everything. Pure + serializable — safe to import
 * from client and server.
 */

import type { WorkItem } from "@/lib/types";
import type { AgentRunStatus, HumanTaskProjection } from "./projection";

export type DeskAgentLane =
  | "agent_working"
  | "waiting_human"
  | "agent_blocked"
  | "needs_human"
  | "human_action";

export const DESK_LANE_LABELS: Record<DeskAgentLane, string> = {
  agent_working: "Agent Working",
  waiting_human: "Waiting On You",
  agent_blocked: "Agent Blocked",
  needs_human: "Needs Human",
  human_action: "Your Action",
};

/** Tone hint for badges — maps to UI colors without importing UI. */
export const DESK_LANE_TONE: Record<DeskAgentLane, "run" | "wait" | "block" | "human"> = {
  agent_working: "run",
  waiting_human: "wait",
  agent_blocked: "block",
  needs_human: "block",
  human_action: "human",
};

export interface WorkItemAgentView {
  workItemId: string;
  lane: DeskAgentLane;
  label: string;
  /** Short reason line — blocked reason, reminder, or the human next step. */
  detail: string | null;
  /** Agent run status when a Service Agent run exists for this item. */
  runStatus: AgentRunStatus | null;
  reminderAt: string | null;
}

function laneFromRunStatus(status: AgentRunStatus): DeskAgentLane {
  switch (status) {
    case "running":
      return "agent_working";
    case "waiting_human":
      return "waiting_human";
    case "blocked":
      return "agent_blocked";
    case "failed":
      return "needs_human";
    case "succeeded":
    case "idle":
    default:
      return "human_action";
  }
}

/**
 * Classify a work item using its Service Agent run (when present). Falls back to
 * the item's own blocker/action signals when no agent run is attached.
 */
export function classifyWorkItem(
  item: Pick<WorkItem, "id" | "blocker" | "nextActionLabel" | "actionRequired">,
  run: HumanTaskProjection | null | undefined,
  opts?: { agentActive?: boolean },
): WorkItemAgentView {
  if (opts?.agentActive === false) {
    return {
      workItemId: item.id,
      lane: "human_action",
      label: DESK_LANE_LABELS.human_action,
      detail: item.blocker?.label ?? item.nextActionLabel,
      runStatus: null,
      reminderAt: null,
    };
  }
  if (run) {
    const lane = laneFromRunStatus(run.status);
    const detail =
      lane === "agent_blocked" || lane === "needs_human"
        ? (run.blockedReason ?? item.blocker?.label ?? "Blocked — needs a human")
        : lane === "waiting_human"
          ? `Agent prepared work — ${item.nextActionLabel}`
          : lane === "agent_working"
            ? (run.reminderAt ? "Agent running — will wake you" : "Agent running")
            : null;
    return {
      workItemId: item.id,
      lane,
      label: DESK_LANE_LABELS[lane],
      detail,
      runStatus: run.status,
      reminderAt: run.reminderAt,
    };
  }

  // No agent run: infer from the item. A blocker with a capability gate is a
  // system door (agent-blocked); otherwise it's a human action to work now.
  if (item.blocker) {
    const systemDoor = item.blocker.capabilityId != null;
    const lane: DeskAgentLane = systemDoor ? "agent_blocked" : "human_action";
    return {
      workItemId: item.id,
      lane,
      label: DESK_LANE_LABELS[lane],
      detail: item.blocker.label,
      runStatus: null,
      reminderAt: null,
    };
  }

  return {
    workItemId: item.id,
    lane: "human_action",
    label: DESK_LANE_LABELS.human_action,
    detail: item.actionRequired ? item.nextActionLabel : null,
    runStatus: null,
    reminderAt: null,
  };
}

/** Roll up lane counts for the Desk-level presence banner. */
export function summarizeDeskLanes(views: WorkItemAgentView[]): Record<DeskAgentLane, number> {
  const counts: Record<DeskAgentLane, number> = {
    agent_working: 0,
    waiting_human: 0,
    agent_blocked: 0,
    needs_human: 0,
    human_action: 0,
  };
  for (const v of views) counts[v.lane] += 1;
  return counts;
}
