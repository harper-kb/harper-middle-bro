import "server-only";

import { randomUUID } from "crypto";
import type { ActionReceipt, CapabilityId, IdempotencyRecord } from "@/lib/types";

/**
 * Process-local idempotency ledger. Survives for the life of the Node process;
 * durable SQLite persistence can replace this without changing the ActionAdapter
 * contract (read-after-write still returns the original receipt).
 */
const records = new Map<string, IdempotencyRecord>();
const receipts = new Map<string, ActionReceipt>();

export function buildIdempotencyKey(parts: {
  operatorId: string;
  capabilityId: CapabilityId;
  workItemId: string | null;
  fingerprint: string;
}): string {
  return [
    parts.operatorId,
    parts.capabilityId,
    parts.workItemId ?? "none",
    parts.fingerprint,
  ].join(":");
}

export function recallIdempotent(key: string): ActionReceipt | null {
  const rec = records.get(key);
  if (!rec) return null;
  return receipts.get(rec.receiptId) ?? null;
}

export function storeReceipt(receipt: ActionReceipt): void {
  receipts.set(receipt.id, receipt);
  records.set(receipt.idempotencyKey, {
    key: receipt.idempotencyKey,
    capabilityId: receipt.capabilityId,
    receiptId: receipt.id,
    createdAt: receipt.requestedAt,
  });
}

export function newReceiptId(): string {
  return `rcpt_${randomUUID()}`;
}

/** Test-only reset. */
export function _resetIdempotencyForTests(): void {
  records.clear();
  receipts.clear();
}
