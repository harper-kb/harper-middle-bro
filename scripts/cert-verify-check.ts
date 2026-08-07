/**
 * Self-check: client-certificate verification (src/lib/cert-verify.ts).
 *
 * Three synthetic sample certs for acct-oakridge (one policy on file:
 * NXT-GL-667788, NEXT Insurance, GL, 12/01/2025 → 12/01/2026, unscheduled):
 *   1. Clean — every readable claim matches the record → Approve
 *   2. Tampered — wrong policy number + invented limit → Deny
 *   3. Partial — no certificate holder → Approve With Notes
 *
 * Deterministic: a fixed "today" (2026-08-07) makes date verdicts stable.
 * Run: npx tsx scripts/cert-verify-check.ts
 */

import {
  parseCertificateText,
  verifyAgainstRecord,
  type RecordOnFile,
  type VerifyReport,
} from "../src/lib/cert-verify";
import { bareFormSet, FORM_SETS, type PolicyFormSet } from "../src/lib/forms";
import { SEED_ACCOUNTS, SEED_POLICIES } from "../src/lib/seed";
import type { Account } from "../src/lib/types";

const TODAY = "2026-08-07";

let failed = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

const seedAccount = SEED_ACCOUNTS.find((a) => a.id === "acct-oakridge")!;
const account: Account = {
  ...seedAccount,
  status: "active",
  paymentReceivedAt: null,
} as Account;
const policies = SEED_POLICIES.filter((p) => p.accountId === "acct-oakridge");
const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
  policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
);
const record: RecordOnFile = { account, policies, formSets };

function verify(text: string): VerifyReport {
  return verifyAgainstRecord(parseCertificateText(text), record, TODAY);
}

/* ————— Scenario 1: clean sample → Approve ————— */

const CLEAN = `
CERTIFICATE OF LIABILITY INSURANCE
INSURED: Oakridge Property Mgmt LLC
INSURER A: Next Insurance US Company NAIC# 16285
COMMERCIAL GENERAL LIABILITY
A NXT-GL-667788 12/01/2025 12/01/2026
CERTIFICATE HOLDER
Desert Plaza Owners Association
`;

console.log("━━━ S1 Clean sample cert ━━━");
{
  const r = verify(CLEAN);
  check(
    r.recommendation === "Approve",
    "Clean cert recommends Approve",
    `got ${r.recommendation}: ${r.reasons.join(" | ")}`,
  );
  const polRow = r.rows.find((x) => x.field === "Policy Number");
  check(polRow?.verdict === "Match", "Policy number NXT-GL-667788 matches the record");
  const carrierRow = r.rows.find((x) => x.field === "Carrier");
  check(
    carrierRow?.verdict === "Match",
    "Issuing company (Next Insurance US Company) matches the NEXT Insurance policy",
  );
  const effRow = r.rows.find((x) => x.field.startsWith("Effective Date"));
  check(effRow?.verdict === "Match", "Effective date matches the policy term");
  const holderRow = r.rows.find((x) => x.field === "Certificate Holder");
  check(
    holderRow?.verdict === "Not On File",
    "Holder reports Not On File (per-certificate, honestly unconfirmable)",
  );
}

/* ————— Scenario 2: tampered → Deny ————— */

const TAMPERED = `
CERTIFICATE OF LIABILITY INSURANCE
INSURED: Oakridge Property Mgmt LLC
INSURER A: Next Insurance US Company
COMMERCIAL GENERAL LIABILITY
A NXT-GL-999999 12/01/2025 12/01/2026
EACH OCCURRENCE $2,000,000
CERTIFICATE HOLDER
Desert Plaza Owners Association
`;

console.log("\n━━━ S2 Tampered sample cert ━━━");
{
  const r = verify(TAMPERED);
  check(
    r.recommendation === "Deny",
    "Tampered cert recommends Deny",
    `got ${r.recommendation}`,
  );
  const polRow = r.rows.find((x) => x.field === "Policy Number");
  check(
    polRow?.verdict === "Mismatch" && polRow.critical,
    "Wrong policy number is a critical mismatch",
  );
  const limitRow = r.rows.find((x) => /Each Occurrence/i.test(x.field));
  check(
    limitRow?.verdict === "Not On File",
    "Invented $2M limit reports Not On File (no schedule of record to confirm it)",
    limitRow ? `${limitRow.field}: ${limitRow.verdict}` : "row missing",
  );
  check(
    r.reasons.some((x) => /policy number/i.test(x)),
    "Deny reasons name the policy-number mismatch",
  );
}

/* ————— Scenario 3: partial (no holder) → Approve With Notes ————— */

const PARTIAL = `
CERTIFICATE OF LIABILITY INSURANCE
INSURED: Oakridge Property Mgmt LLC
INSURER A: NEXT Insurance
COMMERCIAL GENERAL LIABILITY
A NXT-GL-667788 12/01/2025 12/01/2026
`;

console.log("\n━━━ S3 Partial sample cert (no holder) ━━━");
{
  const r = verify(PARTIAL);
  check(
    r.recommendation === "Approve With Notes",
    "Missing holder recommends Approve With Notes",
    `got ${r.recommendation}: ${r.reasons.join(" | ")}`,
  );
  const holderRow = r.rows.find((x) => x.field === "Certificate Holder");
  check(
    holderRow?.verdict === "Could Not Read",
    "Missing holder reports Could Not Read — listed honestly",
  );
  const carrierRow = r.rows.find((x) => x.field === "Carrier");
  check(
    carrierRow?.verdict === "Match",
    "Brand name (NEXT Insurance) matches the policy record directly",
  );
}

/* ————— Scenario 4: expired term → Deny ————— */

const EXPIRED = `
INSURED: Oakridge Property Mgmt LLC
INSURER A: NEXT Insurance
COMMERCIAL GENERAL LIABILITY
A NXT-GL-667788 12/01/2024 12/01/2025
CERTIFICATE HOLDER
Desert Plaza Owners Association
`;

console.log("\n━━━ S4 Expired term ━━━");
{
  const r = verify(EXPIRED);
  check(
    r.recommendation === "Deny",
    "Expired/mismatched term recommends Deny",
    `got ${r.recommendation}`,
  );
  check(
    r.rows.some((x) => x.field.startsWith("Policy In Force") && x.critical),
    "Lapsed coverage is flagged as a critical row",
  );
}

console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILURE(S)`}`);
process.exit(failed === 0 ? 0 : 1);
