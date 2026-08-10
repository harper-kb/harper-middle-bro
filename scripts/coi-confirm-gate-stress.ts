/**
 * Batch-confirm gate stress — every verifier reject must be VISIBLE to the
 * guided card's record step. The wizard refuses "Confirm All From The File"
 * while any record area carries a reject; that gate keys on the reject's
 * `fieldId` mapped into a review area. A reject with no mappable fieldId is
 * invisible to the gate (the header still blocks issuance via verifier-clean,
 * but the attestation step would read clean when it is not).
 *
 * Scenarios:
 *   G1. Adversarial battery on acct-meridian — inflated limit, invented
 *       policy number, shifted dates, fake NAIC, tampered / invented
 *       description-overflow lines. Each must reject AND every reject must
 *       map to a review area.
 *   G2. Insurer-letter exhaustion (7 carriers) — the insurer-overflow reject
 *       maps into the "insurers" record area (regression: it used to carry
 *       no fieldId at all).
 *   G3. Record vs per-certificate split — coverage tampering points at
 *       record areas (batched step); description/holder rejects point at the
 *       per-certificate areas (their own steps).
 *   G4. Book sweep — untouched sheets for every seed account on both forms:
 *       any reject that exists must be area-mapped; no invisible rejects
 *       anywhere on the book.
 *
 * Run: npx tsx scripts/coi-confirm-gate-stress.ts
 * Exit code = number of failed scenarios.
 */
import { CERT_FORMS, certDescription, resolveCertSheet } from "../src/lib/acord25";
import { buildCertificatePacket } from "../src/lib/certificate";
import {
  verifyEditedSheet,
  type SheetFinding,
  type SheetOverrides,
} from "../src/lib/cert-review";
import { bareFormSet, FORM_SETS, type PolicyFormSet } from "../src/lib/forms";
import { SEED_ACCOUNTS, SEED_POLICIES } from "../src/lib/seed";
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

/**
 * Mirror of `fieldArea` in src/components/CertificateStudio.tsx — the
 * component keeps it private, so the harness re-states the mapping. If the
 * component's mapping changes, change this too (G4 will catch drift the
 * moment a reject stops mapping).
 */
const SECTION_AREA_KEYS = new Set(
  [...CERT_FORMS.acord25.sections, ...CERT_FORMS.acord30.sections].map(
    (d) => d.key,
  ),
);
function fieldAreaMirror(id: string): string | null {
  if (id === "desc" || id.startsWith("desc.")) return "desc";
  if (id.startsWith("holder.")) return "holder";
  if (id.startsWith("insurer.") || id.startsWith("naic.")) return "insurers";
  if (id.startsWith("producer.") || id.startsWith("insured.") || id === "date") {
    return "header";
  }
  const prefix = id.split(".")[0];
  if (SECTION_AREA_KEYS.has(prefix) || /^other\d+$/.test(prefix)) return prefix;
  return null;
}

const RECORD_AREA = (a: string) =>
  a === "header" || a === "insurers" || SECTION_AREA_KEYS.has(a) || /^other\d+$/.test(a);

function areaOf(f: SheetFinding): string | null {
  return f.fieldId ? fieldAreaMirror(f.fieldId) : null;
}

function unmapped(rejects: SheetFinding[]): SheetFinding[] {
  return rejects.filter((f) => areaOf(f) == null);
}

function account(id: string): Account {
  const a = SEED_ACCOUNTS.find((x) => x.id === id);
  if (!a) throw new Error(`no account ${id}`);
  return a;
}

function accountPolicies(accountId: string): Policy[] {
  return SEED_POLICIES.filter((p) => p.accountId === accountId).sort((a, b) =>
    a.carrier < b.carrier ? -1 : a.carrier > b.carrier ? 1 : 0,
  );
}

function buildAll(
  accountId: string,
  holderName = "Test Holder Corp",
  holderAddress = "100 Main St, Springfield, IL 62701",
) {
  const acct = account(accountId);
  const policies = accountPolicies(accountId);
  const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
    policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
  );
  const packet = buildCertificatePacket({
    account: acct,
    policies,
    formSets,
    holderName,
    holderAddress,
  });
  const sheet = resolveCertSheet("acord25", packet.sections);
  return { acct, policies, formSets, packet, sheet };
}

/* ————— G1: adversarial battery — every reject must be area-mapped ————— */

scenario("G1 Adversarial Battery On acct-meridian — Rejects All Map To Areas", () => {
  const { acct, packet, sheet } = buildAll("acct-meridian");

  // Field ids discovered off the live sheet so the battery survives fixture edits.
  const feederSec = sheet.sections.find((rs) => rs.feeder && rs.ref)!;
  const sec = feederSec.def.key;
  const limitBox = feederSec.def.limitBoxes.find(
    (b) => b.slot != null && feederSec.limits[b.key]?.kind === "amount",
  )!;
  const naicLetter = packet.insurers.find((i) => i.naic)!.letter;
  const desc = certDescription(packet, sheet);
  check(sheet.overflow.length > 0, "Control: meridian carries description overflow lines", `${sheet.overflow.length} lines`);

  const battery: { name: string; overrides: SheetOverrides; wantArea?: string }[] = [
    {
      name: `Inflated limit (${sec}.limit.${limitBox.key} → $9,999,999)`,
      overrides: { [`${sec}.limit.${limitBox.key}`]: "9,999,999" },
      wantArea: sec,
    },
    {
      name: `Invented policy number (${sec}.policyNumber)`,
      overrides: { [`${sec}.policyNumber`]: "FAKE-000-INVENTED" },
      wantArea: sec,
    },
    {
      name: `Shifted effective date (${sec}.eff → 01/01/2019)`,
      overrides: { [`${sec}.eff`]: "01/01/2019" },
      wantArea: sec,
    },
    {
      name: `Shifted expiration date (${sec}.exp → 12/31/2039)`,
      overrides: { [`${sec}.exp`]: "12/31/2039" },
      wantArea: sec,
    },
    {
      name: `Fake NAIC (naic.${naicLetter} → 99999)`,
      overrides: { [`naic.${naicLetter}`]: "99999" },
      wantArea: "insurers",
    },
    {
      name: "Tampered overflow line (amount edited in the description)",
      overrides: {
        desc: desc.replace(sheet.overflow[0].text, sheet.overflow[0].text.replace(/[\d,]+$/, "9,999,999")),
      },
      wantArea: "desc",
    },
    {
      name: "Invented overflow line appended to the description",
      overrides: {
        desc: `${desc}\nPHANTOM-777, 01/01/2026, 01/01/2027, Pollution Liability, $ 5,000,000, $ 5,000,000`,
      },
      wantArea: "desc",
    },
  ];

  for (const t of battery) {
    const verdict = verifyEditedSheet({ account: acct, packet, sheet, overrides: t.overrides });
    check(verdict.rejects.length > 0, `${t.name} REJECTS`, verdict.rejects.map((r) => r.finding.id).join(", ") || "NO REJECT — WOULD SHIP");
    const invisible = unmapped(verdict.rejects);
    check(
      invisible.length === 0,
      `${t.name} — every reject visible to the batch gate`,
      invisible.map((f) => f.finding.id).join(", ") || `areas: ${[...new Set(verdict.rejects.map(areaOf))].join(",")}`,
    );
    if (t.wantArea) {
      check(
        verdict.rejects.some((f) => areaOf(f) === t.wantArea),
        `${t.name} — reject lands in the "${t.wantArea}" area`,
        [...new Set(verdict.rejects.map(areaOf))].join(","),
      );
    }
  }
});

/* ————— G2: insurer exhaustion maps into the insurers area ————— */

scenario("G2 Insurer Exhaustion — Overflow Reject Visible To The Batch Gate", () => {
  const acct = account("acct-meridian");
  const carriers = ["Kinsale", "Hiscox", "Markel", "Chubb", "Travelers", "CNA", "Zurich"];
  const policies: Policy[] = carriers.map((c, i) => ({
    id: `pol-gate-${i}`,
    accountId: acct.id,
    policyNumber: `GATE-${i}`,
    carrier: c,
    coverages: ["GL"],
    effectiveDate: "2026-04-01",
    expirationDate: "2027-04-01",
    premiumCents: 100_000,
    quoteInsuredName: null,
    quoteCarrier: null,
    issuingCarrier: null,
  }));
  const formSets = Object.fromEntries(policies.map((p) => [p.id, bareFormSet(p.coverages)]));
  const packet = buildCertificatePacket({
    account: acct,
    policies,
    formSets,
    holderName: "Test Holder Corp",
    holderAddress: "100 Main St, Springfield, IL 62701",
  });
  const sheet = resolveCertSheet("acord25", packet.sections);
  const verdict = verifyEditedSheet({ account: acct, packet, sheet, overrides: {} });
  const overflowRejects = verdict.rejects.filter((f) => f.finding.id.startsWith("insurer-overflow"));
  check(overflowRejects.length === 1, "Seventh carrier rejects at the insurer block", overflowRejects.map((f) => f.finding.id).join(","));
  check(
    overflowRejects.every((f) => areaOf(f) === "insurers"),
    `insurer-overflow reject maps to the "insurers" record area (fieldId ${overflowRejects[0]?.fieldId})`,
    overflowRejects.map((f) => `${f.finding.id} → ${areaOf(f) ?? "INVISIBLE"}`).join(", "),
  );
  check(
    unmapped(verdict.rejects).length === 0,
    "No reject on the exhausted sheet is invisible to the gate",
    unmapped(verdict.rejects).map((f) => f.finding.id).join(", ") || "all mapped",
  );
});

/* ————— G3: record vs per-certificate split ————— */

scenario("G3 Record Vs Per-Certificate Split — Rejects Land On The Right Step", () => {
  const { acct, packet, sheet } = buildAll("acct-meridian");

  // Holder missing → per-cert holder area, never the batched record step.
  const noHolder = buildAll("acct-meridian", "", "");
  const holderVerdict = verifyEditedSheet({
    account: noHolder.acct,
    packet: noHolder.packet,
    sheet: noHolder.sheet,
    overrides: {},
  });
  const holderRejects = holderVerdict.rejects.filter((f) => f.finding.id === "holder-missing");
  check(holderRejects.length === 1, "Blank holder rejects (holder-missing)");
  check(
    holderRejects.every((f) => areaOf(f) === "holder" && !RECORD_AREA(areaOf(f)!)),
    "holder-missing points at the per-certificate holder step, not the record batch",
    holderRejects.map((f) => `${f.fieldId} → ${areaOf(f)}`).join(","),
  );

  // Overflow tampering → per-cert desc area.
  const desc = certDescription(packet, sheet);
  const tampered = verifyEditedSheet({
    account: acct,
    packet,
    sheet,
    overrides: { desc: `${desc}\nGHOST-1, 02/02/2026, 02/02/2027, Riggers Liability, $ 1,000,000, —` },
  });
  check(
    tampered.rejects.length > 0 &&
      tampered.rejects.every((f) => areaOf(f) === "desc" && !RECORD_AREA("desc")),
    "Invented overflow line points at the per-certificate description step",
    [...new Set(tampered.rejects.map(areaOf))].join(","),
  );

  // Unbacked entry in an empty section → that section's record area.
  const emptySec = sheet.sections.find((rs) => !rs.feeder);
  if (emptySec) {
    const id = `${emptySec.def.key}.limit.${emptySec.def.limitBoxes[0].key}`;
    const v = verifyEditedSheet({ account: acct, packet, sheet, overrides: { [id]: "1,000,000" } });
    check(
      v.rejects.length > 0 && v.rejects.every((f) => RECORD_AREA(areaOf(f) ?? "")),
      `Value typed into the empty ${emptySec.def.name} section blocks the record batch`,
      v.rejects.map((f) => `${f.finding.id} → ${areaOf(f)}`).join(", "),
    );
  } else {
    console.log("  # no empty section on the meridian sheet — skip");
  }
});

/* ————— G4: book sweep — no invisible rejects anywhere ————— */

scenario("G4 Book Sweep — Untouched Sheets, Both Forms, Zero Invisible Rejects", () => {
  let accountsChecked = 0;
  let rejectsSeen = 0;
  const invisible: string[] = [];
  for (const acct of SEED_ACCOUNTS) {
    const policies = accountPolicies(acct.id);
    if (policies.length === 0) continue;
    const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
      policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
    );
    for (const formKey of ["acord25", "acord30"] as const) {
      const packet = buildCertificatePacket({
        account: acct,
        policies,
        formSets,
        holderName: "Sweep Holder LLC",
        holderAddress: "1 Sweep Way, Springfield, IL 62701",
      });
      const sheet = resolveCertSheet(formKey, packet.sections);
      const verdict = verifyEditedSheet({ account: acct, packet, sheet, overrides: {} });
      rejectsSeen += verdict.rejects.length;
      for (const f of unmapped(verdict.rejects)) {
        invisible.push(`${acct.id}/${formKey}: ${f.finding.id}`);
      }
    }
    accountsChecked++;
  }
  check(accountsChecked >= 8, "Swept the whole seed book", `${accountsChecked} accounts × 2 forms, ${rejectsSeen} rejects seen`);
  check(
    invisible.length === 0,
    "Every reject on the book carries a fieldId the batch gate can map",
    invisible.join(" | ") || "all mapped",
  );
});

console.log(
  `\n━━━ SCOREBOARD ━━━\nScenarios: ${scenarios} · Passed: ${scenarios - failedScenarios} · Failed: ${failedScenarios}\nChecks: ${checks} · Passed: ${checks - failedChecks} · Failed: ${failedChecks}`,
);
process.exit(failedScenarios);
