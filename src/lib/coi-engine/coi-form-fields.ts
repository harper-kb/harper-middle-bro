// The form-type → editable-field-set resolution (client-safe, no template
// bytes). The dock editor, the confirm rail, and the changed-count all read
// the ACTIVE form's own field catalog through this seam, so an ACORD 30
// certificate edits ACORD 30 fields — never the 25's ids typed into a void.

import { ACORD25_FIELDS, ACORD25_SECTIONS, type EditableField } from "./acord25-fields";
import { ACORD30_FIELDS, ACORD30_SECTIONS } from "./acord30-fields";
import acord25Schema from "./acord25-schema.json";
import acord30Schema from "./acord30-schema.json";
import type { CoiFormType } from "./coi-forms";

export function fieldsForForm(form: CoiFormType): EditableField[] {
  // ACORD 28 has no schema on file (no template either — the catalog names
  // the gap); anything not acord30 reads the standing ACORD 25 catalog.
  return form === "acord30" ? ACORD30_FIELDS : ACORD25_FIELDS;
}

export function sectionsForForm(form: CoiFormType): string[] {
  return form === "acord30" ? ACORD30_SECTIONS : ACORD25_SECTIONS;
}

// ── The two name spaces of one certificate field ──────────────────────────────
// Certificate field VALUES are keyed by the schema's logical `field_id`
// (`certificateDate`) — that is what generated_certificates.field_values and
// every editor above it speak. The PDF's AcroForm WIDGETS carry the schema's
// `field_name` (`Form_CompletionDate_A`) — that is what pdf.js reports when the
// in-place page editor reads the rendered document. Handing the page editor
// field_ids is what left every box on the page answering to no field (the
// regenerate-review "0 on the page" bug, 2026-07-29). These maps are the ONE
// translation seam; both schemas are verified 1:1 (no duplicate ids or names).
type CoiSchemaNameEntry = { field_id: string; field_name: string };
function buildNameMaps(fields: CoiSchemaNameEntry[]): {
  acroById: Map<string, string>;
  idByAcro: Map<string, string>;
} {
  const acroById = new Map<string, string>();
  const idByAcro = new Map<string, string>();
  for (const f of fields) {
    if (!f.field_id || !f.field_name) continue;
    if (!acroById.has(f.field_id)) acroById.set(f.field_id, f.field_name);
    if (!idByAcro.has(f.field_name)) idByAcro.set(f.field_name, f.field_id);
  }
  return { acroById, idByAcro };
}

const NAME_MAPS: Record<"acord25" | "acord30", ReturnType<typeof buildNameMaps>> = {
  acord25: buildNameMaps(acord25Schema.fields as CoiSchemaNameEntry[]),
  acord30: buildNameMaps(acord30Schema.fields as CoiSchemaNameEntry[]),
};

function nameMapsForForm(form: CoiFormType) {
  return form === "acord30" ? NAME_MAPS.acord30 : NAME_MAPS.acord25;
}

/** The AcroForm widget name for a logical field id (null when the schema has no such field). */
export function acroFieldNameFor(form: CoiFormType, fieldId: string): string | null {
  return nameMapsForForm(form).acroById.get(fieldId) ?? null;
}

/** The logical field id for an AcroForm widget name (null when unknown). */
export function fieldIdForAcroName(form: CoiFormType, acroName: string): string | null {
  return nameMapsForForm(form).idByAcro.get(acroName) ?? null;
}

// The coverage-scoped sections per form (the acord25-scope law generalized):
// sections describing a LINE the policy may or may not carry collapse to one
// honest "not on this policy" line when the system filled none of their fields.
export const COVERAGE_SECTIONS_BY_FORM: Record<"acord25" | "acord30", Set<string>> = {
  acord25: new Set(["General Liability", "Automobile Liability", "Umbrella / Excess", "Workers Compensation", "Other Policy"]),
  acord30: new Set(["Garage Liability", "Garage Keepers", "General Liability", "Umbrella / Excess", "Workers Compensation", "Other Policy"]),
};

export function coverageSectionsForForm(form: CoiFormType): Set<string> {
  return form === "acord30" ? COVERAGE_SECTIONS_BY_FORM.acord30 : COVERAGE_SECTIONS_BY_FORM.acord25;
}
