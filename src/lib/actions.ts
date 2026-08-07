"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  applyBlanketFastPath,
  claimTicket,
  closeThread,
  createAndSendThread,
  createTicket,
  getAccountDetail,
  getOperator,
  getStreak,
  getTicketDetail,
  humanProceed,
  listUnderwriters,
  markAccountPaymentReceived,
  recordClientTerms,
  recordCoiDecision,
  recordPaymentCleared,
  recordSendOutcome,
  resetDatabase,
  setAutoSend,
  setTicketStatus,
  simulateUwQuote,
  updateOperator,
  updateUnderwriter,
} from "./db";
import {
  formatRequestStackLabel,
  getRequestType,
  primaryRequestType,
} from "./catalog";
import { buildTicketDraft } from "./draft";
import { evaluateBlanketFastPath } from "./fast-path";
import { getPolicyFormSet } from "./forms";
import { getActiveRedAlertForAccount } from "./red-alerts";
import { createModelSession } from "./model";
import { transport } from "./transport";
import { getSessionOperator } from "./session";
import {
  assertDeliverableEmail,
  assertVerifiedAddress,
  validateEmail,
} from "./validate-contact.server";
import { emailPasses } from "./validate-contact";
import type {
  LoopReasonId,
  Operator,
  RequestTypeId,
  TicketSource,
  TicketStatus,
} from "./types";

async function requireOperatorId(): Promise<string> {
  const operator = await getSessionOperator();
  if (!operator) {
    throw new Error(
      "Sign in before sending — your signature stamps every draft.",
    );
  }
  return operator.id;
}

function revalidateTicket(ticketId: string, accountId?: string) {
  revalidatePath("/");
  revalidatePath("/comms");
  revalidatePath("/ai-desk");
  revalidatePath("/me");
  revalidatePath(`/tickets/${ticketId}`);
  if (accountId) revalidatePath(`/accounts/${accountId}`);
}

export async function createTicketAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const policyIds = formData.getAll("policyIds").map(String).filter(Boolean);
  const requestType = String(formData.get("requestType") ?? "") as RequestTypeId;
  const source = String(formData.get("source") ?? "internal") as TicketSource;
  const requestedBy = String(formData.get("requestedBy") ?? "").trim();
  const requestedByEmail =
    String(formData.get("requestedByEmail") ?? "").trim() || null;
  const subject = String(formData.get("subject") ?? "").trim();
  const holderName = String(formData.get("holderName") ?? "").trim() || null;
  const holderAddress =
    String(formData.get("holderAddress") ?? "").trim() || null;
  const wording = String(formData.get("wording") ?? "").trim();
  const namedOnPolicyRequired = formData.get("namedOnPolicy") === "1";

  if (!accountId || policyIds.length === 0 || !requestType || !requestedBy) {
    throw new Error(
      "Account, at least one policy, request type, and who asked are all required.",
    );
  }

  // Hard gates re-run server-side — the client chips are a courtesy, this
  // is the stop. A validator outage blocks too; nothing passes unverified.
  if (requestedByEmail) {
    await assertDeliverableEmail(requestedByEmail, "Requester Email");
  }
  if (holderAddress) {
    await assertVerifiedAddress(holderAddress, "Holder Address");
  }

  const sessionOp = await getSessionOperator();
  const operatorId = sessionOp?.id ?? null;

  const ticket = createTicket({
    accountId,
    policyIds,
    requestType,
    source,
    requestedBy,
    requestedByEmail,
    subject,
    holderName,
    holderAddress,
    wording,
    namedOnPolicyRequired,
    operatorId,
  });

  // An active red alert stands the account down: no fast path, no auto-send.
  // The ticket still files — work is tracked, nothing pushes.
  const redAlert = getActiveRedAlertForAccount(accountId);

  // Blanket fast path first: if the paper already grants this and the holder
  // accepts wording, there is no market ask — the cert goes straight to
  // Ready To Issue with the form cited. A holder who must be named on the
  // policy skips this and rides the normal market path, blanket or not.
  const fast = redAlert
    ? ({ eligible: false, reason: "red_alert" } as const)
    : evaluateBlanketFastPath({
        requestType,
        wording,
        namedOnPolicyRequired,
        policies: ticket.policies.map((p) => ({
          policy: p,
          formSet: getPolicyFormSet(p),
        })),
      });
  if (fast.eligible) {
    applyBlanketFastPath(ticket.id, {
      basis: fast.basis,
      form: fast.form,
      policyNumber: fast.policy.policyNumber,
      requestLabel: getRequestType(requestType).label,
    });
  } else if (
    !redAlert &&
    operatorId &&
    getStreak(operatorId, requestType).autoSend
  ) {
    // Earned trust: this request type sends itself for this operator.
    await autoSendTicket(ticket.id, operatorId);
  }

  revalidateTicket(ticket.id, accountId);
  redirect(`/tickets/${ticket.id}`);
}

/**
 * Auto-send still respects every gate the button does. A block or a warning
 * that needs a human parks the ticket in Needs You instead of going out.
 */
async function autoSendTicket(ticketId: string, operatorId: string) {
  const ticket = getTicketDetail(ticketId);
  const operator = getOperator(operatorId);
  if (!ticket || !operator) return;

  const policy = ticket.policies[0];
  if (!policy) return;

  const session = createModelSession();
  const draft = buildTicketDraft({
    ticket,
    account: ticket.account,
    policy,
    carrierDesks: listUnderwriters(),
    operator,
  });

  if (draft.blocked || draft.needsAck || !draft.route?.sendEmail) {
    setTicketStatus(ticketId, "needs_you");
    return;
  }

  // Auto-send answers to the same recipient gate as the button. An email
  // that fails (or can't be checked) parks the ticket for a human — it
  // never goes out on trust.
  const recipient = draft.underwriter?.email ?? "";
  if (!recipient || !emailPasses(await validateEmail(recipient))) {
    setTicketStatus(ticketId, "needs_you");
    return;
  }

  const result = await transport.send({
    toName: draft.underwriter?.name ?? "Market",
    toEmail: draft.underwriter?.email ?? null,
    subject: draft.subject,
    body: draft.body,
    channel: draft.route.primary,
    attachments: [],
  });
  if (!result.ok) return;

  createAndSendThread({
    accountId: ticket.accountId,
    policyId: policy.id,
    requestType: ticket.requestType,
    details: draft.details,
    operatorId,
    ticketId: ticket.id,
    bodyOverride: draft.body,
    auto: true,
    modelCalls: session.calls,
  });
  recordSendOutcome({
    operatorId,
    requestType: ticket.requestType,
    clean: true,
  });
}

/**
 * The one button. Everything the ticket page showed you is what goes out —
 * verification blocks it, warnings need the ack, and a clean run without edits
 * moves this request type closer to auto-send.
 */
export async function sendTicketDraftAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const policyId = String(formData.get("policyId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const ackWarnings = formData.get("ackWarnings") === "1";
  const edited = formData.get("edited") === "1";
  const loopReason =
    (String(formData.get("loopReason") ?? "").trim() as LoopReasonId) || null;
  const attachments = formData
    .getAll("attachments")
    .map(String)
    .filter(Boolean)
    .map((name) => ({ name }));

  const operatorId = await requireOperatorId();
  const ticket = getTicketDetail(ticketId);
  if (!ticket) throw new Error("Ticket not found");

  const policy =
    ticket.policies.find((p) => p.id === policyId) ?? ticket.policies[0];
  if (!policy) throw new Error("No policy on this ticket");

  // Any outbound after the first needs a reason — that tag is the whole point.
  if (ticket.threads.length > 0 && !loopReason) {
    throw new Error(
      "This ticket already has a market thread — tag why you're going back out.",
    );
  }

  // Owns every model call made on the way to this email. Nothing generates
  // through another path, so the trace can never be half the story.
  const session = createModelSession();

  const draft = buildTicketDraft({
    ticket,
    account: ticket.account,
    policy,
    carrierDesks: listUnderwriters(),
    operator: null,
  });

  // A rewritten body means whatever was generated did not ship.
  if (edited && session.used) {
    session.markAllOverridden("Operator rewrote the body before sending");
  }

  // Recipient hard gate — server-side, so no client state can sneak a send
  // past a dead or wrong mailbox.
  if (draft.route?.sendEmail) {
    await assertDeliverableEmail(
      draft.underwriter?.email ?? "",
      "Recipient Email",
    );
  }

  const result = await transport.send({
    toName: draft.underwriter?.name ?? "Market",
    toEmail: draft.route?.sendEmail ? (draft.underwriter?.email ?? null) : null,
    subject: draft.subject,
    body,
    channel: draft.route?.primary ?? "email",
    attachments,
  });
  if (!result.ok) throw new Error("The mailbox rejected this send");

  const thread = createAndSendThread({
    accountId: ticket.accountId,
    policyId: policy.id,
    requestType: ticket.requestType,
    details: draft.details,
    operatorId,
    ackWarnings,
    ticketId: ticket.id,
    loopReason,
    bodyOverride: body,
    attachments,
    edited,
    modelCalls: session.calls,
  });

  claimTicket(ticket.id, operatorId);
  recordSendOutcome({
    operatorId,
    requestType: ticket.requestType,
    clean: !edited && !ackWarnings,
  });

  revalidateTicket(ticket.id, ticket.accountId);
  revalidatePath(`/threads/${thread.id}`);

  return { threadId: thread.id, note: result.note };
}

export async function setTicketStatusAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const status = String(formData.get("status") ?? "") as TicketStatus;
  if (!ticketId || !status) throw new Error("Missing ticket or status");

  const ticket = setTicketStatus(ticketId, status);
  revalidateTicket(ticketId, ticket.accountId);
}

export async function claimTicketAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const operatorId = await requireOperatorId();
  const ticket = claimTicket(ticketId, operatorId);
  revalidateTicket(ticketId, ticket.accountId);
  if (formData.get("open") === "1") {
    redirect(`/tickets/${ticket.id}`);
  }
}

export async function setAutoSendAction(formData: FormData) {
  const requestType = String(formData.get("requestType") ?? "") as RequestTypeId;
  const on = formData.get("on") === "1";
  const operatorId = await requireOperatorId();
  setAutoSend(operatorId, requestType, on);
  revalidatePath("/me");
  revalidatePath("/ai-desk");
}

export async function updateProfileAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const signature = String(formData.get("signature") ?? "").trim();
  const defaultTemplate = String(
    formData.get("defaultTemplate") ?? "standard",
  ) as Operator["defaultTemplate"];

  if (!id || !displayName || !email || !title || !signature) {
    throw new Error("Name, email, title, and signature are required");
  }

  await assertDeliverableEmail(email, "Profile Email");

  updateOperator(id, {
    displayName,
    email,
    title,
    phone,
    signature,
    defaultTemplate,
  });

  revalidatePath("/me");
  revalidatePath("/");
  revalidatePath("/threads");
}

/**
 * Sandbox compose: open a ticket + send the first UW email in one step.
 * Supports a stack of request types (AI + WOS + 30-day notice, etc.).
 * Operator signature is required (sign in on Profile).
 */
export async function sendSandboxAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const policyId = String(formData.get("policyId") ?? "");
  const details = String(formData.get("details") ?? "");
  const templateId = String(
    formData.get("templateId") ?? "standard",
  ) as Operator["defaultTemplate"];

  let stack: RequestTypeId[] = [];
  const rawStack = String(formData.get("requestTypes") ?? "");
  if (rawStack) {
    try {
      const parsed = JSON.parse(rawStack) as unknown;
      if (Array.isArray(parsed)) {
        stack = parsed.filter((x): x is RequestTypeId => typeof x === "string");
      }
    } catch {
      stack = [];
    }
  }
  const legacy = String(formData.get("requestType") ?? "") as RequestTypeId;
  if (stack.length === 0 && legacy) stack = [legacy];

  if (!accountId || !policyId || stack.length === 0) {
    throw new Error("Account, policy, and at least one request type are required.");
  }

  const requestType = primaryRequestType(stack);
  const stackLabel = formatRequestStackLabel(stack);
  const itemLines =
    stack.length > 1
      ? stack.map((id) => {
          const r = getRequestType(id);
          return `${r.label} (${r.premiumBearing === "usually" || r.premiumBearing === "sometimes" ? "premium possible" : "usually no premium"})`;
        })
      : undefined;

  const wording =
    stack.length > 1
      ? [
          `Stacked requests: ${stack.map((id) => getRequestType(id).label).join(" · ")}`,
          "",
          details.trim(),
        ]
          .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
          .join("\n")
      : details;

  const operatorId = await requireOperatorId();
  const operator = getOperator(operatorId);
  if (!operator) throw new Error("Operator not found — sign in on Profile.");

  // Recipient hard gate — the primary UW on file must have a mail-taking
  // domain before this compose creates a thread.
  const uwEmail = getAccountDetail(accountId)?.primaryUw.email ?? "";
  await assertDeliverableEmail(uwEmail, "Underwriter Email");

  const ticket = createTicket({
    accountId,
    policyIds: [policyId],
    requestType,
    source: "internal",
    requestedBy: operator.displayName,
    requestedByEmail: operator.email,
    subject: stack.length > 1 ? stackLabel : "",
    holderName: null,
    holderAddress: null,
    wording,
    operatorId,
  });

  const thread = createAndSendThread({
    accountId,
    policyId,
    requestType,
    details: wording,
    requestLabel: stackLabel,
    requestItems: itemLines,
    operatorId,
    templateId,
    ticketId: ticket.id,
    ackWarnings: true,
  });

  revalidatePath("/");
  revalidatePath("/queue");
  revalidatePath("/threads");
  revalidatePath("/oversight");
  revalidatePath("/comms");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath(`/tickets/${ticket.id}`);
  revalidatePath(`/threads/${thread.id}`);

  return { threadId: thread.id, ticketId: ticket.id };
}

export async function simulateQuoteAction(formData: FormData) {
  const threadId = String(formData.get("threadId") ?? "");
  const dollars = Number(formData.get("dollars") ?? 0);
  const cents = Math.round(dollars * 100);

  const thread = simulateUwQuote(threadId, cents);

  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/threads");
  revalidatePath("/oversight");
  revalidatePath("/comms");
  revalidatePath(`/accounts/${thread.accountId}`);
  if (thread.ticketId) revalidatePath(`/tickets/${thread.ticketId}`);

  return { threadId };
}

export async function humanProceedAction(formData: FormData) {
  const threadId = String(formData.get("threadId") ?? "");
  const thread = humanProceed(threadId);

  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/threads");
  revalidatePath("/oversight");
  revalidatePath(`/accounts/${thread.accountId}`);
}

export async function sendClientTermsAction(formData: FormData) {
  const threadId = String(formData.get("threadId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const paymentReference =
    String(formData.get("paymentReference") ?? "").trim() || null;

  if (!threadId || !body) throw new Error("Nothing to send");

  const thread = recordClientTerms({ threadId, body, paymentReference });

  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/threads");
  revalidatePath("/oversight");
  revalidatePath("/me");
  revalidatePath(`/accounts/${thread.accountId}`);
}

export async function markPaymentClearedAction(formData: FormData) {
  const threadId = String(formData.get("threadId") ?? "");
  if (!threadId) throw new Error("Missing thread");

  const thread = recordPaymentCleared(threadId);

  revalidatePath("/");
  revalidatePath("/comms");
  revalidatePath("/me");
  revalidatePath(`/accounts/${thread.accountId}`);
  if (thread.ticketId) revalidatePath(`/tickets/${thread.ticketId}`);
}

/**
 * Account-level activation: payment landed, pre-bind becomes active service.
 * Distinct from markPaymentClearedAction, which clears a quoted endorsement
 * premium on one thread.
 */
export async function markAccountPaymentReceivedAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) throw new Error("Missing account");
  await requireOperatorId();

  markAccountPaymentReceived(accountId);

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/certificates");
}

export async function recordCoiDecisionAction(formData: FormData) {
  const threadId = String(formData.get("threadId") ?? "");
  const decision = String(formData.get("decision") ?? "") as "issued" | "rejected";
  const summary = String(formData.get("summary") ?? "").trim();

  if (!threadId || (decision !== "issued" && decision !== "rejected")) {
    throw new Error("Bad certificate decision");
  }

  const thread = recordCoiDecision({ threadId, decision, summary });

  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/threads");
  revalidatePath("/oversight");
  revalidatePath("/me");
  revalidatePath(`/accounts/${thread.accountId}`);
}

export async function closeThreadAction(formData: FormData) {
  const threadId = String(formData.get("threadId") ?? "");
  const thread = closeThread(threadId);

  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/threads");
  revalidatePath("/oversight");
  revalidatePath("/me");
  revalidatePath(`/accounts/${thread.accountId}`);
}

export async function updateUwAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const email = String(formData.get("email") ?? "");
  await assertDeliverableEmail(email, "Underwriter Email");
  updateUnderwriter(id, {
    name: String(formData.get("name") ?? ""),
    email,
    phone: String(formData.get("phone") ?? "") || null,
    portal: String(formData.get("portal") ?? "") || null,
    notes: String(formData.get("notes") ?? "") || null,
  });

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/");
  revalidatePath("/oversight");
}

export async function resetDbAction() {
  resetDatabase();
  revalidatePath("/");
  revalidatePath("/queue");
  revalidatePath("/accounts");
  revalidatePath("/threads");
  revalidatePath("/oversight");
  revalidatePath("/comms");
  revalidatePath("/ai-desk");
  revalidatePath("/me");
}
