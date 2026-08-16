/**
 * Certificate fill audit — measures how completely and correctly the
 * Certificate Studio fills ACORD forms straight off the schedule of record.
 *
 * For every account with policies, this script:
 *   1. Loads policies + schedules DIRECTLY from SQLite (raw SQL — the same
 *      schedule of record the account page resolves), with the production
 *      fallback chain (DB rows → FORM_SETS → bare coverage codes).
 *   2. Builds the packet + sheet through the one-door assembler
 *      buildFactSnapshot (cert-snapshot.ts) — the exact pipeline that serves
 *      preparation and issuance — and checks digest determinism.
 *   3. Independently recomputes what every ACORD field SHOULD say from the
 *      raw rows (doctrine reimplemented here, not imported), and classifies
 *      each field: Filled Correct / Correctly Blank / Missed Fill /
 *      Wrong Value / Static-Producer.
 *
 * Run: npx tsx scripts/cert-fill-audit.ts
 * Output: docs/cert-fill-report.md (overwritten) + same content on stdout.
 * Exit code = number of Wrong Value findings (critical misses).
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  CERT_FORMS,
  certDescription,
  type Acord25Sheet,
  type CertFormKey,
  type ResolvedLimit,
  type SectionDef,
} from "../src/lib/acord25";
import { evaluateKnowledgeForCertSection } from "../src/lib/carrier-knowledge";
import {
  blockingFailures,
  runCertChecks,
  type CertCheckContext,
} from "../src/lib/cert-checks";
import { buildFactSnapshot } from "../src/lib/cert-snapshot";
import {
  buildCertificatePacket,
  type CertificatePacket,
} from "../src/lib/certificate";
import {
  bareFormSet,
  FORM_SETS,
  limitMode,
  type LimitSlot,
  type PolicyFormSet,
} from "../src/lib/forms";
import { naicForPolicy } from "../src/lib/naic";
import { AUTHORIZED_REPRESENTATIVE, PRODUCER } from "../src/lib/brand";
import type { Account, Policy } from "../src/lib/types";

/** Run from the repo root (as `npx tsx scripts/cert-fill-audit.ts` does). */
const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "data", "underwriter-desk.db");
const REPORT_PATH = path.join(ROOT, "docs", "cert-fill-report.md");

/** Fixed audit holder — pass-through data, never a claim. */
const HOLDER_NAME = "Audit Holder LLC";
const HOLDER_ADDRESS = "100 Main St, Springfield, IL 62701";

/** Fixed snapshot clock so the one-door assembler is bit-deterministic. */
const SNAPSHOT_AT = "2026-08-08T00:00:00.000Z";

/* ————————————————— Raw SQLite loading (the schedule of record) ————————————————— */

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

interface RawPolicyRow {
  id: string;
  account_id: string;
  policy_number: string;
  carrier: string;
  coverages_json: string;
  effective_date: string;
  expiration_date: string;
  premium_cents: number;
  quote_insured_name: string | null;
  quote_carrier: string | null;
  issuing_carrier: string | null;
}

interface RawAccountRow {
  id: string;
  name: string;
  dba: string | null;
  industry: string;
  address1: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  primary_uw_id: string;
  backup_uw_id: string | null;
  notes: string | null;
}

interface RawLimitRow {
  slot: LimitSlot;
  mode: "amount" | "included" | "excluded";
  amount_cents: number | null;
  loc: string | null;
}

interface RawEndtRow {
  form: string;
  edition: string;
  title: string;
  kind: string;
  note: string | null;
}

interface RawPartRow {
  code: string;
  label: string;
  form: string;
  edition: string;
}

const accounts = db
  .prepare(
    `SELECT id, name, dba, industry, address1, city, state, zip,
            primary_uw_id, backup_uw_id, notes
     FROM accounts ORDER BY id`,
  )
  .all() as RawAccountRow[];

/** Same order the account page uses: ORDER BY carrier, id (db.ts:1123). */
const policiesFor = db.prepare(
  `SELECT * FROM policies WHERE account_id = ? ORDER BY carrier, id`,
);
const limitsFor = db.prepare(
  `SELECT slot, mode, amount_cents, loc FROM policy_limits WHERE policy_id = ?`,
);
const endtsFor = db.prepare(
  `SELECT form, edition, title, kind, note FROM policy_endorsements
   WHERE policy_id = ? ORDER BY sort_order ASC`,
);
const partsFor = db.prepare(
  `SELECT code, label, form, edition FROM policy_coverage_parts
   WHERE policy_id = ? ORDER BY sort_order ASC`,
);

function mapPolicy(row: RawPolicyRow): Policy {
  return {
    id: row.id,
    accountId: row.account_id,
    policyNumber: row.policy_number,
    carrier: row.carrier,
    coverages: JSON.parse(row.coverages_json) as string[],
    effectiveDate: row.effective_date,
    expirationDate: row.expiration_date,
    premiumCents: row.premium_cents,
    quoteInsuredName: row.quote_insured_name,
    quoteCarrier: row.quote_carrier,
    issuingCarrier: row.issuing_carrier,
  };
}

/**
 * The account object the packet needs (it reads name + identity only).
 * Cast, not typed literal: the parent session is actively extending the
 * Account type (lifecycle metadata) and this audit must not break when a
 * field is added — the cert pipeline under test doesn't consume them.
 */
function mapAccount(row: RawAccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    dba: row.dba,
    industry: row.industry,
    addressLine1: row.address1,
    city: row.city,
    state: row.state,
    zip: row.zip,
    primaryUwId: row.primary_uw_id,
    backupUwId: row.backup_uw_id,
    notes: row.notes,
    status: "active",
    paymentReceivedAt: null,
  } as Account;
}

/** Production fallback chain: DB schedule → FORM_SETS seed → bare codes. */
function loadFormSet(p: Policy): {
  set: PolicyFormSet;
  source: "sqlite" | "seed" | "bare";
} {
  const parts = partsFor.all(p.id) as RawPartRow[];
  if (parts.length > 0) {
    const limits = (limitsFor.all(p.id) as RawLimitRow[]).map((l) => ({
      slot: l.slot,
      mode: l.mode,
      amountCents: l.amount_cents ?? undefined,
      loc: l.loc ?? undefined,
    }));
    const endorsements = (endtsFor.all(p.id) as RawEndtRow[]).map((e) => ({
      form: e.form,
      edition: e.edition,
      title: e.title,
      kind: e.kind as PolicyFormSet["endorsements"][number]["kind"],
      note: e.note ?? undefined,
    }));
    return { set: { coverages: parts, limits, endorsements }, source: "sqlite" };
  }
  if (FORM_SETS[p.id]) return { set: FORM_SETS[p.id], source: "seed" };
  // Same bare-code expansion production uses: catalog labels so the coverage
  // section that owns the line claims the policy, `unscheduled` so nothing
  // beyond identity prints.
  return { set: bareFormSet(p.coverages), source: "bare" };
}

/* ————————————————— Field classification ————————————————— */

type Cls =
  | "filled_correct"
  | "correctly_blank"
  | "missed_fill"
  | "wrong_value"
  | "static_producer";

interface FieldAudit {
  cls: Cls;
  sheetId: string; // "acct-x" or "acct-x · ACORD 30"
  section: string;
  field: string;
  expected: string;
  got: string;
  source: string;
}

const audits: FieldAudit[] = [];
/** Boxes printing the dec statement "Excluded" where the schedule is silent. */
let silentExcludedPrints = 0;

function push(a: FieldAudit) {
  audits.push(a);
}

type FieldBase = Omit<FieldAudit, "cls" | "expected" | "got">;

function textCell(base: FieldBase, expected: string, got: string) {
  const cls: Cls =
    expected && got === expected
      ? "filled_correct"
      : !expected && !got
        ? "correctly_blank"
        : expected && !got
          ? "missed_fill"
          : "wrong_value";
  push({ ...base, cls, expected: expected || "[blank]", got: got || "[blank]" });
}

function boolCell(base: FieldBase, expected: boolean, got: boolean) {
  const cls: Cls =
    expected && got
      ? "filled_correct"
      : !expected && !got
        ? "correctly_blank"
        : expected && !got
          ? "missed_fill"
          : "wrong_value";
  push({
    ...base,
    cls,
    expected: expected ? "checked" : "unchecked",
    got: got ? "checked" : "unchecked",
  });
}

const money = (cents: number) =>
  "$" + new Intl.NumberFormat("en-US").format(Math.round(cents / 100));

function fmtResolved(v: ResolvedLimit | null | undefined): string {
  if (v == null) return "[blank]";
  if (v.kind === "included") return "Included";
  if (v.kind === "excluded") return "Excluded";
  return money(v.cents);
}

function sameResolved(
  raw: RawLimitRow,
  got: ResolvedLimit | null | undefined,
): boolean {
  if (got == null) return false;
  if (raw.mode === "amount")
    return got.kind === "amount" && got.cents === (raw.amount_cents ?? 0);
  return got.kind === raw.mode;
}

function fmtRaw(raw: RawLimitRow): string {
  if (raw.mode === "included") return "Included";
  if (raw.mode === "excluded") return "Excluded";
  return money(raw.amount_cents ?? 0);
}

/* ————————————————— Doctrine recompute (independent of acord25.ts) ————————————————— */

function coverageTextRaw(set: PolicyFormSet): string {
  return set.coverages.map((c) => c.label).join(" · ");
}

/** Expected checkbox states per section, recomputed from raw schedule rows. */
function expectedChecks(
  defKey: string,
  set: PolicyFormSet,
): Record<string, boolean> {
  // No schedule of record: the row identifies the policy and claims nothing
  // else — no checkbox may resolve (doctrine: blank beats wrong).
  if (set.unscheduled) return {};
  const text = coverageTextRaw(set);
  switch (defKey) {
    case "gl": {
      const glPart =
        set.coverages.find((c) =>
          /general liability|liability section/i.test(c.label),
        ) ?? set.coverages[0];
      // Claims-made evidence lives in TWO places on a real dec: the coverage
      // part label, or a scheduled claims-made endorsement (ISC paper states
      // it as "Claims-Made and Reported Limitation" — HS/SP CMR 00 00). The
      // resolver only reads the label; the audit reads both, so a sheet that
      // checks OCCUR against claims-made paper is a Wrong Value.
      const claimsMade =
        /claims-?made/i.test(glPart?.label ?? "") ||
        set.endorsements.some((e) => /claims-?made/i.test(e.title));
      const perProject = set.endorsements.some((e) =>
        /per[- ]project/i.test(e.title),
      );
      const perLoc =
        !perProject &&
        set.endorsements.some((e) => /per[- ]location/i.test(e.title));
      return {
        claimsMade,
        occur: !claimsMade,
        aggPolicy: !perProject && !perLoc,
        aggProject: perProject,
        aggLoc: perLoc,
      };
    }
    case "auto": {
      const withoutNonOwned = text.replace(/non-?owned/gi, "");
      return {
        anyAuto: /any auto/i.test(text),
        ownedOnly: /owned autos?/i.test(withoutNonOwned),
        scheduled: /scheduled/i.test(text),
        hiredOnly: /hired/i.test(text),
        nonOwnedOnly: /non-?owned/i.test(text),
      };
    }
    case "umbrella": {
      const claimsMade =
        /claims-?made/i.test(text) ||
        set.endorsements.some((e) => /claims-?made/i.test(e.title));
      return {
        umbrella: /umbrella/i.test(text),
        excess: /excess/i.test(text),
        occur: !claimsMade,
        claimsMade,
      };
    }
    case "wc":
      return { perStatute: true };
    case "garageLiability": {
      const withoutNonOwned = text.replace(/non-?owned/gi, "");
      return {
        anyAuto: /any auto/i.test(text),
        ownedOnly: /owned autos?/i.test(withoutNonOwned),
        hiredOnly: /hired/i.test(text),
        nonOwnedGarage: /non-?owned/i.test(text),
      };
    }
    case "garageKeepers": {
      const carries = (slot: LimitSlot) =>
        set.limits.some((l) => l.slot === slot);
      return {
        legalLiability: /legal liability/i.test(text),
        directBasis: /direct basis/i.test(text),
        primary: /direct basis/i.test(text) && /primary/i.test(text),
        excess: /direct basis/i.test(text) && /excess/i.test(text),
        compOtcPeril: carries("gk_comp_otc"),
        specifiedPerilsPeril: carries("gk_specified_perils"),
        collisionPeril: carries("gk_collision"),
      };
    }
    default:
      return {};
  }
}

/** Every checkbox key printed by a section descriptor (form structure). */
function checkKeys(def: SectionDef): string[] {
  const keys: string[] = [];
  for (const line of def.typeCell) {
    if (line.kind === "checks") for (const it of line.items) keys.push(it.key);
  }
  for (const h of def.limitsHead ?? []) keys.push(h.key);
  for (const b of def.limitBoxes) if (b.check) keys.push(b.check.key);
  return keys;
}

/** Expected feeder: the resolver's selection rule, re-run over raw sets. */
function expectedFeederId(
  def: SectionDef,
  policies: Policy[],
  rawSets: Map<string, PolicyFormSet>,
): string | null {
  for (const p of policies) {
    const set = rawSets.get(p.id)!;
    if (
      set.limits.some((l) => def.slots.includes(l.slot)) ||
      def.match.test(coverageTextRaw(set))
    ) {
      return p.id;
    }
  }
  return null;
}

/** ISO → MM/DD/YYYY, matching the overflow-line convention. */
function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/** Overflow column slot sets — broker doctrine, restated here on purpose. */
const EACH_SLOTS = new Set<LimitSlot>([
  "gl_each_occurrence",
  "auto_combined_single",
  "umb_each_occurrence",
  "wc_el_each_accident",
  "prof_each_claim",
  "liquor_each_common_cause",
  "gar_auto_only_each_accident",
]);
const AGG_SLOTS = new Set<LimitSlot>([
  "gl_general_aggregate",
  "umb_aggregate",
  "prof_aggregate",
  "cyber_aggregate",
  "gar_other_than_auto_aggregate",
]);

/**
 * Expected description grants, rebuilt from raw endorsement rows.
 *
 * A grant endorsement with its form + edition on record backs one exact
 * sentence ("… per CG 20 10 04 13."). A grant listed BY TITLE ONLY (blank
 * form/edition — real ISC decs schedule "Additional Insured" with no form
 * code) still backs the grant wording, but backs NO citation: a sentence
 * ending in a dangling "per  ." cites a form the schedule cannot name and
 * audits as a Wrong Value, never as a match. The audit must not rebuild the
 * resolver's template over blank fields — that would let the bug vouch for
 * itself.
 */
interface DescExpectation {
  kind: "ai" | "wos" | "pnc";
  /** Form + edition are on record — the exact sentence is expected. */
  cited: boolean;
  sentence: string | null;
  grantRe: RegExp;
  source: string;
}

const GRANT_RES: Record<DescExpectation["kind"], RegExp> = {
  ai: /additional insured/i,
  wos: /waiver of subrogation/i,
  pnc: /primary and non-?contributory/i,
};

function expectedDescriptionGrants(
  policies: Policy[],
  rawSets: Map<string, PolicyFormSet>,
): DescExpectation[] {
  const seen = new Set<string>();
  const out: DescExpectation[] = [];
  const add = (exp: DescExpectation) => {
    const key = exp.sentence ?? `uncited:${exp.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(exp);
  };
  const sentenceFor = (kind: DescExpectation["kind"], form: string, edition: string) =>
    kind === "ai"
      ? `${HOLDER_NAME} is included as additional insured per ${form} ${edition}.`
      : kind === "wos"
        ? `Waiver of subrogation applies per ${form} ${edition}.`
        : `Coverage is primary and non-contributory per ${form} ${edition}.`;
  for (const p of policies) {
    const set = rawSets.get(p.id)!;
    for (const kind of ["ai", "wos", "pnc"] as const) {
      const e = set.endorsements.find((x) => x.kind === kind);
      if (!e) continue;
      const cited = Boolean(e.form.trim() && e.edition.trim());
      add({
        kind,
        cited,
        sentence: cited ? sentenceFor(kind, e.form, e.edition) : null,
        grantRe: GRANT_RES[kind],
        source: cited
          ? `policy_endorsements[${p.id}] kind=${kind} (${e.form} ${e.edition})`
          : `policy_endorsements[${p.id}] kind=${kind} — title only, form/edition BLANK on record`,
      });
    }
  }
  return out;
}

/** A grant sentence whose citation trails off ("… per  ." / "… per .") */
function malformedCite(sentence: string): boolean {
  return /\bper\s*\.$/.test(sentence) || /\s\.$/.test(sentence);
}

/* ————————————————— Static / producer verification (once) ————————————————— */

interface StaticCheck {
  field: string;
  expected: string;
  ok: boolean;
}

const STUDIO_SRC = fs.readFileSync(
  path.join(ROOT, "src", "app", "accounts", "[id]", "CertificateStudio.tsx"),
  "utf8",
);

/**
 * Insured-address auto-fill wiring, verified against the studio source: each
 * INSURED box cell must default to its account-record field. A missing marker
 * means the auto-fill regressed and the cell audits as a Missed Fill on every
 * account that carries the value.
 */
const INSURED_ADDR_WIRING: Record<string, boolean> = {
  "insured.addr1": STUDIO_SRC.includes('def={acct.addressLine1 ?? ""}'),
  "insured.city": STUDIO_SRC.includes('def={acct.city ?? ""}'),
  "insured.state": STUDIO_SRC.includes("def={acct.state}"),
  "insured.zip": STUDIO_SRC.includes('def={acct.zip ?? ""}'),
};

function verifyStatics(): StaticCheck[] {
  const src = STUDIO_SRC;
  const wired = (marker: string) => src.includes(marker);
  const checks: StaticCheck[] = [
    { field: "producer.name", expected: PRODUCER.name, ok: wired("def={PRODUCER.name}") },
    { field: "producer.addr1", expected: PRODUCER.addressLine1, ok: wired("def={PRODUCER.addressLine1}") },
    { field: "producer.addr2", expected: PRODUCER.addressLine2, ok: wired("def={PRODUCER.addressLine2}") },
    { field: "producer.city", expected: PRODUCER.city, ok: wired("def={PRODUCER.city}") },
    { field: "producer.state", expected: PRODUCER.state, ok: wired("def={PRODUCER.state}") },
    { field: "producer.zip", expected: PRODUCER.zip, ok: wired("def={PRODUCER.zip}") },
    { field: "producer.contact", expected: PRODUCER.contactName, ok: wired("def={PRODUCER.contactName}") },
    { field: "producer.phone", expected: PRODUCER.phone, ok: wired("def={PRODUCER.phone}") },
    { field: "producer.email", expected: PRODUCER.email, ok: wired("def={PRODUCER.email}") },
    {
      field: "signature",
      expected: AUTHORIZED_REPRESENTATIVE,
      ok: wired("{AUTHORIZED_REPRESENTATIVE}"),
    },
    {
      field: "date",
      expected: "render-time (new Date at render)",
      ok: /new Date\(\)\.toLocaleDateString/.test(src),
    },
    {
      // One-door renderer: every non-issued rendering must carry the
      // Specimen watermark inside the sheet itself.
      field: "specimen.watermark",
      expected: "single renderer, specimen mode watermarked",
      ok:
        wired('data-render-mode={specimen ? "specimen" : "issued"}') &&
        wired("cert-watermark") &&
        wired("Specimen — Not Issued"),
    },
  ];
  return checks;
}

/* ————————————————— Per-sheet audit ————————————————— */

function auditSheet(input: {
  sheetId: string;
  form: CertFormKey;
  account: Account;
  policies: Policy[];
  rawSets: Map<string, PolicyFormSet>;
  packet: CertificatePacket;
  sheet: Acord25Sheet;
  staticChecks: StaticCheck[];
}) {
  const { sheetId, form, policies, rawSets, packet, sheet } = input;
  const base = (section: string, field: string, source: string) => ({
    sheetId,
    section,
    field,
    source,
  });

  // ——— Insured name (one box, fed by the first policy's paper) ———
  const firstPolicy = policies[0];
  const expectedInsured =
    firstPolicy?.quoteInsuredName ?? input.account.name;
  const gotInsured =
    packet.sections[0]?.draft.insuredName ?? packet.account.name;
  textCell(
    {
      ...base(
        "Header",
        "insured.name",
        `policies[${firstPolicy?.id}].quote_insured_name ?? accounts.name`,
      ),
    },
    expectedInsured,
    gotInsured,
  );

  // ——— Insured address (auto-fill from the account record) ———
  // The studio defaults the INSURED box address cells straight off the
  // account row; the wiring is verified against CertificateStudio.tsx source
  // (INSURED_ADDR_WIRING). An account row with no street line yields honest
  // blanks — the record is the schedule of record for the insured address.
  const acct = input.account;
  const addrCells: [string, string, string][] = [
    ["insured.addr1", acct.addressLine1 ?? "", "accounts.address1"],
    ["insured.city", acct.city ?? "", "accounts.city"],
    ["insured.state", acct.state, "accounts.state"],
    ["insured.zip", acct.zip ?? "", "accounts.zip"],
  ];
  for (const [field, expected, source] of addrCells) {
    const wired = INSURED_ADDR_WIRING[field];
    textCell(
      { ...base("Header", field, `${source} (studio default, wiring-verified)`) },
      expected,
      wired ? expected : "",
    );
  }

  // ——— Holder (pass-through data) ———
  textCell(
    { ...base("Holder", "holder.name", "operator input (verbatim carry)") },
    HOLDER_NAME,
    packet.holderName,
  );
  textCell(
    { ...base("Holder", "holder.address", "operator input (verbatim carry)") },
    HOLDER_ADDRESS,
    packet.holderAddress,
  );

  // ——— Insurer block: letters, legal names, NAIC ———
  // Letter doctrine: letters are shared per WRITING PAPER, not per brand.
  // The paper key is the verified issuing company (dec-page writer wins over
  // brand rules — `issuingCarrier` feeds `naicForPolicy`), else the brand.
  // Two ISC policies on different writers are different insurers.
  const expectedLetters = new Map<string, string>(); // paper key → letter
  const paperOf = (p: Policy) =>
    naicForPolicy(p.carrier, p.coverages, p.issuingCarrier)?.issuingCompany ??
    p.carrier;
  for (const p of policies) {
    const key = paperOf(p);
    if (!expectedLetters.has(key)) {
      expectedLetters.set(key, "ABCDEF"[expectedLetters.size] ?? "");
    }
  }
  for (const [paper, letter] of expectedLetters) {
    const anchor = policies.find((p) => paperOf(p) === paper)!;
    const identity = naicForPolicy(
      anchor.carrier,
      anchor.coverages,
      anchor.issuingCarrier,
    );
    const gotIdx = [...expectedLetters.keys()].indexOf(paper);
    const got = packet.insurers[gotIdx];
    const src = identity
      ? anchor.issuingCarrier
        ? "naic.ts registry via policies.issuing_carrier (dec-page writer)"
        : "naic.ts registry (verified issuing company)"
      : "policy record brand (no verified NAIC identity)";
    textCell(
      {
        ...base(
          "Insurers",
          `insurer.${letter || "∅"}.letter (${paper})`,
          "first-appearance order over papers (carrier, id)",
        ),
      },
      letter,
      got?.letter ?? "",
    );
    textCell(
      { ...base("Insurers", `insurer.${letter || "∅"}.name (${paper})`, src) },
      identity?.issuingCompany ?? anchor.carrier,
      got?.issuingCompany ?? got?.carrier ?? "",
    );
    textCell(
      {
        ...base(
          "Insurers",
          `insurer.${letter || "∅"}.naic (${paper})`,
          identity
            ? "naic.ts registry (verified)"
            : "unverified brand — NAIC must stay blank",
        ),
      },
      identity?.naic ?? "",
      got?.naic ?? "",
    );
  }

  // ——— Fixed coverage sections ———
  for (const def of CERT_FORMS[form].sections) {
    const rs = sheet.sections.find((s) => s.def.key === def.key)!;
    const secName = def.name;
    const expFeederId = expectedFeederId(def, policies, rawSets);
    const expFeeder = expFeederId
      ? policies.find((p) => p.id === expFeederId)!
      : null;
    const expSet = expFeederId ? rawSets.get(expFeederId)! : null;
    const rawLimitRows = expFeederId
      ? partsFor.all(expFeederId).length > 0
        ? (limitsFor.all(expFeederId) as RawLimitRow[])
        : expSet!.limits.map((l) => ({
            slot: l.slot,
            mode: limitMode(l),
            amount_cents: l.amountCents ?? null,
            loc: l.loc ?? null,
          }))
      : [];

    // Identity cells.
    const expLetter = expFeeder ? (expectedLetters.get(paperOf(expFeeder)) ?? "") : "";
    textCell(
      { ...base(secName, `${def.key}.insurerLetter`, "insurer letter map") },
      expLetter,
      rs.ref?.insurerLetter ?? "",
    );
    textCell(
      {
        ...base(secName, `${def.key}.policyNumber`, `policies[${expFeederId ?? "—"}].policy_number`),
      },
      expFeeder?.policyNumber ?? "",
      rs.ref?.policyNumber ?? "",
    );
    textCell(
      { ...base(secName, `${def.key}.effectiveDate`, `policies[${expFeederId ?? "—"}].effective_date`) },
      expFeeder?.effectiveDate ?? "",
      rs.ref?.effectiveDate ?? "",
    );
    textCell(
      { ...base(secName, `${def.key}.expirationDate`, `policies[${expFeederId ?? "—"}].expiration_date`) },
      expFeeder?.expirationDate ?? "",
      rs.ref?.expirationDate ?? "",
    );
    boolCell(
      {
        ...base(secName, `${def.key}.addlInsd`, `policy_endorsements[${expFeederId ?? "—"}] kind=ai`),
      },
      Boolean(expSet?.endorsements.some((e) => e.kind === "ai")),
      Boolean(rs.ref?.additionalInsured),
    );
    boolCell(
      {
        ...base(secName, `${def.key}.subrWvd`, `policy_endorsements[${expFeederId ?? "—"}] kind=wos`),
      },
      Boolean(expSet?.endorsements.some((e) => e.kind === "wos")),
      Boolean(rs.ref?.subrogationWaived),
    );

    // Carrier-knowledge gate: a printed ADDL INSD box on a line an
    // enforceable registry entry forbids (ISC excess takes no Additional
    // Insured) is stronger than the paper — it must carry a visible packet
    // reject naming the entry, or it is a critical wrong value.
    if (expFeeder && rs.ref?.additionalInsured) {
      const hits = evaluateKnowledgeForCertSection({
        policy: { carrier: expFeeder.carrier, coverages: expFeeder.coverages },
        flags: { additionalInsured: true },
        account: { state: input.account.state, industry: input.account.industry },
      });
      for (const hit of hits) {
        const rejected = packet.rejects.some(
          (r) => r.finding.id === `carrier-knowledge-${hit.entry.id}`,
        );
        push({
          ...base(
            secName,
            `${def.key}.addlInsd.knowledge.${hit.entry.id}`,
            `carrier-knowledge.ts [${hit.entry.id}]`,
          ),
          cls: rejected ? "filled_correct" : "wrong_value",
          expected: "visible packet reject blocking the forbidden provision",
          got: rejected
            ? "packet reject present (issuance blocked)"
            : "[no reject — forbidden AI would ride out]",
        });
      }
    }

    // Checkboxes — every box the blank form prints.
    const expChecks = expSet ? expectedChecks(def.key, expSet) : {};
    for (const key of checkKeys(def)) {
      boolCell(
        {
          ...base(
            secName,
            `${def.key}.check.${key}`,
            expSet
              ? "coverage-part labels / endorsement titles (doctrine)"
              : "no backing policy — box stays blank",
          ),
        },
        Boolean(expChecks[key]),
        Boolean(rs.checks[key]),
      );
    }

    // Limit boxes.
    for (const box of def.limitBoxes) {
      const fieldId = `${def.key}.limit.${box.key || "[spare]"}`;
      const got = rs.limits[box.key];
      if (!box.slot || !expFeeder) {
        // No data source, or no backing policy: must print blank.
        const src = !box.slot
          ? "no schedule slot exists for this box"
          : "no backing policy — section prints blank";
        if (got == null) {
          push({ ...base(secName, fieldId, src), cls: "correctly_blank", expected: "[blank]", got: "[blank]" });
        } else {
          push({
            ...base(secName, fieldId, src),
            cls: "wrong_value",
            expected: "[blank]",
            got: fmtResolved(got),
          });
        }
        continue;
      }
      const raw = rawLimitRows.find((l) => l.slot === box.slot);
      const src = `policy_limits[${expFeederId}].${box.slot}`;
      if (raw) {
        if (sameResolved(raw, got)) {
          push({ ...base(secName, fieldId, src), cls: "filled_correct", expected: fmtRaw(raw), got: fmtResolved(got) });
        } else if (got == null) {
          push({ ...base(secName, fieldId, src), cls: "missed_fill", expected: fmtRaw(raw), got: "[blank]" });
        } else {
          push({ ...base(secName, fieldId, src), cls: "wrong_value", expected: fmtRaw(raw), got: fmtResolved(got) });
        }
      } else {
        // Dec is silent on this line inside a backed section: the platform
        // prints the dec statement "Excluded" — claims nothing (blank-equivalent).
        if (got == null || got.kind === "excluded") {
          if (got?.kind === "excluded") silentExcludedPrints++;
          push({
            ...base(secName, fieldId, `${src} (dec silent)`),
            cls: "correctly_blank",
            expected: "[silent — Excluded/blank]",
            got: fmtResolved(got),
          });
        } else {
          push({
            ...base(secName, fieldId, `${src} (dec silent)`),
            cls: "wrong_value",
            expected: "[silent — Excluded/blank]",
            got: fmtResolved(got),
          });
        }
      }

      // LOC write-in (garagekeepers per-location limits).
      if (box.withLoc) {
        textCell(
          { ...base(secName, `${def.key}.loc.${box.key || "[spare]"}`, `policy_limits[${expFeederId}].${box.slot ?? "—"}.loc`) },
          raw?.loc ?? "",
          rs.locs[box.key] ?? "",
        );
      }
    }
  }

  // ——— The printed additional row ———
  const other = sheet.others[0];
  if (other?.feeder) {
    const p = other.feeder.policy;
    const rawSet = rawSets.get(p.id)!;
    const rawRows: RawLimitRow[] =
      partsFor.all(p.id).length > 0
        ? (limitsFor.all(p.id) as RawLimitRow[])
        : rawSet.limits.map((l) => ({
            slot: l.slot,
            mode: limitMode(l),
            amount_cents: l.amountCents ?? null,
            loc: l.loc ?? null,
          }));
    textCell(
      { ...base("Additional Row", "other.insurerLetter", "insurer letter map") },
      expectedLetters.get(paperOf(p)) ?? "",
      other.ref?.insurerLetter ?? "",
    );
    textCell(
      { ...base("Additional Row", "other.policyNumber", `policies[${p.id}].policy_number`) },
      p.policyNumber,
      other.ref?.policyNumber ?? "",
    );
    textCell(
      { ...base("Additional Row", "other.effectiveDate", `policies[${p.id}].effective_date`) },
      p.effectiveDate,
      other.ref?.effectiveDate ?? "",
    );
    textCell(
      { ...base("Additional Row", "other.expirationDate", `policies[${p.id}].expiration_date`) },
      p.expirationDate,
      other.ref?.expirationDate ?? "",
    );

    // Label must trace to the coverage parts (or the doctrine fallbacks).
    const fallbacks = ["Professional Liability", "Cyber Liability", "Liquor Liability"];
    const rawLabels = rawSet.coverages.map((c) => c.label);
    const labelTraces =
      other.label.length > 0 &&
      (other.label.split(" · ").every((seg) => rawLabels.includes(seg)) ||
        fallbacks.includes(other.label) ||
        other.label === p.coverages.join(", "));
    push({
      ...base("Additional Row", "other.label", `policy_coverage_parts[${p.id}].label`),
      cls: labelTraces ? "filled_correct" : "wrong_value",
      expected: rawLabels.join(" · ") || p.coverages.join(", "),
      got: other.label || "[blank]",
    });

    for (const line of other.lines) {
      const raw = rawRows.find((l) => l.slot === line.slot);
      const src = `policy_limits[${p.id}].${line.slot}`;
      if (!raw) {
        push({
          ...base("Additional Row", `other.${line.slot}`, src),
          cls: "wrong_value",
          expected: "[no schedule row]",
          got: fmtResolved(line.value),
        });
      } else if (sameResolved(raw, line.value)) {
        push({
          ...base("Additional Row", `other.${line.slot}`, src),
          cls: "filled_correct",
          expected: fmtRaw(raw),
          got: fmtResolved(line.value),
        });
      } else {
        push({
          ...base("Additional Row", `other.${line.slot}`, src),
          cls: "wrong_value",
          expected: fmtRaw(raw),
          got: fmtResolved(line.value),
        });
      }
    }
  } else {
    push({
      ...base("Additional Row", "other.row", "no leftover coverage — row prints blank"),
      cls: "correctly_blank",
      expected: "[blank]",
      got: "[blank]",
    });
  }

  // ——— Description Of Operations overflow lines ———
  for (const [i, line] of sheet.overflow.entries()) {
    const p = policies.find((x) => x.policyNumber === line.policyNumber);
    const sec = "Description Overflow";
    if (!p) {
      push({
        ...base(sec, `overflow[${i}].policyNumber`, "policies table"),
        cls: "wrong_value",
        expected: "[a policy on this account]",
        got: line.policyNumber,
      });
      continue;
    }
    push({
      ...base(sec, `overflow[${i}].policyNumber`, `policies[${p.id}].policy_number`),
      cls: "filled_correct",
      expected: p.policyNumber,
      got: line.policyNumber,
    });
    textCell(
      { ...base(sec, `overflow[${i}].effectiveDate`, `policies[${p.id}].effective_date`) },
      p.effectiveDate,
      line.effectiveDate,
    );
    textCell(
      { ...base(sec, `overflow[${i}].expirationDate`, `policies[${p.id}].expiration_date`) },
      p.expirationDate,
      line.expirationDate,
    );

    const rawSet = rawSets.get(p.id)!;
    const rawLabels = rawSet.coverages.map((c) => c.label);
    const fallbacks = ["Professional Liability", "Cyber Liability", "Liquor Liability"];
    const covTraces =
      line.coverage.length > 0 &&
      (line.coverage.split(" · ").every((seg) => rawLabels.includes(seg)) ||
        fallbacks.includes(line.coverage) ||
        line.coverage === p.coverages.join(", "));
    push({
      ...base(sec, `overflow[${i}].coverage`, `policy_coverage_parts[${p.id}].label`),
      cls: covTraces ? "filled_correct" : "wrong_value",
      expected: rawLabels.join(" · "),
      got: line.coverage,
    });

    const rawRows: RawLimitRow[] =
      partsFor.all(p.id).length > 0
        ? (limitsFor.all(p.id) as RawLimitRow[])
        : rawSet.limits.map((l) => ({
            slot: l.slot,
            mode: limitMode(l),
            amount_cents: l.amountCents ?? null,
            loc: l.loc ?? null,
          }));
    const lineSlots = line.row.lines.map((l) => l.slot);
    const columnAudit = (
      col: "eachOccurrence" | "aggregate",
      colSlots: Set<LimitSlot>,
      got: string,
    ) => {
      const slotInLine = lineSlots.find((s) => colSlots.has(s));
      const raw = slotInLine ? rawRows.find((l) => l.slot === slotInLine) : undefined;
      const src = slotInLine
        ? `policy_limits[${p.id}].${slotInLine}`
        : "no scheduled line in this column";
      if (!raw) {
        push({
          ...base(sec, `overflow[${i}].${col}`, src),
          cls: got === "—" ? "correctly_blank" : "wrong_value",
          expected: "—",
          got,
        });
      } else {
        const expected = fmtRaw(raw);
        push({
          ...base(sec, `overflow[${i}].${col}`, src),
          cls: got === expected ? "filled_correct" : got === "—" ? "missed_fill" : "wrong_value",
          expected,
          got,
        });
      }
    };
    // The line takes the FIRST slot per column; extras carry the rest.
    columnAudit("eachOccurrence", EACH_SLOTS, line.eachOccurrence);
    columnAudit("aggregate", AGG_SLOTS, line.aggregate);

    for (const [j, extra] of line.extras.entries()) {
      const backed = rawRows.some((raw) => extra.endsWith(fmtRaw(raw)));
      push({
        ...base(sec, `overflow[${i}].extra[${j}]`, `policy_limits[${p.id}] (stated line)`),
        cls: backed ? "filled_correct" : "wrong_value",
        expected: "[a stated schedule line]",
        got: extra,
      });
    }

    // Format + presence in the rendered description box.
    const desc = certDescription(packet, sheet);
    const formatOk = /^[A-Z0-9-]+, \d{2}\/\d{2}\/\d{4}, \d{2}\/\d{2}\/\d{4}, .+/.test(line.text);
    const dateOk =
      line.text.includes(usDate(p.effectiveDate)) &&
      line.text.includes(usDate(p.expirationDate));
    push({
      ...base(sec, `overflow[${i}].text`, "deterministic CSV convention"),
      cls: formatOk && dateOk && desc.includes(line.text) ? "filled_correct" : "wrong_value",
      expected: "CSV line, US dates, present in description box",
      got: line.text,
    });
  }

  // ——— Completeness: every scheduled limit row surfaces somewhere ———
  for (const p of policies) {
    const rawSet = rawSets.get(p.id)!;
    for (const l of rawSet.limits) {
      const inSection = sheet.sections.some(
        (rs) =>
          rs.feeder?.policy.id === p.id &&
          rs.def.limitBoxes.some((b) => b.slot === l.slot && rs.limits[b.key] != null),
      );
      const inOther = sheet.others.some(
        (r) => r.feeder?.policy.id === p.id && r.lines.some((ln) => ln.slot === l.slot),
      );
      const inOverflow = sheet.overflow.some(
        (o) => o.row.feeder?.policy.id === p.id && o.row.lines.some((ln) => ln.slot === l.slot),
      );
      if (!inSection && !inOther && !inOverflow) {
        push({
          sheetId,
          section: "Completeness",
          field: `dropped.${p.id}.${l.slot}`,
          source: `policy_limits[${p.id}].${l.slot}`,
          cls: "missed_fill",
          expected: limitMode(l) === "amount" ? money(l.amountCents ?? 0) : limitMode(l),
          got: "[nowhere on the sheet]",
        });
      }
    }
  }

  // ——— Description sentences (endorsement wording + citation integrity) ———
  const expectations = expectedDescriptionGrants(policies, rawSets);
  const gotSentences = packet.description
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const accounted = new Set<string>();
  for (const exp of expectations) {
    if (exp.cited) {
      const present = gotSentences.includes(exp.sentence!);
      if (present) accounted.add(exp.sentence!);
      push({
        ...base("Description", `desc.expect.${exp.kind}`, exp.source),
        cls: present ? "filled_correct" : "missed_fill",
        expected: exp.sentence!,
        got: present ? exp.sentence! : "[absent]",
      });
      continue;
    }
    // Title-only grant: the wording must surface, but no citation is backed.
    const hit = gotSentences.find((s) => exp.grantRe.test(s));
    if (!hit) {
      push({
        ...base("Description", `desc.grant.${exp.kind}`, exp.source),
        cls: "missed_fill",
        expected: `[${exp.kind} grant sentence — endorsement is on the schedule]`,
        got: "[absent]",
      });
      continue;
    }
    accounted.add(hit);
    push({
      ...base("Description", `desc.grant.${exp.kind}`, exp.source),
      cls: "filled_correct",
      expected: `[${exp.kind} grant sentence]`,
      got: hit,
    });
    if (malformedCite(hit)) {
      push({
        ...base("Description", `desc.citation.${exp.kind}`, exp.source),
        cls: "wrong_value",
        expected:
          "[grant wording citing a real form, or no citation — the schedule names no form]",
        got: hit,
      });
    } else {
      // The sentence cites a concrete form — it must trace to SOME scheduled
      // endorsement on this account, else the cite is invented.
      const citesScheduledForm = policies.some((p) =>
        rawSets
          .get(p.id)!
          .endorsements.some((e) => e.form.trim() && hit.includes(e.form)),
      );
      push({
        ...base("Description", `desc.citation.${exp.kind}`, exp.source),
        cls: citesScheduledForm ? "filled_correct" : "wrong_value",
        expected: "[citation traceable to the schedule of record]",
        got: hit,
      });
    }
  }
  for (const got of gotSentences) {
    if (!accounted.has(got)) {
      push({
        ...base("Description", `desc.unbacked`, "no schedule row backs this sentence"),
        cls: "wrong_value",
        expected: "[only schedule-backed wording]",
        got,
      });
    }
  }

  // ——— Static / producer block (verified against brand.ts once) ———
  for (const s of input.staticChecks) {
    push({
      ...base("Producer / Static", s.field, "brand.ts"),
      cls: s.ok ? "static_producer" : "wrong_value",
      expected: s.expected,
      got: s.ok ? s.expected : "[not wired to brand.ts]",
    });
  }
}

/* ————————————————— Drift check: FORM_SETS (code) vs SQLite ————————————————— */

function checkDrift(): string[] {
  const notes: string[] = [];
  for (const [policyId, set] of Object.entries(FORM_SETS)) {
    const exists = db.prepare(`SELECT id FROM policies WHERE id = ?`).get(policyId);
    if (!exists) {
      notes.push(`\`${policyId}\` is in FORM_SETS but not in the policies table.`);
      continue;
    }
    const dbLimits = limitsFor.all(policyId) as RawLimitRow[];
    const codeLimits = set.limits;
    const key = (slot: string, mode: string, cents: number | null, loc: string | null) =>
      `${slot}|${mode}|${cents ?? "∅"}|${loc ?? "∅"}`;
    const dbSet = new Set(dbLimits.map((l) => key(l.slot, l.mode, l.amount_cents, l.loc)));
    const codeSet = new Set(
      codeLimits.map((l) => key(l.slot, limitMode(l), l.amountCents ?? null, l.loc ?? null)),
    );
    for (const k of codeSet) if (!dbSet.has(k)) notes.push(`\`${policyId}\`: limit \`${k}\` in code, not in SQLite.`);
    for (const k of dbSet) if (!codeSet.has(k)) notes.push(`\`${policyId}\`: limit \`${k}\` in SQLite, not in code.`);

    const dbEndts = endtsFor.all(policyId) as RawEndtRow[];
    const ek = (f: string, ed: string, kind: string) => `${f}|${ed}|${kind}`;
    const dbE = new Set(dbEndts.map((e) => ek(e.form, e.edition, e.kind)));
    const codeE = new Set(set.endorsements.map((e) => ek(e.form, e.edition, e.kind)));
    for (const k of codeE) if (!dbE.has(k)) notes.push(`\`${policyId}\`: endorsement \`${k}\` in code, not in SQLite.`);
    for (const k of dbE) if (!codeE.has(k)) notes.push(`\`${policyId}\`: endorsement \`${k}\` in SQLite, not in code.`);
  }
  return notes;
}

/* ————————————————— Enforcement controls (synthetic probes) ————————————————— */

interface ControlCheck {
  label: string;
  pass: boolean;
  detail: string;
}

/**
 * Negative controls: the data on the desk currently has no ISC excess line,
 * so the carrier-knowledge gate never fires in the account audits above.
 * These synthetic probes prove the detectors are live — an audit that can
 * only pass is not an audit.
 */
function runControls(): ControlCheck[] {
  const out: ControlCheck[] = [];
  const probeAccount: Account = {
    id: "probe-acct",
    name: "Probe Account LLC",
    dba: null,
    industry: "General Contracting",
    addressLine1: "1 Probe Way",
    city: "Denver",
    state: "TX",
    zip: "75001",
    primaryUwId: "uw-probe",
    backupUwId: null,
    notes: null,
    status: "active",
    paymentReceivedAt: null,
  };
  const probePolicy: Policy = {
    id: "probe-isc-excess",
    accountId: "probe-acct",
    policyNumber: "ISC-XS-000001",
    carrier: "ISC",
    coverages: ["EXCESS_UMB"],
    effectiveDate: "2026-01-01",
    expirationDate: "2027-01-01",
    premiumCents: 0,
    quoteInsuredName: null,
    quoteCarrier: null,
    issuingCarrier: "Sutton National Insurance Company",
  };
  const probeSet: PolicyFormSet = {
    coverages: [
      {
        code: "EXCESS_UMB",
        label: "Excess Liability",
        form: "XS 00 01",
        edition: "01 26",
      },
    ],
    limits: [{ slot: "umb_each_occurrence", amountCents: 100_000_000 }],
    endorsements: [
      {
        form: "CG 20 10",
        edition: "04 13",
        title: "Additional Insured — Probe (should be forbidden)",
        kind: "ai",
      },
    ],
  };

  // 1. Registry gate, direct: ISC + excess + AI claim → exactly the entry.
  const directHits = evaluateKnowledgeForCertSection({
    policy: { carrier: "ISC", coverages: ["EXCESS_UMB"] },
    flags: { additionalInsured: true },
    account: { state: "TX", industry: "General Contracting" },
  });
  out.push({
    label: "Registry Gate Fires On ISC Excess + Additional Insured",
    pass:
      directHits.length === 1 &&
      directHits[0].entry.id === "isc-excess-no-additional-insured",
    detail: directHits.map((h) => h.entry.id).join(", ") || "[no hit]",
  });

  // 2. Same claim on Kinsale excess paper must NOT fire (the restriction is
  //    ISC's, not a blanket excess rule).
  const kinsaleHits = evaluateKnowledgeForCertSection({
    policy: { carrier: "Kinsale", coverages: ["EXCESS_UMB"] },
    flags: { additionalInsured: true },
    account: { state: "TX", industry: "General Contracting" },
  });
  out.push({
    label: "Registry Gate Silent On Kinsale Excess + Additional Insured",
    pass: kinsaleHits.length === 0,
    detail: kinsaleHits.map((h) => h.entry.id).join(", ") || "[no hit — correct]",
  });

  // 3. Packet gate: a packet built over an ISC excess schedule that carries
  //    an AI endorsement must reject with the entry id and refuse to issue.
  const probePacket = buildCertificatePacket({
    account: probeAccount,
    policies: [probePolicy],
    formSets: { [probePolicy.id]: probeSet },
    holderName: HOLDER_NAME,
    holderAddress: HOLDER_ADDRESS,
  });
  const packetRejected = probePacket.rejects.some(
    (r) => r.finding.id === "carrier-knowledge-isc-excess-no-additional-insured",
  );
  out.push({
    label: "Packet Rejects Forbidden AI On ISC Excess (And Blocks Issue)",
    pass: packetRejected && !probePacket.okToIssue,
    detail: `rejects=[${probePacket.rejects.map((r) => r.finding.id).join(", ")}] okToIssue=${probePacket.okToIssue}`,
  });

  // 4. Presend registry (cert-checks.ts): the same claim through the
  //    canonical check registry must fail Carrier Knowledge Restrictions,
  //    and the check must be structurally non-overridable.
  const ctx: CertCheckContext = {
    account: probeAccount,
    policies: [probePolicy],
    holderName: HOLDER_NAME,
    holderAddress: HOLDER_ADDRESS,
    now: SNAPSHOT_AT,
    verifierRejects: [],
    redAlertActive: false,
    endorsementClaims: [
      { policy: probePolicy, set: probeSet, flag: "additionalInsured" },
    ],
    formKey: "acord25",
    formSets: { [probePolicy.id]: probeSet },
    holderAiRecords: [],
    requirementHolderName: null,
    scheduleSources: [],
    prepared: null,
    currentDigest: "probe",
  };
  const results = runCertChecks({
    ctx,
    // An override attempt on the check must NOT clear it.
    overrides: [
      { checkId: "carrier-knowledge-restrictions", reason: "probe override" },
    ],
    operator: "audit-probe",
  });
  const kc = results.find((r) => r.id === "carrier-knowledge-restrictions");
  const blocked = blockingFailures(results).some(
    (r) => r.id === "carrier-knowledge-restrictions",
  );
  out.push({
    label: "Presend Registry Fails Carrier Knowledge — Override Refused",
    pass: Boolean(kc && kc.status === "fail" && !kc.overridable && blocked),
    detail: kc
      ? `status=${kc.status} overridable=${kc.overridable}`
      : "[check missing from registry]",
  });

  // 5. Wrong-value detector liveness: a deliberately tampered limit must
  //    classify as wrong_value by the same comparator the audit uses.
  const tampered: RawLimitRow = {
    slot: "gl_each_occurrence",
    mode: "amount",
    amount_cents: 100_000_000,
    loc: null,
  };
  out.push({
    label: "Wrong-Value Detector Flags A Tampered Limit",
    pass: !sameResolved(tampered, { kind: "amount", cents: 200_000_000 }),
    detail: "schedule $1,000,000 vs sheet $2,000,000 → mismatch detected",
  });

  return out;
}

/* ————————————————— SQLite spot checks (literal SQL, printed) ————————————————— */

interface SpotCheck {
  label: string;
  sql: string;
  sqlValue: string;
  sheetValue: string;
  ok: boolean;
}

function runSpotChecks(
  sheets: Map<string, { packet: CertificatePacket; sheet: Acord25Sheet }>,
): SpotCheck[] {
  const out: SpotCheck[] = [];
  const q = (sql: string) => db.prepare(sql).get() as Record<string, unknown> | undefined;

  const spot = (
    label: string,
    sql: string,
    sqlValue: string,
    sheetValue: string,
  ) => out.push({ label, sql, sqlValue, sheetValue, ok: sqlValue === sheetValue });

  const rl = sheets.get("acct-ridgeline");
  if (rl) {
    const row = q(
      `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-ridgeline-gl' AND slot='gl_each_occurrence'`,
    );
    const gl = rl.sheet.sections.find((s) => s.def.key === "gl");
    spot(
      "Ridgeline GL Each Occurrence",
      "SELECT amount_cents FROM policy_limits WHERE policy_id='pol-ridgeline-gl' AND slot='gl_each_occurrence'",
      row ? money(Number(row.amount_cents)) : "[no row]",
      fmtResolved(gl?.limits["eachOccurrence"]),
    );
  }
  const gf = sheets.get("acct-greenleaf");
  if (gf) {
    const row = q(
      `SELECT mode FROM policy_limits WHERE policy_id='pol-greenleaf-bop' AND slot='gl_personal_adv'`,
    );
    const gl = gf.sheet.sections.find((s) => s.def.key === "gl");
    spot(
      "Greenleaf Personal & Adv Injury (dec statement)",
      "SELECT mode FROM policy_limits WHERE policy_id='pol-greenleaf-bop' AND slot='gl_personal_adv'",
      row ? (row.mode === "included" ? "Included" : String(row.mode)) : "[no row]",
      fmtResolved(gl?.limits["personalAdv"]),
    );
  }
  const md = sheets.get("acct-meridian");
  if (md) {
    const row = q(
      `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-meridian-eo' AND slot='cyber_aggregate'`,
    );
    const cyberLine = md.sheet.overflow.find((l) => /cyber/i.test(l.coverage));
    spot(
      "Meridian Cyber Aggregate (overflow line)",
      "SELECT amount_cents FROM policy_limits WHERE policy_id='pol-meridian-eo' AND slot='cyber_aggregate'",
      row ? money(Number(row.amount_cents)) : "[no row]",
      cyberLine?.aggregate ?? "[no line]",
    );
  }
  const ap = sheets.get("acct-apex");
  if (ap) {
    const row = q(
      `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-apex-umb' AND slot='umb_each_occurrence'`,
    );
    const umb = ap.sheet.sections.find((s) => s.def.key === "umbrella");
    spot(
      "Apex Umbrella Each Occurrence",
      "SELECT amount_cents FROM policy_limits WHERE policy_id='pol-apex-umb' AND slot='umb_each_occurrence'",
      row ? money(Number(row.amount_cents)) : "[no row]",
      fmtResolved(umb?.limits["eachOccurrence"]),
    );
  }
  const sm = sheets.get("acct-summit");
  if (sm) {
    const row = q(
      `SELECT issuing_carrier FROM policies WHERE id='pol-summit-gl'`,
    );
    const insurerA = sm.packet.insurers[0];
    spot(
      "Summit INSURER A NAIC (dec-page writer wins over ISC brand)",
      "SELECT issuing_carrier FROM policies WHERE id='pol-summit-gl' — Sutton National → NAIC 25798",
      row?.issuing_carrier === "Sutton National Insurance Company" ? "25798" : "[unexpected writer]",
      insurerA?.naic ?? "[blank]",
    );
  }
  const real = sheets.get("acct-real-924821");
  if (real) {
    const row = q(
      `SELECT COUNT(*) AS n FROM policy_limits WHERE policy_id='pol-real-15443'`,
    );
    const gl = real.sheet.sections.find((s) => s.def.key === "gl");
    const printedLimits = gl
      ? Object.values(gl.limits).filter((v) => v != null).length
      : -1;
    spot(
      "Real ISC Account Limit Count (dec-page schedule vs printed sheet)",
      "SELECT COUNT(*) FROM policy_limits WHERE policy_id='pol-real-15443'",
      String(row?.n ?? "[no row]"),
      String(printedLimits),
    );
  }
  const ns30 = sheets.get("acct-northstar · ACORD 30");
  if (ns30) {
    const row = q(
      `SELECT loc FROM policy_limits WHERE policy_id='pol-northstar-gar' AND slot='gk_comp_otc'`,
    );
    const gk = ns30.sheet.sections.find((s) => s.def.key === "garageKeepers");
    spot(
      "Northstar Garagekeepers Comp/OTC LOC (ACORD 30)",
      "SELECT loc FROM policy_limits WHERE policy_id='pol-northstar-gar' AND slot='gk_comp_otc'",
      row ? String(row.loc) : "[no row]",
      gk?.locs["compOtc"] ?? "[blank]",
    );
  }
  return out;
}

/* ————————————————— Run ————————————————— */

const staticChecks = verifyStatics();
const builtSheets = new Map<string, { packet: CertificatePacket; sheet: Acord25Sheet }>();
const riskNotes: string[] = [];
const sheetOrder: string[] = [];
const digestNondeterminism: string[] = [];
/** Accounts that cannot produce a certificate at all (zero policies). */
const policyless: string[] = [];
/** Real-account insurer lines printing the MGA brand (no writer recorded). */
const mgaBrandLines: string[] = [];
/**
 * The operator sample: every dec-verified real account (schedule attached
 * off the dec, writer recorded in `policies.issuing_carrier`) plus the two
 * hard seeds — multi-carrier overflow and the garage / ACORD 30 switcher.
 */
const SEED_SAMPLE = new Set(["acct-meridian", "acct-northstar"]);
const sampleSheetIds: string[] = [];
const accountNameById = new Map<string, string>();
/** Dec-verified real accounts with no street address on the account row. */
const missingInsuredAddress: string[] = [];

for (const acctRow of accounts) {
  const policies = (policiesFor.all(acctRow.id) as RawPolicyRow[]).map(mapPolicy);
  if (policies.length === 0) {
    policyless.push(acctRow.id);
    continue;
  }
  const account = mapAccount(acctRow);

  const rawSets = new Map<string, PolicyFormSet>();
  const formSets: Record<string, PolicyFormSet> = {};
  const sourceByPolicy = new Map<string, string>();
  for (const p of policies) {
    const { set, source } = loadFormSet(p);
    rawSets.set(p.id, set);
    formSets[p.id] = set;
    sourceByPolicy.set(p.id, source);
  }

  // One-door assembler: the same buildFactSnapshot call that serves
  // preparation and issuance resolves the sheet here. Two builds with the
  // same injected clock must produce the same digest (determinism).
  const snapInput = {
    account,
    policies,
    formSets,
    formKey: "acord25" as CertFormKey,
    placements: {},
    holderName: HOLDER_NAME,
    holderAddress: HOLDER_ADDRESS,
    overrides: {},
    takenAt: SNAPSHOT_AT,
  };
  const bundle = buildFactSnapshot(snapInput);
  const rebuilt = buildFactSnapshot(snapInput);
  if (bundle.snapshot.digest !== rebuilt.snapshot.digest) {
    digestNondeterminism.push(acctRow.id);
  }
  const packet = bundle.packet;
  const sheet = bundle.sheet;
  builtSheets.set(acctRow.id, { packet, sheet });
  sheetOrder.push(acctRow.id);
  accountNameById.set(acctRow.id, acctRow.name);
  const decVerified =
    acctRow.id.startsWith("acct-real-") &&
    policies.some((p) => p.issuingCarrier);
  const inSample = decVerified || SEED_SAMPLE.has(acctRow.id);
  if (inSample) sampleSheetIds.push(acctRow.id);
  if (decVerified && (!acctRow.address1?.trim() || !acctRow.zip?.trim())) {
    missingInsuredAddress.push(acctRow.id);
  }
  auditSheet({
    sheetId: acctRow.id,
    form: "acord25",
    account,
    policies,
    rawSets,
    packet,
    sheet,
    staticChecks,
  });

  // ACORD 30 pass for garage accounts (form switcher surface).
  const hasGarage = policies.some((p) =>
    /garage/i.test(coverageTextRaw(rawSets.get(p.id)!)),
  );
  if (hasGarage) {
    const sheet30 = buildFactSnapshot({ ...snapInput, formKey: "acord30" }).sheet;
    const id30 = `${acctRow.id} · ACORD 30`;
    builtSheets.set(id30, { packet, sheet: sheet30 });
    sheetOrder.push(id30);
    if (inSample) sampleSheetIds.push(id30);
    auditSheet({
      sheetId: id30,
      form: "acord30",
      account,
      policies,
      rawSets,
      packet,
      sheet: sheet30,
      staticChecks,
    });
  }

  // Risk notes: cross-policy named-insured disagreement on one sheet.
  const insuredNames = new Set(
    policies.map((p) => p.quoteInsuredName ?? account.name),
  );
  if (insuredNames.size > 1) {
    riskNotes.push(
      `**${acctRow.id}** — one INSURED box, ${insuredNames.size} named-insured spellings across its policies: ${[...insuredNames]
        .map((n) => `"${n}"`)
        .join(", ")}. The sheet prints the first policy's paper (${policies[0].policyNumber}); the others' certs would read differently.`,
    );
  }
  if (packet.rejects.length > 0) {
    riskNotes.push(
      `**${acctRow.id}** — packet has ${packet.rejects.length} verifier reject(s) out of the box: ${packet.rejects
        .map((r) => r.finding.id)
        .join(", ")}.`,
    );
  }
  // INSURER lines with no verified NAIC identity print the policy-record
  // brand with a blank NAIC cell. Honest per doctrine, but when the brand is
  // an MGA (ISC) the line names a non-insurer — flag it for writer intake.
  for (const ins of packet.insurers) {
    if (ins.naic == null && ins.carrier === "ISC") {
      mgaBrandLines.push(`${acctRow.id} (letter ${ins.letter || "∅"})`);
    }
  }

  // A policy with no policy number can never certify: the sheet's honest
  // blank is correct, but the certificate is unissuable until the number
  // lands on the record. Import-data finding, not a resolver bug.
  for (const p of policies) {
    if (!p.policyNumber.trim()) {
      riskNotes.push(
        `**${acctRow.id}** — policy \`${p.id}\` (${p.carrier}, ${p.effectiveDate} – ${p.expirationDate}) has a BLANK policy number in the schedule of record. The POLICY NUMBER cell prints honestly blank, but no holder accepts a certificate without one — fix the import row before this account needs paper.`,
      );
    }
  }

  const bare = policies.filter((p) => sourceByPolicy.get(p.id) === "bare");
  if (bare.length > 0) {
    riskNotes.push(
      `**${acctRow.id}** — ${bare.length} unscheduled polic${bare.length === 1 ? "y" : "ies"} (bare coverage codes, no limits on record): ${bare
        .map((p) => p.policyNumber)
        .join(", ")}. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.`,
    );
  }
}

// Aggregated risk notes (once, not per account).
if (mgaBrandLines.length > 0) {
  riskNotes.push(
    `**MGA brand on the INSURER line** — ${mgaBrandLines.length} sheet(s) print "ISC" with a blank NAIC cell because no dec-page writer is recorded (\`policies.issuing_carrier\` is empty). Honest per doctrine (never a guessed code), but ISC is an MGA, not an insurer — per carrier knowledge \`isc-writer-*\`, a certificate naming ISC on the INSURER line misidentifies the insurer. Record the writer at intake to resolve: ${mgaBrandLines.slice(0, 6).join(", ")}${mgaBrandLines.length > 6 ? `, +${mgaBrandLines.length - 6} more` : ""}.`,
  );
}
if (missingInsuredAddress.length > 0) {
  riskNotes.push(
    `**Insured street address missing on dec-verified real accounts** (Data Gap) — ${missingInsuredAddress.length} account(s) carry no \`address1\`/\`zip\` on the accounts row (${missingInsuredAddress.join(", ")}). The INSURED box prints name + city/state only — honest blanks per doctrine, but the dec carries a mailing address the import never captured; holders can reject a cert with a bare-city insured block.`,
  );
}
if (policyless.length > 0) {
  riskNotes.push(
    `**No policies on record** — ${policyless.join(", ")}: no certificate can exist for these accounts; they are outside the fill audit.`,
  );
}
if (digestNondeterminism.length > 0) {
  riskNotes.push(
    `**Snapshot digest nondeterminism** — same input produced different digests on: ${digestNondeterminism.join(", ")}. The one-door staleness clock cannot be trusted until fixed.`,
  );
}

const driftNotes = checkDrift();
const controls = runControls();
const spotChecks = runSpotChecks(builtSheets);

/* ————————————————— Scoreboard + report ————————————————— */

interface Score {
  total: number;
  fc: number;
  cb: number;
  mf: number;
  wv: number;
  sp: number;
}

function scoreFor(rows: FieldAudit[]): Score {
  const s: Score = { total: rows.length, fc: 0, cb: 0, mf: 0, wv: 0, sp: 0 };
  for (const r of rows) {
    if (r.cls === "filled_correct") s.fc++;
    else if (r.cls === "correctly_blank") s.cb++;
    else if (r.cls === "missed_fill") s.mf++;
    else if (r.cls === "wrong_value") s.wv++;
    else s.sp++;
  }
  return s;
}

const pct = (n: number, d: number) => (d === 0 ? "—" : ((100 * n) / d).toFixed(1) + "%");
const fillRate = (s: Score) => pct(s.fc, s.fc + s.mf);
const accuracy = (s: Score) => pct(s.fc + s.cb, s.fc + s.cb + s.mf + s.wv);

const today = new Date().toISOString().slice(0, 10);

/** Read the previous report's headline numbers before overwriting (trend). */
function previousTotals(): { date: string; fillRate: string; accuracy: string } | null {
  try {
    const prev = fs.readFileSync(REPORT_PATH, "utf8");
    const date = /^# Certificate Fill Audit — (\d{4}-\d{2}-\d{2})/m.exec(prev)?.[1];
    const fill = /\*\*Platform Fill Rate:\*\* ([\d.]+%)/.exec(prev)?.[1];
    const acc = /\*\*Platform Accuracy:\*\* ([\d.]+%)/.exec(prev)?.[1];
    if (date && fill && acc) return { date, fillRate: fill, accuracy: acc };
    return null;
  } catch {
    return null;
  }
}
const prev = previousTotals();

const lines: string[] = [];
const out = (s = "") => lines.push(s);

out(`# Certificate Fill Audit — ${today}`);
out();
out(
  `Auditor: cert-fill-auditor · Pipeline under test: the one-door assembler \`buildFactSnapshot\` (\`cert-snapshot.ts\`) → \`buildCertificatePacket\` → \`resolveCertSheet\` (ACORD 25 2025/12; ACORD 30 2016/03 for garage accounts), plus the \`cert-checks.ts\` presend registry and the \`carrier-knowledge.ts\` enforcement gates · Schedule of record: \`data/underwriter-desk.db\` read directly via SQL. Expected values are recomputed from raw rows independently of the resolver.`,
);
out();

const platform = scoreFor(audits);
const perSheet = new Map<string, Score>();
for (const id of sheetOrder) {
  perSheet.set(id, scoreFor(audits.filter((a) => a.sheetId === id)));
}

const accountsAudited = new Set(sheetOrder.map((s) => s.split(" · ")[0])).size;
const realIds = new Set(
  sheetOrder.filter((s) => s.startsWith("acct-real-")).map((s) => s.split(" · ")[0]),
);
const realScore = scoreFor(audits.filter((a) => a.sheetId.startsWith("acct-real-")));
const fictionScore = scoreFor(audits.filter((a) => !a.sheetId.startsWith("acct-real-")));
out(`## Headline`);
out();
out(
  `Of **${platform.total - platform.sp} fillable fields** across **${accountsAudited} accounts** (${sheetOrder.length} sheets), **${platform.fc} filled correctly**, **${platform.cb} correctly blank**, **${platform.mf} missed**, **${platform.wv} wrong**.`,
);
out();
out(
  `- **Fictional Seed Accounts** (${accountsAudited - realIds.size}): ${fictionScore.fc} filled correct, ${fictionScore.cb} correctly blank, ${fictionScore.mf} missed, ${fictionScore.wv} wrong — Fill Rate ${fillRate(fictionScore)}, Accuracy ${accuracy(fictionScore)}.`,
);
out(
  `- **Real ISC Accounts** (\`acct-real-*\`, ${realIds.size} with policies): ${realScore.fc} filled correct, ${realScore.cb} correctly blank, ${realScore.mf} missed, ${realScore.wv} wrong — Fill Rate ${fillRate(realScore)}, Accuracy ${accuracy(realScore)}. ${sampleSheetIds.filter((s) => s.startsWith("acct-real-")).length} carry dec-verified schedules (writer + limits attached off the dec); the rest are unattached and audit as honest blanks.`,
);
out();
out(`- **Platform Fill Rate:** ${fillRate(platform)} (Filled Correct ÷ fields the schedule can back)`);
out(`- **Platform Accuracy:** ${accuracy(platform)} (Filled Correct + Correctly Blank ÷ all fillable fields)`);
out(
  `- **Static/Producer fields:** ${platform.sp} verified against \`brand.ts\` (producer block, signature, render-time date)${staticChecks.every((s) => s.ok) ? "" : " — **FAILURES, see Wrong Values**"}`,
);
out(
  `- Correctly Blank includes ${silentExcludedPrints} boxes printing the dec statement "Excluded" where the schedule is silent inside a backed section — the platform's blank-equivalent (claims nothing), per the accuracy contract in \`src/lib/acord25.ts\`.`,
);
out();

out(`## Scoreboard Per Account`);
out();
out(`| Sheet | Total Fields | Filled Correct | Correctly Blank | Missed Fill | Wrong Value | Static | Fill Rate | Accuracy |`);
out(`|---|---|---|---|---|---|---|---|---|`);
for (const id of sheetOrder) {
  const s = perSheet.get(id)!;
  out(
    `| ${id} | ${s.total} | ${s.fc} | ${s.cb} | ${s.mf} | ${s.wv} | ${s.sp} | ${fillRate(s)} | ${accuracy(s)} |`,
  );
}
out(
  `| **Platform** | **${platform.total}** | **${platform.fc}** | **${platform.cb}** | **${platform.mf}** | **${platform.wv}** | **${platform.sp}** | **${fillRate(platform)}** | **${accuracy(platform)}** |`,
);
out();

out(`## Dec-Verified Sample Scorecard (Real Book + Hard Seeds)`);
out();
out(
  `The operator sample: every real account whose dec-page schedule is attached and writer-verified (\`policies.issuing_carrier\` set), plus two hard seeds — \`acct-meridian\` (6 policies / 4 carriers, overflow) and \`acct-northstar\` (garage, ACORD 25 + 30).`,
);
out();
out(`| Sheet | Account | Total | Filled Correct | Correctly Blank | Missed Fill | Wrong Value | Fill Rate | Accuracy |`);
out(`|---|---|---|---|---|---|---|---|---|`);
const sampleScore = scoreFor(
  audits.filter((a) => sampleSheetIds.includes(a.sheetId)),
);
for (const id of sampleSheetIds) {
  const s = perSheet.get(id)!;
  const name = accountNameById.get(id.split(" · ")[0]) ?? "";
  out(
    `| ${id} | ${name} | ${s.total} | ${s.fc} | ${s.cb} | ${s.mf} | ${s.wv} | ${fillRate(s)} | ${accuracy(s)} |`,
  );
}
out(
  `| **Sample** | | **${sampleScore.total}** | **${sampleScore.fc}** | **${sampleScore.cb}** | **${sampleScore.mf}** | **${sampleScore.wv}** | **${fillRate(sampleScore)}** | **${accuracy(sampleScore)}** |`,
);
out();

const misses = audits.filter((a) => a.cls === "missed_fill");
const wrongs = audits.filter((a) => a.cls === "wrong_value");
out(`## Missed Fills And Wrong Values`);
out();
if (misses.length === 0 && wrongs.length === 0) {
  out(`None. Every field either matches its schedule source exactly or is correctly blank.`);
  out();
} else {
  if (wrongs.length > 0) {
    out(`### Wrong Values (Critical — Automatic Fail)`);
    out();
    out(`| Sheet | Section | Field | Expected (Source) | Got |`);
    out(`|---|---|---|---|---|`);
    for (const w of wrongs) {
      out(`| ${w.sheetId} | ${w.section} | \`${w.field}\` | ${w.expected} (${w.source}) | ${w.got} |`);
    }
    out();
  }
  if (misses.length > 0) {
    out(`### Missed Fills`);
    out();
    out(`| Sheet | Section | Field | Expected (Source) | Got |`);
    out(`|---|---|---|---|---|`);
    for (const m of misses) {
      out(`| ${m.sheetId} | ${m.section} | \`${m.field}\` | ${m.expected} (${m.source}) | ${m.got} |`);
    }
    out();
  }
}

/* Failure modes: every miss/wrong grouped into one numbered line each, with
 * a gap classification (parser gap / fill-rule gap / data gap). Honest
 * blanks are NOT failures — they score as Correctly Blank above. */
function modeKeyFor(a: FieldAudit): string {
  const f = a.field
    .replace(/insurer\.[A-F∅]\./, "insurer.X.")
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/\[\d+\]/g, "[i]")
    .replace(/^dropped\.[^.]+\./, "dropped.");
  return `${a.cls}|${a.section}|${f}`;
}

function gapFor(key: string): string {
  if (/check\.claimsMade|check\.occur/.test(key)) {
    return "Fill-Rule Gap — `resolveChecks` derives claims-made from the coverage-part label only (`src/lib/acord25.ts:182`); real ISC decs state it as a scheduled endorsement (\"Claims-Made and Reported Limitation\") which the resolver never reads";
  }
  if (/desc\.citation/.test(key)) {
    return "Fill-Rule Gap — `buildDraftFromPolicy` prints `per <form> <edition>` unconditionally (`src/lib/coi.ts:503`), leaving a dangling \"per  .\" when the schedule names no form; upstream Parser Gap — the dec-page importer stored the endorsement by title only (blank form/edition, flagged in `data/real-isc/import-report.json`)";
  }
  if (/desc\.grant/.test(key)) {
    return "Fill-Rule Gap — a grant endorsement on the schedule never surfaced in the description";
  }
  if (/dropped\./.test(key)) {
    return "Fill-Rule Gap — a scheduled limit surfaced nowhere on the sheet";
  }
  if (/desc\.unbacked/.test(key)) {
    return "Wrong Value — description sentence with no schedule backing";
  }
  return "Unclassified — investigate by hand";
}

out(`## Failure Modes (Numbered)`);
out();
const failures = [...wrongs, ...misses];
if (failures.length === 0) {
  out(`None observed on this DB state.`);
  out();
} else {
  out(
    `Every Missed Fill and Wrong Value above, grouped into distinct failure modes — one line each with a repro account. Honest blanks (dec silent, field blank) are passes and are not listed.`,
  );
  out();
  const byMode = new Map<string, FieldAudit[]>();
  for (const f of failures) {
    const key = modeKeyFor(f);
    const rows = byMode.get(key) ?? [];
    rows.push(f);
    byMode.set(key, rows);
  }
  let n = 0;
  for (const [key, rows] of byMode) {
    n++;
    const first = rows[0];
    const sheets = [...new Set(rows.map((r) => r.sheetId))];
    const others =
      sheets.length > 1 ? ` (+${sheets.length - 1} more sheet${sheets.length > 2 ? "s" : ""}: ${sheets.slice(1).join(", ")})` : "";
    out(
      `${n}. **${first.cls === "wrong_value" ? "WRONG VALUE" : "MISSED FILL"}** \`${first.field}\` (${first.section}) — repro \`${first.sheetId}\`${others}: expected ${first.expected}, got ${first.got}. ${gapFor(key)}.`,
    );
  }
  out();
}

// Wrong values that ride through the verifier without a single reject are
// worse than the miss itself — nothing stops the operator from issuing.
const silentWrongSheets = [...new Set(wrongs.map((w) => w.sheetId))].filter(
  (id) => (builtSheets.get(id)?.packet.rejects.length ?? 0) === 0,
);
if (silentWrongSheets.length > 0) {
  riskNotes.unshift(
    `**Verifier silence on Wrong Values** — ${silentWrongSheets.length} sheet(s) carrying a Wrong Value have ZERO packet rejects (okToIssue stays true): ${silentWrongSheets.join(", ")}. Both live failure modes (OCCUR on claims-made paper; dangling "per  ." citation) are invisible to \`verifyCoi\` — the sheet signs and issues clean.`,
  );
}

out(`## Enforcement Controls (Synthetic Probes)`);
out();
out(
  `The live data carries no ISC excess line, so the carrier-knowledge gate never fires in the account audits — these synthetic probes prove the detectors and gates are live. A control failure is a critical finding.`,
);
out();
out(`| Control | Verdict | Detail |`);
out(`|---|---|---|`);
for (const c of controls) {
  out(`| ${c.label} | ${c.pass ? "Pass" : "**FAIL**"} | ${c.detail} |`);
}
out();
out(
  `- Snapshot digest determinism: ${digestNondeterminism.length === 0 ? `every sheet built twice with the same injected clock produced identical digests (${sheetOrder.length} sheets)` : `**FAILED** on ${digestNondeterminism.join(", ")}`}.`,
);
out();

out(`## SQLite Spot Checks`);
out();
out(`Direct SQL against \`data/underwriter-desk.db\`, compared to the rendered sheet value — not trusting the lib end to end.`);
out();
out(`| Check | SQL Value | Sheet Value | Verdict |`);
out(`|---|---|---|---|`);
for (const s of spotChecks) {
  out(`| ${s.label} | ${s.sqlValue} | ${s.sheetValue} | ${s.ok ? "Match" : "**MISMATCH**"} |`);
}
out();
for (const s of spotChecks) {
  out(`- ${s.label}: \`${s.sql}\``);
}
out();

out(`## Schedule Drift (FORM_SETS Vs SQLite)`);
out();
if (driftNotes.length === 0) {
  out(`None — the seeded \`FORM_SETS\` and the SQLite schedule tables agree row for row.`);
} else {
  for (const n of driftNotes) out(`- ${n}`);
}
out();

out(`## Risk Notes`);
out();
if (riskNotes.length === 0) out(`None.`);
for (const n of riskNotes) out(`- ${n}`);
out();

out(`## Method And Definitions`);
out();
out(`- **Filled Correct** — the sheet value matches the schedule of record exactly (raw SQLite rows, or \`naic.ts\` registry for insurer identity).`);
out(`- **Correctly Blank** — the schedule is silent and the field claims nothing (blank, unchecked, or the dec statement "Excluded" on a silent line inside a backed section).`);
out(`- **Missed Fill** — the schedule has the value; the sheet left it blank (includes any scheduled limit that surfaces nowhere: section box, additional row, or description overflow).`);
out(`- **Wrong Value** — the sheet shows something the schedule cannot back. Critical, automatic fail.`);
out(`- **Static/Producer** — brand constants (producer block, signature, render-time DATE), verified against \`src/lib/brand.ts\` and the studio wiring.`);
out(`- Fill Rate = Filled Correct ÷ (Filled Correct + Missed Fill). Accuracy = (Filled Correct + Correctly Blank) ÷ all fillable fields.`);
out(`- Expected values are recomputed in this script from raw SQL rows (doctrine restated, not imported), so a resolver bug cannot vouch for itself. Holder fields use a fixed audit holder ("${HOLDER_NAME}") and are verbatim-carry checks.`);
out(`- Insurer letters are expected per WRITING PAPER (dec-page writer via \`policies.issuing_carrier\`, else brand) — two ISC policies on different writers are different insurers.`);
out(`- Insured address cells (\`insured.addr1/city/state/zip\`) audit the account-record auto-fill: expected straight off the \`accounts\` row, wiring verified against \`CertificateStudio.tsx\` source. A blank street line on record yields honest blanks.`);
out(`- Carrier-knowledge gates (\`carrier-knowledge.ts\`) are cross-checked on every printed Additional Insured box and probed synthetically (Enforcement Controls) since the live data has no ISC excess line.`);
out(`- Claims-made evidence is read from BOTH the coverage-part label and scheduled endorsement titles (real ISC decs carry "Claims-Made and Reported Limitation") — an OCCUR check against claims-made paper is a Wrong Value.`);
out(`- Description grants are audited for citation integrity: a grant endorsement recorded title-only (blank form/edition) backs the wording but no citation — a dangling "per  ." cite is a Wrong Value, and any concrete cite must trace to a scheduled form.`);
out(`- Deterministic: same DB state → same report (snapshot clock injected). Run: \`npx tsx scripts/cert-fill-audit.ts\`. Exit code = wrong values + control failures.`);
out();

out(`## Trend`);
out();
if (prev && prev.date !== today) {
  out(
    `Previous report (${prev.date}): Fill Rate ${prev.fillRate}, Accuracy ${prev.accuracy}. This run: Fill Rate ${fillRate(platform)}, Accuracy ${accuracy(platform)}.`,
  );
} else if (prev) {
  out(
    `Same-day re-run. Previous pass: Fill Rate ${prev.fillRate}, Accuracy ${prev.accuracy}. This pass: Fill Rate ${fillRate(platform)}, Accuracy ${accuracy(platform)}.`,
  );
} else {
  out(`Baseline run — no previous report to compare against.`);
}
out();

const report = lines.join("\n");
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, report);
console.log(report);
const controlFailures = controls.filter((c) => !c.pass).length;
console.log(
  `\n[audit] ${audits.length} fields classified across ${sheetOrder.length} sheets · wrong=${wrongs.length} missed=${misses.length} controlFailures=${controlFailures} · report → docs/cert-fill-report.md`,
);
db.close();
process.exit(wrongs.length + controlFailures + digestNondeterminism.length);
