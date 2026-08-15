/**
 * Account Owner Of Record.
 *
 * `service_owner` already exists as a field on the company record; it simply is
 * not treated as meaning anything. On the single worst P0 onboarding case on
 * the book — dozens of inbound contacts, open for weeks — it resolves to null
 * while a producer is cleanly assigned. Nobody owns the customer who is
 * shouting the loudest.
 *
 * This module makes the field load-bearing: one named owner per account, every
 * reassignment recorded with a reason, and no account allowed to sit orphaned.
 * It is deliberately separate from `operator_accounts`, which is a manager's
 * *visibility* grant and says nothing about who is accountable.
 */

/** Why ownership moved. Reassignment without a reason is how ownership quietly evaporates. */
export type OwnershipChangeReason =
  | "initial_assignment"
  | "manager_reassignment"
  | "pod_rebalance"
  | "coverage_handoff"
  | "departure"
  | "orphan_repair";

export const OWNERSHIP_CHANGE_LABELS: Record<OwnershipChangeReason, string> = {
  initial_assignment: "Initial Assignment",
  manager_reassignment: "Manager Reassignment",
  pod_rebalance: "Pod Rebalance",
  coverage_handoff: "Coverage Handoff",
  departure: "Departure",
  orphan_repair: "Orphan Repair",
};

export interface OwnerAssignment {
  id: string;
  accountId: string;
  /** Internal-agent id of the owner. Null rows exist only as a recorded orphan. */
  ownerAgentId: string | null;
  ownerDisplayName: string | null;
  assignedAt: string;
  /** Null while current — exactly one open row per account is the invariant. */
  endedAt: string | null;
  reason: OwnershipChangeReason;
  assignedBy: string | null;
  note: string | null;
}

/**
 * An account with no current owner. Surfaced rather than silently defaulted,
 * because a default owner is how a queue becomes nobody's problem again.
 */
export interface OwnerOrphan {
  accountId: string;
  accountName: string;
  /** Open at-risk windows on the account — orphans with live risk go first. */
  openAtRiskWindows: number;
  /** Inbound contacts on the account's issues, the frustration proxy. */
  repeatContacts: number;
  /** Producer resolved from custody, so the repair has a starting point. */
  producerAgentId: string | null;
  reason: "never_assigned" | "owner_departed" | "assignment_ended";
}

export type OrphanSeverity = "critical" | "high" | "normal";

/**
 * An orphan with live risk on it is a different problem from an orphan sitting
 * quiet. Sort the repair queue by what is actually burning.
 */
export function orphanSeverity(orphan: OwnerOrphan): OrphanSeverity {
  if (orphan.openAtRiskWindows > 0) return "critical";
  if (orphan.repeatContacts >= 3) return "high";
  return "normal";
}

export function sortOrphans(orphans: OwnerOrphan[]): OwnerOrphan[] {
  const rank: Record<OrphanSeverity, number> = { critical: 0, high: 1, normal: 2 };
  return [...orphans].sort((a, b) => {
    const bySeverity = rank[orphanSeverity(a)] - rank[orphanSeverity(b)];
    if (bySeverity !== 0) return bySeverity;
    if (b.openAtRiskWindows !== a.openAtRiskWindows) {
      return b.openAtRiskWindows - a.openAtRiskWindows;
    }
    return b.repeatContacts - a.repeatContacts;
  });
}

export type OwnershipViolation = {
  accountId: string;
  code: "orphaned" | "multiple_current_owners" | "overlapping_history";
  detail: string;
};

/**
 * The no-orphan rule, checked against history rather than asserted.
 *
 * Three ways ownership can be wrong: nobody holds it, two people hold it, or
 * the history says both at once. All three are reported; none are auto-fixed,
 * because picking an owner is a management act.
 */
export function checkOwnershipInvariants(
  assignments: OwnerAssignment[],
): OwnershipViolation[] {
  const byAccount = new Map<string, OwnerAssignment[]>();
  for (const a of assignments) {
    const list = byAccount.get(a.accountId) ?? [];
    list.push(a);
    byAccount.set(a.accountId, list);
  }

  const violations: OwnershipViolation[] = [];
  for (const [accountId, rows] of byAccount) {
    const current = rows.filter((r) => r.endedAt == null);
    const owned = current.filter((r) => r.ownerAgentId != null);
    if (owned.length === 0) {
      violations.push({
        accountId,
        code: "orphaned",
        detail: "No current owner of record",
      });
    }
    if (owned.length > 1) {
      violations.push({
        accountId,
        code: "multiple_current_owners",
        detail: `${owned.length} concurrent owners: ${owned
          .map((r) => r.ownerDisplayName ?? r.ownerAgentId)
          .join(", ")}`,
      });
    }
    const sorted = [...rows].sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (a.endedAt == null || a.endedAt > b.assignedAt) {
        violations.push({
          accountId,
          code: "overlapping_history",
          detail: `Assignment ${a.id} overlaps ${b.id}`,
        });
      }
    }
  }
  return violations;
}

/** Owner as of a point in time — what the saves projection asks for. */
export function ownerAt(
  assignments: OwnerAssignment[],
  accountId: string,
  at: string,
): OwnerAssignment | null {
  const candidates = assignments
    .filter((a) => a.accountId === accountId)
    .filter((a) => a.assignedAt <= at && (a.endedAt == null || a.endedAt > at))
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  return candidates[0] ?? null;
}

/**
 * Coverage rule: an owner who is out must hand off. The owner floor on saves
 * survives a recorded handoff and dies without one, which is what makes the
 * rule enforce itself instead of needing a policing exercise.
 */
export function hasRecordedHandoff(
  assignments: OwnerAssignment[],
  accountId: string,
  windowOpenedAt: string,
  windowClosedAt: string,
): boolean {
  return assignments.some(
    (a) =>
      a.accountId === accountId &&
      a.reason === "coverage_handoff" &&
      a.assignedAt >= windowOpenedAt &&
      a.assignedAt <= windowClosedAt,
  );
}
