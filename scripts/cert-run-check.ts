/**
 * Self-check: the certificate batch run (src/lib/cert-run.ts).
 *
 * Drives buildCertificateRun for acct-summit (pol-summit-gl carries the
 * CG 20 33 04 13 blanket AI) with three holders — a GC, a landlord, and a
 * lender — and proves:
 *   1. N holders in → N certificate payloads out
 *   2. No cross-contamination: each holder appears in exactly its own
 *      certificate; holder B's name never leaks into holder A's description
 *   3. The blanket-basis line is correct per holder ("{Holder} is included
 *      as additional insured per CG 20 33 04 13.")
 *   4. The pre-bind gate blocks the run outright
 *   5. Prepared emails: one per certificate, holder-correct subject/body,
 *      requester email carried only when on file
 *
 * Run: npx tsx scripts/cert-run-check.ts
 */

import { buildCertificateRun, prepareRunEmails } from "../src/lib/cert-run";
import { bareFormSet, FORM_SETS, type PolicyFormSet } from "../src/lib/forms";
import { SEED_ACCOUNTS, SEED_POLICIES } from "../src/lib/seed";
import type { Account } from "../src/lib/types";

let failed = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

const seedAccount = SEED_ACCOUNTS.find((a) => a.id === "acct-summit")!;
const account: Account = {
  ...seedAccount,
  status: "active",
  paymentReceivedAt: null,
} as Account;
const policies = SEED_POLICIES.filter((p) => p.accountId === "acct-summit");
const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
  policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
);

// Distinct names on purpose — no holder's name is a substring of another's,
// so the contamination check below is airtight.
const HOLDERS = [
  {
    name: "Mesa Verde Builders Inc.",
    address: "400 Contractor Way, Phoenix, AZ 85004",
    requesterEmail: "certs@mesaverde.example",
  },
  {
    name: "Canyon Gate Properties LLC",
    address: "88 Landlord Plaza, Tempe, AZ 85281",
    requesterEmail: null,
  },
  {
    name: "First Lien Capital",
    address: "1 Lender Sq, Scottsdale, AZ 85251",
    requesterEmail: "loanops@firstlien.example",
  },
];

/* ————— 1 + 2 + 3: the run itself ————— */

console.log("━━━ Batch run — acct-summit, 3 holders ━━━");
const run = buildCertificateRun({
  account,
  policies,
  formSets,
  holders: HOLDERS,
  formKey: "acord25",
});

check(!run.blocked, "Active account: run is not blocked");
check(
  run.certificates.length === HOLDERS.length,
  `${HOLDERS.length} holders in → ${HOLDERS.length} certificate payloads out`,
  `got ${run.certificates.length}`,
);

for (let i = 0; i < run.certificates.length; i++) {
  const cert = run.certificates[i];
  const holder = HOLDERS[i];
  check(
    cert.holderName === holder.name && cert.holderAddress === holder.address,
    `Certificate ${i + 1} carries its own holder block (${holder.name})`,
  );
  check(
    cert.description.includes(holder.name),
    `Certificate ${i + 1} description names its own holder`,
    cert.description,
  );
  // Cross-contamination: no other holder's name anywhere in this payload.
  const others = HOLDERS.filter((_, j) => j !== i);
  const leaked = others.filter(
    (o) =>
      cert.description.includes(o.name) ||
      cert.holderName.includes(o.name) ||
      cert.holderAddress.includes(o.address),
  );
  check(
    leaked.length === 0,
    `Certificate ${i + 1} carries no other holder's name or address`,
    leaked.map((o) => o.name).join(", "),
  );
  check(
    cert.blanketBasis === "CG 20 33 04 13",
    `Certificate ${i + 1} cites the blanket basis CG 20 33 04 13`,
    `got ${cert.blanketBasis}`,
  );
  check(
    cert.description.includes(
      `${holder.name} is included as additional insured per CG 20 33 04 13.`,
    ),
    `Certificate ${i + 1} blanket-basis line names its holder verbatim`,
    cert.description,
  );
}

/* ————— 4: the pre-bind gate ————— */

console.log("━━━ Pre-bind gate ━━━");
const preBindRun = buildCertificateRun({
  account: { ...account, status: "pre_bind" },
  policies,
  formSets,
  holders: HOLDERS,
  formKey: "acord25",
});
check(preBindRun.blocked, "Pre-bind account: run is blocked");
check(
  preBindRun.certificates.length === 0,
  "Pre-bind account: zero certificate payloads produced",
  `got ${preBindRun.certificates.length}`,
);
check(
  preBindRun.blockedReason === "Pre-Bind — Payment Activates Issuance",
  "Pre-bind block states its reason",
  `got ${preBindRun.blockedReason}`,
);

/* ————— 5: prepared emails ————— */

console.log("━━━ Prepared emails ━━━");
const emails = prepareRunEmails(run, {
  accountName: account.name,
  formNumber: "ACORD 25",
});
check(
  emails.length === run.certificates.length,
  "One prepared email per certificate",
  `got ${emails.length}`,
);
for (let i = 0; i < emails.length; i++) {
  const m = emails[i];
  const holder = HOLDERS[i];
  check(
    m.subject === `Certificate Of Insurance — ${account.name} — ${holder.name}`,
    `Email ${i + 1} subject names account and its holder`,
    m.subject,
  );
  const others = HOLDERS.filter((_, j) => j !== i);
  check(
    !others.some((o) => m.body.includes(o.name)),
    `Email ${i + 1} body never names another holder`,
  );
  check(
    m.body.includes("CG 20 33"),
    `Email ${i + 1} body cites the blanket basis`,
  );
  check(
    policies.every((p) => m.body.includes(p.policyNumber)),
    `Email ${i + 1} body lists the policy numbers issued`,
  );
  check(
    m.to === holder.requesterEmail,
    `Email ${i + 1} To is ${holder.requesterEmail ?? "null (not on file, never invented)"}`,
    `got ${m.to}`,
  );
}

/* ————— Verdict ————— */

console.log(
  failed === 0
    ? "\nALL CHECKS PASSED"
    : `\n${failed} CHECK${failed === 1 ? "" : "S"} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
