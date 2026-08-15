/**
 * Retention ledger contracts.
 *
 * The desk pays on retained commission, not activity, so the unit of account
 * is an **at-risk window**: a policy that was leaving and the interval during
 * which it could still be kept. Everything else here hangs off that window —
 * the events recorded inside it, the commission it puts at risk, and the
 * credit that gets split when it closes saved.
 *
 * Nothing in this file touches SQLite or the network; the store, the
 * projection, and the surfaces all read these shapes.
 */

import type { CancelReasonCode } from "@/lib/lanes/pending-cancels";
import type { ServiceLaneId } from "@/lib/types";

/** What put the policy at risk. Mirrors the triggers the spine already emits. */
export type AtRiskTriggerKind =
  | "cancellation_notice"
  | "payment_failure"
  | "notice_of_cancellation"
  | "bor_threat"
  | "non_renewal"
  | "churn_intent";

export const AT_RISK_TRIGGER_LABELS: Record<AtRiskTriggerKind, string> = {
  cancellation_notice: "Cancellation Notice",
  payment_failure: "Payment Failure",
  notice_of_cancellation: "Notice Of Cancellation",
  bor_threat: "BOR Threat",
  non_renewal: "Non-Renewal",
  churn_intent: "Churn Intent",
};

/**
 * How a window ended.
 *
 * `rewritten` is deliberately separate from `saved`: moving the insured to
 * another carrier keeps the relationship but usually changes the commission,
 * so it pays on the delta rather than the full retained amount.
 */
export type AtRiskOutcome = "open" | "saved" | "lost" | "rewritten" | "expired";

export const AT_RISK_OUTCOME_LABELS: Record<AtRiskOutcome, string> = {
  open: "Open",
  saved: "Saved",
  lost: "Lost",
  rewritten: "Rewritten",
  expired: "Expired",
};

/**
 * Difficulty banding for the save multiplier. Derived, never hand-set — see
 * `difficultyTierFor` in `difficulty.ts`, which prices the tier off the
 * observed recovery odds for the reason and the elapsed day.
 */
export type DifficultyTier = "routine" | "standard" | "hard" | "long_shot";

export const DIFFICULTY_TIER_LABELS: Record<DifficultyTier, string> = {
  routine: "Routine",
  standard: "Standard",
  hard: "Hard",
  long_shot: "Long Shot",
};

/** Direct bill recovers roughly twice as often as agency bill, so it bands separately. */
export type BillMode = "agency_bill" | "direct_bill" | "financed" | "unknown";

/**
 * The window itself. `commissionAtRiskCents` is populated by the valuation
 * step rather than at open time, because premium and carrier rate frequently
 * resolve later than the notice that opened the window.
 */
export interface AtRiskWindow {
  id: string;
  accountId: string;
  /** Null when the notice arrives before the policy is matched. */
  policyId: string | null;
  /** Spine or legacy issue that carries the work for this window. */
  issueId: string | null;
  lane: ServiceLaneId;
  trigger: AtRiskTriggerKind;
  reason: CancelReasonCode;
  billMode: BillMode;
  openedAt: string;
  /** Carrier's drop-dead date when the notice carries one. */
  effectiveAt: string | null;
  closedAt: string | null;
  outcome: AtRiskOutcome;
  /** Free-text close note — why it went the way it did. */
  outcomeNote: string | null;
  premiumCents: number | null;
  /** Basis points, so 1650 = 16.5%. Integer math keeps the ledger exact. */
  commissionRateBps: number | null;
  commissionAtRiskCents: number | null;
  /** Commission on the replacement policy when the outcome is `rewritten`. */
  replacementCommissionCents: number | null;
  difficultyTier: DifficultyTier;
  /** Owner of record at the moment the window opened, not at close. */
  ownerAgentId: string | null;
  /** Set by the source that derived this window — `lifecycle.signals`, a carrier notice, an operator. */
  sourceKind: RetentionSourceKind;
  sourceRef: string | null;
}

/**
 * Where a window came from. Manual opens are allowed but marked, because the
 * projection weights evidence-backed windows differently at audit time.
 */
export type RetentionSourceKind =
  | "lifecycle_signal"
  | "carrier_notice"
  | "spine_issue"
  | "operator";

/**
 * Everything recorded inside a window. Only the kinds in `DECISIVE_EVENT_KINDS`
 * earn save credit; the rest exist so the timeline reads honestly and so
 * "who was actually working this" can be answered after the fact.
 */
export type RetentionEventKind =
  // Decisive — moved the outcome
  | "outbound_contact_answered"
  | "payment_link_paid"
  | "carrier_escalation_state_change"
  | "rewrite_bound"
  | "bor_returned"
  | "reinstatement_confirmed"
  // Recorded but not decisive
  | "outbound_contact_no_reply"
  | "inbound_contact"
  | "comment"
  | "internal_note"
  | "status_change"
  | "assignment_change"
  | "window_opened"
  | "window_closed";

export const RETENTION_EVENT_LABELS: Record<RetentionEventKind, string> = {
  outbound_contact_answered: "Outbound Contact Answered",
  payment_link_paid: "Payment Link Paid",
  carrier_escalation_state_change: "Carrier Escalation Changed State",
  rewrite_bound: "Rewrite Bound",
  bor_returned: "BOR Returned",
  reinstatement_confirmed: "Reinstatement Confirmed",
  outbound_contact_no_reply: "Outbound Contact, No Reply",
  inbound_contact: "Inbound Contact",
  comment: "Comment",
  internal_note: "Internal Note",
  status_change: "Status Change",
  assignment_change: "Assignment Change",
  window_opened: "Window Opened",
  window_closed: "Window Closed",
};

/**
 * The five decisive verbs from the plan plus reinstatement, weighted by how
 * much of the outcome each one actually carries. A paid payment link, a bound
 * rewrite, and a returned BOR are the acts that end a window; an answered
 * outbound is real work but rarely finishes the job alone.
 */
export const DECISIVE_EVENT_WEIGHTS: Partial<
  Record<RetentionEventKind, number>
> = {
  payment_link_paid: 3,
  rewrite_bound: 3,
  bor_returned: 3,
  reinstatement_confirmed: 3,
  carrier_escalation_state_change: 2,
  outbound_contact_answered: 1,
};

export const DECISIVE_EVENT_KINDS = Object.keys(
  DECISIVE_EVENT_WEIGHTS,
) as RetentionEventKind[];

export function isDecisive(kind: RetentionEventKind): boolean {
  return DECISIVE_EVENT_WEIGHTS[kind] != null;
}

/**
 * Who acted. The spine writes `spine-agent-prod` for automation, so actor kind
 * has to be explicit — an automated cure is a real outcome but not a human's
 * bonus.
 */
export type RetentionActorKind = "human" | "agent" | "system";

export interface RetentionEvent {
  id: string;
  windowId: string;
  kind: RetentionEventKind;
  occurredAt: string;
  /** Raw actor string off the issue timeline, before identity resolution. */
  actor: string;
  actorKind: RetentionActorKind;
  /** Resolved internal-agent id, when the actor maps to a known human. */
  actorAgentId: string | null;
  /** Short human-readable description — what the row is evidence of. */
  detail: string;
  /**
   * Pointer to the artifact that proves this happened (message id, receipt id,
   * carrier confirmation). Credit exists only where evidence exists.
   */
  evidenceRef: string | null;
}

/** Rolling window that kills "let it lapse, cure it, collect". */
export const REPEAT_SAVE_LOCKOUT_DAYS = 90;

/**
 * Relationship continuity is what the plan is buying, so the owner of record
 * takes a floor even when someone else executed — unless they did nothing and
 * never handed off.
 */
export const OWNER_FLOOR_SHARE = 0.25;
