"use server";

import { revalidatePath } from "next/cache";
import {
  applyBlanketFastPath,
  attachIntakeToTicket,
  claimTicket,
  createTicket,
  dismissIntakeEvent,
  escalateTicket,
  getIntakeEvent,
  getTicketDetail,
  grantAccountAccess,
  recordCarrierKnowledgeBlock,
  recordIntakeAck,
  resolveEscalation,
  revokeAccountAccess,
  setOperatorRole,
} from "./db";
import { evaluateKnowledgeForRequest } from "./carrier-knowledge";
import { getRequestType } from "./catalog";
import { evaluateBlanketFastPath } from "./fast-path";
import { getPolicyFormSet } from "./forms";
import {
  getActiveRedAlertForAccount,
  raiseRedAlert,
  resolveRedAlert,
} from "./red-alerts";
import { buildServiceAck } from "./service-ack";
import { getSessionOperator } from "./session";
import type { Operator, RequestTypeId } from "./types";

/**
 * Server actions for the desk-management layer: grants, assignment,
 * escalation, and comm-intake triage. Lives apart from actions.ts so the
 * dashboards, pending board, and comms surfaces share one mutation module.
 */

async function requireOperator(): Promise<Operator> {
  const operator = await getSessionOperator();
  if (!operator) throw new Error("Sign in to work the desk.");
  return operator;
}

async function requireManager(): Promise<Operator> {
  const operator = await requireOperator();
  if (operator.role !== "manager") {
    throw new Error("Manager access only.");
  }
  return operator;
}

function revalidateDesk() {
  revalidatePath("/manager");
  revalidatePath("/my-day");
  revalidatePath("/pending");
  revalidatePath("/queue");
  revalidatePath("/comms");
}

// ————————————————— Grants & Roles —————————————————

export async function grantAccountAccessAction(formData: FormData) {
  const manager = await requireManager();
  grantAccountAccess({
    operatorId: String(formData.get("operatorId") ?? ""),
    accountId: String(formData.get("accountId") ?? ""),
    grantedBy: manager.id,
  });
  revalidateDesk();
}

export async function revokeAccountAccessAction(formData: FormData) {
  await requireManager();
  revokeAccountAccess(
    String(formData.get("operatorId") ?? ""),
    String(formData.get("accountId") ?? ""),
  );
  revalidateDesk();
}

/**
 * Sandbox convenience: the demo database can't know which Clerk sign-in is
 * the real manager, so a signed-in operator may claim the manager seat once.
 * In production this comes from the org directory, not a button.
 */
export async function assumeManagerRoleAction() {
  const operator = await requireOperator();
  setOperatorRole(operator.id, "manager");
  revalidateDesk();
}

// ————————————————— Assignment & Escalation —————————————————

export async function assignTicketAction(formData: FormData) {
  await requireManager();
  const ticketId = String(formData.get("ticketId") ?? "");
  const operatorId = String(formData.get("operatorId") ?? "");
  if (!ticketId || !operatorId) throw new Error("Pick a ticket and an operator.");
  claimTicket(ticketId, operatorId);
  revalidateDesk();
  revalidatePath(`/tickets/${ticketId}`);
}

/** "Hey, you help — I'll flag it, you get to it by end of day." */
export async function escalateTicketAction(formData: FormData) {
  const operator = await requireOperator();
  const ticketId = String(formData.get("ticketId") ?? "");
  const toOperatorId = String(formData.get("toOperatorId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!ticketId || !toOperatorId) throw new Error("Pick who to flag this to.");
  if (!note) throw new Error("Say what you need — a flag with no note helps nobody.");
  escalateTicket({
    ticketId,
    toOperatorId,
    note: `${note} — flagged by ${operator.displayName}`,
  });
  revalidateDesk();
  revalidatePath(`/tickets/${ticketId}`);
}

export async function resolveEscalationAction(formData: FormData) {
  await requireOperator();
  const ticketId = String(formData.get("ticketId") ?? "");
  resolveEscalation(ticketId);
  revalidateDesk();
  revalidatePath(`/tickets/${ticketId}`);
}

// ————————————————— Comm Intake Triage —————————————————

/**
 * Confirm an intake event into its own ticket. The triaging operator picks
 * the request type and policies — the desk never guesses those. Email
 * intake gets the acknowledgment recorded ("we got it, here's your SR");
 * outbound-send gates are untouched because nothing here emails the market.
 */
export async function confirmIntakeTicketAction(formData: FormData) {
  const operator = await requireOperator();
  const intakeId = String(formData.get("intakeId") ?? "");
  const requestType = String(formData.get("requestType") ?? "") as RequestTypeId;
  const policyIds = formData.getAll("policyIds").map(String).filter(Boolean);
  const holderName = String(formData.get("holderName") ?? "").trim() || null;
  const wording = String(formData.get("wording") ?? "").trim();
  const namedOnPolicyRequired = formData.get("namedOnPolicyRequired") === "on";

  const event = getIntakeEvent(intakeId);
  if (!event) throw new Error("Intake event not found.");
  if (event.status !== "pending") throw new Error("Already triaged.");
  if (!event.accountId) {
    throw new Error("Match this comm to an account before opening a ticket.");
  }
  if (policyIds.length === 0) throw new Error("Pick at least one policy.");

  const ticket = createTicket({
    accountId: event.accountId,
    policyIds,
    requestType,
    source: event.channel === "email" ? "email" : event.channel === "text" ? "sms" : "phone",
    requestedBy: event.fromName,
    requestedByEmail: event.channel === "email" ? event.fromContact : null,
    subject: event.subject ?? undefined,
    holderName,
    wording: wording || event.body,
    namedOnPolicyRequired,
    operatorId: operator.id,
  });

  // Carrier knowledge gate — same doctrine as the new-ticket form: a
  // registry blocker at intake is recorded as a decision trace citing the
  // entry, and the send path enforces it server-side.
  const effectiveWording = wording || event.body;
  const knowledgeBlockers = ticket.policies.flatMap((p) =>
    evaluateKnowledgeForRequest({
      requestType,
      wording: effectiveWording,
      policy: p,
      account: {
        state: ticket.account.state,
        industry: ticket.account.industry,
      },
    }).filter((h) => h.entry.severity === "blocker"),
  );
  if (knowledgeBlockers.length > 0) {
    const policy = ticket.policies[0];
    recordCarrierKnowledgeBlock({
      ticketId: ticket.id,
      requestLabel: getRequestType(requestType).label,
      policy: {
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        coverages: policy.coverages,
      },
      account: {
        name: ticket.account.name,
        state: ticket.account.state,
        industry: ticket.account.industry,
      },
      hits: knowledgeBlockers.map((h) => ({
        id: h.entry.id,
        title: h.entry.title,
        detail: h.entry.detail,
        consequence: h.entry.consequence,
        severity: h.entry.severity,
      })),
    });
  }

  // Same fast-path doctrine as the new-ticket form: blanket wording already
  // on the paper means no market touch. An active red alert stands the
  // account down — the ticket files, nothing pushes.
  const fast = getActiveRedAlertForAccount(event.accountId)
    ? ({ eligible: false, reason: "red_alert" } as const)
    : evaluateBlanketFastPath({
        requestType,
        wording: effectiveWording,
        namedOnPolicyRequired,
        policies: ticket.policies.map((p) => ({
          policy: p,
          formSet: getPolicyFormSet(p),
        })),
        account: {
          state: ticket.account.state,
          industry: ticket.account.industry,
        },
      });
  if (fast.eligible) {
    applyBlanketFastPath(ticket.id, {
      basis: fast.basis,
      form: fast.form,
      policyNumber: fast.policy.policyNumber,
      requestLabel: getRequestType(requestType).label,
    });
  }

  attachIntakeToTicket({ intakeId, ticketId: ticket.id, merged: false });

  if (event.channel === "email") {
    const ack = buildServiceAck({ event, ticket });
    recordIntakeAck(intakeId, `${ack.subject}\n\n${ack.body}`);
  }

  revalidateDesk();
  revalidatePath(`/tickets/${ticket.id}`);
}

/** High-confidence duplicate: attach the comm to the ticket it repeats. */
export async function mergeIntakeIntoTicketAction(formData: FormData) {
  await requireOperator();
  const intakeId = String(formData.get("intakeId") ?? "");
  const ticketId = String(formData.get("ticketId") ?? "");
  const event = getIntakeEvent(intakeId);
  const ticket = getTicketDetail(ticketId);
  if (!event || !ticket) throw new Error("Intake event or ticket not found.");

  attachIntakeToTicket({ intakeId, ticketId, merged: true });

  if (event.channel === "email") {
    const ack = buildServiceAck({ event, ticket });
    recordIntakeAck(intakeId, `${ack.subject}\n\n${ack.body}`);
  }

  revalidateDesk();
  revalidatePath(`/tickets/${ticketId}`);
}

export async function dismissIntakeEventAction(formData: FormData) {
  await requireOperator();
  dismissIntakeEvent(String(formData.get("intakeId") ?? ""));
  revalidateDesk();
}

// ————————————————— Red Alerts —————————————————

/**
 * Any operator can raise a red alert the moment the contradiction surfaces —
 * a No Loss letter on record and someone acknowledging claims. Waiting for a
 * manager to notice is how these get pushed anyway.
 */
export async function raiseRedAlertAction(formData: FormData) {
  const operator = await requireOperator();
  const accountId = String(formData.get("accountId") ?? "");
  const noLossRef = String(formData.get("noLossRef") ?? "").trim();
  const claimsRef = String(formData.get("claimsRef") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!accountId) throw new Error("Account is required.");
  if (!noLossRef) {
    throw new Error(
      "Cite the No Loss letter — what was sent, when, and to whom.",
    );
  }
  if (!claimsRef) {
    throw new Error(
      "Cite the claims acknowledgment — who said it, where, and when.",
    );
  }
  raiseRedAlert({
    accountId,
    noLossRef,
    claimsRef,
    note,
    raisedBy: operator.displayName,
  });
  revalidateDesk();
  revalidatePath(`/accounts/${accountId}`);
}

/** Standing down stands down until a manager writes the resolution on record. */
export async function resolveRedAlertAction(formData: FormData) {
  const manager = await requireManager();
  const alertId = String(formData.get("alertId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const resolutionNote = String(formData.get("resolutionNote") ?? "").trim();
  if (!alertId) throw new Error("Alert not found.");
  if (!resolutionNote) {
    throw new Error(
      "A red alert only clears with a written resolution — say what was corrected and how.",
    );
  }
  resolveRedAlert(alertId, manager.displayName, resolutionNote);
  revalidateDesk();
  if (accountId) revalidatePath(`/accounts/${accountId}`);
}
