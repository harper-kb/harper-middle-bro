import "server-only";

import {
  buildIdempotencyKey,
  dispatchAction,
  getCapabilityGate,
} from "@/lib/adapters/agent-tools";
import type { ActionReceipt, CapabilityId } from "@/lib/types";

export type MutationDoor =
  | "docusign"
  | "payment_link"
  | "bind"
  | "coi_issue"
  | "coi_send"
  | "document_retrieval";

const DOOR_TO_CAPABILITY: Record<MutationDoor, CapabilityId> = {
  docusign: "write.docusign",
  payment_link: "write.payment_link",
  bind: "write.bind",
  coi_issue: "write.coi.issue",
  coi_send: "write.coi.send",
  document_retrieval: "write.draft",
};

export function doorGate(door: MutationDoor) {
  return getCapabilityGate(DOOR_TO_CAPABILITY[door]);
}

/**
 * Execute a gated mutation door with confirmation + idempotency.
 * Bind stays blocked until a safe Agent Tools door exists (human portal).
 */
export async function executeMutationDoor(opts: {
  door: MutationDoor;
  operatorId: string;
  accountId: string | null;
  workItemId: string | null;
  confirmed: boolean;
  fingerprint: string;
  payload?: Record<string, unknown>;
}): Promise<ActionReceipt> {
  const capabilityId = DOOR_TO_CAPABILITY[opts.door];
  return dispatchAction(
    {
      capabilityId,
      operatorId: opts.operatorId,
      idempotencyKey: buildIdempotencyKey({
        operatorId: opts.operatorId,
        capabilityId,
        workItemId: opts.workItemId,
        fingerprint: opts.fingerprint,
      }),
      workItemId: opts.workItemId,
      accountId: opts.accountId,
      payload: opts.payload ?? {},
      confirmed: opts.confirmed,
    },
    { allowLegacyFallback: true },
  );
}
