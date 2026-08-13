import type {
  CoveragePart,
  EndorsementForm,
  EndorsementKind,
  EndorsementScope,
  PolicyFormSet,
  PolicyLimit,
} from "../../forms";
import type { LimitSlot } from "../../forms";
import type { Account, Policy } from "../../types";

/**
 * Harper `data.policy-state.v1` → this desk's account / policy / schedule
 * shapes.
 *
 * The contract is the canonical policy-state read over `insurance.policy`,
 * and it carries the one thing the real-book overlay never had: the
 * coverage lines. Accounts and policies alone import as `unscheduled`, and
 * an unscheduled policy prints identity and nothing else — which is why
 * every imported account produced an empty certificate. These rows carry
 * limits with canonical types, the coverage form, and the coverage basis,
 * so a real policy can arrive with a schedule of record behind it.
 *
 * Pure: no I/O, no clock. The importer does the reading and writing.
 */

/* ————————————————————————— The contract ————————————————————————— */

export interface HarperLimit {
  label?: string | null;
  amount?: string | null;
  source_label?: string | null;
  canonical_limit_type?: string | null;
}

export interface HarperCoverageLine {
  limits?: HarperLimit[] | null;
  carrier?: { name?: string | null; naic_code?: string | null } | null;
  premium?: string | null;
  coverage_form?: string | null;
  coverage_type?: string | null;
  coverage_basis?: string | null;
  source_coverage_label?: string | null;
  canonical_coverage_type?: string | null;
}

export interface HarperPolicyRow {
  policy_id?: string | null;
  status?: string | null;
  policy_number?: string | null;
  named_insured?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  coverage_lines?: HarperCoverageLine[] | null;
  company_id?: string | null;
  in_force?: boolean | null;
}

/** ACORD-125/126 mechanical prefill, keyed by widget — the address source. */
export type HarperPrefill = Record<string, string>;

/* ————————————————————————— Mapping tables ————————————————————————— */

/**
 * Canonical coverage type → this desk's coverage code. Anything unmapped
 * keeps its canonical name as the code: an unknown coverage still prints
 * its identity, and inventing a familiar code for it would file real
 * coverage under the wrong section.
 */
const COVERAGE_CODE: Record<string, string> = {
  GENERAL_LIABILITY: "GL",
  PRODUCTS_COMPLETED_OPERATIONS: "ProdL",
  AUTOMOBILE_LIABILITY: "CA",
  HIRED_NON_OWNED_AUTO: "HNOA",
  GARAGE_LIABILITY: "Garage",
  GARAGEKEEPERS: "GK",
  WORKERS_COMPENSATION: "WC",
  EMPLOYERS_LIABILITY: "WC",
  UMBRELLA_LIABILITY: "EXCESS_UMB",
  EXCESS_LIABILITY: "EXCESS_UMB",
  PROFESSIONAL_LIABILITY: "PL",
  TECHNOLOGY_ERRORS_OMISSIONS: "TECH_EO",
  CYBER_LIABILITY: "CL",
  LIQUOR_LIABILITY: "Liquor",
  PROPERTY: "Prop",
  COMMERCIAL_PROPERTY: "Prop",
  BUSINESSOWNERS: "BOP",
};

/**
 * Canonical limit type → ACORD box, **scoped by the coverage line it sits
 * on**. The same canonical name means different boxes on different lines:
 * EACH_OCCURRENCE_OR_CLAIM is the general liability occurrence limit and
 * the professional each-claim limit, GENERAL_AGGREGATE is the GL aggregate
 * and the professional aggregate, and EACH_ACCIDENT is employers-liability
 * on a comp line and uninsured-motorist on an auto one. Reading the limit
 * type without its line is the same mistake as reading a coverage part
 * without its section.
 */
const LIMIT_SLOT: Record<string, Partial<Record<string, LimitSlot>>> = {
  GL: {
    EACH_OCCURRENCE_OR_CLAIM: "gl_each_occurrence",
    DAMAGE_TO_RENTED_PREMISES: "gl_damage_premises",
    MEDICAL_EXPENSE: "gl_med_exp",
    PERSONAL_ADVERTISING_INJURY: "gl_personal_adv",
    GENERAL_AGGREGATE: "gl_general_aggregate",
    PRODUCTS_COMPLETED_OPERATIONS: "gl_products_completed_ops",
  },
  CA: { COMBINED_SINGLE_LIMIT: "auto_combined_single" },
  HNOA: { COMBINED_SINGLE_LIMIT: "auto_combined_single" },
  Garage: {
    AUTO_ONLY_EACH_ACCIDENT: "gar_auto_only_each_accident",
    OTHER_THAN_AUTO_EACH_ACCIDENT: "gar_other_than_auto_each_accident",
    OTHER_THAN_AUTO_AGGREGATE: "gar_other_than_auto_aggregate",
  },
  GK: {
    COMPREHENSIVE: "gk_comp_otc",
    SPECIFIED_PERILS: "gk_specified_perils",
    COLLISION: "gk_collision",
  },
  EXCESS_UMB: {
    EACH_OCCURRENCE_OR_CLAIM: "umb_each_occurrence",
    GENERAL_AGGREGATE: "umb_aggregate",
    AGGREGATE: "umb_aggregate",
  },
  WC: {
    EACH_ACCIDENT: "wc_el_each_accident",
    DISEASE_EACH_EMPLOYEE: "wc_el_disease_employee",
    DISEASE_POLICY_LIMIT: "wc_el_disease_policy",
  },
  PL: {
    EACH_OCCURRENCE_OR_CLAIM: "prof_each_claim",
    GENERAL_AGGREGATE: "prof_aggregate",
    AGGREGATE: "prof_aggregate",
  },
  TECH_EO: {
    EACH_OCCURRENCE_OR_CLAIM: "prof_each_claim",
    GENERAL_AGGREGATE: "prof_aggregate",
    AGGREGATE: "prof_aggregate",
  },
  CL: {
    AGGREGATE: "cyber_aggregate",
    GENERAL_AGGREGATE: "cyber_aggregate",
    EACH_OCCURRENCE_OR_CLAIM: "cyber_aggregate",
  },
  Liquor: { EACH_OCCURRENCE_OR_CLAIM: "liquor_each_common_cause" },
};

/* ————————————————————————— Parsing ————————————————————————— */

/** "$1,139.88" → 113988. Anything unreadable returns null rather than 0. */
export function parseMoneyCents(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** "2026-11-05T00:00:00.000Z" → "2026-11-05". */
export function isoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? m[1] : null;
}

/**
 * "CG 00 01 04 13" → form "CG 00 01", edition "04 13". ISO form numbers are
 * three groups plus a two-group edition; a carrier-proprietary form like
 * "NXUS-GL-0001.1-0619" has no edition to split off, so it stays whole.
 */
export function splitForm(raw: string | null | undefined): {
  form: string;
  edition: string;
} {
  const text = (raw ?? "").trim();
  if (!text) return { form: "—", edition: "" };
  const iso = /^([A-Z]{2}\s+\d{2}\s+\d{2})\s+(\d{2}\s+\d{2})$/i.exec(text);
  if (iso) return { form: iso[1].toUpperCase(), edition: iso[2] };
  // Carrier-proprietary numbering carries the edition as a trailing MMYY:
  // NXUS-GL-2037.2-0925, NXT-0005 IL 0225. Reading it is not a guess — it is
  // the form number's own convention — but it only splits when the month is
  // a real month, because an edition invented from four unrelated digits
  // certifies the wrong paper, which is the whole reason editions are part
  // of form identity.
  const trailing = /^(.*[^\d])(\d{2})(\d{2})$/.exec(text);
  if (trailing) {
    const month = Number(trailing[2]);
    if (month >= 1 && month <= 12) {
      return {
        form: trailing[1].replace(/[\s-]+$/, ""),
        edition: `${trailing[2]} ${trailing[3]}`,
      };
    }
  }
  return { form: text, edition: "" };
}

/* ————————————————————————— Endorsements ————————————————————————— */

export interface HarperEndorsement {
  form_number?: string | null;
  title?: string | null;
  additional_insured_name?: string | null;
  modifies_coverage?: string | null;
  summary?: string | null;
}

/** The endorsement block of a parsed policy document extraction. */
export interface HarperExtraction {
  extraction_data?: {
    policy?: { endorsements?: HarperEndorsement[] | null } | null;
  } | null;
}

/**
 * Wording that makes an additional-insured or waiver endorsement BLANKET:
 * it attaches to whoever a written contract requires, so a certificate can
 * name a holder the policy never listed.
 *
 * Everything else is scheduled, and that default is deliberate. Scheduled
 * means the holder has to be named on the policy before the certificate can
 * claim the status; blanket means it does not. Reading an ambiguous
 * endorsement as blanket issues paper the carrier will not honor, so the
 * ambiguous case has to land on the side that asks a human.
 */
const BLANKET_WORDING =
  /\bblanket\b|automatic status|as required by (a )?written (contract|agreement)|any person or organization|where required by (a )?written/i;

function classifyEndorsement(
  e: HarperEndorsement,
): { kind: EndorsementKind; scope?: EndorsementScope } | null {
  const form = (e.form_number ?? "").toUpperCase();
  const title = e.title ?? "";
  const aiName = e.additional_insured_name ?? "";
  const blanket = BLANKET_WORDING.test(`${title} ${aiName} ${e.summary ?? ""}`);

  // ISO numbering is the reliable signal and the title is the fallback:
  // CG 20 xx is the additional-insured family, CG 24 04 and WC 00 03 13 are
  // the waivers, CG 20 01 is primary & noncontributory.
  if (/^CG\s*20\s*01\b/.test(form) || /primary and non-?contributory/i.test(title)) {
    return { kind: "pnc" };
  }
  if (/^CG\s*20\b/.test(form) || /additional insured/i.test(title)) {
    return { kind: "ai", scope: blanket ? "blanket" : "scheduled" };
  }
  if (
    /^CG\s*24\s*04\b/.test(form) ||
    /^WC\s*00\s*03\s*13\b/.test(form) ||
    /waiver of (transfer|our right|subrogation)|waiver of subrogation/i.test(title)
  ) {
    return { kind: "wos", scope: blanket ? "blanket" : "scheduled" };
  }
  if (aiName.trim()) {
    // A carrier-proprietary form the numbering rules don't recognize, but
    // the extraction found an additional-insured schedule on it.
    return { kind: "ai", scope: blanket ? "blanket" : "scheduled" };
  }
  if (/exclusion|limitation/i.test(title) || /^CG\s*2[12]\b/.test(form)) {
    return { kind: "exclusion" };
  }
  return { kind: "other" };
}

/**
 * Policy-document extraction → the endorsement schedule.
 *
 * Only endorsements with a complete form identity survive: `verifyCoi`
 * ignores an endorsement missing its form or edition, because "CG 20 10
 * 04 13" and "CG 20 10 10 01" are different paper. One without an edition
 * is reported rather than filed under a form identity it does not have.
 */
export function mapEndorsements(extraction: HarperExtraction | null): {
  endorsements: EndorsementForm[];
  withoutIdentity: string[];
} {
  const rows = extraction?.extraction_data?.policy?.endorsements ?? [];
  const endorsements: EndorsementForm[] = [];
  const withoutIdentity: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const title = (row.title ?? "").trim();
    if (!title && !row.form_number) continue;
    const { form, edition } = splitForm(row.form_number);
    const classified = classifyEndorsement(row);
    if (!classified) continue;

    if (!edition.trim() || form === "—") {
      withoutIdentity.push(`${row.form_number ?? "(no form)"} — ${title}`);
      continue;
    }
    const key = `${form} ${edition}`.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    endorsements.push({
      form,
      edition,
      title: title || form,
      kind: classified.kind,
      ...(classified.scope ? { scope: classified.scope } : {}),
      ...(row.additional_insured_name?.trim()
        ? { note: row.additional_insured_name.trim() }
        : {}),
    });
  }
  return { endorsements, withoutIdentity };
}

/** The desk's coverage code for a line, falling back to its canonical name. */
export function coverageCode(line: HarperCoverageLine): string {
  const canonical = (line.canonical_coverage_type ?? "").toUpperCase();
  return COVERAGE_CODE[canonical] ?? canonical ?? "OTHER";
}

/**
 * The coverage part label. Claims-made is stated in the label because that
 * is where the sheet's resolver reads it from, and it is real evidence
 * here: the policy state carries `coverage_basis` per line, which is the
 * one thing Harper's own ACORD prefill refuses to guess
 * (`judgment:claims_made_vs_occurrence`). An UNKNOWN basis adds nothing —
 * the sheet then treats the line as the form's default rather than
 * printing a basis the record does not state.
 */
export function coveragePartLabel(line: HarperCoverageLine): string {
  const base =
    line.source_coverage_label?.trim() ||
    line.coverage_type?.trim() ||
    (line.canonical_coverage_type ?? "Coverage").replace(/_/g, " ");
  return /claims[-_ ]?made/i.test(line.coverage_basis ?? "")
    ? `${base} (Claims-Made)`
    : base;
}

/* ————————————————————————— The mapping ————————————————————————— */

export interface MappedPolicy {
  policy: Policy;
  set: PolicyFormSet;
  /** Limits the contract carried that no ACORD box on this desk accepts */
  droppedLimits: { coverage: string; type: string; label: string }[];
}

/**
 * One policy row → a policy plus its schedule of record. Limits whose
 * canonical type has no box on this desk are dropped and reported rather
 * than forced into an approximate slot: a limit in the wrong box is a
 * wrong certificate, and a limit the desk cannot print is a gap the
 * operator should see.
 */
export function mapPolicy(row: HarperPolicyRow, accountId: string): MappedPolicy | null {
  const policyNumber = row.policy_number?.trim();
  const effectiveDate = isoDate(row.effective_date);
  const expirationDate = isoDate(row.expiration_date);
  if (!row.policy_id || !policyNumber || !effectiveDate || !expirationDate) {
    return null;
  }

  const lines = (row.coverage_lines ?? []).filter(Boolean);
  const coverages: CoveragePart[] = [];
  const limits: PolicyLimit[] = [];
  const droppedLimits: MappedPolicy["droppedLimits"] = [];
  const seenSlots = new Set<LimitSlot>();
  let premiumCents = 0;
  let carrierName: string | null = null;

  for (const line of lines) {
    const code = coverageCode(line);
    const { form, edition } = splitForm(line.coverage_form);
    coverages.push({ code, label: coveragePartLabel(line), form, edition });

    const linePremium = parseMoneyCents(line.premium);
    if (linePremium != null) premiumCents += linePremium;
    if (!carrierName && line.carrier?.name) carrierName = line.carrier.name;

    const table = LIMIT_SLOT[code] ?? {};
    for (const limit of line.limits ?? []) {
      const canonical = (limit.canonical_limit_type ?? "").toUpperCase();
      const cents = parseMoneyCents(limit.amount);
      const slot = table[canonical];
      if (!slot || cents == null) {
        if (limit.label || limit.amount) {
          droppedLimits.push({
            coverage: code,
            type: canonical || "(untyped)",
            label: `${limit.label ?? ""} ${limit.amount ?? ""}`.trim(),
          });
        }
        continue;
      }
      // First statement of a slot wins: a dec states a line once, and a
      // repeat is the same line seen through another coverage part.
      if (seenSlots.has(slot)) continue;
      seenSlots.add(slot);
      limits.push({ slot, amountCents: cents });
    }
  }

  const policy: Policy = {
    id: `pol-h-${row.policy_id}`,
    accountId,
    policyNumber,
    carrier: carrierName ?? "Unassigned",
    coverages: Array.from(new Set(coverages.map((c) => c.code))),
    effectiveDate,
    expirationDate,
    premiumCents,
    quoteInsuredName: row.named_insured?.trim() || null,
    quoteCarrier: carrierName,
  };

  // A policy whose lines carried no readable limit has no dec behind it.
  // Saying so is the difference between a blank row the desk can chase and
  // a schedule that looks real and states nothing.
  const set: PolicyFormSet =
    coverages.length === 0
      ? { coverages: [], limits: [], endorsements: [], unscheduled: true }
      : { coverages, limits, endorsements: [] };

  return { policy, set, droppedLimits };
}

/**
 * The insured's identity, off the ACORD 125 mechanical prefill. That tool
 * is fail-closed by design — it omits anything missing or ambiguous rather
 * than inventing it — so a field absent here is absent on the record, and
 * the account carries a null the certificate will print as blank.
 */
export function mapAccount(input: {
  companyId: string;
  prefill: HarperPrefill | null;
  fallbackName: string;
  underwriterId: string;
}): Account {
  const v = input.prefill ?? {};
  const line1 = v.NamedInsured_MailingAddress_LineOne_A?.trim() || null;
  const line2 = v.NamedInsured_MailingAddress_LineTwo_A?.trim() || null;
  return {
    id: `acct-h-${input.companyId}`,
    name: v.NamedInsured_FullName_A?.trim() || input.fallbackName,
    dba: null,
    industry: "—",
    addressLine1: [line1, line2].filter(Boolean).join(", ") || null,
    city: v.NamedInsured_MailingAddress_CityName_A?.trim() || null,
    state: v.NamedInsured_MailingAddress_StateOrProvinceCode_A?.trim() || "",
    zip: v.NamedInsured_MailingAddress_PostalCode_A?.trim() || null,
    primaryUwId: input.underwriterId,
    backupUwId: null,
    notes: null,
    // Imported policies are on the books; payment is not this contract's
    // to state, so service is active and the ledger stays the authority.
    status: "active",
    paymentReceivedAt: null,
  };
}
