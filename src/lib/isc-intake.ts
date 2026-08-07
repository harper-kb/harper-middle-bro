import type {
  CoveragePart,
  EndorsementKind,
  EndorsementScope,
  LimitMode,
  LimitSlot,
} from "./forms";
import { identityForIssuingCompany } from "./naic";

/**
 * ISC portal document intake — deterministic text parser.
 *
 * The desk binds most ISC (Instant Specialty) policies itself: the operator
 * downloads the dec page / schedule of forms from the portal and pastes the
 * text here. The parser reads only what the document states — writing
 * company, policy number, coverage forms, stated limits, and the endorsement
 * schedule. Lines it does not recognize are counted, never guessed at.
 * Extraction happens once; the result becomes the schedule of record that
 * certificates and the fast path read from.
 *
 * Pure module — safe on the client for live preview; the server re-parses
 * the same text before anything persists.
 */

/**
 * Sample ISC portal text — a realistic garage dec for the desk's demo
 * policy ISC-GAR-112233. Clearly labeled as a sample in the intake panel;
 * deliberately carries no 30-day Notice Of Cancellation endorsement, so the
 * certs@iscmga.com request loop stays exercised.
 */
export const ISC_SAMPLE_DEC = `INSTANT SPECIALTY — COMMERCIAL GARAGE DECLARATIONS
Issued through ISC (Managing General Agent)
Written by: Third Coast Insurance Company
Policy Number: ISC-GAR-112233

LIMITS OF INSURANCE
Garage Liability — Auto Only — Each Accident ............ $1,000,000
Garage Liability — Other Than Auto — Each Accident ...... $1,000,000
Garage Liability — Other Than Auto — Aggregate .......... $2,000,000
Garagekeepers — Comprehensive / OTC ...................... $250,000
Garagekeepers — Collision ................................ $250,000

SCHEDULE OF FORMS AND ENDORSEMENTS
CA 00 05 10 13 Garage Coverage Form
CA 99 37 10 13 Garagekeepers Coverage
ISC-GAR 21 03 24 Blanket Additional Insured — When Required by Written Contract
CA 04 44 10 13 Waiver of Transfer of Rights of Recovery Against Others to Us (Waiver of Subrogation)
ISC-GAR 05 03 24 Primary and Noncontributory — Other Insurance Condition
ISC-GAR 33 03 24 Tow Truck Operations Amendment`;

export interface IscParsedLimit {
  slot: LimitSlot;
  mode: LimitMode;
  amountCents: number | null;
}

export interface IscParsedEndorsement {
  form: string;
  edition: string;
  title: string;
  kind: EndorsementKind;
  scope?: EndorsementScope;
}

export interface IscParseResult {
  /** Writing company legal name, matched against the verified ISC writer list */
  writer: string | null;
  writerNaic: string | null;
  policyNumber: string | null;
  coverages: CoveragePart[];
  limits: IscParsedLimit[];
  endorsements: IscParsedEndorsement[];
  /** Non-empty lines the parser did not understand — reported, never invented */
  ignoredLines: number;
  warnings: string[];
}

/** Coverage forms the parser recognizes as coverage parts (not endorsements). */
const COVERAGE_FORMS: Record<string, { code: string; label: string }> = {
  "CG 00 01": { code: "GL", label: "Commercial General Liability" },
  "CA 00 05": { code: "Garage", label: "Garage Coverage" },
  "CA 00 01": { code: "CA", label: "Business Auto Coverage" },
  "CA 99 37": { code: "GK", label: "Garagekeepers Coverage" },
};

/**
 * Dec-page limit labels → ACORD limit slots, most specific first — a
 * "Damage To Rented Premises (Each Occurrence)" line must never fall
 * into the Each Occurrence slot.
 */
const LIMIT_LABELS: [RegExp, LimitSlot][] = [
  [/damage\s+to\s+(rented\s+)?premises/i, "gl_damage_premises"],
  [/products[\s–—-]*comp(leted)?\s*\/?\s*op(erations)?s?\s*agg(regate)?/i, "gl_products_completed_ops"],
  [/general\s+aggregate/i, "gl_general_aggregate"],
  [/personal\s*(&|and)\s*adv(ertising)?\s*injury/i, "gl_personal_adv"],
  [/med(ical)?\s*exp(ense)?s?/i, "gl_med_exp"],
  [/combined\s+single\s+limit/i, "auto_combined_single"],
  [/auto\s+only.*?(each|ea)\s+accident/i, "gar_auto_only_each_accident"],
  [/other\s+than\s+auto.*?aggregate/i, "gar_other_than_auto_aggregate"],
  [/other\s+than\s+auto.*?(each|ea)\s+accident/i, "gar_other_than_auto_each_accident"],
  [/garagekeepers.*?specified\s+perils/i, "gk_specified_perils"],
  [/garagekeepers.*?collision/i, "gk_collision"],
  [/garagekeepers.*?comp(rehensive)?/i, "gk_comp_otc"],
  [/each\s+occurrence/i, "gl_each_occurrence"],
];

/** ISO-style form code: "CG 20 10", "CA 99 37" — with optional "04 13" edition. */
const ISO_FORM = /^([A-Z]{2}\s?\d{2}\s?\d{2})\s+(\d{2}[\s/]\d{2})?\s*(.*)$/;
/** ISC proprietary form code: "ISC-GL 40", "ISC-GAR 12" — optional edition. */
const ISC_FORM = /^(ISC-[A-Z]{1,4}\s?\d{1,4})\s+(\d{2}[\s/]\d{2})?\s*(.*)$/;

function normalizeFormCode(raw: string): string {
  // "CG2010" / "CG 20 10" → "CG 20 10"; ISC codes keep their hyphen.
  if (raw.startsWith("ISC-")) return raw.replace(/\s+/g, " ").trim();
  const compact = raw.replace(/\s+/g, "");
  return `${compact.slice(0, 2)} ${compact.slice(2, 4)} ${compact.slice(4, 6)}`;
}

function classifyKind(title: string): EndorsementKind {
  const t = title.toLowerCase();
  if (t.includes("additional insured")) return "ai";
  if (t.includes("waiver of subrogation") || t.includes("waiver of transfer"))
    return "wos";
  if (/primary\s*(&|and)\s*non[\s-]?contributory/.test(t)) return "pnc";
  if (t.includes("exclusion") || t.startsWith("excl")) return "exclusion";
  return "other";
}

function classifyScope(title: string): EndorsementScope | undefined {
  const t = title.toLowerCase();
  if (
    t.includes("blanket") ||
    t.includes("automatic status") ||
    t.includes("when required by written contract") ||
    t.includes("as required by written contract")
  ) {
    return "blanket";
  }
  if (t.includes("scheduled") || t.includes("designated")) return "scheduled";
  return undefined;
}

function parseMoney(raw: string): number | null {
  const m = raw.match(/\$\s?([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export function parseIscDec(text: string): IscParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result: IscParseResult = {
    writer: null,
    writerNaic: null,
    policyNumber: null,
    coverages: [],
    limits: [],
    endorsements: [],
    ignoredLines: 0,
    warnings: [],
  };

  const seenForms = new Set<string>();
  const seenSlots = new Set<LimitSlot>();

  for (const line of lines) {
    // Writing company — matched against the verified ISC writer registry only.
    if (!result.writer) {
      const identity = identityForIssuingCompany(line);
      if (identity) {
        result.writer = identity.issuingCompany;
        result.writerNaic = identity.naic;
        continue;
      }
    }

    // Policy number.
    if (!result.policyNumber) {
      const pn = line.match(
        /policy\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
      );
      if (pn) {
        result.policyNumber = pn[1].toUpperCase();
        continue;
      }
    }

    // Stated limit lines — "Each Occurrence ......... $1,000,000",
    // "Medical Expense — Excluded".
    const limitHit = LIMIT_LABELS.find(([re]) => re.test(line));
    if (limitHit) {
      const [, slot] = limitHit;
      if (!seenSlots.has(slot)) {
        const excluded = /\bexcluded\b/i.test(line);
        const included = /\bincluded\b/i.test(line);
        const amountCents = parseMoney(line);
        if (excluded || included || amountCents != null) {
          seenSlots.add(slot);
          result.limits.push({
            slot,
            mode: excluded ? "excluded" : included ? "included" : "amount",
            amountCents: excluded || included ? null : amountCents,
          });
          continue;
        }
      }
    }

    // Schedule-of-forms lines — coverage forms and endorsements.
    const formMatch = line.match(ISC_FORM) ?? line.match(ISO_FORM);
    if (formMatch) {
      const form = normalizeFormCode(formMatch[1]);
      const edition = (formMatch[2] ?? "").replace("/", " ").trim();
      const title = (formMatch[3] ?? "").replace(/^[–—-]\s*/, "").trim();
      if (seenForms.has(form)) continue;
      seenForms.add(form);

      const coverage = COVERAGE_FORMS[form];
      if (coverage) {
        result.coverages.push({ ...coverage, form, edition });
        continue;
      }
      if (title) {
        result.endorsements.push({
          form,
          edition,
          title,
          kind: classifyKind(title),
          scope: classifyScope(title),
        });
        continue;
      }
      // A bare form code with no title claims nothing.
      result.warnings.push(`Form ${form} listed without a title — skipped.`);
      continue;
    }

    result.ignoredLines += 1;
  }

  if (!result.writer) {
    result.warnings.push(
      "No writing company found. ISC paper issues on Hadron Specialty, Sutton National, SiriusPoint America, or Third Coast — the dec page names one of them.",
    );
  }
  if (!result.policyNumber) {
    result.warnings.push("No policy number found on the pasted text.");
  }
  if (result.coverages.length === 0 && result.endorsements.length === 0) {
    result.warnings.push(
      "No coverage forms or endorsements recognized — nothing will attach.",
    );
  }

  return result;
}

/**
 * A parse is attachable when it names a writer, carries at least one
 * coverage form or endorsement, and — when both sides state a policy
 * number — the numbers agree. Accuracy gate, not a convenience gate.
 */
export function iscParseAttachable(
  parsed: IscParseResult,
  policyNumber: string,
): { ok: boolean; reason: string | null } {
  if (!parsed.writer) {
    return { ok: false, reason: "The dec must name the writing company." };
  }
  if (parsed.coverages.length === 0 && parsed.endorsements.length === 0) {
    return { ok: false, reason: "Nothing recognized to attach." };
  }
  if (
    parsed.policyNumber &&
    parsed.policyNumber.toUpperCase() !== policyNumber.toUpperCase()
  ) {
    return {
      ok: false,
      reason: `Dec policy number ${parsed.policyNumber} does not match ${policyNumber}.`,
    };
  }
  return { ok: true, reason: null };
}
