/**
 * COI stress harness — drives the real cert pipeline end to end:
 * buildCertificatePacket → resolveCertSheet → buildSuggestions →
 * verifyEditedSheet, against the seed schedule of record.
 *
 * Run: npx tsx scripts/coi-stress.ts
 * Exit code = number of failed scenarios.
 */
import { createHash } from "node:crypto";
import * as acord from "../src/lib/acord25";
import { CERT_FORMS, resolveCertSheet, type Acord25Sheet } from "../src/lib/acord25";
import { buildCertificatePacket, type CertificatePacket } from "../src/lib/certificate";
import { verifyEditedSheet, type SheetOverrides } from "../src/lib/cert-review";
import { bareFormSet, FORM_SETS, type PolicyFormSet } from "../src/lib/forms";
import { SEED_ACCOUNTS, SEED_POLICIES } from "../src/lib/seed";
import type { Account, Policy } from "../src/lib/types";

// Feature-detect the description-overflow API (absent pre-fix).
const certDescription: (p: CertificatePacket, s: Acord25Sheet) => string =
  (acord as Record<string, unknown>).certDescription as never;
const hasOverflowApi = typeof certDescription === "function";

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

function account(id: string): Account {
  const a = SEED_ACCOUNTS.find((x) => x.id === id);
  if (!a) throw new Error(`no account ${id}`);
  return a;
}

/** Policies for an account in DB order (ORDER BY carrier, rowid = seed order). */
function accountPolicies(accountId: string): Policy[] {
  return SEED_POLICIES.filter((p) => p.accountId === accountId).sort((a, b) =>
    a.carrier < b.carrier ? -1 : a.carrier > b.carrier ? 1 : 0,
  );
}

function formSetsFor(policies: Policy[]): Record<string, PolicyFormSet> {
  return Object.fromEntries(policies.map((p) => [p.id, FORM_SETS[p.id]]));
}

function buildAll(accountId: string, holderName = "Test Holder Corp", holderAddress = "100 Main St, Springfield, IL 62701") {
  const acct = account(accountId);
  const policies = accountPolicies(accountId);
  const formSets = formSetsFor(policies);
  const packet = buildCertificatePacket({ account: acct, policies, formSets, holderName, holderAddress });
  return { acct, policies, formSets, packet };
}

const money = (cents: number) =>
  "$" + new Intl.NumberFormat("en-US").format(Math.round(cents / 100));

/* ————— S1 · Multi-policy overload (Meridian Reach — the Whyze shape) ————— */
scenario("S1 Multi-Policy Overload — acct-meridian (6 policies, 4 carriers)", () => {
  const { acct, packet } = buildAll("acct-meridian");
  const sheet = resolveCertSheet("acord25", packet.sections);

  // Insurer letters exhaust cleanly.
  const letters = packet.insurers.map((i) => i.letter);
  check(
    new Set(letters).size === letters.length && letters.every((l) => l >= "A" && l <= "F"),
    "Insurer letters unique and within printed A–F rows",
    letters.map((l, i) => `${l}=${packet.insurers[i].carrier}`).join(" "),
  );
  const sectionLetters = packet.sections.map((s) => s.insurerLetter);
  check(
    sectionLetters.every((l) => letters.includes(l)),
    "Every policy's section letter maps to a printed insurer",
    sectionLetters.join(","),
  );

  // Physical form fidelity: ACORD 25 has ONE additional write-in row.
  const printedOthers = sheet.others.filter((r) => r.feeder);
  check(
    printedOthers.length <= 1,
    "At most one additional row prints on the sheet (form has one)",
    `printed other rows: ${sheet.others.length} (${sheet.others.map((r) => r.label || "[blank]").join(" | ")})`,
  );

  // Everything that doesn't fit a printed section must land in the
  // Description Of Operations as deterministic CSV lines.
  check(hasOverflowApi, "Overflow API exists (sheet.overflow + certDescription)");
  if (hasOverflowApi) {
    const overflow = (sheet as unknown as { overflow: { text: string; policyNumber: string }[] }).overflow;
    const desc = certDescription(packet, sheet);
    console.log("  — Description Of Operations:\n" + desc.split("\n").map((l) => "      | " + l).join("\n"));
    check(overflow.length >= 2, "Overflow carries the lines that don't fit", `${overflow.length} lines`);
    for (const line of overflow) {
      check(
        desc.includes(line.text),
        `Overflow line in description — ${line.policyNumber}`,
        line.text,
      );
      check(
        /^[A-Z0-9-]+, \d{2}\/\d{2}\/\d{4}, \d{2}\/\d{2}\/\d{4}, .+/.test(line.text),
        "Line matches `Policy, Eff, Exp, Coverage, …` format",
      );
    }
    // Cross-check overflow dollar values against the schedule of record.
    const cyber = overflow.find((l) => l.text.includes("Cyber"));
    check(
      Boolean(cyber?.text.includes(money(FORM_SETS["pol-meridian-eo"].limits.find((x) => x.slot === "cyber_aggregate")!.amountCents!))),
      "Cyber overflow aggregate equals the scheduled amount",
      cyber?.text,
    );
    const events = overflow.filter((l) => l.policyNumber === "KIN-EV-902319");
    check(events.length >= 1, "Special-events policy overflows (its GL/Liquor lines)", events.map((e) => e.text).join(" || "));
  }

  // Nothing silently dropped: every scheduled dollar/statement is on the
  // sheet (fixed section, printed other row) or in an overflow line.
  const lost: string[] = [];
  for (const s of packet.sections) {
    for (const lim of s.set.limits) {
      const inSection = sheet.sections.some(
        (rs) =>
          rs.feeder?.policy.id === s.policy.id &&
          rs.def.limitBoxes.some((b) => b.slot === lim.slot && rs.limits[b.key] != null),
      );
      const inOther = sheet.others.some(
        (r) => r.feeder?.policy.id === s.policy.id && r.lines.some((ln) => ln.slot === lim.slot),
      );
      const inOverflow =
        hasOverflowApi &&
        (sheet as unknown as { overflow: { policyNumber: string }[] }).overflow.some(
          (l) => l.policyNumber === s.policy.policyNumber,
        );
      if (!inSection && !inOther && !inOverflow) lost.push(`${s.policy.policyNumber}:${lim.slot}`);
    }
  }
  check(lost.length === 0, "No scheduled limit dropped from the certificate", lost.join(", ") || "all accounted for");

  // Default sheet verifies clean (holder present, everything backed).
  const verdict = verifyEditedSheet({ account: acct, packet, sheet, overrides: {} });
  check(
    verdict.rejects.length === 0,
    "Untouched extracted sheet verifies with zero rejects",
    verdict.rejects.map((r) => r.finding.id).join(", ") || "clean",
  );
});

/* ————— S1b · Insurer-letter exhaustion beyond the printed form ————— */
scenario("S1b Insurer-Letter Exhaustion — 7 synthetic carriers", () => {
  const acct = account("acct-meridian");
  const base = accountPolicies("acct-meridian")[0];
  const carriers = ["Kinsale", "Hiscox", "Markel", "AmTrust", "USLI", "Thimble", "NEXT Insurance"];
  const policies: Policy[] = carriers.map((c, i) => ({
    ...base,
    id: `syn-${i}`,
    policyNumber: `SYN-${i}`,
    carrier: c,
  }));
  const formSets = Object.fromEntries(policies.map((p) => [p.id, FORM_SETS["pol-meridian-gl"]]));
  const packet = buildCertificatePacket({
    account: acct,
    policies,
    formSets,
    holderName: "H",
    holderAddress: "",
  });
  const letters = packet.insurers.map((i) => i.letter);
  check(
    letters.every((l) => l === "" || (l >= "A" && l <= "F")),
    "No phantom letter beyond the printed A–F block (7th carrier gets blank, not G)",
    letters.map((l) => l || "∅").join(","),
  );
  check(
    packet.rejects.some((r) => r.finding.id.startsWith("insurer-overflow")),
    "Packet refuses to issue with a 7th carrier",
    packet.rejects.map((r) => r.finding.id).join(", "),
  );
  const sheet = resolveCertSheet("acord25", packet.sections);
  const v = verifyEditedSheet({ account: acct, packet, sheet, overrides: {} });
  check(
    v.rejects.some((r) => r.finding.id.startsWith("insurer-overflow")),
    "Studio verifier blocks the signature path too",
    v.rejects.map((r) => r.finding.id).join(", "),
  );
});

/* ————— S2 · Included / Excluded mix (Greenleaf BOP) ————— */
scenario("S2 Included/Excluded Mix — acct-greenleaf", () => {
  const { acct, packet } = buildAll("acct-greenleaf");
  const sheet = resolveCertSheet("acord25", packet.sections);
  const gl = sheet.sections.find((rs) => rs.def.key === "gl")!;
  check(Boolean(gl.feeder), "GL section backed by the BOP");
  const lim = (k: string) => gl.limits[k];
  check(lim("personalAdv")?.kind === "included", "Personal & Adv Injury prints Included (dec statement)");
  check(lim("productsCompOp")?.kind === "included", "Products–Comp/Op prints Included");
  check(lim("medExp")?.kind === "excluded", "Med Exp prints Excluded");
  check(lim("eachOccurrence")?.kind === "amount", "Each Occurrence prints the dollar");
  for (const key of ["auto", "umbrella", "wc"]) {
    const rs = sheet.sections.find((x) => x.def.key === key)!;
    const allBlank =
      !rs.feeder &&
      !rs.ref &&
      Object.values(rs.limits).every((v) => v == null) &&
      Object.keys(rs.checks).length === 0;
    check(allBlank, `${rs.def.name} section entirely blank (no backing policy, no bleed)`);
  }
  // Typing into an unbacked section rejects.
  const v = verifyEditedSheet({
    account: acct,
    packet,
    sheet,
    overrides: { "umbrella.limit.eachOccurrence": "5,000,000" },
  });
  check(
    v.rejects.some((r) => r.finding.id.startsWith("unbacked-umbrella")),
    "Value typed into the unbacked Umbrella section rejects",
    v.rejects.map((r) => r.finding.id).join(", "),
  );
});

/* ————— S3 · ACORD 25 ↔ 30 switching (Northstar garage) ————— */
scenario("S3 Form Switching — acct-northstar 25↔30", () => {
  const { packet } = buildAll("acct-northstar");
  const s25a = resolveCertSheet("acord25", packet.sections);
  const s30 = resolveCertSheet("acord30", packet.sections);
  const s25b = resolveCertSheet("acord25", packet.sections);
  check(
    JSON.stringify(s25a) === JSON.stringify(s25b),
    "Re-resolving ACORD 25 after a 30 pass is byte-identical (no stale state)",
  );
  const gar = s30.sections.find((rs) => rs.def.key === "garageLiability")!;
  const gk = s30.sections.find((rs) => rs.def.key === "garageKeepers")!;
  check(Boolean(gar.feeder && gk.feeder), "ACORD 30 garage sections fed by the garage policy");
  check(gk.locs["compOtc"] === "LOC 1", "Garagekeepers LOC write-in from the schedule", JSON.stringify(gk.locs));
  const gl30 = s30.sections.find((rs) => rs.def.key === "gl")!;
  check(!gl30.feeder, "ACORD 30 GL section blank (garage label does not bleed into GL)");
  const wc25 = s25a.sections.find((rs) => rs.def.key === "wc")!;
  check(Boolean(wc25.feeder), "ACORD 25 WC section fed by the WC policy");
  // Garage limits must not vanish on the 25.
  const garSlots = ["gar_auto_only_each_accident", "gar_other_than_auto_each_accident", "gar_other_than_auto_aggregate", "gk_comp_otc", "gk_collision"];
  const on25 = garSlots.every(
    (slot) =>
      s25a.others.some((r) => r.lines.some((ln) => ln.slot === slot)) ||
      (hasOverflowApi &&
        (s25a as unknown as { overflow: { policyNumber: string }[] }).overflow.some((l) => l.policyNumber === "AMT-GAR-778302")),
  );
  check(on25, "Garage limits surface on the 25 (other row or description overflow)");
});

/* ————— S4 · Adversarial verifier pass (Ridgeline) ————— */
scenario("S4 Adversarial Edits — acct-ridgeline", () => {
  const { acct, packet } = buildAll("acct-ridgeline");
  const sheet = resolveCertSheet("acord25", packet.sections);

  // Control: untouched sheet is clean.
  const clean = verifyEditedSheet({ account: acct, packet, sheet, overrides: {} });
  check(clean.rejects.length === 0, "Control: untouched sheet has zero rejects", clean.rejects.map((r) => r.finding.id).join(","));

  const attacks: { name: string; overrides: SheetOverrides; expect: (ids: string[]) => boolean }[] = [
    {
      name: "GL Each Occurrence inflated to $2M (policy carries $1M)",
      overrides: { "gl.limit.eachOccurrence": "2,000,000" },
      expect: (ids) => ids.some((i) => i === "limit-over-gl_each_occurrence"),
    },
    {
      name: "Invented policy number",
      overrides: { "gl.policyNumber": "KIN-GL-999999" },
      expect: (ids) => ids.includes("policy-mismatch"),
    },
    {
      name: "Backdated effective date",
      overrides: { "gl.eff": "01/01/2020" },
      expect: (ids) => ids.includes("term-early"),
    },
    {
      name: "Expiration past the policy",
      overrides: { "wc.exp": "12/31/2028" },
      expect: (ids) => ids.includes("term-late"),
    },
    {
      name: "Unbacked checkbox (Scheduled Autos)",
      overrides: { "auto.check.scheduled": true },
      expect: (ids) => ids.includes("check-unbacked-auto-scheduled"),
    },
    {
      name: "Umbrella retention write-in with no data source",
      overrides: { "umbrella.writein.retentionText": "10,000" },
      expect: (ids) => ids.some((i) => i.startsWith("unbacked-umbrella.writein")),
    },
    {
      name: "Wrong NAIC for a verified carrier",
      overrides: { "naic.C": "12345" },
      expect: (ids) => ids.some((i) => i.startsWith("naic-")),
    },
    {
      name: "Dollar typed into the slotless blank GL box",
      overrides: { "gl.limit.glBlank": "1,000,000" },
      expect: (ids) => ids.some((i) => i.startsWith("unbacked-gl.limit.glBlank")),
    },
    {
      name: "Misspelled named insured",
      overrides: { "insured.name": "Rodgeline Automation LLC" },
      expect: (ids) => ids.includes("insured-mismatch"),
    },
    {
      name: "Open-ended contract wording in the description",
      overrides: { desc: "Coverage applies as required by written contract." },
      expect: (ids) => ids.some((i) => i.startsWith("desc-if-required")),
    },
    {
      name: '"Included" claimed on a line the dec states as a dollar',
      overrides: { "gl.limit.eachOccurrence": "Included" },
      expect: (ids) => ids.some((i) => i.startsWith("included-unbacked")),
    },
  ];

  for (const a of attacks) {
    const v = verifyEditedSheet({ account: acct, packet, sheet, overrides: a.overrides });
    const ids = v.rejects.map((r) => r.finding.id);
    check(a.expect(ids) && ids.length > 0, `REJECTED: ${a.name}`, ids.join(", ") || "no rejects!");
  }
});

/* ————— S4b · Adversarial overflow tampering (post-fix contract) ————— */
scenario("S4b Overflow Tampering — acct-meridian description lines", () => {
  if (!hasOverflowApi) {
    check(false, "Overflow API missing — tampering checks not possible");
    return;
  }
  const { acct, packet } = buildAll("acct-meridian");
  const sheet = resolveCertSheet("acord25", packet.sections);
  const desc = certDescription(packet, sheet);
  const overflow = (sheet as unknown as { overflow: { text: string }[] }).overflow;

  // Tamper: inflate a dollar inside an overflow line.
  const tampered = desc.replace("$1,000,000", "$3,000,000");
  check(tampered !== desc, "Tamper target found in description");
  const v1 = verifyEditedSheet({ account: acct, packet, sheet, overrides: { desc: tampered } });
  check(
    v1.rejects.some((r) => r.fieldId === "desc"),
    "Edited overflow amount rejects (line no longer backed)",
    v1.rejects.map((r) => r.finding.id).join(", "),
  );

  // Fabricate: add a policy line that isn't on the account.
  const fake = desc + "\nXYZ-PL-000001, 01/01/2026, 01/01/2027, Pollution Liability, $5,000,000, $5,000,000";
  const v2 = verifyEditedSheet({ account: acct, packet, sheet, overrides: { desc: fake } });
  check(
    v2.rejects.some((r) => r.fieldId === "desc"),
    "Fabricated overflow line rejects",
    v2.rejects.map((r) => r.finding.id).join(", "),
  );

  // Delete one line: understating is allowed — warn, never reject.
  const oneGone = desc
    .split("\n")
    .filter((l) => l.trim() !== overflow[0].text)
    .join("\n");
  const v3 = verifyEditedSheet({ account: acct, packet, sheet, overrides: { desc: oneGone } });
  check(
    v3.rejects.length === 0 && v3.warns.some((w) => w.fieldId === "desc"),
    "Deleted overflow line warns but does not block (blank beats wrong)",
    `rejects=${v3.rejects.map((r) => r.finding.id).join(",") || "none"} warns=${v3.warns.map((w) => w.finding.id).join(",")}`,
  );
});

/* ————— S5 · Layout torture — longest holder, maximum overflow ————— */
scenario("S5 Layout Torture — longest holder + maximum overflow lines", () => {
  const acct = account("acct-meridian");
  const eo = accountPolicies("acct-meridian").find((p) => p.id === "pol-meridian-eo")!;
  const holderName =
    "The Metropolitan Consolidated Municipal Water Reclamation & Infrastructure Improvement District of Greater Springfield, a Joint Powers Authority";
  const holderAddress =
    "Office of Risk Management, Attn: Certificate Compliance Unit\n4501 West Industrial Parkway Boulevard, Building C, Suite 4700\nSpringfield, IL 62701-4501";

  // Six same-carrier E&O+Cyber placements → 12 leftover coverages, 1 printed
  // row + 11 description overflow lines. The box must carry every line.
  const policies: Policy[] = Array.from({ length: 6 }, (_, i) => ({
    ...eo,
    id: `tor-${i}`,
    policyNumber: `HSX-ME-9100${i}`,
  }));
  const formSets = Object.fromEntries(policies.map((p) => [p.id, FORM_SETS["pol-meridian-eo"]]));
  const packet = buildCertificatePacket({ account: acct, policies, formSets, holderName, holderAddress });
  const sheet = resolveCertSheet("acord25", packet.sections);
  if (!hasOverflowApi) {
    check(false, "Overflow API missing — torture build would stretch the form");
    return;
  }
  const overflow = (sheet as unknown as { overflow: { text: string }[] }).overflow;
  const desc = certDescription(packet, sheet);
  check(
    sheet.others.filter((r) => r.feeder).length === 1 && overflow.length === 11,
    "1 printed row + 11 overflow lines (nothing stretches the grid)",
    `others=${sheet.others.length} overflow=${overflow.length}`,
  );
  check(
    overflow.every((l) => desc.includes(l.text)),
    "Every overflow line lands in the description box",
    `${desc.split("\n").length} description lines`,
  );
  const v = verifyEditedSheet({ account: acct, packet, sheet, overrides: {} });
  check(
    v.rejects.length === 0,
    "Torture sheet still verifies clean (long holder is data, not a claim)",
    v.rejects.map((r) => r.finding.id).join(", ") || "clean",
  );
  check(
    packet.holderName === holderName && packet.holderAddress === holderAddress,
    "Holder name/address carried verbatim — never truncated in data",
  );
});

/* ————— S6 · Temporal edges ————— */
scenario("S6 Temporal Edges — expired / future / overlap / mid-term endorsement", () => {
  // Future-effective special events policy prints its scheduled term.
  const { acct, packet } = buildAll("acct-meridian");
  const ev = packet.sections.find((s) => s.policy.id === "pol-meridian-events")!;
  check(
    ev.draft.effectiveDate === "2026-09-10" && ev.draft.expirationDate === "2026-09-14",
    "Not-yet-effective policy prints its scheduled term verbatim",
  );
  if (hasOverflowApi) {
    const sheet = resolveCertSheet("acord25", packet.sections);
    const overflow = (sheet as unknown as { overflow: { text: string }[] }).overflow;
    check(
      overflow.some((l) => l.text.includes("09/10/2026") && l.text.includes("09/14/2026")),
      "Overflow line carries the future term dates",
      overflow.map((l) => l.text).join(" || "),
    );
  }

  // Overlapping, differing terms stay per-policy — no date bleed.
  const wc = packet.sections.find((s) => s.policy.id === "pol-meridian-wc")!;
  const gl = packet.sections.find((s) => s.policy.id === "pol-meridian-gl")!;
  check(
    wc.draft.effectiveDate === "2026-01-01" && gl.draft.effectiveDate === "2026-05-01",
    "Overlapping terms print per policy (WC 01/01, GL 05/01)",
  );

  // Expired policy (schedule of record ended 2026-06-01): the sheet prints
  // the true past term, and stretching it to look in-force rejects.
  const expiredPolicies: Policy[] = [
    { ...accountPolicies("acct-meridian").find((p) => p.id === "pol-meridian-gl")!, effectiveDate: "2025-06-01", expirationDate: "2026-06-01" },
  ];
  const pExp = buildCertificatePacket({
    account: acct,
    policies: expiredPolicies,
    formSets: { "pol-meridian-gl": FORM_SETS["pol-meridian-gl"] },
    holderName: "Test Holder Corp",
    holderAddress: "",
  });
  check(
    pExp.sections[0].draft.expirationDate === "2026-06-01",
    "Expired policy prints its true (past) expiration — nothing invented",
  );
  const sheetExp = resolveCertSheet("acord25", pExp.sections);
  const vLate = verifyEditedSheet({
    account: acct,
    packet: pExp,
    sheet: sheetExp,
    overrides: { "gl.exp": "06/01/2027" },
  });
  check(
    vLate.rejects.some((r) => r.finding.id === "term-late"),
    "Stretching the expired policy's exp date rejects (term-late)",
    vLate.rejects.map((r) => r.finding.id).join(", "),
  );

  // A policy with no parsed schedule (bare coverage codes, e.g. cedar's
  // property placement) still gets NAMED on the sheet — never dropped.
  const cedar = buildAll("acct-cedar");
  // The production getPolicyFormSet fallback for unscheduled policies.
  const cedarSets: Record<string, PolicyFormSet> = Object.fromEntries(
    cedar.policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
  );
  const cedarPacket = buildCertificatePacket({
    account: cedar.acct,
    policies: cedar.policies,
    formSets: cedarSets,
    holderName: "H",
    holderAddress: "",
  });
  const cedarSheet = resolveCertSheet("acord25", cedarPacket.sections);
  const namedSomewhere = cedar.policies.every(
    (p) =>
      cedarSheet.sections.some((rs) => rs.feeder?.policy.id === p.id) ||
      cedarSheet.others.some((r) => r.feeder?.policy.id === p.id) ||
      (hasOverflowApi &&
        (cedarSheet as unknown as { overflow: { policyNumber: string }[] }).overflow.some(
          (l) => l.policyNumber === p.policyNumber,
        )),
  );
  check(
    namedSomewhere,
    "Unscheduled (bare-code) policies still print by name — nothing silently dropped",
  );

  // REGRESSION (the oakridge bug): a single-GL account whose only policy has
  // no schedule of record must fill the COMMERCIAL GENERAL LIABILITY row —
  // identity only, no checkbox, no limit — never a stray write-in row.
  const oak = buildAll("acct-oakridge");
  const oakSets: Record<string, PolicyFormSet> = Object.fromEntries(
    oak.policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
  );
  const oakPacket = buildCertificatePacket({
    account: oak.acct,
    policies: oak.policies,
    formSets: oakSets,
    holderName: "Test Holder Corp",
    holderAddress: "",
  });
  const oakSheet = resolveCertSheet("acord25", oakPacket.sections);
  const oakGl = oakSheet.sections.find((rs) => rs.def.key === "gl")!;
  check(
    oakGl.ref?.policyNumber === "NXT-GL-667788",
    "Oakridge single GL policy fills the GL row (NXT-GL-667788)",
    oakGl.ref?.policyNumber ?? "[GL row empty]",
  );
  check(
    !oakSheet.others.some((r) => r.feeder?.policy.id === "pol-oakridge-gl"),
    "Oakridge GL no longer falls through to the additional write-in row",
  );
  check(
    Object.values(oakGl.checks).every((v) => !v) &&
      Object.values(oakGl.limits).every((v) => v === null),
    "Unscheduled GL row claims identity only — no checkbox, every limit box blank",
  );

  // Mid-term endorsement: schedule of record raised GL occurrence to $2M.
  const policies = accountPolicies("acct-meridian");
  const endorsed: Record<string, PolicyFormSet> = {
    ...formSetsFor(policies),
    "pol-meridian-gl": {
      ...FORM_SETS["pol-meridian-gl"],
      limits: FORM_SETS["pol-meridian-gl"].limits.map((l) =>
        l.slot === "gl_each_occurrence" ? { ...l, amountCents: 2_000_000_00 } : l,
      ),
    },
  };
  const p2 = buildCertificatePacket({
    account: acct,
    policies,
    formSets: endorsed,
    holderName: "Test Holder Corp",
    holderAddress: "",
  });
  const sheet2 = resolveCertSheet("acord25", p2.sections);
  const gl2 = sheet2.sections.find((rs) => rs.def.key === "gl")!;
  const eo = gl2.limits["eachOccurrence"];
  check(
    eo?.kind === "amount" && eo.cents === 2_000_000_00,
    "Endorsed limit flows through at render time ($2M on the sheet)",
  );
  const vOld = verifyEditedSheet({
    account: acct,
    packet: p2,
    sheet: sheet2,
    overrides: { "gl.limit.eachOccurrence": "3,000,000" },
  });
  check(
    vOld.rejects.some((r) => r.finding.id === "limit-over-gl_each_occurrence"),
    "Claiming above the endorsed limit still rejects",
  );
});

/* ————— S7 · Determinism ————— */
scenario("S7 Determinism — double build, byte-identical", () => {
  const hash = (accountId: string) => {
    const { packet } = buildAll(accountId);
    const sheet = resolveCertSheet("acord25", packet.sections);
    const desc = hasOverflowApi ? certDescription(packet, sheet) : packet.description;
    // Strip functions (SectionDef resolvers) — compare the data payload.
    const payload = JSON.stringify({ packet, sheet, desc }, (k, v) =>
      typeof v === "function" ? undefined : v,
    );
    return createHash("sha256").update(payload).digest("hex");
  };
  for (const id of ["acct-meridian", "acct-ridgeline", "acct-northstar", "acct-greenleaf"]) {
    const h1 = hash(id);
    const h2 = hash(id);
    check(h1 === h2, `${id} builds byte-identical twice`, h1.slice(0, 16));
    console.log(`  # cross-run hash ${id}: ${h1}`);
  }
  // ACORD 30 too.
  const { packet } = buildAll("acct-northstar");
  const a = JSON.stringify(resolveCertSheet("acord30", packet.sections), (k, v) =>
    typeof v === "function" ? undefined : v,
  );
  const b = JSON.stringify(resolveCertSheet("acord30", packet.sections), (k, v) =>
    typeof v === "function" ? undefined : v,
  );
  check(a === b, "ACORD 30 sheet resolves byte-identical twice");
});

console.log(
  `\n━━━ SCOREBOARD ━━━\nScenarios: ${scenarios} · Passed: ${scenarios - failedScenarios} · Failed: ${failedScenarios}\nChecks: ${checks} · Passed: ${checks - failedChecks} · Failed: ${failedChecks}`,
);
process.exit(failedScenarios);
