import { evaluateKnowledgeForRequest } from "../carriers/carrier-knowledge";
import type { Account, Policy, RequestTypeId, Underwriter } from "../types";

export type VerifySeverity = "ok" | "warn" | "block";

export interface VerifyIssue {
  id: string;
  severity: VerifySeverity;
  title: string;
  detail: string;
}

export interface VerifyResult {
  okToSend: boolean;
  needsAck: boolean;
  issues: VerifyIssue[];
  /** UW that matches the selected policy's carrier (may differ from account primary) */
  matchedUw: Underwriter | null;
  matchSource: "primary" | "backup" | "carrier_desk" | "none";
}

/** Collapse legal noise so "Apex Roofing LLC" ≈ "APEX ROOFING, L.L.C." */
export function normalizeCompanyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pc|dba)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function companyNamesMatch(a: string, b: string): boolean {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // One contains the other (short DBA vs full legal)
  if (na.includes(nb) || nb.includes(na)) return true;
  // Token overlap ≥ 80%
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return false;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  const score = hit / Math.max(ta.size, tb.size);
  return score >= 0.8;
}

/**
 * Pick the underwriter that actually matches the policy's carrier —
 * not blindly the account primary (multi-policy accounts).
 */
export function matchUnderwriterToPolicy(
  account: Account & {
    primaryUw: Underwriter;
    backupUw: Underwriter | null;
  },
  policy: Policy,
  carrierDesks: Underwriter[],
): { uw: Underwriter | null; source: VerifyResult["matchSource"] } {
  const carrier = policy.carrier.trim().toLowerCase();

  if (account.primaryUw.carrier.trim().toLowerCase() === carrier) {
    return { uw: account.primaryUw, source: "primary" };
  }
  if (
    account.backupUw &&
    account.backupUw.carrier.trim().toLowerCase() === carrier
  ) {
    return { uw: account.backupUw, source: "backup" };
  }

  const desk = carrierDesks.find(
    (u) => u.carrier.trim().toLowerCase() === carrier,
  );
  if (desk) return { uw: desk, source: "carrier_desk" };

  return { uw: null, source: "none" };
}

export function verifyBeforeSend(input: {
  account: Account & { primaryUw: Underwriter; backupUw: Underwriter | null };
  policy: Policy;
  requestType: RequestTypeId;
  carrierDesks: Underwriter[];
  /** Request wording — carrier-knowledge matchers read it (e.g. a 10-day notice ask) */
  wording?: string;
}): VerifyResult {
  const issues: VerifyIssue[] = [];

  // Carrier knowledge gate: enforceable registry entries (ISC excess takes
  // no Additional Insured; ISC Colorado contractors/lease has no 10-day
  // notice for non-payment) block or warn before anything reaches the
  // market. The issue id is the registry entry id — the block cites its
  // knowledge entry as the reason.
  for (const hit of evaluateKnowledgeForRequest({
    requestType: input.requestType,
    wording: input.wording ?? "",
    policy: input.policy,
    account: { state: input.account.state, industry: input.account.industry },
  })) {
    issues.push({
      id: hit.entry.id,
      severity: hit.entry.severity === "blocker" ? "block" : "warn",
      title: hit.entry.title,
      detail: `${hit.entry.detail} ${hit.entry.consequence} [Carrier Knowledge: ${hit.entry.id}]`,
    });
  }
  const { uw, source } = matchUnderwriterToPolicy(
    input.account,
    input.policy,
    input.carrierDesks,
  );

  if (!uw) {
    issues.push({
      id: "uw-missing",
      severity: "block",
      title: "No Underwriter For This Carrier",
      detail: `Policy is ${input.policy.carrier}, but no UW desk is on file for that market. Fix Contacts before sending.`,
    });
  } else if (source !== "primary") {
    issues.push({
      id: "uw-reroute",
      severity: "warn",
      title: "Underwriter Re-Matched To The Policy",
      detail: `Account primary is ${input.account.primaryUw.name} (${input.account.primaryUw.carrier}). This ${input.policy.carrier} policy routes to ${uw.name} instead.`,
    });
  }

  if (uw && uw.carrier.trim().toLowerCase() !== input.policy.carrier.trim().toLowerCase()) {
    issues.push({
      id: "uw-carrier-mismatch",
      severity: "block",
      title: "UW Carrier Does Not Match Policy",
      detail: `Underwriter is tagged ${uw.carrier}; policy carrier is ${input.policy.carrier}. Do not send until this is fixed.`,
    });
  }

  const quoteName = input.policy.quoteInsuredName;
  if (quoteName) {
    const matchesAccount = companyNamesMatch(input.account.name, quoteName);
    const matchesDba =
      input.account.dba != null &&
      companyNamesMatch(input.account.dba, quoteName);
    if (!matchesAccount && !matchesDba) {
      issues.push({
        id: "quote-name-mismatch",
        severity: "block",
        title: "Quote Named Insured ≠ Account",
        detail: `Quote on file says “${quoteName}”. Account is “${input.account.name}”${input.account.dba ? ` (DBA ${input.account.dba})` : ""}. Quotes get uploaded wrong — fix the quote or the account before you request an endorsement.`,
      });
    }
  } else {
    issues.push({
      id: "quote-name-missing",
      severity: "warn",
      title: "No Quote Named Insured On File",
      detail:
        "Confirm the legal name on the quote/binder matches this account before requesting.",
    });
  }

  const quoteCarrier = input.policy.quoteCarrier;
  if (quoteCarrier) {
    if (
      quoteCarrier.trim().toLowerCase() !==
      input.policy.carrier.trim().toLowerCase()
    ) {
      issues.push({
        id: "quote-carrier-mismatch",
        severity: "block",
        title: "Quote Carrier ≠ Policy Carrier",
        detail: `Quote on file is ${quoteCarrier}; selected policy is ${input.policy.carrier}. Wrong quote may have been attached.`,
      });
    }
  }

  const needsAck = issues.some((i) => i.severity === "warn");
  const hasBlock = issues.some((i) => i.severity === "block");

  return {
    okToSend: !hasBlock,
    needsAck,
    issues,
    matchedUw: uw,
    matchSource: source,
  };
}
