/**
 * Self-check: the desk placement correction loop.
 *
 * Exercises the whole loop against an in-memory SQLite database:
 *   1. migrateIntelligenceTables creates desk_placement_rules
 *   2. upsertPlacementRule persists a correction with provenance;
 *      a re-correction replaces it (one rule per policy)
 *   3. resolveCertSheet honors the rule — the ruled section claims the
 *      policy, the coverage matcher skips it (no duplicate), and the row
 *      carries placedByRule provenance
 *   4. deletePlacementRule revokes it — the matcher takes back over
 *
 * Run: npx tsx --conditions react-server scripts/cert-corrections-check.ts
 * (policy-intelligence imports "server-only"; the react-server condition
 * resolves it to its empty module, same as the app server does.)
 */

import Database from "better-sqlite3";
import { resolveCertSheet } from "../src/lib/acord25";
import { buildCertificatePacket } from "../src/lib/certificate";
import { bareFormSet, FORM_SETS, type PolicyFormSet } from "../src/lib/forms";
import {
  deletePlacementRule,
  listPlacementRules,
  migrateIntelligenceTables,
  upsertPlacementRule,
} from "../src/lib/policy-intelligence";
import { SEED_ACCOUNTS, SEED_POLICIES } from "../src/lib/seed";
import type { Account } from "../src/lib/types";

let failed = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

/* ————— Persistence: table + CRUD ————— */

console.log("━━━ S1 Placement rules persist with provenance ━━━");
const db = new Database(":memory:");
// Minimal parents for the FK — the real schema lives in db.ts's migrate.
db.exec(`
  CREATE TABLE accounts (id TEXT PRIMARY KEY);
  CREATE TABLE policies (id TEXT PRIMARY KEY);
  INSERT INTO accounts (id) VALUES ('acct-oakridge');
  INSERT INTO policies (id) VALUES ('pol-oakridge-gl');
`);
migrateIntelligenceTables(db);
const table = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='desk_placement_rules'`)
  .get();
check(Boolean(table), "migrateIntelligenceTables creates desk_placement_rules");

const rule = upsertPlacementRule(db, {
  accountId: "acct-oakridge",
  policyId: "pol-oakridge-gl",
  sectionKey: "umbrella",
  movedFrom: "Additional Row",
  correctedBy: "Rita Alvarez",
});
check(
  rule.sectionKey === "umbrella" && rule.correctedBy === "Rita Alvarez",
  "upsertPlacementRule stores the correction with operator provenance",
);

const replaced = upsertPlacementRule(db, {
  accountId: "acct-oakridge",
  policyId: "pol-oakridge-gl",
  sectionKey: "gl",
  movedFrom: "Umbrella Liab",
  correctedBy: "Rita Alvarez",
});
const listed = listPlacementRules(db, "acct-oakridge");
check(
  listed.length === 1 && listed[0].sectionKey === "gl",
  "Re-correcting the same policy replaces the rule (one rule per policy)",
  `rules=${listed.length} section=${listed[0]?.sectionKey}`,
);

/* ————— Resolver honors the rule ————— */

console.log("\n━━━ S2 Resolver honors the desk rule ━━━");
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
const packet = buildCertificatePacket({
  account,
  policies,
  formSets,
  holderName: "Check Holder",
  holderAddress: "",
});

// A routing correction, which is the only thing a rule is: Meridian carries
// two policies that can each feed the general liability row, the matcher
// takes the first, and the desk picks the other. The rule must beat the
// matcher without producing a duplicate row.
//
// This used to pin a GL-only policy to the umbrella section — the comment
// called it artificial. It was, and worse: a rule cannot conjure coverage,
// so that placement is now refused (see cert-invariants-check). The fixture
// has to be a correction the desk could legitimately make.
const meridianAccount = SEED_ACCOUNTS.find((a) => a.id === "acct-meridian")!;
const meridianPolicies = SEED_POLICIES.filter(
  (p) => p.accountId === "acct-meridian",
);
const meridianPacket = buildCertificatePacket({
  account: { ...meridianAccount, status: "active" } as Account,
  policies: meridianPolicies,
  formSets: Object.fromEntries(
    meridianPolicies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
  ),
  holderName: "Check Holder",
  holderAddress: "",
});
const unruled = resolveCertSheet("acord25", meridianPacket.sections, {});
const matcherPick = unruled.sections.find((rs) => rs.def.key === "gl")!.feeder
  ?.policy.id;
const deskPick =
  matcherPick === "pol-meridian-gl" ? "pol-meridian-events" : "pol-meridian-gl";
const ruled = resolveCertSheet("acord25", meridianPacket.sections, {
  [deskPick]: "gl",
});
const glRuled = ruled.sections.find((rs) => rs.def.key === "gl")!;
check(
  glRuled.feeder?.policy.id === deskPick && glRuled.placedByRule === true,
  "Ruled section claims the policy and carries placedByRule provenance",
  `gl fed by ${glRuled.feeder?.policy.id ?? "nothing"} (matcher wanted ${matcherPick})`,
);
check(
  ruled.unhonoredPlacements.length === 0,
  "A correction between sections the policy can feed is honored",
);
const feeds = ruled.sections.filter(
  (rs) => rs.feeder?.policy.id === deskPick,
).length;
check(feeds === 1, "The policy feeds exactly one section under the rule");

/* ————— Revocation restores the matcher ————— */

console.log("\n━━━ S3 Revoking the rule restores the matcher ━━━");
deletePlacementRule(db, replaced.id);
check(
  listPlacementRules(db, "acct-oakridge").length === 0,
  "deletePlacementRule removes the rule",
);
const restored = resolveCertSheet("acord25", packet.sections, {});
const glRestored = restored.sections.find((rs) => rs.def.key === "gl")!;
check(
  glRestored.ref?.policyNumber === "NXT-GL-667788" &&
    glRestored.placedByRule === false,
  "With no rule, the coverage matcher places the GL policy in the GL row",
);

/* ————— Determinism ————— */

console.log("\n━━━ S4 Rule-driven resolve is deterministic ━━━");
const a = JSON.stringify(
  resolveCertSheet("acord25", meridianPacket.sections, { [deskPick]: "gl" })
    .sections.map((rs) => [rs.def.key, rs.ref?.policyNumber ?? null, rs.placedByRule]),
);
const b = JSON.stringify(
  resolveCertSheet("acord25", meridianPacket.sections, { [deskPick]: "gl" })
    .sections.map((rs) => [rs.def.key, rs.ref?.policyNumber ?? null, rs.placedByRule]),
);
check(a === b, "Same placements → byte-identical section layout");

console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILURE(S)`}`);
process.exit(failed === 0 ? 0 : 1);
