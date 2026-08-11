/**
 * Self-check: certificate issuance invariants (the consolidation).
 *
 * Drives the SAME issuance core production uses (performCertIssuance) against
 * an in-memory SQLite database and proves:
 *   1. Canonical registry blocks are persisted per attempt (which check,
 *      when, on whose action) — and non-overridable checks fail closed even
 *      with an override request.
 *   2. Overridable checks clear only with an attributed, logged override
 *      record (operator + reason + timestamp + check id).
 *   3. Endorsement gates: form identity includes the edition date, and a
 *      scheduled Additional Insured claim with "requested" status blocks —
 *      Bind Requested is not bound.
 *   4. Source trust: a prior certificate as a schedule source blocks with no
 *      override; quote-grade sourcing needs an attributed override.
 *   5. Frozen fact snapshot: prepared artifacts invalidate on upstream fact
 *      change (digest mismatch) and on TTL expiry, with forced regeneration
 *      at send; unchanged facts consume the prepared artifact.
 *   6. Supersede/revoke chain: one active cert per (holder, requirement),
 *      revocation notices, corrected-certificate linkage both directions.
 *   7. Single send path + specimen watermark + learning fence (structural
 *      assertions over the source, since the UI layer imports server-only
 *      modules that cannot load under tsx).
 *
 * Run: npx tsx scripts/cert-invariants-check.ts
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { performCertIssuance, type IssuanceInput } from "../src/lib/cert-issuance-core";
import {
  getLivePrepared,
  invalidatePreparedForAccount,
  listCheckOverrides,
  listHolderNotices,
  listIssueAttempts,
  listIssuedCerts,
  markCertErroneous,
  migrateCertLedger,
  requirementKeyFor,
  upsertPrepared,
} from "../src/lib/cert-ledger";
import { runCertChecks } from "../src/lib/cert-checks";
import { buildFactSnapshot } from "../src/lib/cert-snapshot";
import { buildDraftFromPolicy } from "../src/lib/coi";
import { bareFormSet, FORM_SETS, type PolicyFormSet } from "../src/lib/forms";
import { SEED_ACCOUNTS, SEED_POLICIES } from "../src/lib/seed";
import type { Account } from "../src/lib/types";

let failed = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

/* ————— Fixtures: acct-summit, same as cert-run-check ————— */

const seedAccount = SEED_ACCOUNTS.find((a) => a.id === "acct-summit")!;
const account: Account = {
  ...seedAccount,
  status: "active",
  paymentReceivedAt: "2026-01-15T00:00:00.000Z",
} as Account;
const policies = SEED_POLICIES.filter((p) => p.accountId === "acct-summit");
const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
  policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
);

const db = new Database(":memory:");
migrateCertLedger(db);

const HOLDER = "Mesa Verde Builders Inc.";
const HOLDER_ADDR = "400 Contractor Way, Phoenix, AZ 85004";

function baseInput(over: Partial<IssuanceInput> = {}): IssuanceInput {
  return {
    db,
    operator: "Harness Operator",
    path: "studio",
    account,
    policies,
    formSets,
    holderName: HOLDER,
    holderAddress: HOLDER_ADDR,
    artifact: { kind: "sheet", formKey: "acord25", placements: {}, overrides: {} },
    redAlertActive: false,
    holderAiRecords: [],
    scheduleSources: [],
    ...over,
  };
}

/* ————— 1. Registry blocks persist; non-overridable fails closed ————— */

console.log("━━━ 1. Canonical registry — blocks persisted, non-overridable fails closed ━━━");
{
  const out = performCertIssuance(
    baseInput({
      redAlertActive: true,
      // An override request on a non-overridable check must change nothing.
      checkOverrides: [{ checkId: "red-alert-stand-down", reason: "deadline pressure" }],
    }),
  );
  check(!out.issued, "Active red alert blocks issuance");
  check(
    out.attempt.blockedCheckIds.includes("red-alert-stand-down"),
    "Attempt row names the blocking check (red-alert-stand-down)",
    out.attempt.blockedCheckIds.join(","),
  );
  const persisted = listIssueAttempts(db, account.id);
  check(
    persisted.length === 1 &&
      persisted[0].outcome === "blocked" &&
      persisted[0].attemptedBy === "Harness Operator",
    "Blocked attempt persisted with operator attribution",
  );
  const rr = out.results.find((r) => r.id === "red-alert-stand-down");
  check(
    rr?.status === "fail" && rr.overridable === false,
    "Red alert check is fail (not overridden) despite the override request",
  );
}

/* ————— 2. Clean issuance: snapshot with provenance, notice, ledger row ————— */

console.log("━━━ 2. Clean issuance — frozen snapshot with per-field provenance ━━━");
let firstCertId = "";
{
  const out = performCertIssuance(baseInput());
  check(out.issued, "Clean sheet issues", JSON.stringify(out.results.filter((r) => r.status === "fail").map((r) => r.id)));
  if (out.issued) {
    firstCertId = out.cert.id;
    const snap = out.cert.snapshot;
    check(snap.digest.length === 64, "Snapshot carries a SHA-256 digest");
    check(snap.fields.length >= 8, `Snapshot records ${snap.fields.length} fields`);
    check(
      snap.fields.every((f) => f.source.trim().length > 0),
      "Every snapshot field carries provenance",
    );
    check(Boolean(snap.takenAt), "Snapshot carries its timestamp");
    const notices = listHolderNotices(db, account.id);
    check(
      notices.length === 1 && notices[0].kind === "issued",
      "Issued holder notice generated",
    );
  }
}

/* ————— 3. Holder constraint + supersede on re-issue ————— */

console.log("━━━ 3. One active cert per (holder, requirement) — supersede on re-issue ━━━");
let secondCertId = "";
{
  const out = performCertIssuance(baseInput());
  check(out.issued, "Second issuance for the same holder issues");
  if (out.issued) {
    secondCertId = out.cert.id;
    const certs = listIssuedCerts(db, account.id);
    const active = certs.filter(
      (c) => c.status === "active" && c.requirementKey === requirementKeyFor({ holderName: HOLDER }),
    );
    check(active.length === 1, "Exactly one active cert for the requirement");
    const prior = certs.find((c) => c.id === firstCertId)!;
    check(prior.status === "superseded", "Prior cert marked superseded");
    check(prior.supersededBy === secondCertId, "Prior links forward to its replacement");
    check(out.cert.supersedes === firstCertId, "New cert links back to the paper it replaces");
  }
}

/* ————— 4. Revoke + corrected chain ————— */

console.log("━━━ 4. Erroneous cert — revoke, holder re-notification, corrected chain ━━━");
{
  markCertErroneous(db, {
    certId: secondCertId,
    revokedBy: "Desk Manager",
    reason: "Wrong holder address block.",
  });
  const revoked = listIssuedCerts(db, account.id).find((c) => c.id === secondCertId)!;
  check(revoked.status === "revoked" && revoked.revokedBy === "Desk Manager", "Cert revoked on record with attribution");
  const revNotice = listHolderNotices(db, account.id).find((n) => n.kind === "revoked");
  check(Boolean(revNotice), "Revocation notice generated for the holder");

  const out = performCertIssuance(baseInput());
  check(out.issued, "Corrected certificate issues");
  if (out.issued) {
    check(out.cert.supersedes === secondCertId, "Corrected cert links to the revoked paper");
    const revokedAfter = listIssuedCerts(db, account.id).find((c) => c.id === secondCertId)!;
    check(revokedAfter.supersededBy === out.cert.id, "Revoked paper links forward to the correction");
    const corrNotice = listHolderNotices(db, account.id).find((n) => n.kind === "corrected");
    check(Boolean(corrNotice), "Corrected-certificate holder notice generated");
  }
}

/* ————— 5. Overridable check: logged, attributed override ————— */

console.log("━━━ 5. Override policy — attributed record, never a second path ━━━");
{
  const mismatch = baseInput({
    ticketId: "tkt-harness",
    requirementHolderName: "Someone Else Entirely LLC",
  });
  const blocked = performCertIssuance(mismatch);
  check(
    !blocked.issued && blocked.attempt.blockedCheckIds.includes("holder-matches-requirement"),
    "Holder/requirement mismatch blocks",
  );
  const overridden = performCertIssuance({
    ...mismatch,
    checkOverrides: [
      { checkId: "holder-matches-requirement", reason: "Holder renamed mid-contract; producer confirmed in writing." },
    ],
  });
  check(overridden.issued, "Attributed override clears the overridable check");
  if (overridden.issued) {
    const rows = listCheckOverrides(db, overridden.attempt.id);
    check(
      rows.length === 1 &&
        rows[0].checkId === "holder-matches-requirement" &&
        rows[0].operator === "Harness Operator" &&
        rows[0].reason.includes("producer confirmed"),
      "Override persisted with operator + reason + check id",
    );
    const rr = overridden.results.find((r) => r.id === "holder-matches-requirement");
    check(rr?.status === "overridden" && rr.overriddenBy === "Harness Operator", "Result records who overrode");
  }
}

/* ————— 6. Endorsement gates: edition identity + Bind Requested ————— */

console.log("━━━ 6. Endorsement gates — edition date is identity; Bind Requested is not bound ━━━");
{
  const policy = policies[0];
  const editionless: PolicyFormSet = {
    ...formSets[policy.id],
    endorsements: [
      { form: "CG 20 10", edition: "", title: "Additional Insured — Owners", kind: "ai", scope: "blanket" },
    ],
  };
  const draft = buildDraftFromPolicy({
    account,
    policy,
    holderName: HOLDER,
    holderAddress: HOLDER_ADDR,
    set: editionless,
  });
  // The auto-fill no longer claims an endorsement without full form
  // identity (underreporting beats overstating) — assert that, then make
  // the claim explicitly to prove the door still blocks it.
  check(
    !draft.flags.additionalInsured,
    "Auto-fill does not claim an AI form that lacks its edition date",
    JSON.stringify(draft.flags),
  );
  draft.flags.additionalInsured = true;
  const out = performCertIssuance(
    baseInput({
      path: "ticket",
      policies: [policy],
      formSets: { [policy.id]: editionless },
      artifact: { kind: "draft", draft },
    }),
  );
  check(
    !out.issued && out.attempt.blockedCheckIds.includes("endorsement-backing-verified"),
    "AI claim backed by a form without an edition date blocks",
    out.attempt.blockedCheckIds.join(","),
  );

  const scheduled: PolicyFormSet = {
    ...formSets[policy.id],
    endorsements: [
      { form: "CG 20 10", edition: "04 13", title: "Additional Insured — Scheduled", kind: "ai", scope: "scheduled" },
    ],
  };
  const schedDraft = buildDraftFromPolicy({
    account,
    policy,
    holderName: HOLDER,
    holderAddress: HOLDER_ADDR,
    set: scheduled,
  });
  const requested = performCertIssuance(
    baseInput({
      path: "ticket",
      policies: [policy],
      formSets: { [policy.id]: scheduled },
      artifact: { kind: "draft", draft: schedDraft },
      holderAiRecords: [{ status: "requested", formUsed: "CG 20 10 04 13" }],
    }),
  );
  check(
    !requested.issued && requested.attempt.blockedCheckIds.includes("endorsement-backing-verified"),
    "Scheduled AI with Bind Requested blocks — Bind Requested is not bound",
  );
  const bound = performCertIssuance(
    baseInput({
      path: "ticket",
      policies: [policy],
      formSets: { [policy.id]: scheduled },
      artifact: { kind: "draft", draft: schedDraft },
      holderAiRecords: [{ status: "bound", formUsed: "CG 20 10 04 13" }],
    }),
  );
  check(bound.issued, "Same claim with bound status issues", JSON.stringify(bound.results.filter((r) => r.status === "fail").map((r) => r.id)));
}

/* ————— 7. Source trust order ————— */

console.log("━━━ 7. Source trust — prior cert never a source; quote needs an override ━━━");
{
  const fromCert = performCertIssuance(
    baseInput({
      scheduleSources: [{ kind: "coi", createdAt: new Date().toISOString() }],
      checkOverrides: [{ checkId: "source-document-trust", reason: "trust me" }],
    }),
  );
  check(
    !fromCert.issued && fromCert.attempt.blockedCheckIds.includes("source-document-trust"),
    "Prior-certificate sourcing blocks with no override",
  );
  const quoteOnly = baseInput({
    scheduleSources: [{ kind: "quote", createdAt: new Date().toISOString() }],
  });
  const blocked = performCertIssuance(quoteOnly);
  check(
    !blocked.issued && blocked.attempt.blockedCheckIds.includes("source-document-rank"),
    "Quote-grade sourcing blocks without an override",
  );
  const cleared = performCertIssuance({
    ...quoteOnly,
    checkOverrides: [
      { checkId: "source-document-rank", reason: "Policy paper requested from carrier; quote verified against the binder terms." },
    ],
  });
  check(cleared.issued, "Quote-grade sourcing issues with an attributed override");
}

/* ————— 8. Snapshot staleness: digest invalidation, TTL, consumption ————— */

console.log("━━━ 8. Frozen snapshot — staleness invalidation and forced regeneration ━━━");
{
  const prepHolder = "Canyon Gate Properties LLC";
  const reqKey = requirementKeyFor({ holderName: prepHolder });
  const { snapshot } = buildFactSnapshot({
    account,
    policies,
    formSets,
    formKey: "acord25",
    placements: {},
    holderName: prepHolder,
    holderAddress: "88 Landlord Plaza, Tempe, AZ 85281",
    overrides: {},
  });
  upsertPrepared(db, {
    accountId: account.id,
    requirementKey: reqKey,
    holderName: prepHolder,
    snapshot,
    preparedBy: "Harness Operator",
  });
  check(getLivePrepared(db, account.id, reqKey) != null, "Prepared artifact stored live");

  // Upstream fact change: the GL each-occurrence limit moves on the schedule.
  const mutated: Record<string, PolicyFormSet> = JSON.parse(JSON.stringify(formSets));
  const anyLimit = Object.values(mutated).flatMap((s) => s.limits)[0];
  if (anyLimit?.amountCents != null) anyLimit.amountCents += 100_000_00;
  const stale = performCertIssuance(
    baseInput({
      formSets: mutated,
      holderName: prepHolder,
      holderAddress: "88 Landlord Plaza, Tempe, AZ 85281",
    }),
  );
  check(
    !stale.issued && stale.attempt.blockedCheckIds.includes("snapshot-current"),
    "Digest mismatch blocks the send and forces regeneration",
  );
  const deadRow = db
    .prepare(`SELECT invalidated_reason FROM cert_prepared WHERE account_id = ? AND requirement_key = ?`)
    .get(account.id, reqKey) as { invalidated_reason: string | null };
  check(
    deadRow.invalidated_reason === "Upstream Facts Changed Since Preparation",
    "Stale prepared artifact invalidated on the spot with the reason recorded",
    String(deadRow.invalidated_reason),
  );
  const retry = performCertIssuance(
    baseInput({
      formSets: mutated,
      holderName: prepHolder,
      holderAddress: "88 Landlord Plaza, Tempe, AZ 85281",
    }),
  );
  check(retry.issued, "Retry regenerates from current facts and issues");
  if (retry.issued) {
    check(retry.cert.snapshotDigest !== snapshot.digest, "Issued digest differs from the stale preparation");
  }

  // TTL expiry blocks the same way.
  const ttlHolder = "First Lien Capital";
  const ttlKey = requirementKeyFor({ holderName: ttlHolder });
  const ttlSnap = buildFactSnapshot({
    account,
    policies,
    formSets,
    formKey: "acord25",
    placements: {},
    holderName: ttlHolder,
    holderAddress: "1 Lender Sq, Scottsdale, AZ 85251",
    overrides: {},
  }).snapshot;
  upsertPrepared(db, {
    accountId: account.id,
    requirementKey: ttlKey,
    holderName: ttlHolder,
    snapshot: ttlSnap,
    preparedBy: "Harness Operator",
    preparedAt: new Date(Date.now() - 100 * 3_600_000).toISOString(),
  });
  const expired = performCertIssuance(
    baseInput({
      holderName: ttlHolder,
      holderAddress: "1 Lender Sq, Scottsdale, AZ 85251",
    }),
  );
  check(
    !expired.issued && expired.attempt.blockedCheckIds.includes("snapshot-current"),
    "TTL-expired prepared artifact blocks the send",
  );

  // Unchanged facts: the prepared artifact is consumed by the issuance.
  const liveHolder = "Juniper Yards LLC";
  const liveKey = requirementKeyFor({ holderName: liveHolder });
  const liveSnap = buildFactSnapshot({
    account,
    policies,
    formSets,
    formKey: "acord25",
    placements: {},
    holderName: liveHolder,
    holderAddress: "12 Juniper Way, Mesa, AZ 85201",
    overrides: {},
  }).snapshot;
  upsertPrepared(db, {
    accountId: account.id,
    requirementKey: liveKey,
    holderName: liveHolder,
    snapshot: liveSnap,
    preparedBy: "Harness Operator",
  });
  const consumed = performCertIssuance(
    baseInput({
      holderName: liveHolder,
      holderAddress: "12 Juniper Way, Mesa, AZ 85201",
      now: liveSnap.takenAt,
    }),
  );
  check(consumed.issued, "Prepared artifact with matching digest issues");
  const consumedRow = db
    .prepare(`SELECT consumed_by_cert_id FROM cert_prepared WHERE account_id = ? AND requirement_key = ?`)
    .get(account.id, liveKey) as { consumed_by_cert_id: string | null };
  check(Boolean(consumedRow.consumed_by_cert_id), "Prepared artifact consumed by the issued cert");

  // The upstream-change hook kills everything pending on the account.
  upsertPrepared(db, {
    accountId: account.id,
    requirementKey: requirementKeyFor({ holderName: "Hook Test Holder" }),
    holderName: "Hook Test Holder",
    snapshot: liveSnap,
    preparedBy: "Harness Operator",
  });
  const killed = invalidatePreparedForAccount(db, account.id, "Red Alert Raised");
  check(killed >= 1, "Upstream-change hook invalidates pending prepared artifacts");
}

/* ————— 9. Structural: single send path, watermark, learning fence ————— */

console.log("━━━ 9. Structural — single send path, specimen watermark, learning fence ━━━");
{
  const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const src = {
    studio: read("src/components/CertificateStudio.tsx"),
    verifier: read("src/components/CoiVerifier.tsx"),
    core: read("src/lib/cert-issuance-core.ts"),
    ledger: read("src/lib/cert-ledger.ts"),
    css: read("src/app/globals.css"),
    corrections: read("src/lib/cert-corrections.ts"),
    studioActions: read("src/lib/cert-studio-actions.ts"),
  };

  // Single send path: only the ledger writes cert_issued, only the core
  // calls issueCert, and both UI routes call the issuance actions.
  const libDir = path.join(__dirname, "..", "src");
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(p);
    }
  })(libDir);
  const insertsCertIssued = files.filter((f) =>
    /INSERT INTO cert_issued/.test(fs.readFileSync(f, "utf8")),
  );
  check(
    insertsCertIssued.length === 1 && insertsCertIssued[0].endsWith("cert-ledger.ts"),
    "cert_issued rows are written by cert-ledger.ts alone",
    insertsCertIssued.join(","),
  );
  const callsIssueCert = files.filter((f) => {
    const text = fs.readFileSync(f, "utf8");
    return /\bissueCert\(/.test(text) && !f.endsWith("cert-ledger.ts");
  });
  check(
    callsIssueCert.length === 1 && callsIssueCert[0].endsWith("cert-issuance-core.ts"),
    "issueCert is called only from the issuance core",
    callsIssueCert.join(","),
  );
  check(
    src.studio.includes("issueCertificateAction") &&
      src.verifier.includes("issueTicketCertificateAction"),
    "Studio and ticket verifier both route through the issuance actions",
  );
  check(
    /appendChecks\?\:/.test(src.core) && !/skipChecks|omitChecks/.test(src.core),
    "Path-specific logic can only append checks — no skip parameter exists",
  );

  // Specimen watermark: gated on the issued-inputs match, present in the
  // sheet markup, forced on in print media.
  check(
    src.studio.includes('data-render-mode={specimen ? "specimen" : "issued"}') &&
      src.studio.includes("Specimen — Not Issued") &&
      src.studio.includes('className="cert-watermark"'),
    "Sheet renders the Specimen — Not Issued watermark on every non-issued render",
  );
  check(
    src.studio.includes("issued != null && issued.key === inputsKey"),
    "Clean render exists only while the on-screen inputs match the issued artifact",
  );
  const printBlock = src.css.slice(src.css.indexOf("Specimen watermark"));
  check(
    src.css.includes(".cert-watermark") &&
      /@media print\s*\{[\s\S]*?\.cert-watermark\s*\{[\s\S]*?display:\s*flex\s*!important/.test(
        printBlock,
      ),
    "Watermark styles exist and are forced on in print media",
  );

  // Learning fence: the gate exists, both learned kinds pass through it,
  // and the forbidden kinds are named.
  check(
    src.corrections.includes("assertLearnableCorrection") &&
      src.corrections.includes("FORBIDDEN_CORRECTION_KINDS") &&
      src.corrections.includes('"description_of_operations"'),
    "Learning boundary gate and forbidden-kind list exist",
  );
  check(
    src.studioActions.includes('assertLearnableCorrection("placement")') &&
      src.studioActions.includes('assertLearnableCorrection("holder_rail")'),
    "Every learned-behavior write passes the fence",
  );
  // PlacementMap values are section keys only — a rule cannot carry a limit,
  // a checkbox, or a word of description. The type is the structural proof.
  const acord = read("src/lib/acord25.ts");
  check(
    /export type PlacementMap = Record<string, string>;/.test(acord),
    "Placement rules carry routing only (policyId → sectionKey)",
  );
}

/* ————— Garage risk belongs on the garage form —————
 * An ACORD 25 has no garagekeepers block: the basis, the perils, and the
 * per-location limits have nowhere to print, so issuing one would drop the
 * coverage silently. The registry blocks it and cannot be talked out of it. */
{
  const garagePolicy = SEED_POLICIES.find((p) => p.id === "pol-metro-gar")!;
  const garageSet = FORM_SETS[garagePolicy.id];
  const garageCtx = {
    account,
    policies: [garagePolicy],
    holderName: "Roadside Partners LLC",
    holderAddress: "1 Main St, Austin, TX 78701",
    now: "2026-06-01T12:00:00.000Z",
    verifierRejects: [],
    redAlertActive: false,
    endorsementClaims: [],
    formSets: { [garagePolicy.id]: garageSet },
    holderAiRecords: [],
    requirementHolderName: null,
    scheduleSources: [],
    prepared: null,
    currentDigest: "probe",
  };
  const on25 = runCertChecks({
    ctx: { ...garageCtx, formKey: "acord25" as const },
    overrides: [{ checkId: "garage-form-fit", reason: "operator insists" }],
    operator: "Rogue Operator",
  }).find((r) => r.id === "garage-form-fit")!;
  check(
    on25.status === "fail" && on25.severity === "blocking",
    "Garagekeepers on an ACORD 25 blocks, and an override cannot clear it",
    `status=${on25.status}`,
  );
  const on30 = runCertChecks({
    ctx: { ...garageCtx, formKey: "acord30" as const },
  }).find((r) => r.id === "garage-form-fit")!;
  check(on30.status === "pass", "The same policy passes on the ACORD 30");
}

/* ————— A certificate to the insured grants nothing to a third party —————
 * The everyday certificate names the insured as its own holder. There is no
 * third party to be an additional insured or to have subrogation waived, so
 * neither the wording nor the ADDL INSD / SUBR WVD columns may claim one. */
{
  const summitPolicy = policies[0];
  const toThirdParty = buildDraftFromPolicy({
    account,
    policy: summitPolicy,
    holderName: "Desert Plaza Owners Association",
    holderAddress: "",
    set: formSets[summitPolicy.id],
  });
  check(
    toThirdParty.flags.additionalInsured &&
      /additional insured/i.test(toThirdParty.description),
    "A third-party holder still gets the additional-insured wording",
  );
  const toInsured = buildDraftFromPolicy({
    account,
    policy: summitPolicy,
    holderName: account.name,
    holderAddress: "",
    set: formSets[summitPolicy.id],
  });
  check(
    !toInsured.flags.additionalInsured &&
      !toInsured.flags.subrogationWaived &&
      !toInsured.flags.primaryNonContributory,
    "Holder is the insured — no AI / WOS / P&NC column is claimed",
  );
  check(
    !/additional insured|waiver of subrogation|primary and non-contributory/i.test(
      toInsured.description,
    ),
    "Holder is the insured — no grant wording in the description",
    toInsured.description,
  );
}

/* ————— Every seed policy has a schedule of record —————
 * A policy with no entry in FORM_SETS falls back to bareFormSet, which is
 * `unscheduled` and prints an all-blank LIMITS column by design. That is the
 * right answer for a real policy whose dec page isn't on file, and the wrong
 * answer for the demo book — it reads as a broken certificate. Drift between
 * SEED_POLICIES and FORM_SETS is what causes it, so fail here instead. */
{
  const unscheduled = SEED_POLICIES.filter((p) => !FORM_SETS[p.id]);
  check(
    unscheduled.length === 0,
    "Every seed policy carries a schedule of record",
    unscheduled.length > 0
      ? `no FORM_SETS entry: ${unscheduled.map((p) => p.id).join(", ")} — their certificates would print no limits`
      : undefined,
  );
}

console.log(failed === 0 ? "\nAll invariants hold." : `\n${failed} FAILURE(S).`);
process.exit(failed === 0 ? 0 : 1);
