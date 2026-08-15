/**
 * The saves projection.
 *
 * A save is usually a team sport, so attribution is the part that decides
 * whether the whole plan is trusted or resented. Last-touch rewards swooping in
 * at the end; first-responder punishes whoever did the hard middle. This uses
 * weighted contribution across decisive actions instead: credit splits among
 * the humans who did something that moved the outcome, and nothing else counts.
 *
 * Comments, internal notes, status flips, and assignment changes earn zero.
 * So does an action with no evidence pointer — credit exists only where
 * evidence exists in the ledger, which is also what makes work done out of a
 * personal inbox unpaid rather than merely invisible.
 */

import { assessDifficulty, daysBetween } from "./difficulty";
import { retainedCommissionForRewrite } from "./commission";
import { hasRecordedHandoff, ownerAt, type OwnerAssignment } from "./ownership";
import { podForLane, type ServicePodId } from "./pods";
import { agentDisplayName, type InternalAgent } from "./agents";
import {
  DECISIVE_EVENT_WEIGHTS,
  isDecisive,
  OWNER_FLOOR_SHARE,
  REPEAT_SAVE_LOCKOUT_DAYS,
  type AtRiskWindow,
  type RetentionEvent,
} from "./types";

/** A prior save on the same policy, used to enforce the 90-day lockout. */
export type PriorSave = {
  accountId: string;
  policyId: string | null;
  savedAt: string;
};

/**
 * An SLA breach on someone's own book. Feeds the self-inflicted gate: you do
 * not get paid for rescuing an account you dropped.
 */
export type OwnBookBreach = {
  accountId: string;
  agentId: string;
  breachedAt: string;
};

export type SaveGateCode =
  | "no_decisive_action"
  | "no_human_actor"
  | "no_evidence"
  | "repeat_save_lockout"
  | "self_inflicted"
  | "rewrite_delta"
  | "owner_floor_waived";

export const SAVE_GATE_LABELS: Record<SaveGateCode, string> = {
  no_decisive_action: "No Decisive Action",
  no_human_actor: "No Human Actor",
  no_evidence: "No Evidence In Ledger",
  repeat_save_lockout: "Repeat Save Lockout",
  self_inflicted: "Self-Inflicted Risk",
  rewrite_delta: "Rewrite Pays On Delta",
  owner_floor_waived: "Owner Floor Waived",
};

export interface SaveAttribution {
  agentId: string;
  displayName: string;
  /** Summed decisive-action weight before the owner floor. */
  weight: number;
  /** Final share of this save's credit, 0–1 across all attributions. */
  share: number;
  decisiveActions: number;
  /** True when this share is the owner floor rather than earned weight. */
  viaOwnerFloor: boolean;
}

export interface SaveCredit {
  windowId: string;
  accountId: string;
  policyId: string | null;
  podId: ServicePodId | null;
  /** Dollars actually kept. The honest headline; never scaled by difficulty. */
  retainedCommissionCents: number;
  difficultyMultiplier: number;
  /**
   * Retained commission scaled by difficulty. Only used to divide the pool, so
   * a hard save out-earns an easy one of the same dollar size without
   * misreporting what was retained.
   */
  creditUnits: number;
  attributions: SaveAttribution[];
  gates: SaveGateCode[];
  closedAt: string;
  /** Hours from window open to the first decisive human action. */
  hoursToFirstDecisiveAction: number | null;
}

export interface SkippedWindow {
  windowId: string;
  accountId: string;
  reason: SaveGateCode | "not_saved" | "unvalued";
  detail: string;
}

export interface SavesProjection {
  credits: SaveCredit[];
  skipped: SkippedWindow[];
  /** Windows that closed saved but credited nobody — automation or unrecorded work. */
  uncreditedSaves: number;
}

export interface SavesProjectionInput {
  windows: AtRiskWindow[];
  events: RetentionEvent[];
  assignments: OwnerAssignment[];
  directory: InternalAgent[];
  priorSaves?: PriorSave[];
  ownBookBreaches?: OwnBookBreach[];
  /** How far back a breach counts as having caused the risk. */
  selfInflictedLookbackDays?: number;
}

const DEFAULT_SELF_INFLICTED_LOOKBACK_DAYS = 30;

/** Self-inflicted risk halves the save rather than zeroing it — the work still happened. */
export const SELF_INFLICTED_PENALTY = 0.5;

export function projectSaves(input: SavesProjectionInput): SavesProjection {
  const priorSaves = input.priorSaves ?? [];
  const breaches = input.ownBookBreaches ?? [];
  const lookback =
    input.selfInflictedLookbackDays ?? DEFAULT_SELF_INFLICTED_LOOKBACK_DAYS;

  const eventsByWindow = new Map<string, RetentionEvent[]>();
  for (const e of input.events) {
    const list = eventsByWindow.get(e.windowId) ?? [];
    list.push(e);
    eventsByWindow.set(e.windowId, list);
  }

  const credits: SaveCredit[] = [];
  const skipped: SkippedWindow[] = [];
  let uncreditedSaves = 0;

  for (const w of input.windows) {
    if (w.outcome !== "saved" && w.outcome !== "rewritten") {
      skipped.push({
        windowId: w.id,
        accountId: w.accountId,
        reason: "not_saved",
        detail: `Outcome ${w.outcome}`,
      });
      continue;
    }
    if (w.commissionAtRiskCents == null) {
      skipped.push({
        windowId: w.id,
        accountId: w.accountId,
        reason: "unvalued",
        detail: "No commission at risk attached — value the window before crediting",
      });
      continue;
    }

    const closedAt = w.closedAt ?? new Date().toISOString();
    const gates: SaveGateCode[] = [];

    if (isRepeatSave(w, closedAt, priorSaves)) {
      skipped.push({
        windowId: w.id,
        accountId: w.accountId,
        reason: "repeat_save_lockout",
        detail: `Same policy saved within ${REPEAT_SAVE_LOCKOUT_DAYS} days`,
      });
      continue;
    }

    const windowEvents = (eventsByWindow.get(w.id) ?? []).filter(
      (e) => e.occurredAt >= w.openedAt && e.occurredAt <= closedAt,
    );
    const decisive = windowEvents.filter(
      (e) => isDecisive(e.kind) && e.actorKind === "human" && e.actorAgentId,
    );
    const unevidenced = decisive.filter((e) => !e.evidenceRef);
    const payable = decisive.filter((e) => e.evidenceRef);

    if (decisive.length === 0) {
      uncreditedSaves += 1;
      skipped.push({
        windowId: w.id,
        accountId: w.accountId,
        reason: windowEvents.some((e) => isDecisive(e.kind))
          ? "no_human_actor"
          : "no_decisive_action",
        detail: "Saved, but no decisive human action recorded in the window",
      });
      continue;
    }
    if (payable.length === 0) {
      uncreditedSaves += 1;
      skipped.push({
        windowId: w.id,
        accountId: w.accountId,
        reason: "no_evidence",
        detail: `${unevidenced.length} decisive action(s) carried no evidence reference`,
      });
      continue;
    }
    if (unevidenced.length > 0) gates.push("no_evidence");

    const retainedCents =
      w.outcome === "rewritten"
        ? retainedCommissionForRewrite(
            w.commissionAtRiskCents,
            w.replacementCommissionCents ?? 0,
          )
        : w.commissionAtRiskCents;
    if (w.outcome === "rewritten") gates.push("rewrite_delta");

    const firstDecisiveAt = payable
      .map((e) => e.occurredAt)
      .sort((a, b) => a.localeCompare(b))[0]!;
    const difficulty = assessDifficulty({
      reason: w.reason,
      billMode: w.billMode,
      daysElapsed: daysBetween(w.openedAt, firstDecisiveAt),
    });

    const owner = ownerAt(input.assignments, w.accountId, w.openedAt);
    const ownerAgentId = w.ownerAgentId ?? owner?.ownerAgentId ?? null;

    let attributions = splitByWeight(payable, input.directory);
    const ownerActed = attributions.some((a) => a.agentId === ownerAgentId);
    const handedOff = hasRecordedHandoff(
      input.assignments,
      w.accountId,
      w.openedAt,
      closedAt,
    );

    if (ownerAgentId && (ownerActed || handedOff)) {
      attributions = applyOwnerFloor(
        attributions,
        ownerAgentId,
        agentDisplayName(ownerAgentId, input.directory),
      );
    } else if (ownerAgentId) {
      // The owner neither acted nor handed off under the coverage rule, so the
      // floor is forfeited and the credit stays with whoever did the work.
      gates.push("owner_floor_waived");
    }

    let penalty = 1;
    if (isSelfInflicted(w, attributions, breaches, lookback)) {
      penalty = SELF_INFLICTED_PENALTY;
      gates.push("self_inflicted");
    }

    const multiplier = difficulty.multiplier * penalty;
    credits.push({
      windowId: w.id,
      accountId: w.accountId,
      policyId: w.policyId,
      podId: podForLane(w.lane),
      retainedCommissionCents: retainedCents,
      difficultyMultiplier: Math.round(multiplier * 100) / 100,
      creditUnits: Math.round(retainedCents * multiplier),
      attributions,
      gates,
      closedAt,
      hoursToFirstDecisiveAction:
        Math.round(daysBetween(w.openedAt, firstDecisiveAt) * 24 * 10) / 10,
    });
  }

  return { credits, skipped, uncreditedSaves };
}

function splitByWeight(
  decisive: RetentionEvent[],
  directory: InternalAgent[],
): SaveAttribution[] {
  const byAgent = new Map<string, { weight: number; actions: number }>();
  for (const e of decisive) {
    const agentId = e.actorAgentId!;
    const weight = DECISIVE_EVENT_WEIGHTS[e.kind] ?? 0;
    const prev = byAgent.get(agentId) ?? { weight: 0, actions: 0 };
    byAgent.set(agentId, {
      weight: prev.weight + weight,
      actions: prev.actions + 1,
    });
  }
  const total = [...byAgent.values()].reduce((n, v) => n + v.weight, 0);
  if (total <= 0) return [];
  return [...byAgent.entries()]
    .map(([agentId, v]) => ({
      agentId,
      displayName: agentDisplayName(agentId, directory),
      weight: v.weight,
      share: v.weight / total,
      decisiveActions: v.actions,
      viaOwnerFloor: false,
    }))
    .sort((a, b) => b.share - a.share);
}

/**
 * Lift the owner to the floor and scale everyone else down proportionally.
 * The floor exists because relationship continuity is what the plan is buying,
 * not because the owner did the most work on any given window.
 */
function applyOwnerFloor(
  attributions: SaveAttribution[],
  ownerAgentId: string,
  ownerDisplayName: string,
): SaveAttribution[] {
  const existing = attributions.find((a) => a.agentId === ownerAgentId);
  const ownerShare = existing?.share ?? 0;
  if (ownerShare >= OWNER_FLOOR_SHARE) return attributions;

  const others = attributions.filter((a) => a.agentId !== ownerAgentId);
  const remaining = 1 - OWNER_FLOOR_SHARE;
  const othersTotal = others.reduce((n, a) => n + a.share, 0);
  const scaled = others.map((a) => ({
    ...a,
    share: othersTotal > 0 ? (a.share / othersTotal) * remaining : 0,
  }));
  const ownerRow: SaveAttribution = {
    agentId: ownerAgentId,
    displayName: ownerDisplayName,
    weight: existing?.weight ?? 0,
    share: OWNER_FLOOR_SHARE,
    decisiveActions: existing?.decisiveActions ?? 0,
    viaOwnerFloor: true,
  };
  return [ownerRow, ...scaled].sort((a, b) => b.share - a.share);
}

function isRepeatSave(
  w: AtRiskWindow,
  closedAt: string,
  priorSaves: PriorSave[],
): boolean {
  const cutoffMs = Date.parse(closedAt) - REPEAT_SAVE_LOCKOUT_DAYS * 86_400_000;
  return priorSaves.some((p) => {
    if (p.accountId !== w.accountId) return false;
    if (w.policyId && p.policyId && p.policyId !== w.policyId) return false;
    const at = Date.parse(p.savedAt);
    return at >= cutoffMs && at < Date.parse(closedAt);
  });
}

/**
 * A breach on the crediting agent's own book, on this account, in the run-up to
 * the trigger. This is the rule that stops the plan from paying people to let
 * accounts get sick.
 */
function isSelfInflicted(
  w: AtRiskWindow,
  attributions: SaveAttribution[],
  breaches: OwnBookBreach[],
  lookbackDays: number,
): boolean {
  const openedMs = Date.parse(w.openedAt);
  const floorMs = openedMs - lookbackDays * 86_400_000;
  const agentIds = new Set(attributions.map((a) => a.agentId));
  return breaches.some((b) => {
    if (b.accountId !== w.accountId) return false;
    if (!agentIds.has(b.agentId)) return false;
    const at = Date.parse(b.breachedAt);
    return at >= floorMs && at <= openedMs;
  });
}

/**
 * No single account may take more than this share of a pod's period pool.
 *
 * The cap can never bind below an even split — with three accounts in a
 * period, a third each is not concentration, it is arithmetic. The effective
 * cap is therefore the greater of this share and `1 / accounts`, which keeps a
 * thin period from being mostly unpayable.
 */
export const PER_ACCOUNT_POOL_CAP_SHARE = 0.15;

export function effectiveAccountCap(accountCount: number): number {
  if (accountCount <= 0) return 1;
  return Math.max(PER_ACCOUNT_POOL_CAP_SHARE, 1 / accountCount);
}

export interface PoolAllocation {
  agentId: string;
  displayName: string;
  creditUnits: number;
  payoutCents: number;
}

export interface PoolAllocationResult {
  podId: ServicePodId | null;
  poolCents: number;
  allocations: PoolAllocation[];
  /** Units trimmed by the per-account cap, returned to the pool. */
  cappedUnits: number;
  unallocatedCents: number;
}

/**
 * Turn credit units into money. Pooling per period rather than paying a fixed
 * rate per save keeps the program's cost bounded and stops a single large
 * account from consuming a quarter's budget.
 */
export function allocatePool(
  credits: SaveCredit[],
  poolCents: number,
  podId: ServicePodId | null = null,
): PoolAllocationResult {
  const byAccount = new Map<string, number>();
  for (const c of credits) {
    byAccount.set(c.accountId, (byAccount.get(c.accountId) ?? 0) + c.creditUnits);
  }
  const totalUnits = [...byAccount.values()].reduce((n, v) => n + v, 0);
  if (totalUnits <= 0) {
    return {
      podId,
      poolCents,
      allocations: [],
      cappedUnits: 0,
      unallocatedCents: poolCents,
    };
  }

  const accountShares = capAccountShares(byAccount);
  let cappedUnits = 0;
  const byAgent = new Map<string, { displayName: string; units: number }>();
  for (const c of credits) {
    const rawAccountUnits = byAccount.get(c.accountId) ?? 0;
    const allowedAccountUnits = (accountShares.get(c.accountId) ?? 0) * totalUnits;
    const scale = rawAccountUnits > 0 ? allowedAccountUnits / rawAccountUnits : 0;
    if (scale < 1) cappedUnits += c.creditUnits * (1 - scale);
    for (const a of c.attributions) {
      const prev = byAgent.get(a.agentId) ?? { displayName: a.displayName, units: 0 };
      byAgent.set(a.agentId, {
        displayName: a.displayName,
        units: prev.units + c.creditUnits * scale * a.share,
      });
    }
  }

  const payableUnits = [...byAgent.values()].reduce((n, v) => n + v.units, 0);
  const allocations = [...byAgent.entries()]
    .map(([agentId, v]) => ({
      agentId,
      displayName: v.displayName,
      creditUnits: Math.round(v.units),
      payoutCents:
        payableUnits > 0 ? Math.round(poolCents * (v.units / payableUnits)) : 0,
    }))
    .sort((a, b) => b.payoutCents - a.payoutCents);

  const paid = allocations.reduce((n, a) => n + a.payoutCents, 0);
  return {
    podId,
    poolCents,
    allocations,
    cappedUnits: Math.round(cappedUnits),
    unallocatedCents: Math.max(0, poolCents - paid),
  };
}

/**
 * Water-fill the pool: hold every account to the effective cap and redistribute
 * the trimmed share across accounts still under it, repeating until nothing is
 * over. Redistribution matters — capping without it would silently shrink the
 * pool the period actually pays out, which is a different decision from
 * limiting concentration.
 */
function capAccountShares(byAccount: Map<string, number>): Map<string, number> {
  const cap = effectiveAccountCap(byAccount.size);
  const shares = new Map<string, number>();
  let remainingShare = 1;
  let open = [...byAccount.entries()];

  while (open.length > 0) {
    const openUnits = open.reduce((n, [, u]) => n + u, 0);
    if (openUnits <= 0) break;
    const over = open.filter(
      ([, u]) => (u / openUnits) * remainingShare > cap + 1e-9,
    );
    if (over.length === 0) {
      for (const [id, u] of open) {
        shares.set(id, (u / openUnits) * remainingShare);
      }
      break;
    }
    for (const [id] of over) {
      shares.set(id, cap);
      remainingShare -= cap;
    }
    const overIds = new Set(over.map(([id]) => id));
    open = open.filter(([id]) => !overIds.has(id));
  }

  // Anything unreached (zero-unit accounts) contributes nothing.
  for (const [id] of byAccount) if (!shares.has(id)) shares.set(id, 0);
  return shares;
}
