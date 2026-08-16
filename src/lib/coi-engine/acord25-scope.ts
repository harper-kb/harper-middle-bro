// Scope the bench's field editor to the POLICY (sweep-6 finding 1).
//
// The contradiction this fixes: "to confirm" used to mean "every ACORD field the
// system left blank", so a GL-only certificate showed "116 to confirm" (21
// automobile-liability fields, 17 umbrella, 12 workers-comp…) right beside
// "Ready to send" and a checker chip saying "reconciles" — two opposite meanings
// of the same words on one screen. Held against DR's own test ("is every box
// doing something right now?"), ~100 of those boxes were doing nothing.
//
// The rule now:
//   - "to confirm" = ONLY the fields the CHECKER flagged — one vocabulary between
//     the checker chip and the editor counter.
//   - Coverage sections with nothing on the policy collapse to one honest
//     "not on this policy" line instead of shouting dozens of blank CONFIRMs.
//
// Pure — no I/O, no React — so both the editor and its tests share it.

import { ACORD25_FIELDS } from "./acord25-fields";
import type { EditableField } from "./acord25-fields";

// The coverage-scoped sections: each one describes a LINE the policy may or may
// not carry. Identity sections (Producer, Insured, Holder, …) are always real.
export const COVERAGE_SECTIONS = new Set([
  "General Liability",
  "Automobile Liability",
  "Umbrella / Excess",
  "Workers Compensation",
  "Other Policy",
]);

// Is this section "on the policy"? A coverage section counts as on-policy only
// when the system filled ANY of its fields (a value anywhere means the line
// exists). Non-coverage sections are always on. The optional fields/coverage
// params let the form-type seam (coi-form-fields.ts) run the same law over
// the ACORD 30's own catalog; the defaults keep every existing caller on the
// standing ACORD 25 behavior.
export function sectionOnPolicy(
  section: string,
  sys: Record<string, string>,
  fields: EditableField[] = ACORD25_FIELDS,
  coverageSections: Set<string> = COVERAGE_SECTIONS,
): boolean {
  if (!coverageSections.has(section)) return true;
  return fields.some((f) => f.section === section && (sys[f.id] ?? "") !== "");
}

// The ADD flow's honest label (Pratik's 2026-07-14 QA): a coverage section the
// SYSTEM filled nothing for can still be added by the operator — separate
// professional-liability paper, an auto line the record missed. Once the
// operator has typed ANY value into such a section, "not on this policy" is no
// longer the truth about the certificate being sent; the section is
// operator-added. System-filled sections and non-coverage sections are never
// "added" — the mark exists only where a human typed into a line the policy
// record didn't carry. Pure, same seams as sectionOnPolicy.
export function sectionAddedManually(
  section: string,
  sys: Record<string, string>,
  current: Record<string, string>,
  fields: EditableField[] = ACORD25_FIELDS,
  coverageSections: Set<string> = COVERAGE_SECTIONS,
): boolean {
  if (sectionOnPolicy(section, sys, fields, coverageSections)) return false;
  return fields.some((f) => f.section === section && (current[f.id] ?? "") !== "");
}

// The checker's vocabulary → the ACORD field ids it points at. The checker talks
// in reconciled-field names ("Policy number") and flag sentences ("Expiration
// date missing — confirm."); the editor talks in field ids. This map is the one
// bridge, so the chip and the counter can never mean different things.
const GL_LIMIT_IDS = [
  "eachOccurrenceLimit",
  "damageToRentedPremisesLimit",
  "medExpLimit",
  "personalAndAdvInjuryLimit",
  "generalAggregateLimit",
  "productsCompOpAggLimit",
];

// The ACORD 30's garage-row limit cells (row A + the garagekeepers block) —
// the 30's counterparts of the 25's GL limit cells.
const GARAGE_LIMIT_IDS = [
  "eachAccidentLimit",
  "autoOnlyLimit",
  "aggregateLimit",
  "garageKeepersCompOtcLimit",
  "garageKeepersSpecifiedPerilsLimit",
  "garageKeepersCollisionLimit",
];

// Each concept carries EVERY form's field ids (the 25's and the 30's) —
// confirmFields already filters against the active form's own catalog, so the
// off-form ids drop out there. Before this, a flagged garage certificate lost
// its whole confirm rail: the checker's ids all named ACORD 25 cells, and the
// catalog filter (correctly) dropped every one of them (Bugbot's catch).
const CHECKER_FIELD_MAP: Array<{ re: RegExp; ids: string[] }> = [
  { re: /policy\s*(number|#)/i, ids: ["cglPolicyNumber", "policyNumber"] },
  { re: /effective/i, ids: ["cglPolicyEffectiveDate", "policyEffectiveDate"] },
  { re: /expiration/i, ids: ["cglPolicyExpirationDate", "policyExpirationDate"] },
  // "Each occurrence" is GL vocabulary on BOTH forms — the 30's GL row has its
  // own cell. The garage row speaks "each accident"; that concept is its own
  // row below (Bugbot: a GL each-occurrence flag must not highlight the
  // garage cell).
  { re: /each[-\s]?occurrence/i, ids: ["eachOccurrenceLimit", "generalLiabilityEachOccurrenceLimit"] },
  { re: /each[-\s]?accident/i, ids: ["eachAccidentLimit"] },
  { re: /limit/i, ids: [...GL_LIMIT_IDS, "generalLiabilityEachOccurrenceLimit", ...GARAGE_LIMIT_IDS] },
  { re: /holder/i, ids: ["certificateHolderNameLine1", "certificateHolderName"] },
  { re: /named\s+insured/i, ids: ["insuredName"] },
  { re: /carrier|insurer/i, ids: ["insurerAName"] },
  { re: /coverage\s+line/i, ids: ["commercialGeneralLiabilityCheckbox"] },
];

export interface CheckShape {
  status?: string;
  flags?: string[];
  reconciled?: { field: string; ok: boolean; detail?: string }[];
}

// The set of ACORD field ids the checker flagged for confirmation — the ONE
// meaning of "to confirm". Reads both the reconciled entries (field names) and
// the bare flag sentences (the generated-cert path returns reconciled: []).
export function confirmFieldIds(check: CheckShape | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!check) return ids;
  const texts: string[] = [];
  for (const r of check.reconciled ?? []) if (!r.ok) texts.push(r.field);
  for (const f of check.flags ?? []) texts.push(f);
  for (const text of texts) {
    for (const m of CHECKER_FIELD_MAP) {
      if (m.re.test(text)) {
        m.ids.forEach((id) => ids.add(id));
        break; // first matching rule wins per text — the map is ordered by specificity
      }
    }
  }
  return ids;
}

// The checker-flagged fields, in editor order, restricted to fields that exist
// ON THE ACTIVE FORM (the optional catalog param — the form-type seam): a
// checker id that names an ACORD 25 cell simply doesn't exist on an ACORD 30
// and drops out here, so the confirm rail never points at a field the editor
// can't show.
export function confirmFields(check: CheckShape | null | undefined, fields: EditableField[] = ACORD25_FIELDS): EditableField[] {
  const ids = confirmFieldIds(check);
  return fields.filter((f) => ids.has(f.id));
}

// The tracing deep-link's editor leg: what lands in the find-a-field search
// when a checker text is clicked. The editor filters by LABEL/ID SUBSTRING, so
// a full flag sentence ("Certificate holder not identified in the request —
// confirm/add.") would match zero fields and blank the editor. A short
// reconciled-field name that already matches a label filters as-is; a flag
// sentence maps through the same CHECKER_FIELD_MAP bridge the confirm rail
// reads (so the two can never disagree) to its first field's label; text the
// bridge doesn't know opens the editor UNFILTERED — never filtered-to-nothing.
// Resolved against the ACTIVE form's catalog (the optional param, the same
// seam as confirmFields): on an ACORD 30 the query must land on a 30 label,
// never a 25-only label that filters the dock to nothing (Bugbot).
export function editorQueryForCheckerText(text: string, fields: EditableField[] = ACORD25_FIELDS): string {
  const t = text.trim().toLowerCase();
  if (t && fields.some((f) => f.label.toLowerCase().includes(t) || f.id.toLowerCase().includes(t))) {
    return text.trim();
  }
  const ids = confirmFieldIds({ flags: [text] });
  const first = fields.find((f) => ids.has(f.id));
  return first ? first.label : "";
}
