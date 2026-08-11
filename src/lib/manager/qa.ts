/**
 * Manager QA — handoffs, blocked-reason analytics, per-agent drilldowns.
 * Counts must reconcile to underlying section views when live.
 */

import type { WorkItem } from "@/lib/types";

export type AgentDrilldown = {
  operatorId: string | null;
  displayName: string;
  openCount: number;
  onFireCount: number;
  blockedCount: number;
  oldestAgeHours: number;
  handoffsIn: number;
  handoffsOut: number;
};

export function buildBlockedReasonAnalytics(items: WorkItem[]): {
  reason: string;
  count: number;
}[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const reason = item.blocker?.label ?? "No Blocker";
    map.set(reason, (map.get(reason) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export function buildAgentDrilldowns(items: WorkItem[]): AgentDrilldown[] {
  const byAgent = new Map<string, WorkItem[]>();
  for (const item of items) {
    const key = item.owner.operatorId ?? item.owner.displayName ?? "unassigned";
    const list = byAgent.get(key) ?? [];
    list.push(item);
    byAgent.set(key, list);
  }

  const now = Date.now();
  return [...byAgent.entries()]
    .map(([, list]) => {
      const first = list[0]!;
      const ages = list.map((i) =>
        Math.max(0, (now - Date.parse(i.createdAt)) / 3_600_000),
      );
      return {
        operatorId: first.owner.operatorId,
        displayName: first.owner.displayName ?? "Unassigned",
        openCount: list.length,
        onFireCount: list.filter((i) => i.isOnFire).length,
        blockedCount: list.filter((i) => i.blocker).length,
        oldestAgeHours: Math.round(Math.max(...ages)),
        handoffsIn: list.filter((i) => i.owner.operatorId == null).length,
        handoffsOut: 0,
      };
    })
    .sort((a, b) => b.openCount - a.openCount);
}

export function reconcileSectionCounts(
  sectionCounts: Record<string, number>,
  drilldownTotal: number,
): { ok: boolean; detail: string } {
  const sum = Object.values(sectionCounts).reduce((n, v) => n + v, 0);
  if (sum !== drilldownTotal) {
    return {
      ok: false,
      detail: `Section sum ${sum} ≠ drilldown ${drilldownTotal}`,
    };
  }
  return { ok: true, detail: "Counts reconcile" };
}
