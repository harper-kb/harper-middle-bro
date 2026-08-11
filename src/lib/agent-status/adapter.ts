import "server-only";

import {
  agentToolsConfigured,
  executeAgentToolsCommand,
} from "@/lib/adapters/agent-tools";
import { getCapabilityGate } from "@/lib/adapters/agent-tools/capabilities";
import { getServiceActivation } from "@/lib/service-activation";
import type { LaneDataMode } from "@/lib/types";
import {
  projectHumanTasks,
  summarizeAgentStatus,
  type AgentRunStatus,
  type HumanTaskProjection,
} from "./projection";

/**
 * Service Agent run-status adapter.
 *
 * Reads Service Agent / HWS run status through the Harper Agent Tools door
 * (`service task list`, capability `read.agent_status`). Never calls HWS
 * product routes from the browser — this module is server-only and the Desk
 * consumes the projected, serializable result.
 *
 * Live-data honesty: when Agent Tools credentials are absent (or the call
 * fails), the Desk shows a clearly labeled SAMPLE projection so operators can
 * see the shape of agent presence — it is never presented as live agent
 * activity. A lane only reads `live` when the door actually answered.
 */

export type AgentStatusBundle = {
  activation: "active" | "ready_off" | "not_configured";
  mode: LaneDataMode;
  /** Why the projection is sample (missing credential, door error) — null when live. */
  modeReason: string | null;
  tasks: HumanTaskProjection[];
  /** Per-work-item projection for attaching agent presence to Desk rows. */
  byWorkItem: Record<string, HumanTaskProjection>;
  summary: string;
  sourceApi: string;
  fetchedAt: string;
};

/** Raw run record shape before projection. */
type AgentRunRecord = {
  id: string;
  workItemId: string | null;
  accountId: string | null;
  title: string;
  status: AgentRunStatus;
  blockedReason: string | null;
  reminderAt: string | null;
  updatedAt: string;
};

const VALID_STATUSES: readonly AgentRunStatus[] = [
  "idle",
  "running",
  "blocked",
  "waiting_human",
  "succeeded",
  "failed",
];

/** Normalize an upstream status string to a known AgentRunStatus. */
export function normalizeAgentRunStatus(raw: unknown): AgentRunStatus {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((VALID_STATUSES as readonly string[]).includes(s)) return s as AgentRunStatus;
  // Common upstream synonyms → canonical.
  if (s === "in_progress" || s === "active" || s === "processing") return "running";
  if (s === "waiting" || s === "needs_human" || s === "needs_input" || s === "awaiting_human")
    return "waiting_human";
  if (s === "error" || s === "errored") return "failed";
  if (s === "done" || s === "complete" || s === "completed" || s === "success")
    return "succeeded";
  if (s === "queued" || s === "pending" || s === "") return "idle";
  return "idle";
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

/** Tolerant mapper over an Agent Tools `service task list` response. */
export function mapAgentToolsRuns(data: Record<string, unknown>): AgentRunRecord[] {
  const rows: unknown =
    (Array.isArray(data.tasks) && data.tasks) ||
    (Array.isArray(data.runs) && data.runs) ||
    (Array.isArray(data.items) && data.items) ||
    (Array.isArray((data.data as { rows?: unknown })?.rows) &&
      (data.data as { rows: unknown[] }).rows) ||
    (Array.isArray(data.rows) && data.rows) ||
    [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((raw, i): AgentRunRecord | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const id = str(r.id) ?? str(r.run_id) ?? str(r.task_id) ?? `run-${i}`;
      return {
        id,
        workItemId: str(r.work_item_id) ?? str(r.workItemId) ?? str(r.ticket_id),
        accountId: str(r.account_id) ?? str(r.accountId) ?? str(r.company_id),
        title: str(r.title) ?? str(r.name) ?? str(r.summary) ?? "Agent run",
        status: normalizeAgentRunStatus(r.status ?? r.state ?? r.run_status),
        blockedReason:
          str(r.blocked_reason) ?? str(r.blockedReason) ?? str(r.blocker) ?? null,
        reminderAt: str(r.reminder_at) ?? str(r.reminderAt) ?? str(r.wake_at),
        updatedAt:
          str(r.updated_at) ??
          str(r.updatedAt) ??
          str(r.last_activity_at) ??
          new Date().toISOString(),
      };
    })
    .filter((r): r is AgentRunRecord => r != null);
}

function toBundle(
  runs: AgentRunRecord[],
  mode: LaneDataMode,
  modeReason: string | null,
  sourceApi: string,
): AgentStatusBundle {
  const tasks = projectHumanTasks(runs);
  const byWorkItem: Record<string, HumanTaskProjection> = {};
  for (const t of tasks) {
    if (t.workItemId && !byWorkItem[t.workItemId]) byWorkItem[t.workItemId] = t;
  }
  return {
    activation: mode === "live" ? "active" : "not_configured",
    mode,
    modeReason,
    tasks,
    byWorkItem,
    summary: summarizeAgentStatus(tasks),
    sourceApi,
    fetchedAt: new Date().toISOString(),
  };
}

/** Dormant projection used while Service Agent is intentionally switched off. */
export function dormantAgentStatusBundle(opts: {
  ready: boolean;
  reason: string;
}): AgentStatusBundle {
  return {
    activation: opts.ready ? "ready_off" : "not_configured",
    mode: "sample",
    modeReason: opts.reason,
    tasks: [],
    byWorkItem: {},
    summary: opts.ready
      ? "Service Agent available · not activated"
      : "Service Agent plumbing installed · credentials required",
    sourceApi: "dormant://agent-status",
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Labeled sample projection — the shape of Service Agent presence keyed to the
 * Desk's sample work items. Never emitted as live agent activity.
 */
export function sampleAgentStatusBundle(reason: string): AgentStatusBundle {
  return toBundle([], "sample", reason, "sample://agent-status");
}

/**
 * Load Service Agent run status. Live only when the Agent Tools door answered;
 * otherwise a clearly labeled sample projection.
 */
export async function loadAgentStatus(opts?: {
  operatorId?: string | null;
}): Promise<AgentStatusBundle> {
  const activation = getServiceActivation().agent;
  if (activation.state !== "active") {
    return dormantAgentStatusBundle({
      ready: activation.ready,
      reason: activation.blockerLabel ?? "Service Agent is not activated",
    });
  }
  const gate = getCapabilityGate("read.agent_status");
  if (!agentToolsConfigured()) {
    return sampleAgentStatusBundle(
      gate.blockerLabel ??
        "Harper Agent Tools not configured — set HARPER_AGENT_TOOLS_BASE_URL + HARPER_AGENT_TOOLS_TOKEN",
    );
  }
  try {
    const result = await executeAgentToolsCommand("service task list", {
      operator_id: opts?.operatorId ?? null,
      scope: "desk",
    });
    if (!result.ok) {
      return sampleAgentStatusBundle(
        result.error ?? "Agent Tools run-status read failed",
      );
    }
    const runs = mapAgentToolsRuns(result.data);
    return toBundle(runs, "live", null, result.sourceApi);
  } catch (err) {
    return sampleAgentStatusBundle(
      err instanceof Error ? err.message : "Agent Tools unreachable",
    );
  }
}
