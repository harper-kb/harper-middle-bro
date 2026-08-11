/**
 * Task-grain priority engine with BigBrother sort parity.
 *
 * Ladder (lower rank = earlier / more urgent), matching
 * `bigbrother/.../sort-companies.ts` then refined at task grain:
 *   1. fire flag
 *   2. operator override (encoded in resolved urgency tier)
 *   3. resolved A/B/C urgency tier
 *   4. urgency score
 *   5. action-required signal
 *   6. real deadline / cancellation effective (sooner first)
 *   7. age (oldest wins within equal priority)
 *   8. stable name / id tie-break
 *
 * Recent breaches surface loudly; very old items go to an aged-backlog shelf.
 */

import type { UrgencyTier, WorkItem, WorkItemPriorityReason } from "@/lib/types";

/** Days stuck at or above this → quieter aged-backlog shelf (still sortable). */
export const AGED_BACKLOG_DAYS = 21;

/** Breach window: clock past due within this many days is "loud". */
export const LOUD_BREACH_DAYS = 14;

export type SortableWorkItem = {
  id: string;
  accountName: string;
  isOnFire: boolean;
  /** Resolved tier after override → AI → deterministic */
  urgencyTier: UrgencyTier;
  urgencyScore: number | null;
  actionRequired: boolean;
  /** ISO deadline when known — cancellation effective overrides generic clocks */
  deadlineAt: string | null;
  /** Age proxy: days in lane / stuck */
  daysStuck: number;
  clockBreached: boolean;
  parkedUntil: string | null;
};

export function tierRank(tier: UrgencyTier | string | null | undefined): number {
  const t = (tier || "none").toString().toUpperCase();
  if (t === "A") return 0;
  if (t === "B") return 1;
  if (t === "C") return 2;
  if (t === "NONE") return 3;
  return 5;
}

export function workItemToSortable(item: WorkItem, now = new Date()): SortableWorkItem {
  const deadlineAt =
    item.clock.kind === "cancellation_effective" || item.clock.kind === "bind_deadline"
      ? item.clock.at
      : item.clock.at;
  const createdMs = Date.parse(item.createdAt);
  const daysStuck = Number.isFinite(createdMs)
    ? Math.max(0, Math.floor((now.getTime() - createdMs) / 86_400_000))
    : 0;
  return {
    id: item.id,
    accountName: item.accountName,
    isOnFire: item.isOnFire === true,
    urgencyTier: item.urgencyTier,
    urgencyScore: item.urgencyScore,
    actionRequired: item.actionRequired === true,
    deadlineAt,
    daysStuck,
    clockBreached: item.clock.breached === true,
    parkedUntil: item.parkedUntil,
  };
}

/**
 * BigBrother-parity comparator for task-grain rows.
 * Returns negative when `a` should appear before `b`.
 */
export function compareSortableWorkItems(a: SortableWorkItem, b: SortableWorkItem): number {
  // Parked items sink below active work (Desk continuity).
  const aParked = a.parkedUntil ? 1 : 0;
  const bParked = b.parkedUntil ? 1 : 0;
  if (aParked !== bParked) return aParked - bParked;

  const aFire = a.isOnFire === true ? 1 : 0;
  const bFire = b.isOnFire === true ? 1 : 0;
  if (aFire !== bFire) return bFire - aFire;

  const ra = tierRank(a.urgencyTier);
  const rb = tierRank(b.urgencyTier);
  if (ra !== rb) return ra - rb;

  const sa = a.urgencyScore ?? 0;
  const sb = b.urgencyScore ?? 0;
  if (sa !== sb) return sb - sa;

  const aAction = a.actionRequired === true ? 0 : 1;
  const bAction = b.actionRequired === true ? 0 : 1;
  if (aAction !== bAction) return aAction - bAction;

  // Sooner deadline first; missing deadlines sort after dated ones.
  const aDead = a.deadlineAt ? Date.parse(a.deadlineAt) : Number.POSITIVE_INFINITY;
  const bDead = b.deadlineAt ? Date.parse(b.deadlineAt) : Number.POSITIVE_INFINITY;
  if (aDead !== bDead) return aDead - bDead;

  // Within equal priority, oldest work wins (higher daysStuck first).
  if (a.daysStuck !== b.daysStuck) return b.daysStuck - a.daysStuck;

  const byName = a.accountName.localeCompare(b.accountName);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

export function sortWorkItems(items: WorkItem[], now = new Date()): WorkItem[] {
  return [...items].sort((a, b) =>
    compareSortableWorkItems(workItemToSortable(a, now), workItemToSortable(b, now)),
  );
}

export type PriorityShelf = "active" | "loud_breach" | "aged_backlog";

export function shelfFor(item: SortableWorkItem): PriorityShelf {
  if (item.daysStuck >= AGED_BACKLOG_DAYS && !item.isOnFire) {
    return "aged_backlog";
  }
  if (item.clockBreached && item.daysStuck < LOUD_BREACH_DAYS) {
    return "loud_breach";
  }
  return "active";
}

export function partitionByShelf(items: WorkItem[], now = new Date()): {
  active: WorkItem[];
  loudBreach: WorkItem[];
  agedBacklog: WorkItem[];
} {
  const sorted = sortWorkItems(items, now);
  const active: WorkItem[] = [];
  const loudBreach: WorkItem[] = [];
  const agedBacklog: WorkItem[] = [];
  for (const item of sorted) {
    const shelf = shelfFor(workItemToSortable(item, now));
    if (shelf === "aged_backlog") agedBacklog.push(item);
    else if (shelf === "loud_breach") loudBreach.push(item);
    else active.push(item);
  }
  return { active, loudBreach, agedBacklog };
}

/** Desk: next highest-priority non-parked item. */
export function pickNextWorkItem(
  items: WorkItem[],
  opts?: { excludeIds?: Set<string>; now?: Date },
): WorkItem | null {
  const exclude = opts?.excludeIds ?? new Set();
  const now = opts?.now ?? new Date();
  const sorted = sortWorkItems(items, now);
  for (const item of sorted) {
    if (exclude.has(item.id)) continue;
    if (item.parkedUntil && Date.parse(item.parkedUntil) > now.getTime()) continue;
    return item;
  }
  return null;
}

export function explainWhyNext(item: WorkItem): WorkItemPriorityReason[] {
  if (item.priorityReasons.length > 0) return item.priorityReasons;
  const reasons: WorkItemPriorityReason[] = [];
  if (item.isOnFire) reasons.push({ code: "fire_flag", label: "On Fire" });
  reasons.push({
    code: "urgency_tier",
    label: `Tier ${item.urgencyTier.toUpperCase()}`,
  });
  if (item.actionRequired) {
    reasons.push({ code: "action_required", label: "Action Required" });
  }
  if (item.clock.kind === "cancellation_effective") {
    reasons.push({
      code: "deadline",
      label: "Cancellation Effective",
      detail: item.clock.label,
    });
  } else if (item.clock.at) {
    reasons.push({ code: "deadline", label: item.clock.label });
  }
  reasons.push({ code: "age", label: "Oldest in cohort" });
  return reasons;
}

/**
 * BB-parity fixture helper — mirrors compareWorkbenchCompanies inputs.
 * Used by scripts/priority-engine-check.ts.
 */
export type BbParityRow = {
  name: string;
  isOnFire?: boolean;
  tier: UrgencyTier;
  score?: number;
  actionRequired?: boolean;
  daysStuck: number;
  deadlineAt?: string | null;
};

export function compareBbParityRows(a: BbParityRow, b: BbParityRow): number {
  return compareSortableWorkItems(
    {
      id: a.name,
      accountName: a.name,
      isOnFire: a.isOnFire === true,
      urgencyTier: a.tier,
      urgencyScore: a.score ?? null,
      actionRequired: a.actionRequired === true,
      deadlineAt: a.deadlineAt ?? null,
      daysStuck: a.daysStuck,
      clockBreached: false,
      parkedUntil: null,
    },
    {
      id: b.name,
      accountName: b.name,
      isOnFire: b.isOnFire === true,
      urgencyTier: b.tier,
      urgencyScore: b.score ?? null,
      actionRequired: b.actionRequired === true,
      deadlineAt: b.deadlineAt ?? null,
      daysStuck: b.daysStuck,
      clockBreached: false,
      parkedUntil: null,
    },
  );
}
