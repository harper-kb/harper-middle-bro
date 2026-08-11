import "server-only";

import type {
  ActionAdapter,
  ActionReceipt,
  ActionRequest,
  CapabilityId,
  ConfirmationPolicy,
} from "@/lib/types";
import { getCapabilityGate, CAPABILITY_DEFS } from "./capabilities";
import { executeAgentToolsCommand } from "./client";
import {
  newReceiptId,
  recallIdempotent,
  storeReceipt,
} from "./idempotency";
import { getLegacyFallback } from "./legacy";

const CONFIRMATION_BY_CAPABILITY: Partial<Record<CapabilityId, ConfirmationPolicy>> = {
  "write.comms.email": "one_click",
  "write.comms.text": "one_click",
  "write.comms.bulk": "batch_review",
  "write.docusign": "one_click",
  "write.payment_link": "one_click",
  "write.bind": "one_click",
  "write.coi.issue": "one_click",
  "write.coi.send": "one_click",
  "write.draft": "none",
  "write.issue": "none",
  "write.task": "none",
  "write.reminder": "one_click",
};

function confirmationFor(id: CapabilityId): ConfirmationPolicy {
  return CONFIRMATION_BY_CAPABILITY[id] ?? "one_click";
}

function commandFor(id: CapabilityId): string | null {
  return CAPABILITY_DEFS.find((d) => d.id === id)?.command ?? null;
}

function baseReceipt(
  request: ActionRequest,
  status: ActionReceipt["status"],
  summary: string,
  details: ActionReceipt["details"] = {},
): ActionReceipt {
  const now = new Date().toISOString();
  return {
    id: newReceiptId(),
    capabilityId: request.capabilityId,
    idempotencyKey: request.idempotencyKey,
    status,
    operatorId: request.operatorId,
    workItemId: request.workItemId,
    accountId: request.accountId,
    summary,
    requestedAt: now,
    completedAt: status === "accepted" ? null : now,
    verified: status === "confirmed" || status === "idempotent_replay" ? true : null,
    details,
  };
}

export async function dispatchAction(
  request: ActionRequest,
  opts?: { allowLegacyFallback?: boolean },
): Promise<ActionReceipt> {
  const prior = recallIdempotent(request.idempotencyKey);
  if (prior) {
    const replay: ActionReceipt = {
      ...prior,
      status: "idempotent_replay",
      summary: `Idempotent replay — ${prior.summary}`,
    };
    return replay;
  }

  const gate = getCapabilityGate(request.capabilityId);
  const policy = confirmationFor(request.capabilityId);
  if (policy !== "none" && !request.confirmed) {
    const receipt = baseReceipt(
      request,
      "rejected",
      `Confirmation required (${policy}) before ${request.capabilityId}`,
      { confirmation: policy },
    );
    storeReceipt(receipt);
    return receipt;
  }

  if (gate.state === "unavailable") {
    const receipt = baseReceipt(
      request,
      "rejected",
      gate.blockerLabel ?? "Capability unavailable",
      { gate: gate.state },
    );
    storeReceipt(receipt);
    return receipt;
  }

  if (gate.state === "blocked") {
    if (opts?.allowLegacyFallback) {
      const legacy = getLegacyFallback(request.capabilityId);
      if (legacy) {
        const receipt = await legacy.execute(request);
        storeReceipt(receipt);
        return receipt;
      }
    }
    const receipt = baseReceipt(
      request,
      "rejected",
      gate.blockerLabel ?? "Capability blocked",
      { gate: gate.state, provider: gate.provider },
    );
    storeReceipt(receipt);
    return receipt;
  }

  const command = commandFor(request.capabilityId);
  if (!command) {
    const receipt = baseReceipt(
      request,
      "rejected",
      `No Agent Tools command mapped for ${request.capabilityId}`,
    );
    storeReceipt(receipt);
    return receipt;
  }

  try {
    const result = await executeAgentToolsCommand(command, {
      ...request.payload,
      idempotency_key: request.idempotencyKey,
      operator_id: request.operatorId,
      work_item_id: request.workItemId,
      account_id: request.accountId,
    });
    if (!result.ok) {
      const receipt = baseReceipt(
        request,
        "failed",
        result.error ?? "Agent Tools execution failed",
        { httpStatus: result.status },
      );
      storeReceipt(receipt);
      return receipt;
    }
    const receipt = baseReceipt(
      request,
      "confirmed",
      `Executed ${command}`,
      {
        command,
        // Keep only scalar crumbs from the response
        resultKeys: Object.keys(result.data).length,
      },
    );
    storeReceipt(receipt);
    return receipt;
  } catch (err) {
    const receipt = baseReceipt(
      request,
      "failed",
      err instanceof Error ? err.message : "Agent Tools error",
    );
    storeReceipt(receipt);
    return receipt;
  }
}

export function createAgentToolsActionAdapter(
  capabilityId: CapabilityId,
): ActionAdapter {
  return {
    capabilityId,
    confirmation: confirmationFor(capabilityId),
    provider: "agent_tools",
    execute: (request) => dispatchAction(request),
  };
}
