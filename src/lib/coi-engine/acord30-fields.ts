// The FULL ACORD 30 field set, derived from Harper's own acord30-schema.json —
// the garage certificate's sibling of acord25-fields.ts, so the dock editor
// can edit EVERY field on a garage certificate the same way it edits the 25.
// Same shape (EditableField), garage-specific sections.

import acord30Schema from "./acord30-schema.json";
import type { EditableField } from "./acord25-fields";

const SECTION_ORDER = [
  "Certificate",
  "Producer",
  "Insured",
  "Insurers",
  "Garage Liability",
  "Garage Keepers",
  "General Liability",
  "Umbrella / Excess",
  "Workers Compensation",
  "Other Policy",
  "Certificate Holder",
  "Description",
  "Other",
];

function sectionOf(id: string): string {
  const s = id.toLowerCase();
  if (/^certificatedate|^form|^certificatenumber|^revisionnumber/.test(s)) return "Certificate";
  if (s.startsWith("producer")) return "Producer";
  if (s.startsWith("insuredaddress") || s.startsWith("insuredname") || s.startsWith("insured")) return "Insured";
  if (s.startsWith("insurer")) return "Insurers";
  if (s.startsWith("garagekeepers")) return "Garage Keepers";
  // Row A (garage liability) owns the form's top-level policy number/dates and
  // the auto-only / each-accident / aggregate limit cells (see coi-pdf.ts's
  // ACORD 30 date-field note: there is no garageLiabilityPolicy* id).
  if (s.startsWith("garageliability") || s === "policynumber" || s === "policyeffectivedate" || s === "policyexpirationdate" || s.startsWith("autoonly") || s.startsWith("eachaccident") || s === "aggregatelimit") return "Garage Liability";
  if (s.startsWith("generalliability") || s.startsWith("commercialgeneral") || s.startsWith("generalaggregate") || s.startsWith("genlaggregate") || s.startsWith("damagetorented") || s.startsWith("medexp") || s.startsWith("personaladv") || s.startsWith("productscompop") || s.startsWith("combinedsingle")) return "General Liability";
  if (s.startsWith("umbrella") || s.startsWith("excess") || s.startsWith("retention")) return "Umbrella / Excess";
  if (s.startsWith("workerscomp") || s.startsWith("wc") || s.startsWith("proprietorpartner")) return "Workers Compensation";
  if (s.startsWith("otherinsurance") || s.startsWith("otherpolicy")) return "Other Policy";
  if (s.startsWith("certificateholder")) return "Certificate Holder";
  if (s.startsWith("descriptionofoperations") || s.startsWith("remark")) return "Description";
  return "Other";
}

// Same humanizer as the 25 (kept local — the two field sets are deliberately
// independent asset derivations, one per schema).
function labelOf(id: string): string {
  const parts = id.split(".");
  const base = parts[0];
  const suffix = parts[1] ? ` (${parts[1]})` : "";
  const spaced = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bWc\b/gi, "WC")
    .replace(/\bNaic\b/gi, "NAIC")
    .replace(/\bEl\b/gi, "E&L")
    .replace(/\bOtc\b/gi, "OTC")
    .replace(/\bLoc\b/gi, "LOC")
    .replace(/^./, (c) => c.toUpperCase());
  return spaced + suffix;
}

const HIDE = new Set(["formEditionIdentifier"]);

function build(): EditableField[] {
  const seen = new Set<string>();
  const fields: EditableField[] = [];
  const raw = (acord30Schema as { fields: { field_id: string; field_name: string; type: string }[] }).fields ?? [];
  for (const f of raw) {
    if (!f.field_id || seen.has(f.field_id) || HIDE.has(f.field_id)) continue;
    seen.add(f.field_id);
    fields.push({
      id: f.field_id,
      label: labelOf(f.field_id),
      type: f.type === "checkbox" ? "checkbox" : "text",
      section: sectionOf(f.field_id),
    });
  }
  fields.sort((a, b) => {
    const sa = SECTION_ORDER.indexOf(a.section);
    const sb = SECTION_ORDER.indexOf(b.section);
    return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
  });
  return fields;
}

export const ACORD30_FIELDS: EditableField[] = build();

export const ACORD30_SECTIONS: string[] = Array.from(new Set(ACORD30_FIELDS.map((f) => f.section))).sort(
  (a, b) => (SECTION_ORDER.indexOf(a) === -1 ? 99 : SECTION_ORDER.indexOf(a)) - (SECTION_ORDER.indexOf(b) === -1 ? 99 : SECTION_ORDER.indexOf(b)),
);
