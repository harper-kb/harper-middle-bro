/**
 * PDF-fill failure-mode hunt — drives the full certificate pipeline
 * (packet → sheet → suggestions → verify → one-door issuance) over 10
 * diverse examples and probes the specific spots where the printed /
 * saved ACORD sheet could go wrong. Findings feed
 * docs/pdf-fill-failure-log.md.
 *
 * Examples:
 *   E1  acct-real-925460 — real ISC, dec-attached schedule, Hadron writer
 *   E2  acct-real-925420 — real ISC, SiriusPoint writer
 *   E3  acct-real-916015 — real ISC, NO schedule, missing street address
 *   E4  acct-meridian    — 6 policies, 4 carriers, description overflow
 *   E5  acct-northstar   — garage account, ACORD 30 + ACORD 25
 *   E6  acct-real-925505 — pre-bind, zero policies on file
 *   E7  synthetic        — zero policies on an ACTIVE account (door probe)
 *   E8  synthetic        — blank policy number
 *   E9  acct-greenleaf   — Included / Excluded mix, blanket AI + WoS
 *   E10 acct-metro       — ISC garage paper, unscheduled, Third Coast
 *
 * Run: node --import tsx scripts/pdf-fill-hunt.ts
 * Read-only against data/underwriter-desk.db; ledger writes go to :memory:.
 * Exit code = number of confirmed failures.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { certDescription, resolveCertSheet, type CertFormKey } from "../src/lib/acord25";
import { performCertIssuance, type IssuanceInput } from "../src/lib/cert-issuance-core";
import { migrateCertLedger } from "../src/lib/cert-ledger";
import {
  buildSuggestions,
  verifyEditedSheet,
  type SheetOverrides,
} from "../src/lib/cert-review";
import { buildFactSnapshot } from "../src/lib/cert-snapshot";
import { buildCertificatePacket } from "../src/lib/certificate";
import {
  bareFormSet,
  FORM_SETS,
  type EndorsementForm,
  type PolicyFormSet,
  type PolicyLimit,
} from "../src/lib/forms";
import { SEED_ACCOUNTS, SEED_POLICIES } from "../src/lib/seed";
import type { Account, Policy } from "../src/lib/types";

const NOW = "2026-08-10T17:30:00.000Z";
const HOLDER = "Test Holder Corp";
const HOLDER_ADDR = "100 Main St, Springfield, IL 62701";

let failures = 0;
const found: string[] = [];

function probe(id: string, ok: boolean, label: string, evidence?: string) {
  if (ok) {
    console.log(`  ok      ${label}${evidence ? ` — ${evidence}` : ""}`);
  } else {
    failures++;
    found.push(`${id}: ${label}${evidence ? ` — ${evidence}` : ""}`);
    console.log(`  FAILURE ${id} ${label}${evidence ? ` — ${evidence}` : ""}`);
  }
}

function section(name: string) {
  console.log(`\n━━━ ${name} ━━━`);
}

/* ————— Live data access (read-only), mirroring production resolution ————— */

const live = new Database(path.join(__dirname, "..", "data", "underwriter-desk.db"), {
  readonly: true,
});

function liveAccount(id: string): Account {
  const a = live.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!a) throw new Error(`no account ${id}`);
  return {
    id: a.id as string,
    name: a.name as string,
    dba: (a.dba as string | null) ?? null,
    industry: a.industry as string,
    addressLine1: (a.address1 as string | null) ?? null,
    city: (a.city as string | null) ?? null,
    state: a.state as string,
    zip: (a.zip as string | null) ?? null,
    primaryUwId: (a.primary_uw_id as string) ?? "uw-x",
    backupUwId: (a.backup_uw_id as string | null) ?? null,
    notes: (a.notes as string | null) ?? null,
    status: a.status as Account["status"],
    paymentReceivedAt: (a.payment_received_at as string | null) ?? null,
  };
}

function livePolicies(accountId: string): Policy[] {
  return (
    live
      .prepare(`SELECT * FROM policies WHERE account_id = ? ORDER BY carrier, id`)
      .all(accountId) as Record<string, unknown>[]
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
  }));
}

/** DB schedule → seed library → bare codes, same order as getPolicyFormSet. */
function resolveFormSet(policy: Policy): PolicyFormSet {
  const parts = live
    .prepare(
      `SELECT code, label, form, edition FROM policy_coverage_parts
       WHERE policy_id = ? ORDER BY sort_order ASC`,
    )
    .all(policy.id) as PolicyFormSet["coverages"];
  if (parts.length > 0) {
    const limits = (
      live
        .prepare(
          `SELECT slot, mode, amount_cents AS amountCents, loc FROM policy_limits WHERE policy_id = ?`,
        )
        .all(policy.id) as {
        slot: PolicyLimit["slot"];
        mode: PolicyLimit["mode"] | null;
        amountCents: number | null;
        loc: string | null;
      }[]
    ).map(
      (l) =>
        ({
          slot: l.slot,
          mode: l.mode ?? "amount",
          amountCents: l.amountCents ?? undefined,
          loc: l.loc ?? undefined,
        }) as PolicyLimit,
    );
    const endorsements = (
      live
        .prepare(
          `SELECT form, edition, title, kind, scope, note FROM policy_endorsements
           WHERE policy_id = ? ORDER BY sort_order ASC`,
        )
        .all(policy.id) as Record<string, unknown>[]
    ).map(
      (e) =>
        ({
          form: e.form as string,
          edition: e.edition as string,
          title: e.title as string,
          kind: e.kind,
          scope: (e.scope as EndorsementForm["scope"] | null) ?? undefined,
          note: (e.note as string | null) ?? undefined,
        }) as EndorsementForm,
    );
    return { coverages: parts, limits, endorsements };
  }
  return FORM_SETS[policy.id] ?? bareFormSet(policy.coverages);
}

function seedAccount(id: string): Account {
  const a = SEED_ACCOUNTS.find((x) => x.id === id);
  if (!a) throw new Error(`no seed account ${id}`);
  return a;
}

function seedPolicies(accountId: string): Policy[] {
  return SEED_POLICIES.filter((p) => p.accountId === accountId).sort((a, b) =>
    a.carrier < b.carrier ? -1 : a.carrier > b.carrier ? 1 : 0,
  );
}

/* ————— Pipeline runner ————— */

interface RunResult {
  packet: ReturnType<typeof buildCertificatePacket>;
  sheet: ReturnType<typeof resolveCertSheet>;
  suggestions: ReturnType<typeof buildSuggestions>;
  verdict: ReturnType<typeof verifyEditedSheet>;
}

function runPipeline(input: {
  account: Account;
  policies: Policy[];
  formSets: Record<string, PolicyFormSet>;
  formKey?: CertFormKey;
  overrides?: SheetOverrides;
}): RunResult {
  const packet = buildCertificatePacket({
    account: input.account,
    policies: input.policies,
    formSets: input.formSets,
    holderName: HOLDER,
    holderAddress: HOLDER_ADDR,
  });
  const sheet = resolveCertSheet(input.formKey ?? "acord25", packet.sections);
  const suggestions = buildSuggestions(sheet, packet);
  const verdict = verifyEditedSheet({
    account: input.account,
    packet,
    sheet,
    overrides: input.overrides ?? {},
  });
  return { packet, sheet, suggestions, verdict };
}

function ledgerDb(): Database.Database {
  const db = new Database(":memory:");
  migrateCertLedger(db);
  return db;
}

function issuance(
  db: Database.Database,
  over: Partial<IssuanceInput> & Pick<IssuanceInput, "account" | "policies" | "formSets">,
): IssuanceInput {
  return {
    db,
    now: NOW,
    operator: "PDF Fill Hunt",
    path: "studio",
    holderName: HOLDER,
    holderAddress: HOLDER_ADDR,
    artifact: { kind: "sheet", formKey: "acord25", placements: {}, overrides: {} },
    redAlertActive: false,
    holderAiRecords: [],
    scheduleSources: [{ kind: "policy", createdAt: "2026-08-09T02:47:22.697Z" }],
    ...over,
  };
}

/** Junk markers that must never appear in a rendered value. */
const JUNK = /undefined|NaN|\[object|Invalid Date/;

function sweepJunk(id: string, run: RunResult) {
  const bad = run.suggestions.filter(
    (s) => JUNK.test(s.display) || JUNK.test(s.source),
  );
  probe(
    id,
    bad.length === 0,
    "no undefined/NaN/[object] in any suggestion",
    bad.map((b) => `${b.id}="${b.display}"`).join(", ") || `${run.suggestions.length} suggestions clean`,
  );
  probe(
    id,
    !JUNK.test(certDescription(run.packet, run.sheet)),
    "description free of junk markers",
  );
}

/* ————————————————————————— E1 real ISC, Hadron schedule ————————————————————————— */

section("E1 acct-real-925460 — Real ISC + Hadron Dec Schedule");
const e1 = {
  account: liveAccount("acct-real-925460"),
  policies: livePolicies("acct-real-925460"),
};
const e1Sets = Object.fromEntries(e1.policies.map((p) => [p.id, resolveFormSet(p)]));
{
  const run = runPipeline({ ...e1, formSets: e1Sets });
  sweepJunk("E1", run);
  probe(
    "E1",
    run.verdict.rejects.length === 0,
    "untouched sheet verifies clean",
    run.verdict.rejects.map((r) => r.finding.id).join(", ") || "0 rejects",
  );
  const gl = run.sheet.sections.find((s) => s.def.key === "gl")!;
  probe(
    "E1",
    gl.limits.eachOccurrence?.kind === "amount" && gl.limits.eachOccurrence.cents === 100000000,
    "GL Each Occurrence fills $1,000,000 off the dec schedule",
    JSON.stringify(gl.limits.eachOccurrence),
  );
  const naic = run.packet.insurers[0];
  probe(
    "E1",
    naic.issuingCompany === "Hadron Specialty Insurance Company" && naic.naic != null,
    "INSURER A prints the Hadron writer with a verified NAIC",
    `${naic.issuingCompany} / ${naic.naic}`,
  );

  // P-desc: AI endorsement on this real schedule has a BLANK form + edition.
  // The packet wording must not print a dangling "per ." on the certificate.
  const desc = certDescription(run.packet, run.sheet);
  probe(
    "E1",
    !/per\s+\./.test(desc) && !/per\s{2,}/.test(desc),
    'description does not print a dangling "per ." for a form-less endorsement',
    JSON.stringify(desc.slice(0, 160)),
  );

  // P-money: true value typed with decimals must NOT reject.
  for (const text of ["1,000,000.00", "$1,000,000", "1000000.00"]) {
    const v = verifyEditedSheet({
      account: e1.account,
      packet: run.packet,
      sheet: run.sheet,
      overrides: { "gl.limit.eachOccurrence": text },
    });
    const over = v.rejects.filter((r) => r.finding.id.startsWith("limit-over"));
    probe(
      "E1",
      over.length === 0,
      `typing the true limit as "${text}" does not reject`,
      over.map((r) => r.finding.detail).join(" | ") || "accepted",
    );
  }
  // P-money-garbage: text that isn't a clean dollar must not silently parse.
  for (const text of ["1.5M", "-500"]) {
    const v = verifyEditedSheet({
      account: e1.account,
      packet: run.packet,
      sheet: run.sheet,
      overrides: { "gl.limit.eachOccurrence": text },
    });
    probe(
      "E1",
      v.rejects.some((r) => r.finding.id.startsWith("limit-unreadable")),
      `garbage limit text "${text}" rejects as unreadable (never a silent misparse)`,
      v.findings
        .filter((f) => f.fieldId === "gl.limit.eachOccurrence")
        .map((f) => f.finding.id)
        .join(", ") || "NO FINDING AT ALL",
    );
  }

  // P-date: an impossible calendar date inside the policy term must reject.
  const vDate = verifyEditedSheet({
    account: e1.account,
    packet: run.packet,
    sheet: run.sheet,
    overrides: { "gl.eff": "02/31/2027" },
  });
  probe(
    "E1",
    vDate.rejects.some((r) => r.finding.id.startsWith("date-invalid")),
    "impossible date 02/31/2027 rejects instead of printing",
    vDate.rejects.map((r) => r.finding.id).join(", ") || "NO REJECT — PRINTS 02/31/2027",
  );

  // P-inverted: eff after exp, both inside the term, must not pass silently.
  const vInv = verifyEditedSheet({
    account: e1.account,
    packet: run.packet,
    sheet: run.sheet,
    overrides: { "gl.eff": "06/01/2027", "gl.exp": "01/01/2027" },
  });
  probe(
    "E1",
    vInv.rejects.length > 0,
    "inverted term (eff 06/01/2027 > exp 01/01/2027) rejects",
    vInv.rejects.map((r) => r.finding.id).join(", ") || "NO REJECT — INVERTED TERM PRINTS",
  );

  // Issuance through the one door with a policy-grade source.
  const db = ledgerDb();
  const out = performCertIssuance(issuance(db, { ...e1, formSets: e1Sets }));
  probe(
    "E1",
    out.issued,
    "clean sheet issues through performCertIssuance",
    out.issued ? out.cert.id : out.attempt.blockedCheckIds.join(","),
  );

  // P-rail-door: the reviewer MANUALLY checks Addl Insd against this policy's
  // identity-less AI endorsement. The one door blocks the claim
  // (endorsement-backing-verified demands form + edition) — the review rail
  // must reject the same claim, never read all-green over a shut door.
  const vManualAi = verifyEditedSheet({
    account: e1.account,
    packet: run.packet,
    sheet: run.sheet,
    overrides: { "gl.addl": true },
  });
  const outManualAi = performCertIssuance(
    issuance(db, {
      ...e1,
      formSets: e1Sets,
      artifact: { kind: "sheet", formKey: "acord25", placements: {}, overrides: { "gl.addl": true } },
    }),
  );
  probe(
    "E1",
    !outManualAi.issued &&
      outManualAi.attempt.blockedCheckIds.includes("endorsement-backing-verified"),
    "manually claimed identity-less AI blocks at the door",
    outManualAi.issued ? "ISSUED ANYWAY" : outManualAi.attempt.blockedCheckIds.join(","),
  );
  probe(
    "E1",
    vManualAi.rejects.some((r) => r.finding.id === "flag-additionalInsured"),
    "the review rail rejects the same claim (no all-green rail over a blocked door)",
    vManualAi.rejects.map((r) => r.finding.id).join(", ") || "RAIL ALL-GREEN OVER A BLOCKED DOOR",
  );
}

/* ————————————————————————— E2 real ISC, SiriusPoint ————————————————————————— */

section("E2 acct-real-925420 — Real ISC + SiriusPoint Writer");
{
  const account = liveAccount("acct-real-925420");
  const policies = livePolicies("acct-real-925420");
  const formSets = Object.fromEntries(policies.map((p) => [p.id, resolveFormSet(p)]));
  const run = runPipeline({ account, policies, formSets });
  sweepJunk("E2", run);
  probe(
    "E2",
    run.verdict.rejects.length === 0,
    "untouched sheet verifies clean",
    run.verdict.rejects.map((r) => r.finding.id).join(", ") || "0 rejects",
  );
  const ins = run.packet.insurers[0];
  probe(
    "E2",
    ins.issuingCompany != null && /siriuspoint/i.test(ins.issuingCompany),
    "INSURER A prints the SiriusPoint writer",
    `${ins.issuingCompany} / ${ins.naic}`,
  );
  // The dec schedules SP CMR 00 00 "Claims-Made and Reported Limitation" —
  // the GL type cell must check CLAIMS-MADE, not OCCUR (checking OCCUR on
  // claims-made paper overstates the coverage).
  const gl = run.sheet.sections.find((s) => s.def.key === "gl")!;
  probe(
    "E2",
    gl.checks.claimsMade === true && gl.checks.occur === false,
    "scheduled claims-made endorsement flips the GL checkboxes",
    `claimsMade=${gl.checks.claimsMade} occur=${gl.checks.occur}`,
  );
  const db = ledgerDb();
  const out = performCertIssuance(issuance(db, { account, policies, formSets }));
  probe("E2", out.issued, "issues through the one door", out.issued ? "issued" : out.attempt.blockedCheckIds.join(","));
}

/* ————————————————— E3 real ISC, no schedule, missing address ————————————————— */

section("E3 acct-real-916015 — Schedule-less Paper, Missing Street Address");
{
  const account = liveAccount("acct-real-916015");
  const policies = livePolicies("acct-real-916015");
  const formSets = Object.fromEntries(policies.map((p) => [p.id, resolveFormSet(p)]));
  const run = runPipeline({ account, policies, formSets });
  sweepJunk("E3", run);
  const gl = run.sheet.sections.find((s) => s.def.key === "gl")!;
  probe(
    "E3",
    gl.feeder != null && Object.values(gl.limits).every((v) => v == null),
    "unscheduled GL: identity fills, every limit box prints an honest blank",
    JSON.stringify(gl.limits),
  );
  probe(
    "E3",
    !run.suggestions.some((s) => s.id === "insured.addr1"),
    "no address suggestion invented for a street-less account record",
    run.suggestions.find((s) => s.id === "insured.addr1")?.display,
  );
  // Typing a limit into an unscheduled section must reject (nothing backs it).
  const v = verifyEditedSheet({
    account,
    packet: run.packet,
    sheet: run.sheet,
    overrides: { "gl.limit.eachOccurrence": "1,000,000" },
  });
  probe(
    "E3",
    v.rejects.length > 0,
    "typing a dollar into an unscheduled section rejects",
    v.rejects.map((r) => r.finding.id).join(", ") || "NO REJECT",
  );
  const db = ledgerDb();
  const out = performCertIssuance(
    issuance(db, { account, policies, formSets, scheduleSources: [] }),
  );
  probe(
    "E3",
    out.issued,
    "honest-blank sheet still issues (blank beats wrong, not blank beats issue)",
    out.issued ? "issued" : out.attempt.blockedCheckIds.join(","),
  );
}

/* ————————————————— E4 multi-policy multi-carrier + overflow ————————————————— */

section("E4 acct-meridian — 6 Policies, 4 Carriers, Description Overflow");
{
  const account = seedAccount("acct-meridian");
  const policies = seedPolicies("acct-meridian");
  const formSets = Object.fromEntries(
    policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
  );
  const run = runPipeline({ account, policies, formSets });
  sweepJunk("E4", run);
  probe("E4", run.sheet.overflow.length > 0, "overflow lines print in the description", `${run.sheet.overflow.length} lines`);
  probe(
    "E4",
    run.verdict.rejects.length === 0,
    "untouched sheet verifies clean",
    run.verdict.rejects.map((r) => r.finding.id).join(", ") || "0 rejects",
  );
  // The events policy (eff 09/10) is not in force at NOW — the door must block.
  const db = ledgerDb();
  const out = performCertIssuance(issuance(db, { account, policies, formSets }));
  probe(
    "E4",
    !out.issued && out.attempt.blockedCheckIds.includes("policy-in-force"),
    "not-yet-effective events policy blocks at Policy In Force",
    out.issued ? "ISSUED ANYWAY" : out.attempt.blockedCheckIds.join(","),
  );
  // In-force subset: the GL AI is a SCHEDULED CG 20 26 — with the holder not
  // bound on the AI registry the claim must block; bound, the sheet issues.
  const inForce = policies.filter(
    (p) => p.effectiveDate <= NOW.slice(0, 10) && p.expirationDate >= NOW.slice(0, 10),
  );
  const unbound = performCertIssuance(issuance(db, { account, policies: inForce, formSets }));
  probe(
    "E4",
    !unbound.issued && unbound.attempt.blockedCheckIds.includes("endorsement-backing-verified"),
    "scheduled AI with the holder unbound blocks at Endorsement Backing Verified",
    unbound.issued ? "ISSUED ANYWAY" : unbound.attempt.blockedCheckIds.join(","),
  );
  const out2 = performCertIssuance(
    issuance(db, {
      account,
      policies: inForce,
      formSets,
      holderAiRecords: [{ status: "bound", formUsed: "CG 20 26 04 13" }],
    }),
  );
  probe(
    "E4",
    out2.issued,
    "same sheet issues once the holder's AI request is bound",
    out2.issued ? "issued" : out2.attempt.blockedCheckIds.join(","),
  );
}

/* ————————————————— E5 garage account — ACORD 30 and ACORD 25 ————————————————— */

section("E5 acct-northstar — Garage Paper On ACORD 30 And ACORD 25");
{
  const account = seedAccount("acct-northstar");
  const policies = seedPolicies("acct-northstar");
  const formSets = Object.fromEntries(
    policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
  );
  const run30 = runPipeline({ account, policies, formSets, formKey: "acord30" });
  sweepJunk("E5", run30);
  const garage = run30.sheet.sections.find((s) => s.def.key === "garageLiability")!;
  probe(
    "E5",
    garage.feeder != null && garage.limits.autoOnlyEaAccident?.kind === "amount",
    "ACORD 30 garage liability fills off the schedule",
    JSON.stringify(garage.limits.autoOnlyEaAccident),
  );
  const gk = run30.sheet.sections.find((s) => s.def.key === "garageKeepers")!;
  probe(
    "E5",
    gk.locs.compOtc === "LOC 1" && gk.locs.collision === "LOC 1",
    "garagekeepers LOC write-ins print off the schedule",
    JSON.stringify(gk.locs),
  );
  // The garage policy's quote insured ("North Star Freight LLC") disagrees
  // with the account — one INSURED box cannot match both papers. The seeded
  // upload-error story must reject the mixed sheet, fail closed.
  probe(
    "E5",
    run30.verdict.rejects.some((r) => r.finding.id === "insured-mismatch"),
    "mixed-insured sheet rejects (seeded quote-insured discrepancy, fail closed)",
    run30.verdict.rejects.map((r) => `${r.finding.id}`).join(", ") || "NO REJECT — MIXED INSURED PRINTS",
  );
  // Same account on ACORD 25 — the garage paper lands in the auto section.
  const run25 = runPipeline({ account, policies, formSets, formKey: "acord25" });
  const auto = run25.sheet.sections.find((s) => s.def.key === "auto")!;
  console.log(
    `  # ACORD 25 auto section for garage paper: feeder=${auto.feeder?.policy.policyNumber}, CSL=${JSON.stringify(auto.limits.combinedSingle)}`,
  );
  // Garage-only certificate: the sheet carries the policy's own named
  // insured, verifies clean, and issues on ACORD 30.
  const garOnly = policies.filter((p) => p.id === "pol-northstar-gar");
  const runGar = runPipeline({ account, policies: garOnly, formSets, formKey: "acord30" });
  probe(
    "E5",
    runGar.verdict.rejects.length === 0,
    "garage-only ACORD 30 verifies clean",
    runGar.verdict.rejects.map((r) => r.finding.id).join(", ") || "0 rejects",
  );
  const db = ledgerDb();
  const out = performCertIssuance(
    issuance(db, {
      account,
      policies: garOnly,
      formSets,
      artifact: { kind: "sheet", formKey: "acord30", placements: {}, overrides: {} },
      // CA 20 48 is a scheduled AI — issuance needs the holder bound.
      holderAiRecords: [{ status: "bound", formUsed: "CA 20 48 10 13" }],
    }),
  );
  probe("E5", out.issued, "garage-only ACORD 30 issues through the one door", out.issued ? "issued" : out.attempt.blockedCheckIds.join(","));
}

/* ————————————————— E6 pre-bind account with zero policies ————————————————— */

section("E6 acct-real-925505 — Pre-Bind, Zero Policies On File");
{
  const account = liveAccount("acct-real-925505");
  const policies = livePolicies("acct-real-925505");
  probe("E6", policies.length === 0, "control: the account truly has zero policies", `${policies.length}`);
  const run = runPipeline({ account, policies, formSets: {} });
  sweepJunk("E6", run);
  const db = ledgerDb();
  const out = performCertIssuance(issuance(db, { account, policies, formSets: {} }));
  probe(
    "E6",
    !out.issued,
    "pre-bind zero-policy account cannot issue",
    out.issued ? "ISSUED AN EMPTY CERT" : out.attempt.blockedCheckIds.join(","),
  );
}

/* ————————— E7 zero policies on an ACTIVE account — the empty-cert door ————————— */

section("E7 Synthetic — Zero Policies On An Active Account");
{
  const account = seedAccount("acct-meridian"); // active, no red alert
  const run = runPipeline({ account, policies: [], formSets: {} });
  probe(
    "E7",
    run.verdict.rejects.length > 0,
    "verifier rejects a sheet with no policies on it",
    run.verdict.rejects.map((r) => r.finding.id).join(", ") || "VERIFIER SILENT ON AN EMPTY SHEET",
  );
  const db = ledgerDb();
  const out = performCertIssuance(issuance(db, { account, policies: [], formSets: {} }));
  probe(
    "E7",
    !out.issued,
    "CARDINAL: an empty certificate (zero policies) must not issue",
    out.issued ? "ISSUED AN EMPTY CERT" : `blocked: ${out.attempt.blockedCheckIds.join(",")}`,
  );
}

/* ————————————————— E8 blank policy number ————————————————— */

section("E8 Synthetic — Blank Policy Number On The Schedule Of Record");
{
  const account = seedAccount("acct-meridian");
  const base = seedPolicies("acct-meridian").find((p) => p.id === "pol-meridian-gl")!;
  const policy: Policy = { ...base, id: "pol-blank-num", policyNumber: "  " };
  const formSets = { [policy.id]: FORM_SETS[base.id] };
  const run = runPipeline({ account, policies: [policy], formSets });
  sweepJunk("E8", run);
  const warn = run.verdict.warns.find((w) => w.finding.id.startsWith("policy-number-missing"));
  probe(
    "E8",
    warn != null && run.verdict.rejects.length === 0,
    "blank policy number warns (issue knowingly blank) without a phantom reject",
    [...run.verdict.rejects, ...run.verdict.warns].map((f) => f.finding.id).join(", "),
  );
  const gl = run.sheet.sections.find((s) => s.def.key === "gl")!;
  probe("E8", gl.ref?.policyNumber.trim() === "", "the policy-number cell prints blank, never invented", JSON.stringify(gl.ref?.policyNumber));
}

/* ————————————————— E9 Included / Excluded mix + snapshot fidelity ————————————————— */

section("E9 acct-greenleaf — Included/Excluded Mix, Snapshot Fidelity");
{
  const account = liveAccount("acct-greenleaf");
  const policies = livePolicies("acct-greenleaf");
  const formSets = Object.fromEntries(policies.map((p) => [p.id, resolveFormSet(p)]));
  const run = runPipeline({ account, policies, formSets });
  sweepJunk("E9", run);
  const gl = run.sheet.sections.find((s) => s.def.key === "gl")!;
  probe(
    "E9",
    gl.limits.medExp?.kind === "excluded" &&
      gl.limits.personalAdv?.kind === "included" &&
      gl.limits.productsCompOp?.kind === "included",
    "dec-stated Included / Excluded lines resolve as stated",
    JSON.stringify({ medExp: gl.limits.medExp, personalAdv: gl.limits.personalAdv }),
  );
  probe(
    "E9",
    run.verdict.rejects.length === 0,
    "untouched sheet verifies clean",
    run.verdict.rejects.map((r) => r.finding.id).join(", ") || "0 rejects",
  );

  // P-snapshot: unchecking Subr Wvd and clearing a limit box are reviewer
  // facts — the frozen snapshot must reflect the sheet as issued, and the
  // digest must move (staleness clock).
  const snapInput = {
    account,
    policies,
    formSets,
    formKey: "acord25" as CertFormKey,
    placements: {},
    holderName: HOLDER,
    holderAddress: HOLDER_ADDR,
    takenAt: NOW,
  };
  const base = buildFactSnapshot({ ...snapInput, overrides: {} });
  const edited = buildFactSnapshot({
    ...snapInput,
    overrides: { "gl.subr": false, "gl.limit.damagePremises": "" },
  });
  const subrField = edited.snapshot.fields.find((f) => f.id === "gl.subr");
  probe(
    "E9",
    subrField == null || subrField.value !== "Y",
    "snapshot drops the Subr Wvd claim after the reviewer unchecks it",
    subrField ? `snapshot still says gl.subr="${subrField.value}"` : "dropped",
  );
  const dmgField = edited.snapshot.fields.find((f) => f.id === "gl.limit.damagePremises");
  probe(
    "E9",
    dmgField == null,
    "snapshot drops a limit the reviewer cleared to blank",
    dmgField ? `snapshot still says "${dmgField.value}"` : "dropped",
  );
  probe(
    "E9",
    base.snapshot.digest !== edited.snapshot.digest,
    "digest moves when the reviewer unchecks / clears (staleness clock sees it)",
    base.snapshot.digest === edited.snapshot.digest ? "DIGEST BLIND TO THE EDIT" : "digests differ",
  );

  // The unchecked sheet still verifies (underreporting allowed) and issues.
  const v = verifyEditedSheet({
    account,
    packet: run.packet,
    sheet: run.sheet,
    overrides: { "gl.subr": false, "gl.limit.damagePremises": "" },
  });
  probe(
    "E9",
    v.rejects.length === 0,
    "underreporting (uncheck + cleared box) never rejects",
    v.rejects.map((r) => r.finding.id).join(", ") || "0 rejects",
  );
  const db = ledgerDb();
  const out = performCertIssuance(
    issuance(db, {
      account,
      policies,
      formSets,
      artifact: {
        kind: "sheet",
        formKey: "acord25",
        placements: {},
        overrides: { "gl.subr": false, "gl.limit.damagePremises": "" },
      },
    }),
  );
  probe("E9", out.issued, "the underreported sheet issues", out.issued ? "issued" : out.attempt.blockedCheckIds.join(","));
}

/* ————————————————— E10 ISC garage, unscheduled, Third Coast ————————————————— */

section("E10 acct-metro — ISC Garage Paper, Unscheduled, Third Coast Writer");
{
  const account = liveAccount("acct-metro");
  const policies = livePolicies("acct-metro");
  const formSets = Object.fromEntries(policies.map((p) => [p.id, resolveFormSet(p)]));
  const run30 = runPipeline({ account, policies, formSets, formKey: "acord30" });
  sweepJunk("E10", run30);
  const ins = run30.packet.insurers[0];
  probe(
    "E10",
    ins.issuingCompany != null && /third coast/i.test(ins.issuingCompany),
    "INSURER A prints the recorded Third Coast writer",
    `${ins.issuingCompany} / ${ins.naic}`,
  );
  const garage = run30.sheet.sections.find((s) => s.def.key === "garageLiability")!;
  probe(
    "E10",
    garage.feeder != null && Object.values(garage.limits).every((v) => v == null),
    "unscheduled garage paper: identity fills, limits stay blank on ACORD 30",
    JSON.stringify(garage.limits),
  );
  probe(
    "E10",
    run30.verdict.rejects.length === 0,
    "untouched ACORD 30 verifies clean",
    run30.verdict.rejects.map((r) => r.finding.id).join(", ") || "0 rejects",
  );
}

/* ————— Scoreboard ————— */

console.log(`\n━━━ RESULT ━━━`);
if (found.length) {
  console.log(`${found.length} FAILURE(S):`);
  for (const f of found) console.log(`  • ${f}`);
} else {
  console.log("No failures — every probe passed.");
}
process.exit(failures);
