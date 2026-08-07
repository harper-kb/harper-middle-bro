import { AUTO_APPROVE_THRESHOLD_CENTS } from "./types";

export function canAutoApprove(premiumImpactCents: number | null | undefined): boolean {
  if (premiumImpactCents == null) return false;
  return premiumImpactCents <= AUTO_APPROVE_THRESHOLD_CENTS;
}

export function buildProceedReply(premiumImpactCents: number): string {
  if (premiumImpactCents === 0) {
    return "Confirmed — no additional premium. We'll issue the certificate from the policy and file a copy. Thank you.";
  }
  const dollars = (premiumImpactCents / 100).toFixed(2);
  return `Proceed — please bind/endorse as quoted. Premium impact of $${dollars} is within our auto-approval threshold (≤ $500). Thank you.`;
}

export function buildHumanHoldReply(premiumImpactCents: number): string {
  const dollars = (premiumImpactCents / 100).toFixed(2);
  return `Thanks for the quote of $${dollars}. This exceeds our auto-approval threshold of $500 — a Harper CSR will confirm shortly.`;
}
