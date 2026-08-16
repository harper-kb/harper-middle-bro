import { coverageLabels, getRequestType } from "../catalog";
import { resolveChannel, type ChannelRoute } from "../threads/channels";
import { renderEmailBody, type EmailTemplateId } from "../threads/templates";
import { verifyBeforeSend, type VerifyResult } from "../threads/verify";
import type {
  AccountDetail,
  Operator,
  Policy,
  Ticket,
  Underwriter,
} from "../types";

/**
 * The draft exists before you open the ticket.
 *
 * Pure on purpose: the ticket page renders exactly what the send path will
 * write, so nothing about the email is a surprise at click time.
 */

export interface TicketDraft {
  policy: Policy;
  underwriter: Underwriter | null;
  verify: VerifyResult;
  route: ChannelRoute | null;
  subject: string;
  body: string;
  details: string;
  blocked: boolean;
  needsAck: boolean;
}

/** What we're actually asking the market for, in their reading order. */
export function buildTicketDetails(ticket: Ticket): string {
  const lines: string[] = [];
  const label = getRequestType(ticket.requestType).label.toLowerCase();

  if (ticket.holderName) {
    lines.push(`Please add the following as ${label}:`, "", ticket.holderName);
    if (ticket.holderAddress) lines.push(ticket.holderAddress);
    if (ticket.wording.trim()) lines.push("", ticket.wording.trim());
  } else {
    lines.push(ticket.wording.trim() || `Please process a ${label}.`);
  }

  if (ticket.namedOnPolicyRequired) {
    lines.push(
      "",
      "Note: this holder contractually requires being named on the policy — blanket wording will not satisfy their contract. Please schedule the entity by endorsement and advise if a charge applies.",
    );
  }

  return lines.join("\n");
}

export function buildTicketDraft(input: {
  ticket: Ticket;
  account: AccountDetail;
  policy: Policy;
  carrierDesks: Underwriter[];
  operator: Operator | null;
  templateId?: EmailTemplateId;
}): TicketDraft {
  const { ticket, account, policy, carrierDesks, operator } = input;

  const verify = verifyBeforeSend({
    account,
    policy,
    requestType: ticket.requestType,
    carrierDesks,
    wording: ticket.wording,
  });
  const underwriter = verify.matchedUw;

  const route = underwriter
    ? resolveChannel({
        carrier: policy.carrier,
        requestType: ticket.requestType,
        uwEmail: underwriter.email,
        uwPhone: underwriter.phone,
        uwPortal: underwriter.portal,
        serviceEmail: underwriter.serviceEmail,
      })
    : null;

  const req = getRequestType(ticket.requestType);
  const details = buildTicketDetails(ticket);
  const subject = `${route && !route.sendEmail ? "[Portal]" : "[Harper]"} ${req.label} — ${account.name} (${policy.policyNumber})`;

  const body = underwriter
    ? renderEmailBody(input.templateId ?? operator?.defaultTemplate ?? "standard", {
        accountName: account.name,
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        coverages: coverageLabels(policy.coverages),
        uwName: underwriter.name,
        requestLabel: req.label,
        details,
        signature: operator?.signature ?? "",
      })
    : "No underwriter on file for this carrier — fix Contacts before this can go out.";

  return {
    policy,
    underwriter,
    verify,
    route,
    subject,
    body,
    details,
    blocked: !verify.okToSend || !underwriter,
    needsAck: verify.needsAck,
  };
}
