import "server-only";

import {
  buildIdempotencyKey,
  dispatchAction,
} from "@/lib/adapters/agent-tools";
import { getCapabilityGate } from "@/lib/adapters/agent-tools/capabilities";
import {
  getServiceTemplate,
  lintPlaceholders,
} from "@/lib/templates-registry";
import type { ActionReceipt } from "@/lib/types";

export type ComposerDraft = {
  templateId: string | null;
  to: string;
  subject: string;
  body: string;
  accountId: string | null;
  workItemId: string | null;
  values: Record<string, string>;
};

export type ComposerValidation = {
  ok: boolean;
  blockers: string[];
  templateDiff: string | null;
};

export function validateComposerDraft(draft: ComposerDraft): ComposerValidation {
  const blockers: string[] = [];
  if (!draft.to.trim() || !draft.to.includes("@")) {
    blockers.push("Recipient email is required");
  }
  if (!draft.subject.trim()) blockers.push("Subject is required");
  if (!draft.body.trim()) blockers.push("Body is required");

  let templateDiff: string | null = null;
  if (draft.templateId) {
    const tmpl = getServiceTemplate(draft.templateId);
    if (!tmpl) blockers.push(`Unknown template ${draft.templateId}`);
    else {
      const lint = lintPlaceholders(tmpl, draft.values);
      if (lint.missing.length) {
        blockers.push(`Missing placeholders: ${lint.missing.join(", ")}`);
      }
      if (draft.body !== tmpl.body) {
        templateDiff = "Body edited from template — review before send";
      }
    }
  }

  const gate = getCapabilityGate("write.comms.email");
  if (gate.state !== "available") {
    blockers.push(gate.blockerLabel ?? "Send email unavailable");
  }

  return { ok: blockers.length === 0, blockers, templateDiff };
}

export async function sendComposerDraft(opts: {
  operatorId: string;
  draft: ComposerDraft;
  confirmed: boolean;
}): Promise<ActionReceipt> {
  const validation = validateComposerDraft(opts.draft);
  if (!validation.ok) {
    return {
      id: `rcpt_reject_${Date.now()}`,
      capabilityId: "write.comms.email",
      idempotencyKey: "n/a",
      status: "rejected",
      operatorId: opts.operatorId,
      workItemId: opts.draft.workItemId,
      accountId: opts.draft.accountId,
      summary: validation.blockers.join("; "),
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      verified: false,
      details: { blockers: validation.blockers.length },
    };
  }

  const fingerprint = [
    opts.draft.to,
    opts.draft.subject,
    opts.draft.templateId ?? "freeform",
  ].join("|");

  return dispatchAction(
    {
      capabilityId: "write.comms.email",
      operatorId: opts.operatorId,
      idempotencyKey: buildIdempotencyKey({
        operatorId: opts.operatorId,
        capabilityId: "write.comms.email",
        workItemId: opts.draft.workItemId,
        fingerprint,
      }),
      workItemId: opts.draft.workItemId,
      accountId: opts.draft.accountId,
      payload: {
        to: opts.draft.to,
        subject: opts.draft.subject,
        templateId: opts.draft.templateId,
      },
      confirmed: opts.confirmed,
    },
    { allowLegacyFallback: true },
  );
}
