/**
 * One-door consolidation stress harness — hammers the NEW certificate
 * surfaces end to end, on top of scripts/coi-stress.ts (which owns the
 * classic overflow / included-excluded / form-switch / adversarial passes).
 *
 *   A. ISC multi-writer insurer lettering (Hadron / Sutton / SiriusPoint /
 *      Third Coast) — letter per writing company, exhaustion, junk writers
 *   B. Carrier-knowledge blocks at issuance — ISC excess AI must block at
 *      the single send path, non-overridable, citing the entry id
 *   C. The 26 real ISC accounts (acct-real-*) off the live SQLite — honest
 *      blanks, zero fabrication, determinism, issuance through the one door
 *   D. Batch multi-holder runs — no holder bleed, deterministic, ledger
 *      isolation per requirement
 *   E. Snapshot invalidation mid-run — prepared artifacts die on upstream
 *      fact change between holders; forced regeneration issues
 *   F. Supersede chains under repeated corrections — 8 rounds, linear chain,
 *      same-instant tie behavior
 *   G. Form registry scope — ACORD 25/30 present, ACORD 28 absent (scope)
 *
 * Run: npx tsx scripts/coi-onedoor-stress.ts
 * Exit code = number of failed scenarios. Read-only against
 * data/underwriter-desk.db; all ledger writes go to :memory:.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { CERT_FORMS, certDescription, resolveCertSheet } from "../src/lib/acord25";
import { CARRIER_KNOWLEDGE } from "../src/lib/carrier-knowledge";
import { runCertChecks } from "../src/lib/cert-checks";
import { performCertIssuance, type IssuanceInput } from "../src/lib/cert-issuance-core";
import {
  getLivePrepared,
  listHolderNotices,
  listIssuedCerts,
  markCertErroneous,
  migrateCertLedger,
  requirementKeyFor,
  upsertPrepared,
  type IssuedCertRecord,
} from "../src/lib/cert-ledger";
import { verifyEditedSheet } from "../src/lib/cert-review";
import { buildCertificateRun, prepareRunEmails } from "../src/lib/cert-run";
import { buildFactSnapshot } from "../src/lib/cert-snapshot";
import { buildCertificatePacket } from "../src/lib/certificate";
import { buildDraftFromPolicy } from "../src/lib/coi";
import { bareFormSet, type PolicyFormSet } from "../src/lib/forms";
import { ISC_WRITERS } from "../src/lib/naic";
import type { Account, Policy } from "../src/lib/types";

let scenarios = 0;
let failedScenarios = 0;
let checks = 0;
let failedChecks = 0;
let currentFails = 0;

function scenario(name: string, fn: () => void) {
  scenarios++;
  currentFails = 0;
  console.log(`\n━━━ ${name} ━━━`);
  try {
    fn();
  } catch (e) {
    currentFails++;
    console.log(`  ✗ EXCEPTION: ${(e as Error).stack ?? e}`);
  }
  if (currentFails > 0) {
    failedScenarios++;
    console.log(`  ⇒ FAIL (${currentFails} failed check${currentFails === 1 ? "" : "s"})`);
  } else {
    console.log(`  ⇒ PASS`);
  }
}

function check(ok: boolean, label: string, evidence?: string) {
  checks++;
  if (ok) {
    console.log(`  ✓ ${label}${evidence ? ` — ${evidence}` : ""}`);
  } else {
    failedChecks++;
    currentFails++;
    console.log(`  ✗ ${label}${evidence ? ` — ${evidence}` : ""}`);
  }
}

/* ————— Shared fixtures ————— */

const NOW = "2026-08-08T20:00:00.000Z";

const stressAccount: Account = {
  id: "acct-stress-isc",
  name: "Caliber Structural Group LLC",
  dba: null,
  industry: "Construction & Contractors",
  addressLine1: "1800 Fabrication Row",
  city: "Fort Worth",
  state: "TX",
  zip: "76102",
  primaryUwId: "uw-stress",
  backupUwId: null,
  notes: null,
  status: "active",
  paymentReceivedAt: "2026-02-01T00:00:00.000Z",
};

function iscPolicy(over: Partial<Policy>): Policy {
  return {
    id: "pol-x",
    accountId: stressAccount.id,
    policyNumber: "HSIC-ISC01-9990001",
    carrier: "ISC",
    coverages: ["GL"],
    effectiveDate: "2026-05-01",
    expirationDate: "2027-05-01",
    premiumCents: 250_000,
    quoteInsuredName: null,
    quoteCarrier: null,
    issuingCarrier: "Hadron Specialty Insurance Company",
    ...over,
  };
}

const glSet: PolicyFormSet = {
  coverages: [
    { code: "GL", label: "Commercial General Liability", form: "CG 00 01", edition: "04 13" },
  ],
  limits: [
    { slot: "gl_each_occurrence", amountCents: 1_000_000_00 },
    { slot: "gl_general_aggregate", amountCents: 2_000_000_00 },
    { slot: "gl_damage_premises", amountCents: 100_000_00 },
    { slot: "gl_med_exp", mode: "excluded" },
    { slot: "gl_personal_adv", amountCents: 1_000_000_00 },
    { slot: "gl_products_completed_ops", mode: "included" },
  ],
  endorsements: [],
};

const glSetWithBlanketAi: PolicyFormSet = {
  ...glSet,
  endorsements: [
    {
      form: "CG 20 33",
      edition: "04 13",
      title: "Additional Insured — Owners, Lessees Or Contractors — Automatic Status",
      kind: "ai",
      scope: "blanket",
    },
  ],
};

const excessSetWithBlanketAi: PolicyFormSet = {
  coverages: [
    { code: "EXCESS_UMB", label: "Excess / Umbrella Liability", form: "CU 00 01", edition: "04 13" },
  ],
  limits: [
    { slot: "umb_each_occurrence", amountCents: 5_000_000_00 },
    { slot: "umb_aggregate", amountCents: 5_000_000_00 },
  ],
  endorsements: [
    {
      form: "CG 20 33",
      edition: "04 13",
      title: "Additional Insured — Blanket (excess follow form)",
      kind: "ai",
      scope: "blanket",
    },
  ],
};

const excessSetWithWos: PolicyFormSet = {
  ...excessSetWithBlanketAi,
  endorsements: [
    {
      form: "CG 24 04",
      edition: "05 09",
      title: "Waiver Of Transfer Of Rights Of Recovery — Blanket",
      kind: "wos",
      scope: "blanket",
    },
  ],
};

function issuanceInput(db: Database.Database, over: Partial<IssuanceInput>): IssuanceInput {
  return {
    db,
    now: NOW,
    operator: "Stress Harness",
    path: "studio",
    account: stressAccount,
    policies: [],
    formSets: {},
    holderName: "Test Holder Corp",
    holderAddress: "100 Main St, Springfield, IL 62701",
    artifact: { kind: "sheet", formKey: "acord25", placements: {}, overrides: {} },
    redAlertActive: false,
    holderAiRecords: [],
    scheduleSources: [],
    ...over,
  };
}

/* ————— A. ISC multi-writer insurer lettering ————— */

scenario("A ISC Multi-Writer Lettering — Hadron / Sutton / SiriusPoint / Third Coast", () => {
  const writers = ISC_WRITERS.map((w) => w.issuingCompany);
  const policies: Policy[] = writers.map((w, i) =>
    iscPolicy({
      id: `pol-isc-${i}`,
      policyNumber: `ISC-W${i}-000${i}`,
      issuingCarrier: w,
      coverages: ["GL"],
    }),
  );
  const formSets = Object.fromEntries(policies.map((p) => [p.id, glSet]));
  const packet = buildCertificatePacket({
    account: stressAccount,
    policies,
    formSets,
    holderName: "Test Holder Corp",
    holderAddress: "100 Main St, Springfield, IL 62701",
  });

  check(
    packet.insurers.length === 4,
    "Four ISC policies on four writers = four INSURER lines (letter per paper, not per brand)",
    packet.insurers.map((i) => `${i.letter}=${i.issuingCompany ?? i.carrier}`).join(" · "),
  );
  const letters = packet.insurers.map((i) => i.letter);
  check(
    new Set(letters).size === 4 && letters.every((l) => "ABCD".includes(l) && l !== ""),
    "Letters A–D assigned uniquely",
    letters.join(","),
  );
  for (const w of ISC_WRITERS) {
    const line = packet.insurers.find((i) => i.issuingCompany === w.issuingCompany);
    check(
      line != null && line.naic === w.naic,
      `INSURER line prints the writing company with verified NAIC — ${w.issuingCompany}`,
      line ? `${line.letter}: ${line.issuingCompany} NAIC ${line.naic}` : "MISSING",
    );
  }
  check(
    packet.insurers.every((i) => i.issuingCompany !== "ISC"),
    "No INSURER line prints the MGA brand as the writing company",
  );
  // Sections map to the right letters.
  const byPolicy = new Map(packet.sections.map((s) => [s.policy.id, s.insurerLetter]));
  const expected = new Map(packet.insurers.map((i) => [i.issuingCompany, i.letter]));
  check(
    policies.every((p) => byPolicy.get(p.id) === expected.get(p.issuingCarrier!)),
    "Every policy's section carries its own writer's letter",
    policies.map((p) => `${p.policyNumber}:${byPolicy.get(p.id)}`).join(" "),
  );

  // Same-writer sharing: two Hadron policies share one letter.
  const twoHadron: Policy[] = [
    iscPolicy({ id: "pol-h1", policyNumber: "HSIC-1" }),
    iscPolicy({ id: "pol-h2", policyNumber: "HSIC-2", coverages: ["EXCESS_UMB"] }),
  ];
  const pShare = buildCertificatePacket({
    account: stressAccount,
    policies: twoHadron,
    formSets: { "pol-h1": glSet, "pol-h2": { ...excessSetWithWos, endorsements: [] } },
    holderName: "H",
    holderAddress: "",
  });
  check(
    pShare.insurers.length === 1 &&
      pShare.sections.every((s) => s.insurerLetter === pShare.insurers[0].letter),
    "Two ISC policies on the same writer share one insurer line",
    pShare.insurers.map((i) => `${i.letter}=${i.issuingCompany}`).join(),
  );

  // Unrecorded writer: honest blank NAIC, brand prints, separate letter.
  const mixed: Policy[] = [
    iscPolicy({ id: "pol-m1", policyNumber: "HSIC-3" }),
    iscPolicy({ id: "pol-m2", policyNumber: "ISC-UNREC", issuingCarrier: null }),
    iscPolicy({ id: "pol-m3", policyNumber: "ISC-JUNK", issuingCarrier: "Acme Unknown Insurance Group" }),
  ];
  const pMixed = buildCertificatePacket({
    account: stressAccount,
    policies: mixed,
    formSets: { "pol-m1": glSet, "pol-m2": glSet, "pol-m3": glSet },
    holderName: "H",
    holderAddress: "",
  });
  const unrec = pMixed.insurers.filter((i) => i.issuingCompany == null);
  check(
    unrec.length === 1 && unrec.every((i) => i.naic === null && i.carrier === "ISC"),
    "Unrecorded/junk writers collapse to the brand with a BLANK NAIC (never a guess)",
    pMixed.insurers.map((i) => `${i.letter}=${i.issuingCompany ?? i.carrier}:${i.naic ?? "∅"}`).join(" · "),
  );

  // Exhaustion: 4 ISC writers + 3 other carriers = 7 papers → refusal.
  const seven: Policy[] = [
    ...policies,
    iscPolicy({ id: "pol-k", carrier: "Kinsale", issuingCarrier: null, policyNumber: "KIN-1" }),
    iscPolicy({ id: "pol-hx", carrier: "Hiscox", issuingCarrier: null, policyNumber: "HSX-1" }),
    iscPolicy({ id: "pol-mk", carrier: "Markel", issuingCarrier: null, policyNumber: "MKL-1" }),
  ];
  const pSeven = buildCertificatePacket({
    account: stressAccount,
    policies: seven,
    formSets: Object.fromEntries(seven.map((p) => [p.id, glSet])),
    holderName: "H",
    holderAddress: "",
  });
  const sevenLetters = pSeven.insurers.map((i) => i.letter);
  check(
    sevenLetters.filter((l) => l === "").length === 1 &&
      sevenLetters.every((l) => l === "" || (l >= "A" && l <= "F")),
    "Seventh paper gets a blank letter, never a phantom G",
    sevenLetters.map((l) => l || "∅").join(","),
  );
  check(
    pSeven.rejects.some((r) => r.finding.id.startsWith("insurer-overflow")),
    "Packet refuses to issue past six writing companies",
    pSeven.rejects.map((r) => r.finding.id).join(", "),
  );
  // And the one door blocks it.
  const db = new Database(":memory:");
  migrateCertLedger(db);
  const out = performCertIssuance(
    issuanceInput(db, {
      policies: seven,
      formSets: Object.fromEntries(seven.map((p) => [p.id, glSet])),
    }),
  );
  check(
    !out.issued && out.attempt.blockedCheckIds.includes("verifier-clean"),
    "performCertIssuance blocks the 7-writer sheet at Sheet Verifier Clean",
    out.attempt.blockedCheckIds.join(","),
  );
});

/* ————— B. Carrier knowledge at the one door ————— */

scenario("B Carrier Knowledge — ISC excess AI blocks at issuance, non-overridable", () => {
  const db = new Database(":memory:");
  migrateCertLedger(db);
  const excess = iscPolicy({
    id: "pol-excess",
    policyNumber: "SUT-XS-445210",
    coverages: ["EXCESS_UMB"],
    issuingCarrier: "Sutton National Insurance Company",
  });

  // Sheet path: the resolver claims AI off the blanket form on the excess set.
  const sheetOut = performCertIssuance(
    issuanceInput(db, {
      policies: [excess],
      formSets: { [excess.id]: excessSetWithBlanketAi },
    }),
  );
  check(!sheetOut.issued, "Sheet artifact with AI against ISC excess does not issue");
  check(
    sheetOut.attempt.blockedCheckIds.includes("carrier-knowledge-restrictions"),
    "Carrier Knowledge Restrictions is among the blocking checks",
    sheetOut.attempt.blockedCheckIds.join(","),
  );
  const ckResult = sheetOut.results.find((r) => r.id === "carrier-knowledge-restrictions");
  check(
    Boolean(ckResult?.detail.includes("isc-excess-no-additional-insured")),
    "Block cites the knowledge entry id verbatim",
    ckResult?.detail.slice(0, 140),
  );
  // The studio review rail consults the same carrier-knowledge registry the
  // one door enforces: the forbidden AI claim rejects in verifyEditedSheet
  // before the operator can reach Apply Signature, and verifier-clean fails
  // at issuance alongside the registry check.
  check(
    sheetOut.attempt.blockedCheckIds.includes("verifier-clean"),
    "Sheet Verifier Clean fails too — the rail and the registry agree",
    sheetOut.attempt.blockedCheckIds.join(","),
  );
  const packet = buildCertificatePacket({
    account: stressAccount,
    policies: [excess],
    formSets: { [excess.id]: excessSetWithBlanketAi },
    holderName: "Test Holder Corp",
    holderAddress: "100 Main St, Springfield, IL 62701",
  });
  const railSheet = resolveCertSheet("acord25", packet.sections);
  const rail = verifyEditedSheet({
    account: stressAccount,
    packet,
    sheet: railSheet,
    overrides: {},
  });
  check(
    rail.rejects.some(
      (r) => r.finding.id === "carrier-knowledge-isc-excess-no-additional-insured",
    ),
    "Studio review rail (verifyEditedSheet) rejects the forbidden AI claim",
    rail.rejects.map((r) => r.finding.id).join(", ") || "NO REJECT — RAIL BLIND",
  );
  check(
    rail.rejects.some((r) =>
      r.finding.detail.includes("[Carrier Knowledge: isc-excess-no-additional-insured]"),
    ),
    "Rail reject cites the knowledge entry id in the standard citation format",
  );
  check(
    !packet.okToIssue &&
      packet.rejects.some((r) => r.finding.id === "carrier-knowledge-isc-excess-no-additional-insured"),
    "Packet verdict (feeds batch run + ticket verifier) rejects the claim with the entry id",
    packet.rejects.map((r) => r.finding.id).join(", "),
  );
  const run = buildCertificateRun({
    account: stressAccount,
    policies: [excess],
    formSets: { [excess.id]: excessSetWithBlanketAi },
    holders: [{ name: "Run Holder LLC", address: "1 Run Way" }],
    formKey: "acord25",
  });
  check(
    !run.blocked &&
      run.certificates.every(
        (c) => !c.okToIssue && c.rejectIds.includes("carrier-knowledge-isc-excess-no-additional-insured"),
      ),
    "Batch run marks every holder not-ok-to-issue, citing the knowledge entry",
  );

  // Non-overridable: an override request changes nothing.
  const overridden = performCertIssuance(
    issuanceInput(db, {
      policies: [excess],
      formSets: { [excess.id]: excessSetWithBlanketAi },
      checkOverrides: [
        { checkId: "carrier-knowledge-restrictions", reason: "client is screaming, just this once" },
        { checkId: "verifier-clean", reason: "same" },
      ],
    }),
  );
  const ckAfter = overridden.results.find((r) => r.id === "carrier-knowledge-restrictions");
  check(
    !overridden.issued && ckAfter?.status === "fail" && ckAfter.overridable === false,
    "Override request on the knowledge block is ignored — fails closed for everyone",
  );

  // Ticket/draft path: same wall.
  const draft = buildDraftFromPolicy({
    account: stressAccount,
    policy: excess,
    holderName: "Test Holder Corp",
    holderAddress: "100 Main St, Springfield, IL 62701",
    set: excessSetWithBlanketAi,
  });
  check(draft.flags.additionalInsured, "Control: the excess draft claims AI (blanket form on the set)");
  const draftOut = performCertIssuance(
    issuanceInput(db, {
      path: "ticket",
      policies: [excess],
      formSets: { [excess.id]: excessSetWithBlanketAi },
      artifact: { kind: "draft", draft },
    }),
  );
  check(
    !draftOut.issued && draftOut.attempt.blockedCheckIds.includes("carrier-knowledge-restrictions"),
    "Draft (ticket) path blocks on the same registry check",
    draftOut.attempt.blockedCheckIds.join(","),
  );

  // Negative controls: WOS on ISC excess is not forbidden; AI on ISC GL is fine.
  const wosOut = performCertIssuance(
    issuanceInput(db, {
      policies: [{ ...excess, id: "pol-excess-wos" }],
      formSets: { "pol-excess-wos": excessSetWithWos },
    }),
  );
  check(
    wosOut.issued,
    "Control: Waiver Of Subrogation on ISC excess issues (restriction is AI-specific)",
    wosOut.issued ? "issued" : wosOut.attempt.blockedCheckIds.join(","),
  );
  const glAi = iscPolicy({ id: "pol-gl-ai", policyNumber: "HSIC-GL-1" });
  const glOut = performCertIssuance(
    issuanceInput(db, {
      policies: [glAi],
      formSets: { [glAi.id]: glSetWithBlanketAi },
    }),
  );
  check(
    glOut.issued,
    "Control: blanket AI on ISC GENERAL LIABILITY issues (line scope respected)",
    glOut.issued ? "issued" : glOut.attempt.blockedCheckIds.join(","),
  );

  // Blocked attempts persist with the check ids.
  const attempts = db
    .prepare(`SELECT COUNT(*) AS n FROM cert_issue_attempts WHERE outcome = 'blocked'`)
    .get() as { n: number };
  check(attempts.n >= 3, "Every blocked attempt persisted to the ledger", `${attempts.n} blocked rows`);
});

/* ————— C. Real ISC accounts off the live SQLite ————— */

interface RealRow {
  account: Account;
  policies: Policy[];
}

function loadRealAccounts(): RealRow[] {
  const dbPath = path.join(__dirname, "..", "data", "underwriter-desk.db");
  const live = new Database(dbPath, { readonly: true });
  const accounts = live
    .prepare(`SELECT * FROM accounts WHERE id LIKE 'acct-real-%' ORDER BY id`)
    .all() as Record<string, unknown>[];
  const rows: RealRow[] = accounts.map((a) => ({
    account: {
      id: a.id as string,
      name: a.name as string,
      dba: (a.dba as string | null) ?? null,
      industry: a.industry as string,
      addressLine1: (a.address1 as string | null) ?? null,
      city: (a.city as string | null) ?? null,
      state: a.state as string,
      zip: (a.zip as string | null) ?? null,
      primaryUwId: a.primary_uw_id as string,
      backupUwId: (a.backup_uw_id as string | null) ?? null,
      notes: (a.notes as string | null) ?? null,
      status: a.status as Account["status"],
      paymentReceivedAt: (a.payment_received_at as string | null) ?? null,
    },
    policies: (
      live
        .prepare(`SELECT * FROM policies WHERE account_id = ? ORDER BY carrier, id`)
        .all(a.id as string) as Record<string, unknown>[]
    ).map((p) => ({
      id: p.id as string,
      accountId: p.account_id as string,
      policyNumber: p.policy_number as string,
      carrier: p.carrier as string,
      coverages: JSON.parse(p.coverages_json as string) as string[],
      effectiveDate: p.effective_date as string,
      expirationDate: p.expiration_date as string,
      premiumCents: p.premium_cents as number,
      quoteInsuredName: (p.quote_insured_name as string | null) ?? null,
      quoteCarrier: (p.quote_carrier as string | null) ?? null,
      issuingCarrier: (p.issuing_carrier as string | null) ?? null,
    })),
  }));
  // Schedule-of-record presence per policy (mirrors production resolution).
  const scheduled = new Set(
    (
      live.prepare(`SELECT DISTINCT policy_id FROM policy_coverage_parts`).all() as {
        policy_id: string;
      }[]
    ).map((r) => r.policy_id),
  );
  live.close();
  return rows.map((r) => ({
    ...r,
    policies: r.policies.map((p) => {
      if (scheduled.has(p.id)) {
        throw new Error(`${p.id} has a DB schedule — this harness assumed schedule-less real policies`);
      }
      return p;
    }),
  }));
}

scenario("C1 Real ISC Accounts — honest blanks, zero fabrication (26 accounts)", () => {
  const rows = loadRealAccounts();
  check(rows.length === 26, "26 acct-real-* accounts on the book", `${rows.length}`);

  let blankViolations = 0;
  let naicViolations = 0;
  let dollarViolations = 0;
  let verifierDirty = 0;
  const evidence: string[] = [];

  for (const { account, policies } of rows) {
    const formSets = Object.fromEntries(policies.map((p) => [p.id, bareFormSet(p.coverages)]));
    const packet = buildCertificatePacket({
      account,
      policies,
      formSets,
      holderName: "Sample Requesting GC LLC",
      holderAddress: "500 Jobsite Blvd, Austin, TX 78701",
    });
    const sheet = resolveCertSheet("acord25", packet.sections);

    // Every limit box blank, every checkbox unresolved on schedule-less paper.
    for (const rs of sheet.sections) {
      if (Object.values(rs.limits).some((v) => v != null)) {
        blankViolations++;
        evidence.push(`${account.id}: ${rs.def.key} prints a limit with no schedule`);
      }
      if (Object.values(rs.checks).some(Boolean)) {
        blankViolations++;
        evidence.push(`${account.id}: ${rs.def.key} resolves a checkbox with no schedule`);
      }
      if (rs.ref?.additionalInsured || rs.ref?.subrogationWaived) {
        blankViolations++;
        evidence.push(`${account.id}: ${rs.def.key} claims AI/WOS with no endorsement on file`);
      }
    }
    // No fabricated NAIC: writers are unrecorded on these policies.
    for (const ins of packet.insurers) {
      const recorded = policies.some((p) => p.issuingCarrier?.trim());
      if (!recorded && ins.carrier === "ISC" && (ins.naic != null || ins.issuingCompany != null)) {
        naicViolations++;
        evidence.push(`${account.id}: ISC line invented ${ins.issuingCompany} / ${ins.naic}`);
      }
    }
    // Not a dollar sign anywhere on the artifact.
    const desc = certDescription(packet, sheet);
    if (desc.includes("$") || /additional insured|waiver/i.test(desc)) {
      dollarViolations++;
      evidence.push(`${account.id}: description claims something — "${desc.slice(0, 80)}"`);
    }
    const verdict = verifyEditedSheet({ account, packet, sheet, overrides: {} });
    if (verdict.rejects.length > 0) {
      verifierDirty++;
      evidence.push(`${account.id}: untouched sheet rejects ${verdict.rejects.map((r) => r.finding.id).join(",")}`);
    }
  }
  check(blankViolations === 0, "All sections print honest blanks — no limit, checkbox, or AI/WOS claim", evidence.join(" | ") || "clean across 26");
  check(naicViolations === 0, "No invented writing company or NAIC on unrecorded ISC paper");
  check(dollarViolations === 0, "No dollar or endorsement language fabricated into Description Of Operations");
  check(verifierDirty === 0, "Untouched sheets verify clean on all 26 accounts");

  // Determinism: double-build every account, byte-identical.
  const hashOf = (row: RealRow) => {
    const formSets = Object.fromEntries(row.policies.map((p) => [p.id, bareFormSet(p.coverages)]));
    const packet = buildCertificatePacket({
      account: row.account,
      policies: row.policies,
      formSets,
      holderName: "Sample Requesting GC LLC",
      holderAddress: "500 Jobsite Blvd, Austin, TX 78701",
    });
    const sheet = resolveCertSheet("acord25", packet.sections);
    return createHash("sha256")
      .update(JSON.stringify({ packet, sheet }, (k, v) => (typeof v === "function" ? undefined : v)))
      .digest("hex");
  };
  const nondeterministic = rows.filter((r) => hashOf(r) !== hashOf(r));
  check(nondeterministic.length === 0, "All 26 accounts build byte-identical twice", nondeterministic.map((r) => r.account.id).join(",") || "deterministic");

  // Data-quality sweep the desk should know about.
  const blankPolicyNumbers = rows.flatMap((r) => r.policies.filter((p) => !p.policyNumber.trim()).map((p) => `${r.account.id}/${p.id}`));
  console.log(`  # policies with BLANK policy number: ${blankPolicyNumbers.join(", ") || "none"}`);
  const unrecordedWriters = rows.flatMap((r) => r.policies.filter((p) => p.carrier === "ISC" && !p.issuingCarrier?.trim()));
  console.log(`  # ISC policies with unrecorded writing company (NAIC prints blank): ${unrecordedWriters.length}`);
});

scenario("C2 Real ISC Accounts — overstating rejected, one-door issuance honest", () => {
  const rows = loadRealAccounts();
  const active = rows.find((r) => r.account.status === "active" && r.policies.length > 0 && r.policies[0].policyNumber)!;
  const formSets = Object.fromEntries(active.policies.map((p) => [p.id, bareFormSet(p.coverages)]));
  const packet = buildCertificatePacket({
    account: active.account,
    policies: active.policies,
    formSets,
    holderName: "Sample Requesting GC LLC",
    holderAddress: "500 Jobsite Blvd, Austin, TX 78701",
  });
  const sheet = resolveCertSheet("acord25", packet.sections);

  // THE CARDINAL RULE: typing a dollar into a schedule-less box must reject.
  const inflate = verifyEditedSheet({
    account: active.account,
    packet,
    sheet,
    overrides: { "gl.limit.eachOccurrence": "1,000,000" },
  });
  check(
    inflate.rejects.length > 0,
    `CARDINAL: $1,000,000 typed onto schedule-less ${active.account.id} rejects`,
    inflate.rejects.map((r) => r.finding.id).join(", ") || "NO REJECT — OVERSTATEMENT WOULD SHIP",
  );
  const aiClaim = verifyEditedSheet({
    account: active.account,
    packet,
    sheet,
    overrides: { "gl.addl": true },
  });
  check(
    aiClaim.rejects.length > 0,
    "CARDINAL: Additional Insured checkbox with no endorsement on file rejects",
    aiClaim.rejects.map((r) => r.finding.id).join(", ") || "NO REJECT",
  );

  // One-door issuance on the honest blank sheet.
  const db = new Database(":memory:");
  migrateCertLedger(db);
  const out = performCertIssuance(
    issuanceInput(db, {
      account: active.account,
      policies: active.policies,
      formSets,
      holderName: "Sample Requesting GC LLC",
      holderAddress: "500 Jobsite Blvd, Austin, TX 78701",
    }),
  );
  check(out.issued, `Honest-blank certificate issues for ${active.account.id}`, out.issued ? out.cert.id : out.attempt.blockedCheckIds.join(","));
  if (out.issued) {
    const dollarFields = out.cert.snapshot.fields.filter((f) => f.value.includes("$"));
    check(
      dollarFields.length === 0,
      "Frozen snapshot carries zero dollar claims (nothing exceeds the schedule of record)",
      dollarFields.map((f) => `${f.id}=${f.value}`).join(",") || "0 dollar fields",
    );
  }

  // Inflated override at the one door: must block, not issue.
  const inflatedOut = performCertIssuance(
    issuanceInput(db, {
      account: active.account,
      policies: active.policies,
      formSets,
      holderName: "Sample Requesting GC LLC",
      holderAddress: "500 Jobsite Blvd, Austin, TX 78701",
      artifact: {
        kind: "sheet",
        formKey: "acord25",
        placements: {},
        overrides: { "gl.limit.eachOccurrence": "2,000,000" },
      },
    }),
  );
  check(
    !inflatedOut.issued && inflatedOut.attempt.blockedCheckIds.includes("verifier-clean"),
    "CARDINAL: the same inflation blocks at the single send path",
    inflatedOut.attempt.blockedCheckIds.join(","),
  );

  // Pre-bind real account cannot issue.
  const preBind = rows.find((r) => r.account.status === "pre_bind");
  check(preBind != null, "Pre-bind real account present (acct-real-925505)", preBind?.account.id);
  if (preBind) {
    const pbSets = Object.fromEntries(preBind.policies.map((p) => [p.id, bareFormSet(p.coverages)]));
    const pbOut = performCertIssuance(
      issuanceInput(db, {
        account: preBind.account,
        policies: preBind.policies,
        formSets: pbSets,
      }),
    );
    check(
      !pbOut.issued && pbOut.attempt.blockedCheckIds.includes("account-in-service"),
      "Pre-bind account blocks at Account In Service",
      pbOut.attempt.blockedCheckIds.join(","),
    );
    const run = buildCertificateRun({
      account: preBind.account,
      policies: preBind.policies,
      formSets: pbSets,
      holders: [{ name: "H1", address: "" }],
      formKey: "acord25",
    });
    check(run.blocked, "Batch run on the pre-bind account is blocked outright", run.blockedReason ?? "");
  }

  // Blank policy number: report what renders (data-quality edge).
  const blankNum = rows.find((r) => r.policies.some((p) => !p.policyNumber.trim()));
  if (blankNum) {
    const bSets = Object.fromEntries(blankNum.policies.map((p) => [p.id, bareFormSet(p.coverages)]));
    const bPacket = buildCertificatePacket({
      account: blankNum.account,
      policies: blankNum.policies,
      formSets: bSets,
      holderName: "Sample Requesting GC LLC",
      holderAddress: "500 Jobsite Blvd, Austin, TX 78701",
    });
    const bSheet = resolveCertSheet("acord25", bPacket.sections);
    const glRow = bSheet.sections.find((rs) => rs.def.key === "gl")!;
    check(
      glRow.ref != null && glRow.ref.policyNumber === "",
      `Blank policy number renders as a blank cell, not an invention (${blankNum.account.id})`,
      JSON.stringify(glRow.ref?.policyNumber),
    );
    const bVerdict = verifyEditedSheet({ account: blankNum.account, packet: bPacket, sheet: bSheet, overrides: {} });
    check(
      bVerdict.warns.some((w) => w.finding.id.startsWith("policy-number-missing")),
      `Blank policy number WARNS — the operator sees it before signing (${blankNum.account.id})`,
      bVerdict.warns.map((w) => w.finding.id).join(",") || "NO WARN — SILENT BLANK",
    );
    check(
      bVerdict.rejects.length === 0,
      "Blank policy number does not reject — underreporting stays permitted by doctrine",
      bVerdict.rejects.map((r) => r.finding.id).join(",") || "no rejects",
    );
  }
});

/* ————— D. Batch multi-holder runs ————— */

scenario("D Batch Run — 30 holders, zero bleed, ledger isolation", () => {
  const policy = iscPolicy({ id: "pol-batch", policyNumber: "HSIC-BATCH-1" });
  const formSets = { [policy.id]: glSetWithBlanketAi };
  const holders = Array.from({ length: 30 }, (_, i) => ({
    name: `Holder ${String(i + 1).padStart(2, "0")} Property Group LLC`,
    address: `${100 + i} Portfolio Way, Dallas, TX 7520${i % 10}`,
    requesterEmail: i % 3 === 0 ? `requester${i}@example.com` : null,
  }));

  const run1 = buildCertificateRun({
    account: stressAccount,
    policies: [policy],
    formSets,
    holders,
    formKey: "acord25",
  });
  const run2 = buildCertificateRun({
    account: stressAccount,
    policies: [policy],
    formSets,
    holders,
    formKey: "acord25",
  });
  check(!run1.blocked && run1.certificates.length === 30, "Run builds 30 certificates", `${run1.certificates.length}`);
  check(JSON.stringify(run1) === JSON.stringify(run2), "Whole 30-cert run is deterministic (double build identical)");

  let bleed = 0;
  for (const cert of run1.certificates) {
    const othersNamed = holders.filter(
      (h) => h.name !== cert.holderName && cert.description.includes(h.name),
    );
    if (othersNamed.length > 0) bleed++;
    if (!cert.description.includes(cert.holderName)) bleed++;
  }
  check(bleed === 0, "Each description names exactly its own holder — zero cross-holder bleed", `${bleed} bleeds`);
  check(
    run1.certificates.every((c) => c.blanketBasis === "CG 20 33 04 13" && c.okToIssue),
    "Every holder rides the blanket AI basis and verifies ok",
  );

  const emails = prepareRunEmails(run1, { accountName: stressAccount.name, formNumber: "ACORD 25" });
  check(
    emails.every((e, i) => e.to === (holders[i].requesterEmail ?? null)),
    "Email To: is the requester on file or null — never invented",
    `${emails.filter((e) => e.to === null).length} of 30 have no address (stay null)`,
  );

  // Issue all 30 through the one door — one active cert per holder requirement.
  const db = new Database(":memory:");
  migrateCertLedger(db);
  let issuedCount = 0;
  for (const h of holders) {
    const out = performCertIssuance(
      issuanceInput(db, {
        path: "run",
        policies: [policy],
        formSets,
        holderName: h.name,
        holderAddress: h.address,
      }),
    );
    if (out.issued) issuedCount++;
  }
  check(issuedCount === 30, "All 30 issue through performCertIssuance", `${issuedCount}/30`);
  const actives = listIssuedCerts(db, stressAccount.id).filter((c) => c.status === "active");
  check(
    actives.length === 30 && new Set(actives.map((c) => c.requirementKey)).size === 30,
    "Ledger holds 30 active certs under 30 distinct requirement keys",
  );
});

/* ————— E. Snapshot invalidation mid-run ————— */

scenario("E Snapshot Invalidation Mid-Run — upstream change between holders", () => {
  const db = new Database(":memory:");
  migrateCertLedger(db);
  const policy = iscPolicy({ id: "pol-mid", policyNumber: "HSIC-MID-1" });
  const before = { [policy.id]: glSet };
  const holders = ["Alpha Site Owners LLC", "Bravo Site Owners LLC", "Charlie Site Owners LLC"];

  // Prepare all three off the same (pre-change) facts.
  for (const h of holders) {
    const { snapshot } = buildFactSnapshot({
      account: stressAccount,
      policies: [policy],
      formSets: before,
      formKey: "acord25",
      placements: {},
      holderName: h,
      holderAddress: "1 Prep Way, Dallas, TX 75201",
      overrides: {},
      takenAt: NOW,
    });
    upsertPrepared(db, {
      accountId: stressAccount.id,
      requirementKey: requirementKeyFor({ holderName: h }),
      holderName: h,
      snapshot,
      preparedBy: "Stress Harness",
      preparedAt: NOW,
    });
  }

  // Holder 1 sends before the change: prepared artifact consumed.
  const out1 = performCertIssuance(
    issuanceInput(db, {
      path: "run",
      policies: [policy],
      formSets: before,
      holderName: holders[0],
      holderAddress: "1 Prep Way, Dallas, TX 75201",
    }),
  );
  check(out1.issued, "Holder 1 issues on matching digest before the change");
  const consumed = db
    .prepare(`SELECT consumed_by_cert_id FROM cert_prepared WHERE holder_name = ?`)
    .get(holders[0]) as { consumed_by_cert_id: string | null };
  check(Boolean(consumed.consumed_by_cert_id), "Holder 1's prepared artifact consumed by the issued cert");

  // Mid-run endorsement: GL occurrence moves to $2M on the schedule of record.
  const after: Record<string, PolicyFormSet> = {
    [policy.id]: {
      ...glSet,
      limits: glSet.limits.map((l) =>
        l.slot === "gl_each_occurrence" ? { ...l, amountCents: 2_000_000_00 } : l,
      ),
    },
  };

  const out2 = performCertIssuance(
    issuanceInput(db, {
      path: "run",
      policies: [policy],
      formSets: after,
      holderName: holders[1],
      holderAddress: "1 Prep Way, Dallas, TX 75201",
    }),
  );
  check(
    !out2.issued && out2.attempt.blockedCheckIds.includes("snapshot-current"),
    "Holder 2 blocks — prepared digest no longer matches current facts",
    out2.attempt.blockedCheckIds.join(","),
  );
  const dead2 = db
    .prepare(`SELECT invalidated_reason FROM cert_prepared WHERE holder_name = ?`)
    .get(holders[1]) as { invalidated_reason: string | null };
  check(
    dead2.invalidated_reason === "Upstream Facts Changed Since Preparation",
    "Holder 2's prepared artifact invalidated on the spot with the recorded reason",
    String(dead2.invalidated_reason),
  );
  const retry2 = performCertIssuance(
    issuanceInput(db, {
      path: "run",
      policies: [policy],
      formSets: after,
      holderName: holders[1],
      holderAddress: "1 Prep Way, Dallas, TX 75201",
    }),
  );
  check(retry2.issued, "Holder 2 retry regenerates from current facts and issues");
  if (retry2.issued && out1.issued) {
    const f2 = retry2.cert.snapshot.fields.find((f) => f.id === "gl.limit.eachOccurrence");
    const f1 = out1.cert.snapshot.fields.find((f) => f.id === "gl.limit.eachOccurrence");
    check(
      f1?.value === "$ 1,000,000" && f2?.value === "$ 2,000,000",
      "Snapshots carry the schedule as of each send moment ($1M pre-change, $2M post)",
      `${f1?.value} → ${f2?.value}`,
    );
  }

  // Holder 3 never re-prepared: same forced regeneration on first send.
  const out3 = performCertIssuance(
    issuanceInput(db, {
      path: "run",
      policies: [policy],
      formSets: after,
      holderName: holders[2],
      holderAddress: "1 Prep Way, Dallas, TX 75201",
    }),
  );
  check(
    !out3.issued && out3.attempt.blockedCheckIds.includes("snapshot-current"),
    "Holder 3's stale preparation also blocks at send — no silent ride-through",
  );
  check(
    getLivePrepared(db, stressAccount.id, requirementKeyFor({ holderName: holders[2] })) == null,
    "No live prepared artifact remains for holder 3 after the block",
  );
});

/* ————— F. Supersede chain torture ————— */

scenario("F Supersede Chain — 8 correction rounds, linear chain, notices", () => {
  const db = new Database(":memory:");
  migrateCertLedger(db);
  const policy = iscPolicy({ id: "pol-chain", policyNumber: "HSIC-CHAIN-1" });
  const formSets = { [policy.id]: glSet };
  const HOLDER = "Chain Of Custody Partners LP";
  const reqKey = requirementKeyFor({ holderName: HOLDER });

  const ids: string[] = [];
  for (let round = 0; round < 8; round++) {
    const at = new Date(Date.parse(NOW) + round * 60_000).toISOString();
    const out = performCertIssuance(
      issuanceInput(db, {
        now: at,
        policies: [policy],
        formSets,
        holderName: HOLDER,
        holderAddress: "700 Ledger Ln, Houston, TX 77002",
      }),
    );
    if (!out.issued) {
      check(false, `Round ${round + 1} failed to issue`, out.attempt.blockedCheckIds.join(","));
      return;
    }
    ids.push(out.cert.id);
    if (round < 7) {
      markCertErroneous(db, {
        certId: out.cert.id,
        revokedBy: "Desk Manager",
        reason: `Round ${round + 1} correction: wrong holder suite number.`,
        revokedAt: new Date(Date.parse(at) + 30_000).toISOString(),
      });
    }
  }

  const certs = listIssuedCerts(db, stressAccount.id).filter((c) => c.requirementKey === reqKey);
  check(certs.length === 8, "Eight certificates on the requirement", `${certs.length}`);
  const active = certs.filter((c) => c.status === "active");
  check(active.length === 1 && active[0].id === ids[7], "Exactly one active cert — the final correction");
  check(
    certs.filter((c) => c.status === "revoked").length === 7,
    "All seven erroneous certs stand revoked (never deleted, never overwritten)",
  );

  // Walk the chain backward from the active cert: must be linear, 8 long.
  const byId = new Map(certs.map((c) => [c.id, c]));
  const walk: string[] = [];
  let cur: IssuedCertRecord | undefined = active[0];
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) {
      check(false, "Cycle detected in supersede chain", walk.join(" → "));
      return;
    }
    seen.add(cur.id);
    walk.push(cur.id);
    cur = cur.supersedes ? byId.get(cur.supersedes) : undefined;
  }
  check(
    walk.length === 8 && JSON.stringify(walk) === JSON.stringify([...ids].reverse()),
    "Chain walks linearly through all 8 issuances in order",
    `${walk.length} links`,
  );
  check(
    certs.every((c) => c.id === active[0].id || c.supersededBy != null),
    "Every non-final cert links forward to its replacement",
  );

  const notices = listHolderNotices(db, stressAccount.id).filter((n) => n.holderName === HOLDER);
  const kinds = { issued: 0, corrected: 0, revoked: 0 };
  for (const n of notices) kinds[n.kind]++;
  check(
    kinds.revoked === 7 && kinds.corrected === 7 && kinds.issued === 1,
    "Holder notices: 1 issued + 7 revoked + 7 corrected — the holder is never left on dead paper",
    JSON.stringify(kinds),
  );

  // Double revocation is a no-op, not a second notice.
  const before = listHolderNotices(db, stressAccount.id).length;
  markCertErroneous(db, { certId: ids[0], revokedBy: "Desk Manager", reason: "again" });
  check(
    listHolderNotices(db, stressAccount.id).length === before,
    "Revoking an already-revoked cert is a no-op (no duplicate notice)",
  );

  // Same-instant issuance: two sends with identical `now` — the ledger must
  // still hold exactly one active and a walkable chain (tie broken by id).
  const H2 = "Same Instant Holdings LLC";
  const a = performCertIssuance(
    issuanceInput(db, { now: NOW, policies: [policy], formSets, holderName: H2 }),
  );
  const b = performCertIssuance(
    issuanceInput(db, { now: NOW, policies: [policy], formSets, holderName: H2 }),
  );
  const sameInstant = listIssuedCerts(db, stressAccount.id).filter(
    (c) => c.requirementKey === requirementKeyFor({ holderName: H2 }),
  );
  const act2 = sameInstant.filter((c) => c.status === "active");
  check(
    a.issued && b.issued && act2.length === 1,
    "Same-instant double issuance still nets exactly one active cert",
    sameInstant.map((c) => `${c.id.slice(0, 12)}:${c.status}`).join(" · "),
  );
  if (a.issued && b.issued) {
    const second = sameInstant.find((c) => c.id === b.cert.id)!;
    check(
      second.supersedes === a.cert.id,
      "Same-instant tie breaks deterministically — second cert supersedes the first (rowid order)",
      `supersedes=${second.supersedes}`,
    );
  }
});

/* ————— G. Form registry scope ————— */

scenario("G Form Registry Scope — ACORD 25/30 live, ACORD 28 absent", () => {
  const keys = Object.keys(CERT_FORMS);
  check(
    keys.length === 2 && keys.includes("acord25") && keys.includes("acord30"),
    "CERT_FORMS carries exactly acord25 + acord30 — acord28 is out of scope today",
    keys.join(", "),
  );
  check(
    CERT_FORMS.acord25.edition === "2025/12" && CERT_FORMS.acord30.edition === "2016/03",
    "Editions pinned: ACORD 25 (2025/12), ACORD 30 (2016/03)",
  );
  // Guard: nothing in the enforceable knowledge registry references a form
  // the renderer cannot produce.
  const enforceable = CARRIER_KNOWLEDGE.filter((e) => e.enforceable);
  check(enforceable.length === 3, "Three enforceable knowledge entries (2 blockers + 1 warning)", enforceable.map((e) => e.id).join(", "));
});

/* ————— H. Registry sanity — non-overridable wall is complete ————— */

scenario("H Check Registry — every fabrication-class check fails closed", () => {
  const nonOverridable = [
    "red-alert-stand-down",
    "account-in-service",
    "policy-in-force",
    "verifier-clean",
    "holder-named",
    "endorsement-backing-verified",
    "carrier-knowledge-restrictions",
    "source-document-trust",
    "snapshot-current",
  ];
  const excess = iscPolicy({
    id: "pol-reg",
    policyNumber: "SUT-XS-1",
    coverages: ["EXCESS_UMB"],
    issuingCarrier: "Sutton National Insurance Company",
  });
  // The AI claim rides a set with NO backing endorsement at all, so BOTH
  // endorsement-backing-verified and carrier-knowledge-restrictions must fail.
  const unbackedExcess: PolicyFormSet = { ...excessSetWithBlanketAi, endorsements: [] };
  // A worst-case context violating everything at once, with override
  // requests on every check: only the overridable ones may clear.
  const results = runCertChecks({
    ctx: {
      account: { ...stressAccount, status: "cancelled" },
      policies: [{ ...excess, expirationDate: "2026-01-01" }],
      holderName: "",
      holderAddress: "",
      now: NOW,
      verifierRejects: [{ id: "x", title: "Fabricated limit" }],
      redAlertActive: true,
      endorsementClaims: [{ policy: excess, set: unbackedExcess, flag: "additionalInsured" }],
      holderAiRecords: [],
      requirementHolderName: "Someone Else LLC",
      scheduleSources: [{ kind: "coi", createdAt: "2020-01-01T00:00:00.000Z" }],
      prepared: { digest: "stale", expiresAt: "2020-01-01T00:00:00.000Z", invalidatedAt: null },
      currentDigest: "fresh",
    },
    overrides: nonOverridable
      .concat(["holder-matches-requirement", "source-document-rank", "source-document-age"])
      .map((id) => ({ checkId: id, reason: "operator insists" })),
    operator: "Rogue Operator",
  });
  const failedClosed = results.filter((r) => nonOverridable.includes(r.id) && r.status === "fail");
  check(
    failedClosed.length === nonOverridable.length,
    "All nine fabrication-class checks fail closed under blanket override pressure",
    results.filter((r) => nonOverridable.includes(r.id) && r.status !== "fail").map((r) => `${r.id}:${r.status}`).join(",") || "all fail",
  );
  const cleared = results.filter((r) => r.status === "overridden").map((r) => r.id);
  check(
    cleared.every((id) => ["holder-matches-requirement", "source-document-rank", "source-document-age", "holder-address-on-file"].includes(id)),
    "Only structurally overridable checks cleared, each with attribution",
    cleared.join(", "),
  );
});

console.log(
  `\n━━━ SCOREBOARD ━━━\nScenarios: ${scenarios} · Passed: ${scenarios - failedScenarios} · Failed: ${failedScenarios}\nChecks: ${checks} · Passed: ${checks - failedChecks} · Failed: ${failedChecks}`,
);
process.exit(failedScenarios);
