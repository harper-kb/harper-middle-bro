import "server-only";

import {
  buildIdempotencyKey,
  dispatchAction,
} from "@/lib/adapters/agent-tools";
import type { ActionReceipt, CapabilityId } from "@/lib/types";
import {
  filterBulkRecipients,
  type BulkRecipient,
} from "./bulk-filter";

export type { BulkRecipient } from "./bulk-filter";
export { filterBulkRecipients } from "./bulk-filter";

export type BulkBatchPlan = {
  batchId: string;
  templateId: string;
  channel: "email" | "text";
  recipients: BulkRecipient[];
};

/**
 * One batch review/confirmation, then per-recipient execution + receipts.
 */
export async function executeBulkBatch(opts: {
  operatorId: string;
  plan: BulkBatchPlan;
  confirmed: boolean;
}): Promise<{ batchReceipt: ActionReceipt; perRecipient: ActionReceipt[] }> {
  const { included } = filterBulkRecipients(
    opts.plan.recipients,
    opts.plan.channel,
  );
  const batchKey = buildIdempotencyKey({
    operatorId: opts.operatorId,
    capabilityId: "write.comms.bulk",
    workItemId: opts.plan.batchId,
    fingerprint: `${opts.plan.templateId}:${opts.plan.channel}:${included.length}`,
  });

  const batchReceipt = await dispatchAction({
    capabilityId: "write.comms.bulk",
    operatorId: opts.operatorId,
    idempotencyKey: batchKey,
    workItemId: null,
    accountId: null,
    payload: {
      batchId: opts.plan.batchId,
      templateId: opts.plan.templateId,
      channel: opts.plan.channel,
      recipientCount: included.length,
    },
    confirmed: opts.confirmed,
  });

  const perRecipient: ActionReceipt[] = [];
  // Fan-out only after a real confirm (or successful idempotent replay of one).
  if (
    batchReceipt.status === "confirmed" ||
    batchReceipt.status === "idempotent_replay"
  ) {
    const capabilityId: CapabilityId =
      opts.plan.channel === "text" ? "write.comms.text" : "write.comms.email";
    for (const r of included) {
      perRecipient.push(
        await dispatchAction(
          {
            capabilityId,
            operatorId: opts.operatorId,
            idempotencyKey: buildIdempotencyKey({
              operatorId: opts.operatorId,
              capabilityId,
              workItemId: r.workItemId,
              fingerprint: `${opts.plan.batchId}:${r.to}`,
            }),
            workItemId: r.workItemId,
            accountId: r.accountId,
            payload: { to: r.to, batchId: opts.plan.batchId, channel: opts.plan.channel },
            confirmed: true,
          },
          { allowLegacyFallback: true },
        ),
      );
    }
  }

  return { batchReceipt, perRecipient };
}
