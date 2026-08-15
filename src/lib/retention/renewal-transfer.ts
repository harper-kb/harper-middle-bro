/**
 * The renewal transfer.
 *
 * This is the sanction Harper already wrote down and never operationalized:
 * *if subjectivities aren't communicated during the sale, the deal name gets
 * reassigned at 12 months.* Generalized here — a confirmed origination defect
 * moves renewal credit on that account from the producer to the service pod
 * that kept it alive.
 *
 * Paid commission is never clawed back. That is deliberate: a clawback is
 * legally messy and culturally poisonous, and it punishes the close. This
 * punishes only the keep, and moves the money to whoever actually did the
 * keeping. They get paid for closing; they stop getting paid for keeping.
 */

import { isActionable, type DefectSeverity, type OriginationDefect } from "./defects";
import type { ServicePodId } from "./pods";

/** The deal name reassigns at the first renewal, which is twelve months out. */
export const RENEWAL_TRANSFER_HORIZON_MONTHS = 12;

export type RenewalTransferState = "pending" | "effective" | "reversed";

export const RENEWAL_TRANSFER_STATE_LABELS: Record<RenewalTransferState, string> = {
  pending: "Pending",
  effective: "Effective",
  reversed: "Reversed",
};

export interface RenewalTransfer {
  id: string;
  defectId: string;
  accountId: string;
  policyId: string | null;
  fromProducerAgentId: string | null;
  toPodId: ServicePodId | null;
  renewalDueAt: string | null;
  transferredAt: string;
  renewalCommissionCents: number | null;
  state: RenewalTransferState;
  note: string | null;
}

/**
 * Minor defects do not move a renewal. A wrong mailing address is a defect
 * worth coaching on and not worth a year of commission; keeping the sanction
 * proportionate is what keeps it survivable in practice.
 */
const TRANSFERABLE_SEVERITIES: DefectSeverity[] = ["material", "severe"];

export type TransferEligibility =
  | { eligible: true; reason: string }
  | { eligible: false; reason: string };

export function renewalTransferEligibility(
  defect: OriginationDefect,
): TransferEligibility {
  if (!isActionable(defect.state)) {
    return {
      eligible: false,
      reason: `Defect is ${defect.state}, not confirmed — a claim is not a sanction`,
    };
  }
  if (!defect.producerAgentId) {
    return {
      eligible: false,
      reason: "No producer attributed — nothing to transfer from",
    };
  }
  if (!TRANSFERABLE_SEVERITIES.includes(defect.severity)) {
    return {
      eligible: false,
      reason: `${defect.severity} defects are coaching findings, not renewal transfers`,
    };
  }
  if (!defect.absorbingPodId) {
    return {
      eligible: false,
      reason: "No absorbing pod recorded — nothing to transfer to",
    };
  }
  return {
    eligible: true,
    reason: `Confirmed ${defect.severity} ${defect.kind} attributed to ${defect.producerName ?? defect.producerAgentId}`,
  };
}

/** Renewal falls due a year after bind, or a year after the issue if bind is unknown. */
export function renewalDueDate(defect: OriginationDefect): string {
  const anchor = Date.parse(defect.boundAt ?? defect.issueOpenedAt);
  const d = new Date(Number.isNaN(anchor) ? Date.now() : anchor);
  d.setMonth(d.getMonth() + RENEWAL_TRANSFER_HORIZON_MONTHS);
  return d.toISOString();
}

export type BuiltTransfer = Omit<RenewalTransfer, "id">;

export function buildRenewalTransfer(
  defect: OriginationDefect,
  opts: { renewalCommissionCents?: number | null; at?: string } = {},
): BuiltTransfer {
  const eligibility = renewalTransferEligibility(defect);
  if (!eligibility.eligible) {
    throw new Error(`Defect ${defect.id} is not transferable: ${eligibility.reason}`);
  }
  return {
    defectId: defect.id,
    accountId: defect.accountId,
    policyId: defect.policyId,
    fromProducerAgentId: defect.producerAgentId,
    toPodId: defect.absorbingPodId,
    renewalDueAt: renewalDueDate(defect),
    transferredAt: opts.at ?? new Date().toISOString(),
    renewalCommissionCents: opts.renewalCommissionCents ?? null,
    state: "pending",
    note: eligibility.reason,
  };
}

/**
 * A transfer only takes effect at the renewal date. Until then it is pending
 * and reversible, which gives the dispute path real time to run: the pod lead
 * raises the defect, the sales lead can contest it, and the transcript decides.
 */
export function isEffectiveAt(transfer: RenewalTransfer, at: string): boolean {
  if (transfer.state === "reversed") return false;
  if (!transfer.renewalDueAt) return transfer.state === "effective";
  return at >= transfer.renewalDueAt;
}

export interface TransferLedgerSummary {
  podId: ServicePodId | null;
  transfersIn: number;
  commissionMovedCents: number;
}

export function summarizeTransfersByPod(
  transfers: RenewalTransfer[],
  at: string,
): TransferLedgerSummary[] {
  const map = new Map<string, TransferLedgerSummary>();
  for (const t of transfers) {
    if (!isEffectiveAt(t, at)) continue;
    const key = t.toPodId ?? "unassigned";
    const row = map.get(key) ?? {
      podId: t.toPodId,
      transfersIn: 0,
      commissionMovedCents: 0,
    };
    row.transfersIn += 1;
    row.commissionMovedCents += t.renewalCommissionCents ?? 0;
    map.set(key, row);
  }
  return [...map.values()].sort(
    (a, b) => b.commissionMovedCents - a.commissionMovedCents || b.transfersIn - a.transfersIn,
  );
}

export interface ProducerTransferExposure {
  producerAgentId: string;
  transfers: number;
  commissionAtStakeCents: number;
  pending: number;
  effective: number;
}

/** What a producer stands to lose, so the conversation happens before the renewal, not at it. */
export function summarizeProducerExposure(
  transfers: RenewalTransfer[],
  at: string,
): ProducerTransferExposure[] {
  const map = new Map<string, ProducerTransferExposure>();
  for (const t of transfers) {
    if (t.state === "reversed" || !t.fromProducerAgentId) continue;
    const row = map.get(t.fromProducerAgentId) ?? {
      producerAgentId: t.fromProducerAgentId,
      transfers: 0,
      commissionAtStakeCents: 0,
      pending: 0,
      effective: 0,
    };
    row.transfers += 1;
    row.commissionAtStakeCents += t.renewalCommissionCents ?? 0;
    if (isEffectiveAt(t, at)) row.effective += 1;
    else row.pending += 1;
    map.set(t.fromProducerAgentId, row);
  }
  return [...map.values()].sort(
    (a, b) => b.commissionAtStakeCents - a.commissionAtStakeCents,
  );
}
