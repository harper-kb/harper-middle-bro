// The FULL ACORD 25 field set, derived from Harper's own acord25-schema.json, so
// the reviewer can edit EVERY field and is never blocked by a missing/unmarkable
// one. Deduped by field_id, grouped into sections, with human labels.

import acord25Schema from "./acord25-schema.json";

export interface EditableField {
  id: string;
  label: string;
  type: "text" | "checkbox";
  section: string;
}

const SECTION_ORDER = [
  "Certificate",
  "Producer",
  "Insured",
  "Insurers",
  "General Liability",
  "Automobile Liability",
  "Umbrella / Excess",
  "Workers Compensation",
  "Other Policy",
  "Certificate Holder",
  "Description",
  "Other",
];

function sectionOf(id: string): string {
  const s = id.toLowerCase();
  if (/^certificatedate|^form|^certificateofinsurance/.test(s)) return "Certificate";
  if (s.startsWith("producer")) return "Producer";
  if (s.startsWith("insuredaddress") || s.startsWith("insuredname") || s.startsWith("insured")) return "Insured";
  if (s.startsWith("insurer")) return "Insurers";
  if (s.startsWith("cgl") || s.startsWith("commercialgeneral") || s.startsWith("generalliability") || s.startsWith("eachoccurrence") || s.startsWith("damagetorented") || s.startsWith("medexp") || s.startsWith("personalandadv") || s.startsWith("generalaggregate") || s.startsWith("productscompop")) return "General Liability";
  if (s.startsWith("auto") || s.startsWith("vehicle") || s.startsWith("bodilyinjury") || s.startsWith("propertydamage") || s.startsWith("combinedsingle")) return "Automobile Liability";
  if (s.startsWith("umbrella") || s.startsWith("excess") || s.startsWith("retention")) return "Umbrella / Excess";
  if (s.startsWith("workerscomp") || s.startsWith("wc")) return "Workers Compensation";
  if (s.startsWith("otherpolicy") || s.startsWith("otherinsurance")) return "Other Policy";
  if (s.startsWith("certificateholder")) return "Certificate Holder";
  if (s.startsWith("descriptionofoperations") || s.startsWith("remark")) return "Description";
  return "Other";
}

// Humanize a field_id into a label. Handles camelCase, dotted address parts, and a
// few insurance abbreviations that read better expanded.
function labelOf(id: string): string {
  const parts = id.split(".");
  const base = parts[0];
  const suffix = parts[1] ? ` (${parts[1]})` : "";
  const spaced = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bCgl\b/gi, "GL")
    .replace(/\bWc\b/gi, "WC")
    .replace(/\bNaic\b/gi, "NAIC")
    .replace(/\bEl\b/gi, "E&L")
    .replace(/\bAdv\b/gi, "Adv")
    .replace(/^./, (c) => c.toUpperCase());
  return spaced + suffix;
}

const HIDE = new Set(["formEditionIdentifier"]);

function build(): EditableField[] {
  const seen = new Set<string>();
  const fields: EditableField[] = [];
  const raw = (acord25Schema as { fields: { field_id: string; field_name: string; type: string }[] }).fields ?? [];
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

export const ACORD25_FIELDS: EditableField[] = build();

export const ACORD25_SECTIONS: string[] = Array.from(new Set(ACORD25_FIELDS.map((f) => f.section))).sort(
  (a, b) => (SECTION_ORDER.indexOf(a) === -1 ? 99 : SECTION_ORDER.indexOf(a)) - (SECTION_ORDER.indexOf(b) === -1 ? 99 : SECTION_ORDER.indexOf(b)),
);
