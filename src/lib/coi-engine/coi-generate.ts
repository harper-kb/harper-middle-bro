import "server-only";
// readableLine is the SHARED coverage-line → certificate-section reading; it
// lives in coi-context so the queue card's policy tier folds a spelling exactly
// the way this generation does (#1089).
import { coverageFromFieldValues, certificateLineSection as readableLine, certificateLineKey as lineKey, type CoiContext } from "./coi-context";
import { docInsuredDisplayName } from "./coi-doc-extract";
import { ACORD25_TEMPLATE_B64 } from "./acord25-template";
import { ACORD30_TEMPLATE_B64 } from "./acord30-template";
import acord25Schema from "./acord25-schema.json";
import acord30Schema from "./acord30-schema.json";
import { COI_FORMS, type CoiFormType } from "./coi-forms";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fillCoiPdfForm, fillCoiPdfFormWithReport, normalizeCoiFieldValues, normalizeTextFieldValue, formatCertificateDateInEasternTime, type CoiPdfFormSchema } from "./coi-pdf";
import { COI_PRODUCER_DEFAULTS } from "./coi-producer";
import { reconcileAcord30Projection } from "./coi-acord30-authoritative";
import { DESCRIPTION_BOX, DESCRIPTION_FIELD_ID, descriptionFitPlan, descriptionOverflowSentence, type DescriptionFitPlan } from "./acord25-descfit";
// PresendLine used to be a type-only import from HTA's service/presend-gate;
// the send lane wasn't ported, so the shape lives here (the one consumer is
// descriptionFitPresendLine below).
export type PresendLineState = "clear" | "flag" | "unknown";
export interface PresendLine {
  id: "description";
  label: string;
  state: PresendLineState;
  // The record fact behind the state — a red line carries its receipt, a
  // green line states what was checked, a grey line says what couldn't be
  // read. Never empty.
  receipt: string;
}
import {
  canonicalLimitKeyFromLabel,
  mapCanonicalCoiToAcord25Fields,
} from "./coi-deterministic-mapper";
import {
  coiCoverageBasisFromValue,
  coiPolicyLineFromText,
  emptyCoiAddress,
  type CanonicalCoiGenerationInput,
  type CoiGenerationPolicy,
} from "./coi-generation-contract";

// ── The certificate factory ───────────────────────────────────────────────────
// When no issued ACORD 25 exists, the system GENERATES one: it completes every
// field it can from REAL sources (bound policy + deal + company + the request
// thread) plus standard insurance expertise (holder / description / operations),
// runs a CHECKER that reconciles the printed coverage against the bound policy,
// and renders a real, editable ACORD 25 PDF.
//
// HARD GUARDRAIL: coverage numbers, limits, and dates come from the REAL policy
// only. We NEVER invent a limit, coverage, or date. Genuine gaps are printed as
// "CONFIRM — not in policy" and flagged by the checker, not guessed.
//
// THE FALLBACK LADDER (the binder-on-file zero-fill, 2026-07-14): when the
// structured stores hold nothing, the fill falls through the account's REAL
// evidence instead of rendering empty — per field, in this order:
//   saved cert field_values (the route's own branch 1, unchanged)
//   → the bound-policy record (insurance.policy)
//   → the deal record (deals_v2)
//   → the EXTRACTION of the authoritative source document on file
//     (binder / dec page / policy PDF — ctx.docExtraction, source "document")
//   → the prior generated certificate's own values (ctx.priorCert,
//     source "prior-cert")
//   → the POLICY-FORMS EXTRACTION SEAM's summary row for this policy
//     (policy_forms.policy_coverage_summary — carrier with the contract's
//     paper-verified precedence, policy number, term dates; DR's Loom item
//     3, 2026-07-17: "it shouldn't even start the certificate from scratch,
//     there's already a policy" — source "extraction")
//   → missing (honestly blank, flagged CONFIRM — never guessed).

export type Source = "policy" | "deal" | "company" | "request" | "document" | "prior-cert" | "extraction" | "expert" | "missing";

// The policy-forms extraction seam's facts, as the completion consumes them
// (the route reads the seam through the harper_ops door and passes the picked
// summary in — this module stays I/O-free). Every field nullable: the ladder
// fills ONLY what the row actually carries, never a guess.
export interface CoverageExtractionFacts {
  policyNumber: string | null;
  carrier: string | null;
  // The insurer as printed on the policy paper (paper_verified_carrier) —
  // the seam contract's precedence: when set, it wins over the catalog name.
  paperVerifiedCarrier: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  blanketAi?: boolean | null;
  scheduledAi?: boolean | null;
  waiverSubrogation?: boolean | null;
  primaryNoncontributory?: boolean | null;
  endorsementForms?: string[];
  extractionStatus?: string | null;
  minConfidence?: number | null;
  avgConfidence?: number | null;
  coiMinConfidence?: number | null;
  coiAvgConfidence?: number | null;
  coiFormCount?: number | null;
}

export interface FieldVal {
  value: string;
  source: Source;
}

export interface Completion {
  namedInsured: FieldVal;
  insuredAddress: FieldVal;
  // Street/zip ride only when a document-sourced insured block carried them
  // (optional so completions built elsewhere — e.g. form-selection tests —
  // stay valid).
  insuredStreet?: string;
  insuredStreet2?: string;
  insuredCity: string;
  insuredState: string;
  insuredZip?: string;
  carrier: FieldVal;
  carrierNaic?: string | null;
  policyNumber: FieldVal;
  effectiveDate: FieldVal;
  expirationDate: FieldVal;
  // OTHER-row identity when specialty was folded from a sibling policy
  // (or withheld when mixed). Absent → stamp the selected policy's identity.
  otherPolicyNumber?: FieldVal;
  otherEffectiveDate?: FieldVal;
  otherExpirationDate?: FieldVal;
  coverageLines: string[];
  coverageSource: Source;
  // Lines the record carries that an operator already took off this account's
  // certificate, and which this completion therefore left off (#1089). Kept on
  // the completion so the checker can state the drop instead of it reading as a
  // record with no coverage.
  operatorRemovedLines?: string[];
  limits: { line: string; label: string; amount: string }[];
  limitsSource: Source;
  deductible: FieldVal;
  holderName: FieldVal;
  holderAddress: FieldVal;
  descriptionOfOperations: FieldVal;
  specialWording: string | null;
  /**
   * Versioned policy-derived generation contract. The default-off legacy path
   * ignores it; the deterministic path consumes only this record.
   */
  generationInput?: CanonicalCoiGenerationInput;
}

export interface CheckResult {
  status: "match" | "flagged";
  reconciled: { field: string; ok: boolean; detail: string }[];
  flags: string[];
  // THE RECEIPT BASIS (Lane 2's checker receipts, 2026-07-08 — Tanya's walk:
  // "reconciles" rendered over a card whose own body said there was no
  // document to reconcile against): WHAT this check ran against, in plain
  // words — or null when there was genuinely nothing to check against, in
  // which case NO verdict may render (coi-checker-receipt.ts is the one
  // chip derivation). Optional so persisted/older payloads type-check.
  basis?: string | null;
}

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  // UTC getters, deliberately: policy dates arrive as UTC midnights
  // ("2025-05-30T00:00:00Z"), and local getters rendered them ONE DAY EARLY
  // in Pacific — the COI grader's first cycle caught 22 of 25 sampled certs
  // printing wrong effective/expiration dates (2026-07-07). A certificate
  // with the wrong coverage dates is an E&O paper.
  return `${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${String(dt.getUTCDate()).padStart(2, "0")}/${dt.getUTCFullYear()}`;
}

// Coverage lines that belong on the ACORD 25 OTHER row — not GL/Auto/Umbrella/WC.
// Used both to keep specialty limits out of the GL cells and to project the
// OTHER section. Untagged limits still fall through to GL (historical behavior).
// Every standard row below is DERIVED from the one shared fold rather than listed
// as a substring here, so a new rung in the fold needs no second table and a cell
// that merely CARRIES a row's words cannot claim it.

// The statutory row is decided by the ONE shared fold, not by a substring read
// (#2240). `workers\s*comp|^wc$` here claimed any cell that merely CARRIED the
// words, so a compound cell the fold declines — "Workers Comp/EPLI" — printed on
// NEITHER row: barred from OTHER by this test, and swept into the WC section by
// the matching substring in the fill below. The EPLI half left the paper, and the
// WC row the operator emptied re-filled itself from the cell that survived.
// Derived rather than listed, so a new rung in the fold needs no second table.
function isWcSectionLine(line: string): boolean {
  return readableLine(line) === readableLine("WC");
}

// And the umbrella row, for the same reason on the same terms (#2460).
// `umbrella|excess` — in the standard-section alternation this file used to keep
// above, and in the two fill reads
// below — claimed any cell that merely CARRIED the word, so a compound cell the
// fold now declines ("Umbrella/Cargo") printed on NEITHER row: barred from OTHER
// here, while the fill stamped the selected policy's number and term into the
// real UMBRELLA row on its behalf and its own limit found no cell to land in.
function isUmbrellaSectionLine(line: string): boolean {
  return readableLine(line) === readableLine("Umb");
}

// And the general liability row, for the same reason on the same terms (#2540).
// `general liab|^gl$` — in that same alternation and in every GL read below
// — claimed any cell that merely CARRIED the words, so a compound cell the fold now
// declines ("General Liability/EPLI") printed on NEITHER row: barred from OTHER
// here, while the fill stamped the selected policy's number and term into the real
// GENERAL LIABILITY row on its behalf and filed the sibling half's amount in that
// row's own free-text limit pair. Derived from the fold, so the `CGL` spelling
// #2459 charted needs no second table here either.
function isGlSectionLine(line: string): boolean {
  return readableLine(line) === readableLine("GL");
}

// And the automobile row — the last standard row still listed rather than derived
// (#2803, "Coverage line removed: CA — Commercial Auto. Why: removed", the fourth
// arrival of this sentence). `automobile|^auto$` above and `/automobile/i` in the two
// auto fill reads below claimed any cell that merely CARRIED the word, so a compound
// cell the fold has declined since #2404 — "Automobile Liability/Cargo" — printed on
// NEITHER row: barred from OTHER here, while the fill stamped the selected policy's
// insurer letter, number and term into the real AUTOMOBILE row on its behalf and
// routed the cargo half's limit into that row's own cells, so a bound line left the
// customer's certificate. Seeded with the ask's own spelling, so #2181's bare `CA`
// needs no second table here either.
function isAutoSectionLine(line: string): boolean {
  return readableLine(line) === readableLine("CA");
}

/** Specialty / non-standard lines that print on the ACORD 25 OTHER row. */
export function isOtherCoverageLine(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  return !(isWcSectionLine(s) || isUmbrellaSectionLine(s) || isGlSectionLine(s) || isAutoSectionLine(s));
}

/**
 * Fill blank cells on a stored/partial field-values map from a fresh
 * projection — never overwrite a non-empty value. Used when populate saved a
 * cert with empty limits while the bound policy still holds them.
 */
export function fillBlankCoiFieldValues(
  base: Record<string, string>,
  overlay: Record<string, string>,
): Record<string, string> {
  const next = { ...base };
  for (const [fieldId, value] of Object.entries(overlay)) {
    if (!value?.trim()) continue;
    if (next[fieldId]?.trim()) continue;
    next[fieldId] = value;
  }
  return next;
}

const AI_CHECKBOX_FIELD_IDS = [
  "cglAdditionalInsuredCheckbox",
  "autoAdditionalInsuredCheckbox",
  "umbrellaAdditionalInsuredCheckbox",
  "otherInsuranceAdditionalInsuredCheckbox",
] as const;

const WOS_CHECKBOX_FIELD_IDS = [
  "cglSubrogationWaivedCheckbox",
  "autoSubrogationWaivedCheckbox",
  "umbrellaSubrogationWaivedCheckbox",
  "workersCompSubrogationWaivedCheckbox",
  "otherInsuranceSubrogationWaivedCheckbox",
] as const;

/**
 * Clear ADDL INSD / SUBR WVD stamps that lack policy-forms evidence.
 * Stored/populate drafts sometimes paint Y from a holder ask; re-issue must
 * not keep those when extraction does not attest them (Tanya 2026-07-28).
 */
export function stripUnattestedEndorsementCheckboxes(
  values: Record<string, string>,
  coverage: CoverageExtractionFacts | null | undefined,
): Record<string, string> {
  const next = { ...values };
  const aiOk = coverage?.blanketAi === true || coverage?.scheduledAi === true;
  const wosOk = coverage?.waiverSubrogation === true;
  if (!aiOk) {
    for (const id of AI_CHECKBOX_FIELD_IDS) {
      if (id in next) next[id] = "";
    }
  }
  if (!wosOk) {
    for (const id of WOS_CHECKBOX_FIELD_IDS) {
      if (id in next) next[id] = "";
    }
  }
  return next;
}

export interface CompletionProjectionOpts {
  coverageExtraction?: CoverageExtractionFacts | null;
  endorsementNeed?: string | null;
  /** Legacy request context; the Hercules memory pass owns Description. */
  requestWording?: string | null;
  /**
   * Stored Opal field_values are the ACORD 30 authority; the local 45-cell
   * projection is compatibility fallback only.
   */
  canonicalFieldValues?: Record<string, string> | null;
  /** Test/config override. Omit to read COI_DETERMINISTIC_GENERATOR_ENABLED. */
  deterministicGeneratorEnabled?: boolean;
}

// Build the completed certificate values from the real context + expertise.
export function buildCompletion(
  ctx: CoiContext,
  opts?: {
    endorsementNeed?: string | null;
    holderFallback?: string | null;
    coverageExtraction?: CoverageExtractionFacts | null;
    /** Holder-specific wording from the request card (Description prefill). */
    requestWording?: string | null;
  },
): Completion {
  const p = ctx.policy;
  // AN UNBOUND DEAL IS NOT AN EVIDENCE TIER (feedback plane #1128: "Coverage
  // line removed: WC — WC. Why: No workers' comp"). coi-data.ts's ledger rule
  // ("BOUND = real policy number AND deal_stage 'bound'; anything else is
  // UNBOUND") + coi-checklist.ts's line-bind item ("NEVER certificate a line
  // that is not actually bound — direct E&O exposure"). `loadCoiContext` sets
  // `deal.bound` by that SAME rule (number + stage — Greptile's catch here: a
  // stage-bound row with no policy number is unbound), and it already prefers a
  // bound row, so an unbound pick means the account has NO bound deal row at
  // all — the row is a quote, and a quote's lines, number, term
  // and carrier all print as certificate facts (every section below stamps the
  // SAME policy number and dates, so a quoted WC row could put its number on a
  // document-sourced GL row). Gated HERE rather than per-rung so the ladder has
  // one rule: the unbound row falls through exactly as if it carried nothing.
  // The rows stay editable, so this is a default, not a block.
  const d = ctx.deal?.bound ? ctx.deal : null;
  // The two evidence tiers below the structured records: the extraction of
  // the authoritative source document on file, then the account's own prior
  // generated certificate. Both are READ evidence — never invention.
  const x = ctx.docExtraction;
  const pc = ctx.priorCert ? coverageFromFieldValues(ctx.priorCert.fieldValues) : null;
  // The policy-forms extraction seam's row (the ladder's new last rung before
  // missing): facts READ from the bound policy's own forms by the extraction
  // pipeline. Fills only where every higher tier came up empty — and FAILS
  // CLOSED when a higher tier resolved a DIFFERENT policy number than the
  // seam row carries (the Bugbot catch on this lane: the route's guard covers
  // the bound-policy/param target, but the certificate's number can also
  // resolve from the deal, the doc extraction, or the prior cert — a
  // mismatched row there would print another policy's carrier and dates).
  // When a higher tier resolved a number, ONLY an exactly-matching seam row
  // serves — a row carrying a different number OR none at all is unproven
  // for this policy (the security review's null-number fold).
  // `ctx.deal`, not the bound-gated `d`: this guard asks whether ANY tier
  // resolved a number the seam row must match, and an unbound row's number
  // still counts — dropping the deal as a tier may not open this door.
  const higherTierPolicyNumber = p?.policyNumber || ctx.deal?.policyNumber || x?.policyNumber || pc?.policyNumber || "";
  const cxRaw = opts?.coverageExtraction ?? null;
  const cx = cxRaw && higherTierPolicyNumber && cxRaw.policyNumber !== higherTierPolicyNumber ? null : cxRaw;
  const cxCarrier = cx ? cx.paperVerifiedCarrier || cx.carrier : null;
  const xInsured = x ? docInsuredDisplayName(x) : null;

  // The insured identity resolves as a BLOCK (name + address travel together —
  // a policy-record name never wears a document's address, and vice versa).
  let namedInsured: FieldVal;
  let insuredStreet = ctx.company.street1 || "";
  let insuredStreet2 = ctx.company.street2 || "";
  let insuredCity = ctx.company.city || "";
  let insuredState = ctx.company.state || "";
  let insuredZip = ctx.company.zip || "";
  // Where the address BLOCK actually came from (Bugbot's PR #544 catch: the
  // old street-or-zip heuristic mislabeled a document city/state as company).
  let addressFrom: Source = "company";
  if (p?.namedInsured) {
    namedInsured = { value: p.namedInsured, source: "policy" };
  } else if (xInsured) {
    namedInsured = { value: xInsured, source: "document" };
    if (x?.insuredAddress) {
      // The document's address replaces the block WHOLESALE — no company
      // merge, so a document-named insured never wears half a company
      // address. A document naming the insured WITHOUT an address keeps the
      // company mailing address, honestly labeled company (the misfiled-
      // document guard below covers the divergent-identity case).
      insuredStreet = x.insuredAddress.street || "";
      insuredStreet2 = "";
      insuredCity = x.insuredAddress.city || "";
      insuredState = x.insuredAddress.state || "";
      insuredZip = x.insuredAddress.zip || "";
      addressFrom = "document";
    }
  } else if (pc?.insured) {
    namedInsured = { value: pc.insured, source: "prior-cert" };
  } else if (ctx.company.name) {
    namedInsured = { value: ctx.company.name, source: "company" };
  } else {
    namedInsured = { value: "", source: "missing" };
  }
  const address = [
    insuredStreet,
    insuredStreet2,
    [insuredCity, insuredState].filter(Boolean).join(", "),
    insuredZip,
  ]
    .filter(Boolean)
    .join(", ");
  const addressSource: Source = address ? addressFrom : "missing";

  // THE OPERATOR-REMOVAL LAW (#1089, "I already gave this feedback"): the ladder
  // below is record-first, so a line an operator BLANKED on this account's
  // certificate came back on every regeneration. A recorded removal outranks
  // every tier — the operator has already read the record and said no. Every
  // ACORD section (and the OTHER row) is gated on coverageLines, so dropping the
  // line here empties its whole row instead of half-printing it.
  // Matched on lineKey, not on the fold's bytes: an UNCHARTED line's identity is
  // the record's own spelling, so a removal recorded off a sheet that said
  // "Aviation Hull" missed a policy row spelled "aviation hull" and the line
  // reprinted (#1523). `laddered` keeps the fold's bytes — those PRINT.
  const removedByOperator = new Set((ctx.operatorRemovedLines ?? []).map(lineKey));
  // SAY IT ONCE (plane #1977, "Coverage line removed: Garage — Garage. Why:
  // duplicate"): the tier this ladder picks is a raw coverage_type list deduped on
  // its own BYTES upstream, so two spellings of ONE line survive it — and once
  // folded, the certificate named that line twice, on the card's coverage read, in
  // the checker's receipt and in the OTHER row. Keyed on the fold's identity (the
  // same key the removal below matches on, never the bytes), the record's FIRST
  // spelling wins. The count of DISTINCT lines never changes.
  const ladderKeys = new Set<string>();
  const laddered = (p?.coverageLines?.length ? p.coverageLines : d?.coverageType?.length ? d.coverageType : x?.coverageLines.length ? x.coverageLines : (pc?.coverageLines ?? []))
    .map(readableLine)
    .filter((l) => {
      const key = lineKey(l);
      if (ladderKeys.has(key)) return false;
      ladderKeys.add(key);
      return true;
    });
  const coverageLines = laddered.filter((l) => !removedByOperator.has(lineKey(l)));
  const operatorRemovedLines = laddered.filter((l) => removedByOperator.has(lineKey(l)));
  const coverageSource: Source = p?.coverageLines?.length ? "policy" : d?.coverageType?.length ? "deal" : x?.coverageLines.length ? "document" : pc?.coverageLines.length ? "prior-cert" : "missing";
  const policyNumber = p?.policyNumber || d?.policyNumber || x?.policyNumber || pc?.policyNumber || cx?.policyNumber || "";
  const policyNumberSource: Source = p?.policyNumber ? "policy" : d?.policyNumber ? "deal" : x?.policyNumber ? "document" : pc?.policyNumber ? "prior-cert" : cx?.policyNumber ? "extraction" : "missing";
  // Prior-cert dates are already display-formatted (they came off a filled
  // ACORD); everything else formats through the UTC-safe fmtDate.
  const effective = fmtDate(p?.effectiveDate ?? null) || fmtDate(d?.effectiveDate ?? null) || fmtDate(x?.effectiveDate ?? null) || pc?.effectiveDate || fmtDate(cx?.effectiveDate ?? null) || "";
  const effectiveSource: Source = p?.effectiveDate ? "policy" : d?.effectiveDate ? "deal" : x?.effectiveDate ? "document" : pc?.effectiveDate ? "prior-cert" : cx?.effectiveDate ? "extraction" : "missing";
  const expiration = fmtDate(p?.expirationDate ?? null) || fmtDate(d?.expirationDate ?? null) || fmtDate(x?.expirationDate ?? null) || pc?.expirationDate || fmtDate(cx?.expirationDate ?? null) || "";
  const expirationSource: Source = p?.expirationDate ? "policy" : d?.expirationDate ? "deal" : x?.expirationDate ? "document" : pc?.expirationDate ? "prior-cert" : cx?.expirationDate ? "extraction" : "missing";
  // A removed line's limits leave with it, or its numbers still print: the
  // ACORD 30 routes an unclaimed limit by its LABEL alone, so a removed WC
  // "Each Accident" limit landed in the garage row's own cell. Untagged limits
  // are attributable to no line and keep their historical GL fall-through.
  const ladderedLimits = p?.limits?.length ? p.limits : x?.limits.length ? x.limits : (pc?.limits ?? []);
  const limits = ladderedLimits.filter((lim) => !lim.line || !removedByOperator.has(lineKey(lim.line)));
  const limitsSource: Source = p?.limits?.length ? "policy" : x?.limits.length ? "document" : pc?.limits.length ? "prior-cert" : "missing";
  const carrier = d?.carrier || x?.carrier || ctx.carrierFromDocs || pc?.carrier || cxCarrier || "";
  const carrierSource: Source = d?.carrier ? "deal" : x?.carrier || ctx.carrierFromDocs ? "document" : pc?.carrier ? "prior-cert" : cxCarrier ? "extraction" : "missing";
  const deductible = p?.deductible || x?.deductible || "";
  const deductibleSource: Source = p?.deductible ? "policy" : x?.deductible ? "document" : "missing";

  // Description of Operations is request intent only. The persisted pipeline
  // resolves it from the same memory pass as the certificate holder.
  const holderName = ctx.holder.name || opts?.holderFallback || "";
  // This non-agent fallback cannot reliably distinguish a general ticket from
  // field-specific wording. Leave it blank; the persisted Hercules request-
  // context pass is the sole automatic writer.
  const description = "";
  const extractedAddress =
    addressFrom === "document"
      ? x?.generationInput?.insured.address
      : undefined;
  const resolvedAddress = {
    street1: extractedAddress?.street1 ?? insuredStreet,
    street2: extractedAddress?.street2 ?? insuredStreet2,
    city: extractedAddress?.city ?? insuredCity,
    state: extractedAddress?.state ?? insuredState,
    zip: extractedAddress?.zip ?? insuredZip,
    country:
      extractedAddress?.country ?? ctx.company.country ?? "",
  };
  const extractedGenerationInput =
    coverageSource === "document" ? x?.generationInput : undefined;
  let generationInput: CanonicalCoiGenerationInput;
  if (extractedGenerationInput) {
    generationInput = {
      insured: {
        legalName: namedInsured.value,
        address: resolvedAddress,
      },
      carriers: extractedGenerationInput.carriers.map((entry, index) => ({
        ...entry,
        naicCode:
          index === 0 && !entry.naicCode && ctx.carrierNaic
            ? ctx.carrierNaic
            : entry.naicCode,
      })),
      policies: extractedGenerationInput.policies.map((entry) => ({
        ...entry,
        limits: entry.limits.map((limit) => ({ ...limit })),
      })),
    };
  } else {
    const carrierRef = "carrier-A";
    const policies: CoiGenerationPolicy[] = [];
    for (const displayName of coverageLines) {
      const line = coiPolicyLineFromText(displayName);
      if (line !== "other" && policies.some((policy) => policy.line === line)) {
        continue;
      }
      const extractedPolicy = x?.generationInput?.policies.find(
        (policy) => policy.line === line,
      );
      const policyLimits = limits
        .filter((limit) => {
          if (!limit.line) return line === "cgl";
          return coiPolicyLineFromText(readableLine(limit.line)) === line;
        })
        .map((limit) => ({
          key: canonicalLimitKeyFromLabel(displayName, limit.label),
          amount: limit.amount,
          rawLabel: limit.label,
        }));
      const otherIdentity = line === "other" ? p?.otherSection : null;
      policies.push({
        line,
        displayName,
        carrierRef,
        policyNumber:
          line === "other" && otherIdentity
            ? otherIdentity.policyNumber ?? ""
            : policyNumber,
        effectiveDate:
          line === "other" && otherIdentity
            ? fmtDate(otherIdentity.effectiveDate) ?? ""
            : effective,
        expirationDate:
          line === "other" && otherIdentity
            ? fmtDate(otherIdentity.expirationDate) ?? ""
            : expiration,
        coverageBasis:
          extractedPolicy?.coverageBasis ??
          coiCoverageBasisFromValue(p?.coverageBasis),
        limits: policyLimits,
      });
    }
    generationInput = {
      insured: {
        legalName: namedInsured.value,
        address: resolvedAddress,
      },
      carriers:
        carrier || ctx.carrierNaic
          ? [
              {
                ref: carrierRef,
                slot: "A",
                legalName: carrier,
                naicCode: ctx.carrierNaic ?? "",
              },
            ]
          : [],
      policies,
    };
  }

  return {
    namedInsured,
    insuredAddress: { value: address, source: addressSource },
    insuredStreet,
    insuredStreet2,
    insuredCity,
    insuredState,
    insuredZip,
    // THE NO-FALSE-ABSENCE LAW (the roadside-binder/IFG fix, DR 2026-07-07): when
    // the structured fields hold no carrier but the binder document's own
    // extraction or title names one, that IS carrier data — cited to the
    // document, marked confirm-inside-the-binder by the checker below.
    carrier: { value: carrier, source: carrierSource },
    carrierNaic: ctx.carrierNaic ?? null,
    policyNumber: { value: policyNumber, source: policyNumberSource },
    effectiveDate: { value: effective, source: effectiveSource },
    expirationDate: { value: expiration, source: expirationSource },
    ...(p?.otherSection
      ? {
          otherPolicyNumber: {
            value: p.otherSection.policyNumber || "",
            source: (p.otherSection.policyNumber ? "policy" : "missing") as Source,
          },
          otherEffectiveDate: {
            value: fmtDate(p.otherSection.effectiveDate ?? null) || "",
            source: (p.otherSection.effectiveDate ? "policy" : "missing") as Source,
          },
          otherExpirationDate: {
            value: fmtDate(p.otherSection.expirationDate ?? null) || "",
            source: (p.otherSection.expirationDate ? "policy" : "missing") as Source,
          },
        }
      : {}),
    coverageLines,
    coverageSource,
    operatorRemovedLines,
    limits,
    limitsSource,
    deductible: { value: deductible, source: deductibleSource },
    holderName: { value: holderName, source: ctx.holder.name ? "request" : opts?.holderFallback ? "request" : "missing" },
    holderAddress: { value: ctx.holder.address || "", source: ctx.holder.address ? "request" : "missing" },
    descriptionOfOperations: { value: description, source: description ? "request" : "missing" },
    specialWording: description || null,
    generationInput,
  };
}

// Reconcile the generated certificate against the bound policy + flag gaps.
export function runChecker(c: Completion, ctx: CoiContext): CheckResult {
  const reconciled: { field: string; ok: boolean; detail: string }[] = [];
  const flags: string[] = [];
  const add = (field: string, ok: boolean, detail: string) => {
    reconciled.push({ field, ok, detail });
    if (!ok) flags.push(detail);
  };

  const bound = Boolean(ctx.deal?.bound || ctx.policy?.status === "bound");
  add("Policy bound", bound, bound ? "Policy is bound/in-force." : "Policy is not confirmed bound — do not issue until in force.");
  add("Named insured", Boolean(c.namedInsured.value), c.namedInsured.value ? `Named insured: ${c.namedInsured.value} (${c.namedInsured.source}).` : "Named insured missing.");
  // THE MISFILED-DOCUMENT GUARD (the misfiled-paper find, live validation
  // 2026-07-14: the account's classified "policy document" was ANOTHER
  // insured's paper — a document-sourced fill would have printed a stranger's
  // name). A document-read insured that shares no name token with the account
  // is a named confirm: the document may not belong to this account. Never a
  // block — the account name and the paper's name legitimately differ on
  // dba/personal-name accounts (the flagged account's own shape) — but always said.
  if (c.namedInsured.source === "document" && ctx.company.name) {
    const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["llc", "inc", "dba", "the", "and", "company", "corp"].includes(w)));
    const docTokens = tokens(c.namedInsured.value);
    const accountTokens = tokens(ctx.company.name);
    const overlaps = [...docTokens].some((t) => accountTokens.has(t));
    add(
      "Insured matches account",
      overlaps,
      overlaps
        ? "The document's named insured shares the account's name."
        : `The source document names "${c.namedInsured.value}" but the account is "${ctx.company.name}" — confirm the document belongs to this account before issuing.`,
    );
  }
  // Neither a line an operator removed nor a line sitting on an UNBOUND deal is
  // an absence in the record — saying "no coverage line found" over either would
  // be a false claim (the NO-FALSE-ABSENCE LAW below). The removal details are
  // operator-facing prose, so they carry no em dash (the voice canon's banned
  // register, lintOperatorCopy's `em-dash` rule).
  const removedNames = (c.operatorRemovedLines ?? []).join(", ");
  const unboundDealLines = ctx.deal && !ctx.deal.bound ? ctx.deal.coverageType.map(readableLine) : [];
  add(
    "Coverage lines",
    c.coverageLines.length > 0,
    c.coverageLines.length
      ? `Coverage: ${c.coverageLines.join(", ")} (${c.coverageSource}).`
      : removedNames
        ? `Every line on the record (${removedNames}) was removed from this account's certificate by an operator. Confirm what this holder needs before issuing.`
        : unboundDealLines.length
          ? `The only coverage on file is UNBOUND: ${unboundDealLines.join(", ")} sits on a quoted/pending deal record. An unbound line may not be certificated. Confirm the bind first.`
          : "No coverage line found on the policy/deal.",
  );
  // THE REMOVAL IS ACCOUNT-WIDE; THE REQUEST IS THIS CERTIFICATE'S OWN (plane
  // #2394, "Coverage line removed: WC — WC. Why: We can't send this to Peter.").
  // Every other note in that family gives a reason about the COVERAGE ("does not
  // do WC", #2240) — a durable fact about the account, which is what the removal
  // memory records: it is keyed on the company and nothing else
  // (coverageLinesRemovedByCompany), and the delta's own note never enters the
  // read. This one gives a reason about the RECIPIENT, so the removal rode the
  // NEXT holder's certificate, and the receipt below passed over it: `add` flags
  // only on ok=false, so the workers' comp row left a customer's paper while the
  // request that named it went unmentioned. Holder-SCOPING the memory is the
  // wider fix and is not this one (it re-keys the read, the batch read and every
  // #1089 pin); stating the collision is.
  // The line still stays OFF — a recorded removal outranks every tier (#1089)
  // and re-printing one on the strength of a keyword scan is the destructive
  // direction — so this is a confirm, not a re-add. Read through lineKey, the
  // same fold the drop itself matched on above, so a removal recorded off `WC`,
  // `Work Comp` or `Employers Liability` and a request spelled `Workers
  // Compensation` cannot disagree on one line's identity.
  // KNOWN COST, named rather than hidden: detectRequestedLines is a keyword scan,
  // so a phantom request mints this confirm too. It is the same source line-bind
  // already flags off, and a dismissed confirm is the cheap direction next to a
  // requested line silently missing from the paper.
  const requestedKeys = new Set((ctx.requestedLines ?? []).map(lineKey));
  const removedButRequested = (c.operatorRemovedLines ?? []).filter((l) => requestedKeys.has(lineKey(l)));
  const removedQuietly = (c.operatorRemovedLines ?? []).filter((l) => !requestedKeys.has(lineKey(l)));
  // The drop is stated, never silent — and it never flags: the certificate is
  // following the operator's own recorded correction, not failing a check.
  if (c.coverageLines.length && removedQuietly.length) {
    add("Operator-removed coverage", true, `${removedQuietly.join(", ")} is on the record but was removed from this account's certificate by an operator. Kept off, per that correction.`);
  }
  if (removedButRequested.length) {
    add(
      "Requested line removed",
      false,
      `${removedButRequested.join(", ")} was removed from this account's certificate by an operator, and this request asks for it. Kept off, per that correction. Confirm with the holder before issuing.`,
    );
  }
  add("Policy number", Boolean(c.policyNumber.value), c.policyNumber.value ? `Policy #: ${c.policyNumber.value} (${c.policyNumber.source}).` : "Policy number not found.");
  add("Effective date", Boolean(c.effectiveDate.value), c.effectiveDate.value ? `Effective ${c.effectiveDate.value} (${c.effectiveDate.source}).` : "Effective date not in policy — confirm.");
  add("Expiration date", Boolean(c.expirationDate.value), c.expirationDate.value ? `Expiration ${c.expirationDate.value} (${c.expirationDate.source}).` : "Expiration date not in policy — confirm.");
  // THE NO-FALSE-ABSENCE LAW (DR, 2026-07-07, the roadside-assistance account:
  // the bench said "no carrier data" while the IFG Companies Garage Coverage
  // Binder sat on the company's documents page): an absence claim is legal
  // only after ALL reachable sources are consulted — the structured fields
  // AND the document corpus. When a binder/dec page exists unparsed, the
  // honest claim points AT it, never asserts absence.
  const binderNote = ctx.binder
    ? ` The authoritative source likely sits in the document corpus: "${ctx.binder.name}"${ctx.binder.createdAt ? ` (${ctx.binder.createdAt.slice(0, 10)})` : ""} — not yet extracted; open it to confirm.`
    : "";
  // Per-source receipts for the fallback tiers: a document-sourced or
  // prior-cert-sourced value is REAL evidence, but it isn't the structured
  // bound-policy record — the checker names where it came from and keeps the
  // confirm-against-the-source posture on it.
  const docReceipt = ctx.docExtraction ? `the extraction of "${ctx.docExtraction.docName}"` : "the source document's extraction";
  const mappedLimitCount = c.limits.filter((lim) => {
    const line = lim.line ? readableLine(lim.line) : "";
    return Boolean(limitFieldId(line, lim.label) || (line && isOtherCoverageLine(line)));
  }).length;
  const limitsDetail =
    c.limitsSource === "policy"
      ? `${c.limits.length} limit(s) sourced from insurance.policy${mappedLimitCount < c.limits.length ? ` — ${mappedLimitCount} mapped to the form, ${c.limits.length - mappedLimitCount} unmapped (confirm)` : ""}.`
      : c.limitsSource === "document"
        ? `${c.limits.length} limit(s) read from ${docReceipt} — confirm against the document before issuing.`
        : `${c.limits.length} limit(s) carried from this account's prior generated certificate — confirm still current before issuing.`;
  add(
    "Limits",
    c.limits.length > 0,
    c.limits.length
      ? limitsDetail
      : ctx.binder
        ? `Limits not in the structured policy fields.${binderNote}`
        : "No limits found in the structured policy fields or the document corpus — confirm before issuing (NOT auto-filled).",
  );
  if (c.limits.length > 0 && mappedLimitCount < c.limits.length) {
    add(
      "Limits mapped",
      false,
      `${c.limits.length - mappedLimitCount} of ${c.limits.length} policy limit(s) could not be placed on an ACORD cell — confirm before issuing.`,
    );
  }
  add(
    "Carrier",
    Boolean(c.carrier.value),
    c.carrier.value
      ? c.carrier.source === "document"
        ? ctx.docExtraction?.carrier
          ? `Carrier: ${c.carrier.value} — read from ${docReceipt}; confirm inside the document before issuing.`
          : `Carrier: ${c.carrier.value} — read from the binder document title ("${ctx.binder?.name ?? "binder"}"); confirm inside the binder before issuing.`
        : c.carrier.source === "extraction"
          ? `Carrier: ${c.carrier.value} — read by the policy-forms extraction from the policy's own forms; confirm against the policy documents before issuing.`
          : `Carrier: ${c.carrier.value} (${c.carrier.source}).`
      : ctx.binder
        ? `Carrier not in the structured fields.${binderNote}`
        : "Carrier not found in the structured fields or the document corpus — confirm.",
  );
  if (c.carrier.value) {
    add(
      "Carrier NAIC",
      Boolean(c.carrierNaic),
      c.carrierNaic
        ? `Carrier NAIC: ${c.carrierNaic} (carriers table).`
        : "Carrier NAIC not on file — confirm before issuing.",
    );
  }
  add("Certificate holder", Boolean(c.holderName.value), c.holderName.value ? `Holder: ${c.holderName.value} (${c.holderName.source}).` : "Certificate holder not identified in the request — confirm/add.");
  // THE EMPTY-REQUIRED-FIELDS RECEIPT (Tanya's Prairie Sky receipt: the READY
  // card wore "reconciles" over a blank holder mailing address): a required
  // field the certificate prints empty is a confirm, never silence under a
  // green verdict. Only when a holder is IDENTIFIED — a missing holder is
  // already its own flag above; a second address flag would double-charge
  // the same gap (the Bugbot catch).
  if (c.holderName.value) {
    add(
      "Holder mailing address",
      Boolean(c.holderAddress.value),
      c.holderAddress.value ? `Holder address: ${c.holderAddress.value} (${c.holderAddress.source}).` : "Holder mailing address empty on the certificate — confirm/add before sending.",
    );
  }

  // The basis: what this check actually ran against. Nothing → null, and the
  // chip derivation refuses to render a verdict with no basis (a verdict must
  // never render without a source — Tanya's law).
  const basisParts: string[] = [];
  if (ctx.policy) basisParts.push("the bound-policy record (insurance.policy)");
  if (ctx.deal) basisParts.push("the deal record (deals_v2)");
  if (ctx.docExtraction) basisParts.push(`the extraction of "${ctx.docExtraction.docName}"`);
  else if (ctx.binder) basisParts.push(`the binder document "${ctx.binder.name}"`);
  if (ctx.priorCert) basisParts.push("this account's prior generated certificate");
  // The seam tier names itself only when a fact actually rode it — a passed-in
  // row that filled nothing is not a basis.
  if ([c.carrier, c.policyNumber, c.effectiveDate, c.expirationDate].some((f) => f.source === "extraction")) {
    basisParts.push("the policy-forms extraction of the bound policy's forms");
  }
  return { status: flags.length ? "flagged" : "match", reconciled, flags, basis: basisParts.length ? basisParts.join(" + ") : null };
}

// Render the completed certificate as a real, editable ACORD 25 PDF (AcroForm
// text fields the reviewer edits directly in the viewer, then Save/Download).
// Map a policy limit label to Harper's ACORD 25 GL limit field_id (from
// acord25-schema.json / coi-pdf.ts COI_MONEY_FIELD_IDS).
function glLimitFieldId(label: string): string | null {
  const s = label.toLowerCase();
  // Compound labels like "Liability and Medical Expenses $X per occurrence"
  // name the occurrence limit — never the MED EXP cell (Tanya 2026-07-28).
  if (/\bliability\b/.test(s) && /medical/.test(s) && /(per|each)\s+occurrence/.test(s)) {
    return "eachOccurrenceLimit";
  }
  // Carriers print both "each occurrence" and "per occurrence".
  if (s.includes("each occurrence") || s.includes("per occurrence")) return "eachOccurrenceLimit";
  if (s.includes("premises") || s.includes("fire damage")) return "damageToRentedPremisesLimit";
  // Med Exp only when the label is ABOUT medical expense — not a compound
  // liability line that merely mentions medical wording above.
  if (/\bmed(?:ical)?\s*exp/.test(s) || (s.includes("medical") && !/\bliability\b/.test(s))) {
    return "medExpLimit";
  }
  if (s.includes("personal") || s.includes("advertising")) return "personalAndAdvInjuryLimit";
  if (s.includes("products") || s.includes("completed op")) return "productsCompOpAggLimit";
  if (s.includes("general aggregate") || s === "aggregate") return "generalAggregateLimit";
  return null;
}

// The other three ACORD 25 coverage sections' limit field_ids — same
// label-driven mapping, never positional. An unrecognized label maps nowhere
// (better an honest blank than a limit printed on the wrong ACORD row).
function autoLimitFieldId(label: string): string | null {
  const s = label.toLowerCase();
  if (s.includes("combined single")) return "combinedSingleLimit";
  if (s.includes("bodily injury") && s.includes("person")) return "bodilyInjuryPerPersonLimit";
  if (s.includes("bodily injury") && s.includes("accident")) return "bodilyInjuryPerAccidentLimit";
  if (s.includes("property damage")) return "propertyDamageLimit";
  return null;
}

function umbrellaLimitFieldId(label: string): string | null {
  const s = label.toLowerCase();
  if (s.includes("each occurrence") || s.includes("per occurrence")) return "umbrellaEachOccurrenceLimit";
  if (s.includes("aggregate")) return "umbrellaAggregateLimit";
  if (s.includes("retention") || s.includes("deductible")) return "retentionAmount";
  return null;
}

function wcLimitFieldId(label: string): string | null {
  const s = label.toLowerCase();
  if (s.includes("each accident")) return "workersCompEachAccidentLimit";
  if (s.includes("disease") && s.includes("employee")) return "workersCompDiseaseEachEmployeeLimit";
  if (s.includes("disease") && s.includes("policy")) return "workersCompDiseasePolicyLimit";
  return null;
}

export type CoverageRow = "gl" | "auto" | "umbrella" | "wc";

export function coverageRowForLine(line: string): CoverageRow | null {
  const s = line.toLowerCase();
  if (/general.?liab|^gl$/.test(s)) return "gl";
  // The auto row asks the fold here too (#2803). A bare `/auto/` was the loosest
  // of this file's three auto reads: it claimed every cell that merely CARRIED
  // the word — the compound cells the fold declines ("Automobile Liability/Cargo",
  // "Prop, Auto"), a policy-number token ("AUTOMOBILE-2026-114"), even
  // "automatic" — so this exported mapper still answered the AUTOMOBILE row's own
  // limit cells for a sibling half's amount while the section legs above had
  // stopped, and it answered NOTHING for the ask's own spelling (`CA`, which the
  // fold charts). Same predicate as the section legs, so the two reads cannot
  // disagree about which cells the row owns.
  if (isAutoSectionLine(line)) return "auto";
  if (/umbrella|excess/.test(s)) return "umbrella";
  if (/workers|(^|[^a-z])comp(ensation)?([^a-z]|$)|^wc$/.test(s)) return "wc";
  return null;
}

/** Standard-row limit mapper. Specialty lines intentionally use ACORD OTHER. */
export function limitFieldId(line: string, label: string): string | null {
  if (!line.trim()) return glLimitFieldId(label);
  const row = coverageRowForLine(line);
  if (row === "gl") return glLimitFieldId(label);
  if (row === "auto") return autoLimitFieldId(label);
  if (row === "umbrella") return umbrellaLimitFieldId(label);
  if (row === "wc") return wcLimitFieldId(label);
  return null;
}

// ── The form-type seam (Pratik's garage-certificate flag, 2026-07-14) ─────────
// The bench can now render more than the ACORD 25. Each renderable form pairs
// its vendored AcroForm template with its field schema HERE — the one place
// the byte-level assets resolve. A form the catalog marks template-less
// (ACORD 28 today) has no entry, and the fill below refuses it with the
// honest reason instead of silently substituting the 25.
const FORM_ASSETS: Partial<Record<CoiFormType, { templateB64: string; schema: CoiPdfFormSchema }>> = {
  acord25: { templateB64: ACORD25_TEMPLATE_B64, schema: acord25Schema as unknown as CoiPdfFormSchema },
  acord30: { templateB64: ACORD30_TEMPLATE_B64, schema: acord30Schema as unknown as CoiPdfFormSchema },
};

// Thrown when a caller asks for a form Harper holds no fillable template for.
// Routes catch it and answer with the honest gap (never a silent ACORD 25).
export class MissingFormTemplateError extends Error {
  readonly formType: CoiFormType;
  constructor(formType: CoiFormType) {
    super(`No fillable ${COI_FORMS[formType].label} template is on file — ${COI_FORMS[formType].title} can't render yet.`);
    this.name = "MissingFormTemplateError";
    this.formType = formType;
  }
}

function formAssets(form: CoiFormType): { templateB64: string; schema: CoiPdfFormSchema } {
  const assets = FORM_ASSETS[form];
  if (!assets) throw new MissingFormTemplateError(form);
  return assets;
}

// Project our completion onto Harper's ACORD 25 field_ids, then fill Harper's
// OWN committed template with Harper's OWN shared coi-pdf logic (same field-value
// normalization, money/date formatting, and X-mark checkbox provider BigBrother
// uses). Left editable in-app (flatten:false) so the reviewer edits + Saves —
// the same fill the operator editor shows, not a homemade or hand-drawn PDF.
// Project our completion onto Harper's ACORD 25 field_id → value map. Exported so
// the reinforcement loop can diff this SYSTEM-GENERATED baseline against the
// reviewer's corrected values (both sides, same field_id contract).
export function legacyCompletionToFieldValues(
  c: Completion,
  opts?: CompletionProjectionOpts | null,
): Record<string, string> {
  const values: Record<string, string> = {};
  values.certificateDate = formatCertificateDateInEasternTime();
  Object.assign(values, COI_PRODUCER_DEFAULTS);
  values.insuredName = c.namedInsured.value;
  if (c.insuredStreet) values["insuredAddress.street1"] = c.insuredStreet;
  if (c.insuredStreet2) values["insuredAddress.street2"] = c.insuredStreet2;
  values["insuredAddress.city"] = c.insuredCity;
  values["insuredAddress.state"] = c.insuredState;
  if (c.insuredZip) values["insuredAddress.zip"] = c.insuredZip;
  if (c.carrier.value) values.insurerAName = c.carrier.value;
  if (c.carrierNaic) values.insurerANaicNumber = c.carrierNaic;
  const fillUnmentionedLimits = (fieldIds: readonly string[]) => {
    for (const fieldId of fieldIds) {
      if (!values[fieldId]) values[fieldId] = "Excluded";
    }
  };

  // Project each coverage line the evidence names onto ITS ACORD 25 section —
  // the same policy number/term when a single policy carries the lines (the
  // one-policy contexts this builder completes from). Limits route by their
  // own line tag when the source carried one. Specialty lines (liquor, EPLI,
  // inland marine, …) never leak into GL — they land on the OTHER row.
  const limitsFor = (claim: (line: string) => boolean, mapper: (label: string) => string | null) => {
    for (const lim of c.limits) {
      const line = lim.line ? readableLine(lim.line) : "";
      if (!claim(line)) continue;
      const id = mapper(lim.label);
      if (id && !values[id]) values[id] = lim.amount;
    }
  };

  // The fold, not the words: see isGlSectionLine above.
  if (c.coverageLines.some(isGlSectionLine)) {
    values.commercialGeneralLiabilityCheckbox = "Y";
    values.cglOccurrenceCheckbox = "Y";
    values.cglInsurerLetter = "A";
    values.cglPolicyNumber = c.policyNumber.value;
    values.cglPolicyEffectiveDate = c.effectiveDate.value;
    values.cglPolicyExpirationDate = c.expirationDate.value;
    // GL takes untagged or GL-tagged limits only — never liquor/specialty.
    limitsFor((line) => !line || isGlSectionLine(line), glLimitFieldId);
    // A single unrecognized GL-tagged (or untagged) limit that isn't one of
    // the six standard cells lands in the GL "other" description/amount pair.
    for (const lim of c.limits) {
      const line = lim.line ? readableLine(lim.line) : "";
      if (line && !isGlSectionLine(line)) continue;
      if (glLimitFieldId(lim.label)) continue;
      if (!values.cglOtherLimitDescription && lim.amount) {
        values.cglOtherLimitDescription = lim.label;
        values.cglOtherLimitAmount = lim.amount;
      }
    }
    fillUnmentionedLimits([
      "eachOccurrenceLimit",
      "damageToRentedPremisesLimit",
      "medExpLimit",
      "personalAndAdvInjuryLimit",
      "generalAggregateLimit",
      "productsCompOpAggLimit",
    ]);
  }
  // The fold, not the words: see isAutoSectionLine above.
  if (c.coverageLines.some(isAutoSectionLine)) {
    values.autoLiabilityInsurerLetter = "A";
    values.autoLiabilityPolicyNumber = c.policyNumber.value;
    values.autoPolicyEffectiveDate = c.effectiveDate.value;
    values.autoPolicyExpirationDate = c.expirationDate.value;
    limitsFor(isAutoSectionLine, autoLimitFieldId);
    const splitLimitFields = [
      "bodilyInjuryPerPersonLimit",
      "bodilyInjuryPerAccidentLimit",
      "propertyDamageLimit",
    ] as const;
    const hasCombinedSingleLimit = Boolean(values.combinedSingleLimit);
    const hasSplitLimit = splitLimitFields.some((fieldId) => Boolean(values[fieldId]));
    // CSL and split BI/PD are alternative ways to express the same Auto
    // liability limit. An unused basis is not an affirmative exclusion.
    if (!hasCombinedSingleLimit) {
      if (hasSplitLimit) {
        fillUnmentionedLimits(splitLimitFields);
      } else {
        // The row exists but the evidence names no limit basis at all.
        fillUnmentionedLimits(["combinedSingleLimit", ...splitLimitFields]);
      }
    }
  }
  const hasGlLine = c.coverageLines.some(isGlSectionLine);
  if (c.coverageLines.some(isUmbrellaSectionLine)) {
    values.umbrellaLiabilityCheckbox = "Y";
    values.umbrellaOccurrenceCheckbox = "Y";
    values.umbrellaInsurerLetter = "A";
    values.umbrellaPolicyNumber = c.policyNumber.value;
    values.umbrellaPolicyEffectiveDate = c.effectiveDate.value;
    values.umbrellaPolicyExpirationDate = c.expirationDate.value;
    // Untagged limits may claim the umbrella row only when there is no GL
    // line to own them — otherwise untagged stays on GL (fail-closed).
    limitsFor(
      (line) => isUmbrellaSectionLine(line) || (!line && !hasGlLine),
      umbrellaLimitFieldId,
    );
    fillUnmentionedLimits([
      "umbrellaEachOccurrenceLimit",
      "umbrellaAggregateLimit",
    ]);
  }
  // The fold, not the words: see isWcSectionLine above.
  if (c.coverageLines.some(isWcSectionLine)) {
    values.workersCompInsurerLetter = "A";
    values.workersCompStatutoryCheckbox = "Y";
    values.workersCompPolicyNumber = c.policyNumber.value;
    values.workersCompPolicyEffectiveDate = c.effectiveDate.value;
    values.workersCompPolicyExpirationDate = c.expirationDate.value;
    limitsFor(isWcSectionLine, wcLimitFieldId);
    fillUnmentionedLimits([
      "workersCompEachAccidentLimit",
      "workersCompDiseaseEachEmployeeLimit",
      "workersCompDiseasePolicyLimit",
    ]);
  }

  // OTHER section — liquor, EPLI, inland marine, and any other non-standard line.
  // Empty limits stay blank (never invented); the row still gets policy #/dates.
  const otherLines = c.coverageLines.map(readableLine).filter(isOtherCoverageLine);
  const otherLimits = c.limits.filter((lim) => {
    const line = lim.line ? readableLine(lim.line) : "";
    return Boolean(line) && isOtherCoverageLine(line);
  });
  if (otherLines.length || otherLimits.length) {
    values.otherInsuranceDescription = [...new Set(otherLines.length ? otherLines : otherLimits.map((l) => readableLine(l.line)))].join("; ");
    // Specialty folded from a sibling: stamp that policy's identity when
    // unique; withhold when mixed (otherPolicyNumber present + empty). Own-
    // specialty or no fold: keep the selected policy's number/dates.
    const otherNumber = c.otherPolicyNumber ? c.otherPolicyNumber.value : c.policyNumber.value;
    const otherEff = c.otherEffectiveDate ? c.otherEffectiveDate.value : c.effectiveDate.value;
    const otherExp = c.otherExpirationDate ? c.otherExpirationDate.value : c.expirationDate.value;
    if (otherNumber) values.otherInsurancePolicyNumber = otherNumber;
    if (otherEff) values.otherInsurancePolicyEffectiveDate = otherEff;
    if (otherExp) values.otherInsurancePolicyExpirationDate = otherExp;
    if (otherLimits.length) {
      values.otherInsuranceLimits = otherLimits.map((l) => `${l.label}: ${l.amount}`).join("; ");
      // Map WC-shaped labels onto the OTHER section's accident/disease cells when present.
      for (const lim of otherLimits) {
        const id = wcLimitFieldId(lim.label);
        if (!id) continue;
        const otherId = id
          .replace("workersCompEachAccidentLimit", "otherInsuranceEachAccidentLimit")
          .replace("workersCompDiseaseEachEmployeeLimit", "otherInsuranceDiseaseEachEmployeeLimit")
          .replace("workersCompDiseasePolicyLimit", "otherInsuranceDiseasePolicyLimit");
        if (otherId !== id && !values[otherId]) values[otherId] = lim.amount;
      }
    }
  }

  // ADDL INSD / SUBR WVD — deterministic base fill from policy-forms evidence.
  // The learning reconciler remains the higher-confidence enhancer on top.
  // Both AI and WOS are fail-closed: a holder ask alone never stamps Y
  // without extraction evidence (Tanya 2026-07-28 — WOS/AI checked while
  // not on the policy). Description-of-operations wording may still note
  // the ask for the operator to confirm.
  const cx = opts?.coverageExtraction ?? null;
  const wantAi = cx?.blanketAi === true || cx?.scheduledAi === true;
  const wantWos = cx?.waiverSubrogation === true;
  if (wantAi || wantWos) {
    const stampSection = (policyId: string, aiId: string | null, wosId: string | null) => {
      if (!values[policyId]) return;
      if (wantAi && aiId) values[aiId] = "Y";
      if (wantWos && wosId) values[wosId] = "Y";
    };
    stampSection("cglPolicyNumber", "cglAdditionalInsuredCheckbox", "cglSubrogationWaivedCheckbox");
    stampSection("autoLiabilityPolicyNumber", "autoAdditionalInsuredCheckbox", "autoSubrogationWaivedCheckbox");
    stampSection("umbrellaPolicyNumber", "umbrellaAdditionalInsuredCheckbox", "umbrellaSubrogationWaivedCheckbox");
    stampSection("workersCompPolicyNumber", null, "workersCompSubrogationWaivedCheckbox");
    stampSection("otherInsurancePolicyNumber", "otherInsuranceAdditionalInsuredCheckbox", "otherInsuranceSubrogationWaivedCheckbox");
  }

  values.certificateHolderNameLine1 = c.holderName.value || "CONFIRM - holder not identified in request";
  if (c.holderAddress.value) values["certificateHolderAddressLine1.street1"] = c.holderAddress.value;

  values.descriptionOfOperations = c.descriptionOfOperations.value;
  return values;
}

function canonicalInputFromCompletion(
  completion: Completion,
): CanonicalCoiGenerationInput {
  if (completion.generationInput) return completion.generationInput;
  const carrierRef = "carrier-A";
  const policies: CoiGenerationPolicy[] = [];
  for (const displayName of completion.coverageLines) {
    const line = coiPolicyLineFromText(displayName);
    if (line !== "other" && policies.some((policy) => policy.line === line)) {
      continue;
    }
    policies.push({
      line,
      displayName,
      carrierRef,
      policyNumber:
        line === "other" && completion.otherPolicyNumber
          ? completion.otherPolicyNumber.value
          : completion.policyNumber.value,
      effectiveDate:
        line === "other" && completion.otherEffectiveDate
          ? completion.otherEffectiveDate.value
          : completion.effectiveDate.value,
      expirationDate:
        line === "other" && completion.otherExpirationDate
          ? completion.otherExpirationDate.value
          : completion.expirationDate.value,
      coverageBasis: "unknown",
      limits: completion.limits
        .filter((limit) => {
          if (!limit.line) return line === "cgl";
          return coiPolicyLineFromText(readableLine(limit.line)) === line;
        })
        .map((limit) => ({
          key: canonicalLimitKeyFromLabel(displayName, limit.label),
          amount: limit.amount,
          rawLabel: limit.label,
        })),
    });
  }
  return {
    insured: {
      legalName: completion.namedInsured.value,
      address: {
        ...emptyCoiAddress(),
        street1: completion.insuredStreet ?? "",
        street2: completion.insuredStreet2 ?? "",
        city: completion.insuredCity,
        state: completion.insuredState,
        zip: completion.insuredZip ?? "",
      },
    },
    carriers:
      completion.carrier.value || completion.carrierNaic
        ? [
            {
              ref: carrierRef,
              slot: "A",
              legalName: completion.carrier.value,
              naicCode: completion.carrierNaic ?? "",
            },
          ]
        : [],
    policies,
  };
}

export function deterministicCoiGeneratorEnabled(
  override?: boolean,
): boolean {
  return (
    override ??
    process.env.COI_DETERMINISTIC_GENERATOR_ENABLED === "true"
  );
}

export function deterministicCompletionToFieldValues(
  completion: Completion,
  opts?: CompletionProjectionOpts | null,
): Record<string, string> {
  const coverage = opts?.coverageExtraction ?? null;
  return mapCanonicalCoiToAcord25Fields(
    canonicalInputFromCompletion(completion),
    {
      certificateDate: formatCertificateDateInEasternTime(),
      producerFields: COI_PRODUCER_DEFAULTS,
      holderName: completion.holderName.value,
      holderAddress: completion.holderAddress.value,
      descriptionOfOperations: completion.descriptionOfOperations.value,
      additionalInsured:
        coverage?.blanketAi === true || coverage?.scheduledAi === true,
      waiverOfSubrogation: coverage?.waiverSubrogation === true,
    },
  );
}

/**
 * Structured divergence signal for the C5a auto-halt (DEC-85). While the
 * deterministic mapper serves traffic, the legacy projection shadow-runs on
 * the same completion and any field-level difference emits ONE log line the
 * probe watcher keys on. Logs field KEYS only — never values (no PII).
 * The detector must never fail generation, so it is fully fenced.
 */
export const COI_MAPPER_DIVERGENCE_MARKER = "COI_MAPPER_DIVERGENCE";

function emitMapperDivergenceSignal(
  completion: Completion,
  opts: CompletionProjectionOpts | null | undefined,
  deterministic: Record<string, string>,
): void {
  try {
    const legacy = legacyCompletionToFieldValues(completion, opts);
    const keys = new Set([...Object.keys(legacy), ...Object.keys(deterministic)]);
    const divergent: string[] = [];
    for (const key of keys) {
      if ((legacy[key] ?? "") !== (deterministic[key] ?? "")) divergent.push(key);
    }
    if (divergent.length > 0) {
      console.error(
        `${COI_MAPPER_DIVERGENCE_MARKER} field_count=${divergent.length} fields=${divergent.sort().slice(0, 25).join(",")}`,
      );
    }
  } catch (error) {
    console.error(
      `${COI_MAPPER_DIVERGENCE_MARKER}_CHECK_FAILED ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Runtime generation switch. False/unset is the byte-for-byte legacy path.
 * The deterministic mapper is opt-in until the committed parity cutover.
 */
export function completionToFieldValues(
  completion: Completion,
  opts?: CompletionProjectionOpts | null,
): Record<string, string> {
  if (
    !deterministicCoiGeneratorEnabled(
      opts?.deterministicGeneratorEnabled,
    )
  ) {
    return legacyCompletionToFieldValues(completion, opts);
  }
  const deterministic = deterministicCompletionToFieldValues(completion, opts);
  emitMapperDivergenceSignal(completion, opts, deterministic);
  return deterministic;
}

// ── The ACORD 30 projection (the garage certificate) ─────────────────────────
// The same completion, projected onto acord30-schema.json field_ids. The 30 is
// the garage-dealer certificate: row A is garage liability (its policy number
// and dates are the form's top-level Policy_* fields), the garagekeepers block
// carries the comp/OTC / specified-perils / collision limits, and the GL row
// exists for a garage policy that also carries GL lines. Coverage numbers come
// from the REAL policy only — the same hard guardrail as the 25.
function isGarageKeepersLine(line: string): boolean {
  return /garage\s*keepers|garagekeepers/i.test(line);
}

// A garagekeepers limit label/line → its ACORD 30 field pair (amount + the
// basis checkbox the amount belongs under).
function garageKeepersFieldsFor(text: string): { limitId: string; checkboxId: string } | null {
  const s = text.toLowerCase();
  if (s.includes("comprehensive") || s.includes("comp") || s.includes("otc")) {
    return { limitId: "garageKeepersCompOtcLimit", checkboxId: "garageKeepersCompOtcCheckbox" };
  }
  if (s.includes("specified")) {
    return { limitId: "garageKeepersSpecifiedPerilsLimit", checkboxId: "garageKeepersSpecifiedPerilsCheckbox" };
  }
  if (s.includes("collision")) {
    return { limitId: "garageKeepersCollisionLimit", checkboxId: "garageKeepersCollisionCheckbox" };
  }
  return null;
}

// A garage-liability limit label → its ACORD 30 field_id.
function garageLiabilityLimitFieldId(label: string): string | null {
  const s = label.toLowerCase();
  if (s.includes("each accident") || s.includes("per accident")) return "eachAccidentLimit";
  if (s.includes("auto only")) return "autoOnlyLimit";
  if (s.includes("aggregate")) return "aggregateLimit";
  return null;
}

// A GL limit label → the ACORD 30's OWN GL-row field_id (the 30 carries the
// full GL limit column; note personalAdvInjuryLimit — the 30's id differs
// from the 25's personalAndAdvInjuryLimit).
function acord30GlLimitFieldId(label: string): string | null {
  const s = label.toLowerCase();
  if (/\bliability\b/.test(s) && /medical/.test(s) && /(per|each)\s+occurrence/.test(s)) {
    return "generalLiabilityEachOccurrenceLimit";
  }
  if (s.includes("each occurrence") || s.includes("per occurrence")) {
    return "generalLiabilityEachOccurrenceLimit";
  }
  if (s.includes("premises") || s.includes("fire damage")) return "damageToRentedPremisesLimit";
  if (/\bmed(?:ical)?\s*exp/.test(s) || (s.includes("medical") && !/\bliability\b/.test(s))) {
    return "medExpLimit";
  }
  if (s.includes("personal") || s.includes("advertising")) return "personalAdvInjuryLimit";
  if (s.includes("products") || s.includes("completed op")) return "productsCompOpAggLimit";
  if (s.includes("general aggregate") || s === "aggregate") return "generalAggregateLimit";
  return null;
}

// An umbrella/excess limit label → the ACORD 30's OWN umbrella-row field_id. The
// 25's `umbrellaLimitFieldId` above cannot be reused: this form's ids carry the
// `umbrellaExcess` stem, and it prints deductible AND retention in one cell where
// the 25 has a `retentionAmount` of its own.
function acord30UmbrellaLimitFieldId(label: string): string | null {
  const s = label.toLowerCase();
  if (s.includes("each occurrence") || s.includes("per occurrence")) return "umbrellaExcessEachOccurrenceLimit";
  if (s.includes("aggregate")) return "umbrellaExcessAggregateLimit";
  if (s.includes("retention") || s.includes("deductible")) return "umbrellaExcessDeductibleRetentionAmount";
  return null;
}

export function completionToAcord30FieldValues(
  c: Completion,
  opts?: CompletionProjectionOpts | null,
): Record<string, string> {
  const values: Record<string, string> = {};
  values.certificateDate = formatCertificateDateInEasternTime();
  Object.assign(values, COI_PRODUCER_DEFAULTS);
  values.insuredName = c.namedInsured.value;
  values["insuredAddressLine1.city"] = c.insuredCity;
  values["insuredAddressLine1.state"] = c.insuredState;
  if (c.carrier.value) values.insurerAName = c.carrier.value;
  const fillUnmentionedLimits = (fieldIds: readonly string[]) => {
    for (const fieldId of fieldIds) {
      if (!values[fieldId]) values[fieldId] = "Excluded";
    }
  };

  // Row A (garage liability): the form's top-level Policy_* fields ARE this
  // row's policy number and term (there is no garageLiabilityPolicy* id in
  // the schema — see coi-pdf.ts's date-field note). An operator may force
  // ACORD 30 for evidence that contains no garage row; preserve that choice
  // without inventing a garage policy section.
  // The record's own bare code is this row (plane #2626, "Coverage line added:
  // Garage — Garage"): a policy whose only garage spelling is `Garage` /
  // `GARAGE` / `Garage Coverage` failed this test, so a certificate routed onto
  // the garage form printed row A with no insurer letter, no policy number, no
  // term and no limits — and the unmentioned-limit fill below never ran either,
  // so the cells were blank rather than honestly excluded. Read through the
  // SHARED fold this module already imports, never a second spelling table. OR,
  // not instead: "Garage Auto Liability" is row A's own spelling and folds to
  // the AUTOMOBILE section, so the regex is what holds it.
  const hasGarageLiability = c.coverageLines.some(
    (line) => /garage\s*(?:auto\s*)?liab/i.test(line) || readableLine(line) === "Garage Liability",
  );
  if (hasGarageLiability) {
    values.garageLiabilityInsurerLetter = "A";
    values.policyNumber = c.policyNumber.value;
    values.policyEffectiveDate = c.effectiveDate.value;
    values.policyExpirationDate = c.expirationDate.value;
  }

  const hasGarageKeepers = c.coverageLines.some(isGarageKeepersLine);
  if (hasGarageKeepers) {
    values.garageKeepersLiabilityInsurerLetter = "A";
    values.garageKeepersPolicyNumber = c.policyNumber.value;
    values.garageKeepersPolicyEffectiveDate = c.effectiveDate.value;
    values.garageKeepersPolicyExpirationDate = c.expirationDate.value;
  }

  // The GL row, only when the policy actually carries a GL line — read through
  // the SHARED fold, which is the rule this comment already claimed and the rule
  // the 25's own leg has always run (isGlSectionLine above). The raw substring
  // under it was a second spelling table and it drifted BOTH ways.
  // The record's own bare code went unread (plane #2706, "Coverage line added:
  // GL — GL. Why: Add GL" — `GL` is the code KNOWN_CODES, LINE_LABELS,
  // coverageFamilyOf and certificateLineSection all chart, and `CGL` is the
  // spelling #2459 charted for exactly this reason), so on the form a garage+GL
  // policy certifies on this row printed with no insurer letter, no policy
  // number and no term; the fill below is gated on the same test, so its six
  // limit cells printed BLANK rather than the honest "Excluded"; and the limit
  // router beside it then dropped the GL line's money into ROW A's aggregate
  // cell, the misfile that router exists to prevent. #2626's fix on row A, one
  // row down, and it takes the fold for the same reason: never a second table.
  // The other direction is #2540's — a compound cell the fold declines
  // ("General Liability/EPLI") claimed this row and stamped the selected
  // policy's number and term onto it on the sibling half's behalf.
  // NARROWS on one spelling: bare "Commercial General" carries no coverage noun,
  // so the fold charts it as its own line and the 25 has never read it as this
  // row either. Named rather than kept — two forms disagreeing about one cell is
  // what this pass closes.
  const hasGL = c.coverageLines.some(isGlSectionLine);
  if (hasGL) {
    values.generalLiabilityInsurerLetter = "A";
    values.commercialGeneralLiabilityCheckbox = "Y";
    values.generalLiabilityPolicyNumber = c.policyNumber.value;
    values.generalLiabilityPolicyEffectiveDate = c.effectiveDate.value;
    values.generalLiabilityPolicyExpirationDate = c.expirationDate.value;
  }

  // And the UMBRELLA / EXCESS row, one row down and on the same terms (plane
  // #2785, "Coverage line removed: Umb — Umb. Why: no umb" — the third arrival of
  // that sentence, and neither of the two the removal plane already closed: #2045
  // charted the bare code as a removal identity, #2460 stopped a compound cell
  // wearing the family, and both hold). This form had NO umbrella leg at all,
  // though its schema carries the whole row and acord30-fields.ts already files
  // those ids under the editor's own "Umbrella / Excess" section. So a certificate
  // routed onto the garage form for a policy that carries an umbrella named no
  // umbrella anywhere on the paper — no insurer letter, no policy number, no term
  // — the fill below never ran, so its limit cells printed BLANK rather than the
  // honest "Excluded", and the limit router then dropped the umbrella's AGGREGATE
  // into ROW A's aggregate cell, so the certificate overstated the GARAGE
  // LIABILITY aggregate by the umbrella's limit while its each-occurrence amount
  // mapped nowhere and was simply lost. #2626's fix on row A and #2706's on the GL
  // row, and it takes the SHARED fold for the same reason: isUmbrellaSectionLine is
  // the predicate the 25's own leg has always run, never a second spelling table.
  // Only the UMBRELLA indicator is stamped, not this form's separate
  // `excessLiabilityCheckbox` — the 25 makes the same call off the same fold, and
  // two forms disagreeing about one cell is what this pass closes.
  const hasUmbrella = c.coverageLines.some(isUmbrellaSectionLine);
  if (hasUmbrella) {
    values.umbrellaExcessLiabilityInsurerLetter = "A";
    values.umbrellaLiabilityCheckbox = "Y";
    values.umbrellaOccurrenceCheckbox = "Y";
    values.umbrellaExcessPolicyNumber = c.policyNumber.value;
    values.umbrellaExcessPolicyEffectiveDate = c.effectiveDate.value;
    values.umbrellaExcessPolicyExpirationDate = c.expirationDate.value;
  }

  // Limits, routed by their own line/label text: garagekeepers limits to the
  // garagekeepers block (amount + basis checkbox), GL-line limits to the 30's
  // OWN GL column (Greptile's mixed-policy catch: a garage+GL policy's GL
  // limits were dropping to blank cells), garage-liability limits to row A's
  // cells. Unmapped labels stay off the form (never guessed into a wrong
  // cell) — they remain visible in the editor's own limit list.
  for (const lim of c.limits) {
    const text = `${lim.line} ${lim.label}`;
    if (isGarageKeepersLine(lim.line) || isGarageKeepersLine(lim.label)) {
      const gk = garageKeepersFieldsFor(text);
      if (gk) {
        values[gk.limitId] = lim.amount;
        values[gk.checkboxId] = "Y";
      }
      continue;
    }
    if (hasGL && lim.line && isGlSectionLine(lim.line)) {
      const gl = acord30GlLimitFieldId(lim.label);
      if (gl) values[gl] = lim.amount;
      continue;
    }
    if (hasUmbrella && lim.line && isUmbrellaSectionLine(lim.line)) {
      const umb = acord30UmbrellaLimitFieldId(lim.label);
      if (umb) {
        values[umb] = lim.amount;
        // This form prints deductible and retention in ONE cell with two basis
        // indicators beside it, so the amount is unreadable without saying which
        // it is — the garagekeepers branch above states its basis the same way.
        if (umb === "umbrellaExcessDeductibleRetentionAmount") {
          values[/deductible/i.test(lim.label) ? "umbrellaDeductibleCheckbox" : "umbrellaRetentionCheckbox"] = "Y";
        }
      }
      continue;
    }
    if (hasGarageLiability) {
      const rowA = garageLiabilityLimitFieldId(lim.label);
      if (rowA) values[rowA] = lim.amount;
    }
  }

  if (hasGarageLiability) {
    fillUnmentionedLimits(["autoOnlyLimit", "eachAccidentLimit", "aggregateLimit"]);
  }
  if (hasGarageKeepers) {
    fillUnmentionedLimits([
      "garageKeepersCompOtcLimit",
      "garageKeepersSpecifiedPerilsLimit",
      "garageKeepersCollisionLimit",
    ]);
  }
  if (hasGL) {
    fillUnmentionedLimits([
      "generalLiabilityEachOccurrenceLimit",
      "damageToRentedPremisesLimit",
      "medExpLimit",
      "personalAdvInjuryLimit",
      "generalAggregateLimit",
      "productsCompOpAggLimit",
    ]);
  }
  if (hasUmbrella) {
    fillUnmentionedLimits(["umbrellaExcessEachOccurrenceLimit", "umbrellaExcessAggregateLimit"]);
  }

  values.certificateHolderName = c.holderName.value || "CONFIRM - holder not identified in request";
  if (c.holderAddress.value) values["certificateHolderAddressLine1.street1"] = c.holderAddress.value;

  values.descriptionOfOperationsLocationsVehicles = c.descriptionOfOperations.value;
  // Opal's stored map out-ranks this projection where it exists, and the
  // ADDL INSD / SUBR WVD cells stay empty unless extraction attests them.
  return reconcileAcord30Projection(values, {
    canonicalFieldValues: opts?.canonicalFieldValues,
    coverageExtraction: opts?.coverageExtraction,
  }).values;
}

// The one dispatcher: the completion projected onto the SELECTED form's
// field_id contract. ACORD 28 has no projection yet (no template either) —
// the catalog gates the pick before generation ever asks.
export function completionToFieldValuesFor(
  form: CoiFormType,
  c: Completion,
  opts?: CompletionProjectionOpts | null,
): Record<string, string> {
  if (form === "acord30") return completionToAcord30FieldValues(c, opts);
  return completionToFieldValues(c, opts);
}

// Fill Harper's OWN committed template with Harper's OWN shared coi-pdf logic from
// the bound-policy completion. Left editable in-app (flatten:false).
export async function generateAcord25Pdf(
  c: Completion,
  opts?: CompletionProjectionOpts | null,
): Promise<Uint8Array> {
  return fillHarperAcord25(completionToFieldValues(c, opts));
}

// The form-aware sibling: generate the SELECTED form from the completion.
export async function generateCoiPdf(
  form: CoiFormType,
  c: Completion,
  opts?: CompletionProjectionOpts | null,
): Promise<Uint8Array> {
  return fillHarperCoiForm(form, completionToFieldValuesFor(form, c, opts));
}

// Fill Harper's ACORD 25 from a field_id → value map (Harper's own contract, e.g.
// insurance.generated_certificates.field_values). Used to RECONSTRUCT an editable
// ACORD 25 from the real issued cert values (flatten:false = editable in-app).
export async function fillHarperAcord25(
  fieldValues: Record<string, string>,
  opts?: { flatten?: boolean },
): Promise<Uint8Array> {
  return fillHarperCoiForm("acord25", fieldValues, opts);
}

// The form-aware fill: the selected form's own vendored template + schema,
// through the same shared coi-pdf normalization/fill every certificate uses.
// A template-less form throws MissingFormTemplateError — the honest gap,
// never a silent ACORD 25 substitution.
export async function fillHarperCoiForm(
  form: CoiFormType,
  fieldValues: Record<string, string>,
  opts?: { flatten?: boolean },
): Promise<Uint8Array> {
  const { templateB64, schema } = formAssets(form);
  const normalized = normalizeCoiFieldValues(fieldValues);
  const template = Uint8Array.from(Buffer.from(templateB64, "base64"));
  return fillCoiPdfForm(template, normalized, schema, { flatten: opts?.flatten ?? false });
}

// The same fill, WITH the description-box fit plan riding the result (Tanya's
// 7/9 finding #6): the live-preview route reads it into response headers so
// the bench can warn the moment an edit overflows; the send gate reads it to
// flag a certificate whose description would print cut off.
export async function fillHarperAcord25WithReport(
  fieldValues: Record<string, string>,
  opts?: { flatten?: boolean },
): Promise<{ bytes: Uint8Array; descriptionFit: DescriptionFitPlan | null }> {
  return fillHarperCoiFormWithReport("acord25", fieldValues, opts);
}

// The form-aware report fill. The description-fit plan only exists where the
// schema carries the ACORD 25 description field id; on other forms it reads
// null and the fit chip simply doesn't render (an honest absence, not a claim).
export async function fillHarperCoiFormWithReport(
  form: CoiFormType,
  fieldValues: Record<string, string>,
  opts?: { flatten?: boolean },
): Promise<{ bytes: Uint8Array; descriptionFit: DescriptionFitPlan | null }> {
  const { templateB64, schema } = formAssets(form);
  const normalized = normalizeCoiFieldValues(fieldValues);
  const template = Uint8Array.from(Buffer.from(templateB64, "base64"));
  const result = await fillCoiPdfFormWithReport(template, normalized, schema, {
    flatten: opts?.flatten ?? false,
  });
  return { bytes: result.pdfBytes, descriptionFit: result.descriptionFit };
}

// ── THE DESCRIPTION-FIT PRE-SEND LINE (Tanya's 7/9 finding #6, the gate leg) ──
// A certificate whose description of operations would print CUT OFF is a
// wrong customer-facing document — additional-insured and contract language
// lives in that box. When a send carries edited field values, the gate runs
// the SAME real-metrics fit the renderer runs and adds an explicit line:
// green with the fitted size as its receipt, flagged with the overflow named.
// No description on the cert = no line (the four/five standing lines are
// untouched). The override door is the standard presend one — a human can
// still send with a stated, logged reason (never a silent pass either way).
export async function descriptionFitPresendLine(
  fieldValues: Record<string, string>,
  // The form the send fills (the 2026-07-14 form seam): the gate measures the
  // SAME form's own description box — the ACORD 30's field id and rect differ
  // from the 25's (Bugbot's catch: reading only the 25's field id skipped the
  // check on every garage certificate).
  form: CoiFormType = "acord25",
): Promise<PresendLine | null> {
  // A template-less form can't render an attachment at all — the send's own
  // missing-template path answers; there is no box to measure here.
  const schema = FORM_ASSETS[form]?.schema;
  if (!schema) return null;
  // Matched by prefix, the same law as the renderer's auto-fit: the 25's
  // `descriptionOfOperations`, the 30's `descriptionOfOperationsLocationsVehicles`.
  const descField = schema.fields.find((f) => f.field_id.startsWith(DESCRIPTION_FIELD_ID));
  const fieldId = descField?.field_id ?? DESCRIPTION_FIELD_ID;
  const description = String(fieldValues[fieldId] ?? "").trim();
  if (!description) return null;
  let plan: DescriptionFitPlan | null = null;
  try {
    // The plan alone, not a full template fill: the same real Helvetica
    // metrics the renderer measures with, against the schema's own box rect,
    // on the SAME normalization the fill applies — one decision, computed
    // cheaply at the gate.
    const box = descField?.rect ? { width: descField.rect.width, height: descField.rect.height } : DESCRIPTION_BOX;
    const scratch = await PDFDocument.create();
    const font = await scratch.embedFont(StandardFonts.Helvetica);
    plan = descriptionFitPlan(normalizeTextFieldValue(description, fieldId), {
      box,
      widthOfText: (t, s) => font.widthOfTextAtSize(t, s),
    });
  } catch {
    /* fall through to the honest can't-verify line below */
  }
  if (!plan) {
    return {
      id: "description",
      label: "Description fits its box",
      state: "unknown",
      receipt: "The description-box fit check couldn't run. Eyeball the description of operations on the preview before sending.",
    };
  }
  return plan.fits
    ? {
        id: "description",
        label: "Description fits its box",
        state: "clear",
        receipt: `The description of operations fits at ${plan.fontSize}pt (${plan.linesNeeded} of ${plan.linesAvailable} lines).`,
      }
    : {
        id: "description",
        label: "Description fits its box",
        state: "flag",
        receipt: descriptionOverflowSentence(plan),
      };
}
