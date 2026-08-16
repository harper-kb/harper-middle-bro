/**
 * ACORD 25 field-contract manifest — the Class-B / Class-C guard.
 *
 * Every field_id in acord25-schema.json belongs to exactly one partition.
 * The deterministic mapper (`completionToFieldValues`) must cover every
 * `static` field and every `deterministic` field whose source is present
 * in a full-context fixture. A newly-added schema field that isn't listed
 * here fails the completeness test — so fill-policy is an explicit decision,
 * never "forgot to map it, Tanya noticed."
 *
 * Under WS5 this manifest becomes the contract for `/opal/populate`.
 */

import acord25Schema from "./acord25-schema.json";

/** Always filled from Harper constants / clock — never blank on a generated cert. */
export const STATIC_FIELD_IDS = [
  "certificateDate",
  "producerName",
  "producerContactName",
  "producerPhone",
  "producerEmail",
  "producerAddress.street1",
  "producerAddress.street2",
  "producerAddress.city",
  "producerAddress.state",
  "producerAddress.zip",
] as const;

/**
 * Filled from structured data when present. Absence of source data → blank
 * cell + checker flag (never invented). Presence of source + blank cell is
 * a Class-B bug the completeness test catches.
 */
export const DETERMINISTIC_FIELD_IDS = [
  // Insured
  "insuredName",
  "insuredAddress.street1",
  "insuredAddress.street2",
  "insuredAddress.city",
  "insuredAddress.state",
  "insuredAddress.zip",
  // Carrier A
  "insurerAName",
  "insurerANaicNumber",
  // GL row
  "commercialGeneralLiabilityCheckbox",
  "cglOccurrenceCheckbox",
  "cglInsurerLetter",
  "cglPolicyNumber",
  "cglPolicyEffectiveDate",
  "cglPolicyExpirationDate",
  "eachOccurrenceLimit",
  "damageToRentedPremisesLimit",
  "medExpLimit",
  "personalAndAdvInjuryLimit",
  "generalAggregateLimit",
  "productsCompOpAggLimit",
  // Auto row (no invented Any-Auto / Scheduled checkboxes — binder facts)
  "autoLiabilityInsurerLetter",
  "autoLiabilityPolicyNumber",
  "autoPolicyEffectiveDate",
  "autoPolicyExpirationDate",
  "combinedSingleLimit",
  "bodilyInjuryPerPersonLimit",
  "bodilyInjuryPerAccidentLimit",
  "propertyDamageLimit",
  // Umbrella / Excess
  "umbrellaLiabilityCheckbox",
  "umbrellaOccurrenceCheckbox",
  "umbrellaInsurerLetter",
  "umbrellaPolicyNumber",
  "umbrellaPolicyEffectiveDate",
  "umbrellaPolicyExpirationDate",
  "umbrellaEachOccurrenceLimit",
  "umbrellaAggregateLimit",
  "retentionAmount",
  // Workers Comp
  "workersCompInsurerLetter",
  "workersCompStatutoryCheckbox",
  "workersCompPolicyNumber",
  "workersCompPolicyEffectiveDate",
  "workersCompPolicyExpirationDate",
  "workersCompEachAccidentLimit",
  "workersCompDiseaseEachEmployeeLimit",
  "workersCompDiseasePolicyLimit",
] as const;

const STATIC_SET = new Set<string>(STATIC_FIELD_IDS);
const DETERMINISTIC_SET = new Set<string>(DETERMINISTIC_FIELD_IDS);

export function schemaFieldIds(): string[] {
  return (acord25Schema as { fields: { field_id: string }[] }).fields.map((f) => f.field_id);
}

/**
 * Schema fields not in static/deterministic. These are request/manual by
 * default (holder, endorsement checkboxes, insurer B–F, rarely-used cells).
 * Not a failure — but promoting one into DETERMINISTIC requires updating the
 * mapper AND this list in the same PR.
 */
export function requestOrManualSchemaFields(): string[] {
  return schemaFieldIds().filter((id) => !STATIC_SET.has(id) && !DETERMINISTIC_SET.has(id));
}

/** Manifest entries that aren't in the schema (typos / drift). Must be empty. */
export function orphanManifestFields(): string[] {
  const schema = new Set(schemaFieldIds());
  return [...STATIC_FIELD_IDS, ...DETERMINISTIC_FIELD_IDS].filter((id) => !schema.has(id));
}

export function isStaticFieldId(id: string): boolean {
  return STATIC_SET.has(id);
}

export function isDeterministicFieldId(id: string): boolean {
  return DETERMINISTIC_SET.has(id);
}
