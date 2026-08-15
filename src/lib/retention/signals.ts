/**
 * Deriving at-risk windows from the signals the company already emits.
 *
 * `lifecycle.signals` carries plenty going in — cancellation notices, relayed
 * carrier cancellations, failed payments — but nothing coming out. There is no
 * `cancellation.cured`, no `policy.reinstated`, no `retention.saved`, so a save
 * is currently uncountable: the desk can see every account start to leave and
 * cannot see a single one decide to stay.
 *
 * This module names both halves. `OPENING_SIGNAL_KINDS` maps what exists today;
 * `CLOSING_SIGNAL_KINDS` declares the closing contract, and until upstream
 * emits it, `deriveCloseFromPolicyState` reconstructs the close from carrier
 * notices and policy-state transitions so the ledger is not blocked on it.
 */

import { classifyCancelReason } from "@/lib/lanes/pending-cancels";
import type { CancelReasonCode } from "@/lib/lanes/pending-cancels";
import type { ServiceLaneId, WorkItem } from "@/lib/types";
import { assessDifficulty, daysBetween } from "./difficulty";
import type {
  AtRiskOutcome,
  AtRiskTriggerKind,
  AtRiskWindow,
  BillMode,
  RetentionEvent,
} from "./types";

/** One row off the `lifecycle.signals` ledger, narrowed to what retention needs. */
export interface LifecycleSignal {
  id: string;
  kind: string;
  companyId: string;
  policyId: string | null;
  occurredAt: string;
  /** Free text carried on the signal — cancel reason usually lives here. */
  detail?: string | null;
  /** Carrier's effective date when the signal carries one. */
  effectiveAt?: string | null;
  billMode?: BillMode;
}

/** A cancellation, reinstatement, or non-renewal notice relayed from a carrier. */
export interface CarrierNotice {
  id: string;
  companyId: string;
  policyId: string | null;
  kind: "cancellation" | "reinstatement" | "non_renewal" | "payment_failure";
  noticeAt: string;
  effectiveAt: string | null;
  reasonText: string;
  billMode?: BillMode;
}

/** Signal kinds that open a window, and the trigger each one records. */
export const OPENING_SIGNAL_KINDS: Record<string, AtRiskTriggerKind> = {
  "cancellation.notice": "cancellation_notice",
  "relay.insurance.cancellation.received": "cancellation_notice",
  "cancellation.pending": "notice_of_cancellation",
  "billing.payment.failed": "payment_failure",
  "payment.failed": "payment_failure",
  "premium_finance.default": "payment_failure",
  "policy.non_renewal": "non_renewal",
  "broker_of_record.requested": "bor_threat",
  "escalation.churn_intent": "churn_intent",
};

/**
 * The closing contract. None of these are emitted upstream today — that gap is
 * the single reason saves cannot be counted, and closing it is the smallest
 * upstream change this system needs.
 */
export const CLOSING_SIGNAL_KINDS: Record<string, AtRiskOutcome> = {
  "cancellation.cured": "saved",
  "policy.reinstated": "saved",
  "retention.saved": "saved",
  "policy.rewritten": "rewritten",
  "policy.cancelled": "lost",
  "broker_of_record.executed": "lost",
};

/** Carrier notice kinds that open a window. */
const NOTICE_TRIGGERS: Record<CarrierNotice["kind"], AtRiskTriggerKind | null> = {
  cancellation: "cancellation_notice",
  non_renewal: "non_renewal",
  payment_failure: "payment_failure",
  reinstatement: null,
};

/** Which service lane owns the window, so pod credit lands in the right pool. */
function laneForTrigger(trigger: AtRiskTriggerKind): ServiceLaneId {
  if (trigger === "non_renewal" || trigger === "bor_threat") return "post_sales";
  if (trigger === "churn_intent") return "active_service";
  return "pending_cancels";
}

/**
 * Windows are keyed by account, policy, and trigger rather than by source row
 * id so that a carrier notice and the lifecycle signal relaying the same
 * cancellation collapse into one window instead of two.
 */
export function windowKey(
  companyId: string,
  policyId: string | null,
  trigger: AtRiskTriggerKind,
  openedAt: string,
): string {
  return `arw:${companyId}:${policyId ?? "no-policy"}:${trigger}:${openedAt.slice(0, 10)}`;
}

export type DerivedLedger = {
  windows: AtRiskWindow[];
  events: RetentionEvent[];
  /** Close signals with no matching open window — a real data-quality signal, not a bug to swallow. */
  unmatchedCloses: { signalId: string; kind: string; companyId: string }[];
};

/**
 * Fold signals and carrier notices into windows plus their opening and closing
 * events. Pure: same inputs, same ledger, so it is safe to re-derive on every
 * sync and reconcile against what is already stored.
 */
export function deriveLedger(input: {
  signals: LifecycleSignal[];
  notices?: CarrierNotice[];
  now?: Date;
}): DerivedLedger {
  const now = input.now ?? new Date();
  const notices = input.notices ?? [];
  const windows = new Map<string, AtRiskWindow>();
  const events: RetentionEvent[] = [];
  const unmatchedCloses: DerivedLedger["unmatchedCloses"] = [];

  const opens = [
    ...input.signals
      .filter((s) => OPENING_SIGNAL_KINDS[s.kind])
      .map((s) => ({
        trigger: OPENING_SIGNAL_KINDS[s.kind]!,
        companyId: s.companyId,
        policyId: s.policyId,
        at: s.occurredAt,
        effectiveAt: s.effectiveAt ?? null,
        reasonText: `${s.kind} ${s.detail ?? ""}`,
        billMode: s.billMode ?? "unknown",
        sourceKind: "lifecycle_signal" as const,
        sourceRef: s.id,
      })),
    ...notices
      .filter((n) => NOTICE_TRIGGERS[n.kind])
      .map((n) => ({
        trigger: NOTICE_TRIGGERS[n.kind]!,
        companyId: n.companyId,
        policyId: n.policyId,
        at: n.noticeAt,
        effectiveAt: n.effectiveAt,
        reasonText: n.reasonText,
        billMode: n.billMode ?? "unknown",
        sourceKind: "carrier_notice" as const,
        sourceRef: n.id,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  for (const open of opens) {
    const key = windowKey(open.companyId, open.policyId, open.trigger, open.at);
    if (windows.has(key)) continue;
    const reason = reasonFromText(open.reasonText);
    const difficulty = assessDifficulty({
      reason,
      billMode: open.billMode,
      daysElapsed: 0,
    });
    windows.set(key, {
      id: key,
      accountId: open.companyId,
      policyId: open.policyId,
      issueId: null,
      lane: laneForTrigger(open.trigger),
      trigger: open.trigger,
      reason,
      billMode: open.billMode,
      openedAt: open.at,
      effectiveAt: open.effectiveAt,
      closedAt: null,
      outcome: "open",
      outcomeNote: null,
      premiumCents: null,
      commissionRateBps: null,
      commissionAtRiskCents: null,
      replacementCommissionCents: null,
      difficultyTier: difficulty.tier,
      ownerAgentId: null,
      sourceKind: open.sourceKind,
      sourceRef: open.sourceRef,
    });
    events.push({
      id: `${key}:opened`,
      windowId: key,
      kind: "window_opened",
      occurredAt: open.at,
      actor: open.sourceKind,
      actorKind: "system",
      actorAgentId: null,
      detail: `Opened on ${open.trigger}`,
      evidenceRef: open.sourceRef,
    });
  }

  const closes = [
    ...input.signals
      .filter((s) => CLOSING_SIGNAL_KINDS[s.kind])
      .map((s) => ({
        outcome: CLOSING_SIGNAL_KINDS[s.kind]!,
        companyId: s.companyId,
        policyId: s.policyId,
        at: s.occurredAt,
        kind: s.kind,
        sourceRef: s.id,
      })),
    ...notices
      .filter((n) => n.kind === "reinstatement")
      .map((n) => ({
        outcome: "saved" as AtRiskOutcome,
        companyId: n.companyId,
        policyId: n.policyId,
        at: n.noticeAt,
        kind: "carrier.reinstatement",
        sourceRef: n.id,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  for (const close of closes) {
    const match = findOpenWindow(windows, close.companyId, close.policyId, close.at);
    if (!match) {
      unmatchedCloses.push({
        signalId: close.sourceRef,
        kind: close.kind,
        companyId: close.companyId,
      });
      continue;
    }
    match.closedAt = close.at;
    match.outcome = close.outcome;
    match.outcomeNote = `Closed on ${close.kind}`;
    // Difficulty is priced at the moment the window actually closed: a
    // day-twenty recovery is a harder save than the same reason on day one.
    match.difficultyTier = assessDifficulty({
      reason: match.reason,
      billMode: match.billMode,
      daysElapsed: daysBetween(match.openedAt, close.at),
    }).tier;
    events.push({
      id: `${match.id}:closed`,
      windowId: match.id,
      kind: "window_closed",
      occurredAt: close.at,
      actor: close.kind,
      actorKind: "system",
      actorAgentId: null,
      detail: `Closed ${close.outcome}`,
      evidenceRef: close.sourceRef,
    });
    if (close.outcome === "saved") {
      events.push({
        id: `${match.id}:reinstated`,
        windowId: match.id,
        kind: "reinstatement_confirmed",
        occurredAt: close.at,
        actor: close.kind,
        actorKind: "system",
        actorAgentId: null,
        detail: "Policy returned to in-force",
        evidenceRef: close.sourceRef,
      });
    }
  }

  for (const w of windows.values()) {
    if (w.outcome === "open") expireIfPastEffective(w, now);
  }

  return {
    windows: [...windows.values()].sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    events,
    unmatchedCloses,
  };
}

/**
 * A window whose carrier effective date has passed with no close signal is not
 * open — the policy is gone. It closes `expired` rather than `lost` because
 * nothing confirmed the cancellation; the distinction keeps save-rate honest.
 */
export const EXPIRY_GRACE_DAYS = 3;

function expireIfPastEffective(w: AtRiskWindow, now: Date): void {
  if (!w.effectiveAt) return;
  const deadline = Date.parse(w.effectiveAt) + EXPIRY_GRACE_DAYS * 86_400_000;
  if (Number.isNaN(deadline) || now.getTime() <= deadline) return;
  w.closedAt = new Date(deadline).toISOString();
  w.outcome = "expired";
  w.outcomeNote = `No close signal ${EXPIRY_GRACE_DAYS} days past carrier effective date`;
}

function findOpenWindow(
  windows: Map<string, AtRiskWindow>,
  companyId: string,
  policyId: string | null,
  at: string,
): AtRiskWindow | null {
  let best: AtRiskWindow | null = null;
  for (const w of windows.values()) {
    if (w.accountId !== companyId) continue;
    if (w.outcome !== "open") continue;
    if (policyId && w.policyId && w.policyId !== policyId) continue;
    if (w.openedAt > at) continue;
    if (!best || w.openedAt > best.openedAt) best = w;
  }
  return best;
}

/**
 * Reuse the pending-cancels reason classifier rather than growing a second
 * vocabulary — the cancel lane and the retention ledger must agree on what
 * "non-pay" means or the difficulty multiplier drifts from the queue.
 */
function reasonFromText(text: string): CancelReasonCode {
  const stub = {
    title: text,
    summary: text,
    blocker: null,
  } as unknown as WorkItem;
  return classifyCancelReason(stub);
}
