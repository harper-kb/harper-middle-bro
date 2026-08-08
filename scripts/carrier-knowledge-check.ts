/**
 * Carrier knowledge registry self-check — run with: npx tsx scripts/carrier-knowledge-check.ts
 *
 * Pure fixtures, no database. Proves the two enforced seed rules end to end
 * against the pure modules the app runs:
 *
 *   1. ISC excess + Additional Insured request → blocked, citing
 *      isc-excess-no-additional-insured (fast path AND pre-send verification
 *      AND certificate preparation).
 *   2. ISC + Colorado + contractors/lease vertical + 10-day Notice of
 *      Cancellation ask → blocked, citing
 *      isc-co-contractors-lease-no-10-day-noc.
 *   3. A 30-day Notice of Cancellation on ISC routes normally — no
 *      knowledge block.
 *   4. The canonical issuance gate consumes the registry: an Additional
 *      Insured claim against an ISC excess line attempted through
 *      performCertIssuance blocks on carrier-knowledge-restrictions,
 *      non-overridable, citing the entry id (in-memory ledger).
 *
 * Plus registry hygiene: required fields, unique ids, and the rule that only
 * committed entries can be enforceable. Exit 1 on any FAIL.
 */

import Database from "better-sqlite3";
import {
  CARRIER_KNOWLEDGE,
  evaluateKnowledgeForCertSection,
  evaluateKnowledgeForRequest,
  isTenDayNocAsk,
  knowledgeForCarrier,
} from "../src/lib/carrier-knowledge";
import { buildCertificatePacket } from "../src/lib/certificate";
import { migrateCertLedger } from "../src/lib/cert-ledger";
import { performCertIssuance } from "../src/lib/cert-issuance-core";
import { buildDraftFromPolicy } from "../src/lib/coi";
import { evaluateBlanketFastPath } from "../src/lib/fast-path";
import { verifyBeforeSend } from "../src/lib/verify";
import type { PolicyFormSet } from "../src/lib/forms";
import type { Account, Policy, Underwriter } from "../src/lib/types";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ——— Fixtures ———
// Cast-built: the Account shape is mid-refactor on a parallel branch; this
// harness only exercises the fields the knowledge gate reads.

const iscUw = {
  id: "uw-isc-x",
  name: "ISC Desk",
  email: "certs@iscmga.com",
  phone: null,
  portal: "https://app.instantspecialty.com",
  carrier: "ISC",
  notes: null,
  channelPrimary: "hybrid",
  serviceEmail: "certs@iscmga.com",
  channelNote: null,
} as Underwriter;

function makeAccount(over: Partial<Account>): Account {
  return {
    id: "acct-check",
    name: "Check Fixture LLC",
    dba: null,
    industry: "Roofing contractor",
    state: "TX",
    primaryUwId: iscUw.id,
    backupUwId: null,
    notes: null,
    status: "active",
    paymentReceivedAt: "2026-01-05T00:00:00.000Z",
    ...over,
  } as Account;
}

function makePolicy(over: Partial<Policy>): Policy {
  return {
    id: "pol-check",
    accountId: "acct-check",
    policyNumber: "ISC-XS-0001",
    carrier: "ISC",
    coverages: ["EXCESS_UMB"],
    effectiveDate: "2026-01-01",
    expirationDate: "2027-01-01",
    premiumCents: 500_000,
    quoteInsuredName: "Check Fixture LLC",
    quoteCarrier: "ISC",
    issuingCarrier: "Sutton National Insurance Company",
    ...over,
  } as Policy;
}

const excessPolicy = makePolicy({});
const glPolicy = makePolicy({
  id: "pol-check-gl",
  policyNumber: "ISC-GL-0001",
  coverages: ["GL"],
});

/** Excess schedule wrongly carrying a blanket AI form — the past mistake. */
const excessSetWithAi: PolicyFormSet = {
  coverages: [
    {
      code: "EXCESS_UMB",
      label: "Excess / Umbrella Liability",
      form: "CU 00 01",
      edition: "04 13",
    },
  ],
  limits: [{ slot: "umb_each_occurrence", amountCents: 1_000_000_00 }],
  endorsements: [
    {
      form: "XS 20 10",
      edition: "01 20",
      title: "Additional Insured — Blanket (excess)",
      kind: "ai",
      scope: "blanket",
    },
  ],
};

const account = makeAccount({});
const accountWithUw = {
  ...account,
  primaryUw: iscUw,
  backupUw: null,
} as Account & { primaryUw: Underwriter; backupUw: Underwriter | null };

const coLeaseAccount = makeAccount({
  state: "CO",
  industry: "Contractors — equipment lease",
});
const coLeaseWithUw = {
  ...coLeaseAccount,
  primaryUw: iscUw,
  backupUw: null,
} as Account & { primaryUw: Underwriter; backupUw: Underwriter | null };

// ——— 1. Registry hygiene ———
console.log("Registry hygiene");
{
  const ids = new Set(CARRIER_KNOWLEDGE.map((e) => e.id));
  check("Entry ids are unique", ids.size === CARRIER_KNOWLEDGE.length);
  check(
    "Every entry carries title, detail, consequence, source, recordedAt",
    CARRIER_KNOWLEDGE.every(
      (e) =>
        e.title.trim() &&
        e.detail.trim() &&
        e.consequence.trim() &&
        e.source.trim() &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.recordedAt),
    ),
  );
  check(
    "Every enforceable entry has a matcher or cert flags",
    CARRIER_KNOWLEDGE.filter((e) => e.enforceable).every(
      (e) => e.match != null || (e.certFlags?.length ?? 0) > 0,
    ),
  );
  check(
    "Blockers are exactly the two seed rules",
    CARRIER_KNOWLEDGE.filter((e) => e.severity === "blocker")
      .map((e) => e.id)
      .sort()
      .join(",") ===
      "isc-co-contractors-lease-no-10-day-noc,isc-excess-no-additional-insured",
  );
  const byKind = CARRIER_KNOWLEDGE.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `  INFO  ${CARRIER_KNOWLEDGE.length} committed entries — ` +
      Object.entries(byKind)
        .map(([k, n]) => `${k}: ${n}`)
        .join(", "),
  );
  check(
    "ISC page set includes both seed rules",
    knowledgeForCarrier("ISC")
      .map((e) => e.id)
      .filter((id) =>
        [
          "isc-excess-no-additional-insured",
          "isc-co-contractors-lease-no-10-day-noc",
        ].includes(id),
      ).length === 2,
  );
}

// ——— 2. Rule 1 — ISC excess takes no Additional Insured ———
console.log("\nRule 1 — ISC Excess + Additional Insured");
{
  const hits = evaluateKnowledgeForRequest({
    requestType: "additional_insured",
    wording: "Please add Palm Court HOA as additional insured.",
    policy: excessPolicy,
    account: { state: account.state, industry: account.industry },
  });
  check(
    "Request evaluation blocks with the rule id",
    hits.some(
      (h) =>
        h.entry.id === "isc-excess-no-additional-insured" &&
        h.entry.severity === "blocker",
    ),
    JSON.stringify(hits.map((h) => h.entry.id)),
  );

  const fast = evaluateBlanketFastPath({
    requestType: "additional_insured",
    wording: "Add them per contract, blanket wording is fine.",
    namedOnPolicyRequired: false,
    policies: [{ policy: excessPolicy, formSet: excessSetWithAi }],
    account: { state: account.state, industry: account.industry },
  });
  check(
    "Fast path refuses even with a blanket AI form on the excess schedule",
    !fast.eligible &&
      fast.reason === "carrier_knowledge" &&
      fast.entry.id === "isc-excess-no-additional-insured",
    JSON.stringify(fast),
  );

  const verify = verifyBeforeSend({
    account: accountWithUw,
    policy: excessPolicy,
    requestType: "additional_insured",
    carrierDesks: [iscUw],
    wording: "Please add the GC as additional insured.",
  });
  check(
    "Pre-send verification hard-blocks, citing the entry id",
    !verify.okToSend &&
      verify.issues.some(
        (i) =>
          i.id === "isc-excess-no-additional-insured" && i.severity === "block",
      ),
    JSON.stringify(verify.issues.map((i) => `${i.id}:${i.severity}`)),
  );

  const packet = buildCertificatePacket({
    account,
    policies: [excessPolicy],
    formSets: { [excessPolicy.id]: excessSetWithAi },
    holderName: "Palm Court HOA",
    holderAddress: "1 Palm Court, Austin, TX",
  });
  check(
    "Certificate preparation rejects the AI provision on the excess line",
    !packet.okToIssue &&
      packet.rejects.some(
        (r) =>
          r.finding.id ===
          "carrier-knowledge-isc-excess-no-additional-insured",
      ),
    JSON.stringify(packet.rejects.map((r) => r.finding.id)),
  );

  const certHits = evaluateKnowledgeForCertSection({
    policy: glPolicy,
    flags: { additionalInsured: true },
  });
  check(
    "The same provision on an ISC General Liability line is untouched",
    certHits.length === 0,
    JSON.stringify(certHits.map((h) => h.entry.id)),
  );
}

// ——— 3. Rule 2 — ISC Colorado contractors/lease + 10-day NOC ———
console.log("\nRule 2 — ISC Colorado Contractors/Lease + 10-Day NOC");
{
  const wording =
    "Lender requires a 10-day notice of cancellation for non-payment on the leased equipment.";
  check("10-day ask detector fires on the wording", isTenDayNocAsk(wording));
  check(
    "Detector stays quiet on a 30-day ask",
    !isTenDayNocAsk("Please add a 30-day notice of cancellation for the lender."),
  );

  const hits = evaluateKnowledgeForRequest({
    requestType: "notice_cancellation_30",
    wording,
    policy: glPolicy,
    account: {
      state: coLeaseAccount.state,
      industry: coLeaseAccount.industry,
    },
  });
  check(
    "Exact combination blocks with the rule id",
    hits.some(
      (h) =>
        h.entry.id === "isc-co-contractors-lease-no-10-day-noc" &&
        h.entry.severity === "blocker",
    ),
    JSON.stringify(hits.map((h) => h.entry.id)),
  );

  const verify = verifyBeforeSend({
    account: coLeaseWithUw,
    policy: glPolicy,
    requestType: "notice_cancellation_30",
    carrierDesks: [iscUw],
    wording,
  });
  check(
    "Pre-send verification blocks before the ask routes to certs@iscmga.com",
    !verify.okToSend &&
      verify.issues.some(
        (i) =>
          i.id === "isc-co-contractors-lease-no-10-day-noc" &&
          i.severity === "block",
      ),
    JSON.stringify(verify.issues.map((i) => `${i.id}:${i.severity}`)),
  );

  // Not generalized: same ask in Texas, or outside the lease vertical, does
  // not hit the blocker.
  const txHits = evaluateKnowledgeForRequest({
    requestType: "notice_cancellation_30",
    wording,
    policy: glPolicy,
    account: { state: "TX", industry: "Contractors — equipment lease" },
  }).filter((h) => h.entry.severity === "blocker");
  check("Texas is not blocked (no generalization)", txHits.length === 0);

  const coRoofer = evaluateKnowledgeForRequest({
    requestType: "notice_cancellation_30",
    wording,
    policy: glPolicy,
    account: { state: "CO", industry: "Roofing contractor" },
  });
  check(
    "Colorado outside the lease vertical warns (desk note) but does not block",
    coRoofer.every((h) => h.entry.severity !== "blocker") &&
      coRoofer.some((h) => h.entry.id === "isc-co-10-day-noc-desk-note"),
    JSON.stringify(coRoofer.map((h) => `${h.entry.id}:${h.entry.severity}`)),
  );
}

// ——— 4. 30-day NOC on ISC still routes normally ———
console.log("\nControl — 30-Day NOC On ISC Routes Normally");
{
  const verify = verifyBeforeSend({
    account: coLeaseWithUw,
    policy: glPolicy,
    requestType: "notice_cancellation_30",
    carrierDesks: [iscUw],
    wording:
      "Please add a 30-day notice of cancellation in favor of the lessor and quote the endorsement charge.",
  });
  check(
    "No knowledge block on a plain 30-day ask",
    verify.okToSend &&
      verify.issues.every((i) => !i.id.startsWith("isc-co-")),
    JSON.stringify(verify.issues.map((i) => `${i.id}:${i.severity}`)),
  );

  const aiOnGl = verifyBeforeSend({
    account: accountWithUw,
    policy: glPolicy,
    requestType: "additional_insured",
    carrierDesks: [iscUw],
    wording: "Please add the GC as additional insured.",
  });
  check(
    "Additional Insured on ISC General Liability is untouched",
    aiOnGl.okToSend &&
      aiOnGl.issues.every((i) => i.id !== "isc-excess-no-additional-insured"),
    JSON.stringify(aiOnGl.issues.map((i) => `${i.id}:${i.severity}`)),
  );
}

// ——— 5. Issuance gate — the canonical check registry runs carrier knowledge ———
console.log("\nIssuance Gate — Canonical Registry Consumes Carrier Knowledge");
{
  const ledger = new Database(":memory:");
  migrateCertLedger(ledger);

  // The past mistake, attempted through the one door: an Additional Insured
  // claim against the ISC excess line, with the blanket AI form on the
  // schedule so no other check masks the block.
  const draft = buildDraftFromPolicy({
    account,
    policy: excessPolicy,
    holderName: "Palm Court HOA",
    holderAddress: "1 Palm Court, Austin, TX",
    set: excessSetWithAi,
  });
  draft.flags.additionalInsured = true;

  const blocked = performCertIssuance({
    db: ledger,
    operator: "Harness Operator",
    path: "ticket",
    account,
    policies: [excessPolicy],
    formSets: { [excessPolicy.id]: excessSetWithAi },
    holderName: draft.holderName,
    holderAddress: draft.holderAddress,
    artifact: { kind: "draft", draft },
    redAlertActive: false,
    holderAiRecords: [],
    scheduleSources: [],
    // An override request on the knowledge check must change nothing.
    checkOverrides: [
      { checkId: "carrier-knowledge-restrictions", reason: "client insists" },
    ],
  });
  const kc = blocked.results.find((r) => r.id === "carrier-knowledge-restrictions");
  check(
    "performCertIssuance blocks, attempt row names carrier-knowledge-restrictions",
    !blocked.issued &&
      blocked.attempt.blockedCheckIds.includes("carrier-knowledge-restrictions"),
    JSON.stringify(blocked.attempt.blockedCheckIds),
  );
  check(
    "The failed check cites the knowledge entry id and is non-overridable despite the override request",
    kc?.status === "fail" &&
      kc.overridable === false &&
      kc.detail.includes("isc-excess-no-additional-insured"),
    JSON.stringify(kc),
  );

  // Control: the same claim on ISC General Liability passes the knowledge
  // check — the registry blocks the carrier's restriction, nothing wider.
  const glSet: PolicyFormSet = {
    coverages: [
      { code: "GL", label: "General Liability", form: "CG 00 01", edition: "04 13" },
    ],
    limits: [{ slot: "gl_each_occurrence", amountCents: 1_000_000_00 }],
    endorsements: [
      {
        form: "CG 20 10",
        edition: "04 13",
        title: "Additional Insured — Blanket",
        kind: "ai",
        scope: "blanket",
      },
    ],
  };
  const glDraft = buildDraftFromPolicy({
    account,
    policy: glPolicy,
    holderName: "Palm Court HOA",
    holderAddress: "1 Palm Court, Austin, TX",
    set: glSet,
  });
  glDraft.flags.additionalInsured = true;
  const control = performCertIssuance({
    db: ledger,
    operator: "Harness Operator",
    path: "ticket",
    account,
    policies: [glPolicy],
    formSets: { [glPolicy.id]: glSet },
    holderName: glDraft.holderName,
    holderAddress: glDraft.holderAddress,
    artifact: { kind: "draft", draft: glDraft },
    redAlertActive: false,
    holderAiRecords: [],
    scheduleSources: [],
  });
  check(
    "Same claim on ISC General Liability passes the knowledge check",
    control.results.find((r) => r.id === "carrier-knowledge-restrictions")
      ?.status === "pass",
    JSON.stringify(
      control.results.filter((r) => r.status === "fail").map((r) => r.id),
    ),
  );
}

console.log(
  failures === 0
    ? "\nAll carrier knowledge checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
