import { formatMoney } from "../format";
import { getRequestType } from "../catalog";
import type { PaymentLink } from "../payments";
import type { RequestSummary } from "../threads/request-summary";
import type { Message, Operator, ThreadDetail } from "../types";

/**
 * The over-threshold relay: when the carrier comes back with a premium we
 * can't auto-approve, the client has to see three things and nothing else —
 * what they asked for, what the carrier said, and how to pay for it.
 */

export interface ClientTermsEmail {
  subject: string;
  body: string;
}

function quoteBlock(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((l) => `  > ${l.trim()}`)
    .join("\n");
}

function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

/** The underwriter's own words on the quote — never paraphrased. */
export function findQuoteMessage(thread: ThreadDetail): Message | null {
  const priced = thread.messages.filter(
    (m) => m.role === "underwriter" && m.premiumImpactCents != null,
  );
  if (priced.length) return priced[priced.length - 1];
  const uw = thread.messages.filter((m) => m.role === "underwriter");
  return uw.length ? uw[uw.length - 1] : null;
}

export function buildClientTermsEmail(input: {
  thread: ThreadDetail;
  request: RequestSummary;
  payment: PaymentLink | null;
  operator: Operator | null;
  /** Override the carrier's words if the operator trimmed them */
  termsText?: string;
}): ClientTermsEmail {
  const { thread, request, payment, operator } = input;
  const req = getRequestType(thread.requestType);
  const premium = thread.offeredPremiumCents ?? 0;
  const uwMessage = findQuoteMessage(thread);
  const terms = (input.termsText ?? uwMessage?.body ?? "").trim();

  const subject = `${req.label} — ${thread.account.name} (${thread.policy.policyNumber})`;

  const requested = [
    `• Request: ${req.label}`,
    request.holderName ? `• Certificate Holder: ${request.holderName}` : null,
    request.holderAddress ? `• Holder Address: ${request.holderAddress}` : null,
    request.wording ? `• In Your Words: ${request.wording}` : null,
    `• Policy: ${thread.policy.policyNumber} (${thread.policy.carrier})`,
  ].filter(Boolean) as string[];

  const carrierTerms = [
    `• Additional Premium: ${formatMoney(premium)}`,
    `• Underwriter: ${thread.underwriter.name}, ${thread.policy.carrier}`,
    `• Applies To: ${thread.policy.policyNumber}, term through ${longDate(thread.policy.expirationDate)}`,
  ];

  const sections = [
    `Hi there,`,
    ``,
    `Your ${req.label.toLowerCase()} request came back from the carrier with an additional premium, so it needs your approval before we can move.`,
    ``,
    `What You Asked For`,
    ...requested,
    ``,
    `Terms From The Carrier`,
    ...carrierTerms,
  ];

  if (terms) {
    sections.push(``, `Straight from ${thread.underwriter.name}:`, quoteBlock(terms));
  }

  if (payment) {
    sections.push(
      ``,
      `To Move Forward`,
      `Approve and pay here: ${payment.url}`,
      `• Amount: ${formatMoney(payment.amountCents)}`,
      `• Reference: ${payment.reference}`,
      `• Good Through: ${longDate(payment.expiresAt)}`,
      ``,
      `Once payment clears we'll have the carrier issue the endorsement and send you the updated certificate. Nothing changes on your policy until then.`,
    );
  } else {
    sections.push(
      ``,
      `To Move Forward`,
      `Reply "approved" and we'll have the carrier issue the endorsement.`,
    );
  }

  sections.push(``, `Questions on any of this, just reply here.`);

  const signature = operator?.signature?.trim();
  if (signature) sections.push(``, signature);

  return { subject, body: sections.join("\n") };
}
