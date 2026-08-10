/**
 * Service Agent / HWS run status projection — human-task view.
 * Never call HWS from the browser; this reads Agent Tools / local status only.
 */

export type AgentRunStatus =
  | "idle"
  | "running"
  | "blocked"
  | "waiting_human"
  | "succeeded"
  | "failed";

export type HumanTaskProjection = {
  id: string;
  workItemId: string | null;
  accountId: string | null;
  title: string;
  status: AgentRunStatus;
  blockedReason: string | null;
  reminderAt: string | null;
  updatedAt: string;
};

export function projectHumanTasks(runs: {
  id: string;
  workItemId: string | null;
  accountId: string | null;
  title: string;
  status: AgentRunStatus;
  blockedReason: string | null;
  reminderAt: string | null;
  updatedAt: string;
}[]): HumanTaskProjection[] {
  return [...runs].sort((a, b) => {
    const rank = (s: AgentRunStatus) =>
      s === "waiting_human" ? 0 : s === "blocked" ? 1 : s === "running" ? 2 : 3;
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export function summarizeAgentStatus(tasks: HumanTaskProjection[]): string {
  const waiting = tasks.filter((t) => t.status === "waiting_human").length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const running = tasks.filter((t) => t.status === "running").length;
  return `${waiting} waiting on human · ${blocked} blocked · ${running} running`;
}
