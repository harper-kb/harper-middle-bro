import acord30Schema from "./acord30-schema.json";

export interface Acord30EndorsementEvidence {
  blanketAi?: boolean | null;
  scheduledAi?: boolean | null;
  waiverSubrogation?: boolean | null;
}

export interface Acord30ProjectionOptions {
  /**
   * Opal's stored field_values are authoritative for policy and coverage
   * cells. The local 45-cell projection is a compatibility fallback only.
   */
  canonicalFieldValues?: Record<string, string> | null;
  coverageExtraction?: Acord30EndorsementEvidence | null;
}

type Acord30SchemaEntry = { field_id: string };

const ACORD30_FIELD_IDS = new Set(
  (acord30Schema.fields as Acord30SchemaEntry[]).map((field) => field.field_id),
);

/**
 * Reviewed canonical ids the ACORD 30 template does not carry as cells. This
 * is the sync path the fail-closed throw points at: when Opal legitimately
 * adds a field, accepting it is a one-line append here (drop it) or a schema
 * entry (print it) — never a code change.
 */
export const ACORD30_INTENTIONAL_NON_TEMPLATE_ALIASES = [
  "garageLiabilityPolicyNumber",
  "garageLiabilityPolicyEffectiveDate",
  "garageLiabilityPolicyExpirationDate",
  "wcElEachAccidentLimit",
  "wcElDiseasePolicyLimit2",
] as const;

const ACORD30_NON_TEMPLATE_ALIAS_IDS = new Set<string>(
  ACORD30_INTENTIONAL_NON_TEMPLATE_ALIASES,
);

const ACORD30_REQUEST_CONTEXT_FIELD_IDS = [
  "certificateDate",
  "descriptionOfOperationsLocationsVehicles",
  "certificateHolderName",
  "certificateHolderNameLine2",
  "certificateHolderAddressLine1.street1",
  "certificateHolderAddressLine1.street2",
  "certificateHolderAddressLine1.city",
  "certificateHolderAddressLine1.state",
  "certificateHolderAddressLine1.zip",
] as const;

export const ACORD30_ADDITIONAL_INSURED_FIELD_IDS = [
  "garageLiabilityAdditionalInsuredCheckbox",
  "garageKeepersAdditionalInsuredCheckbox",
  "generalLiabilityAdditionalInsuredCheckbox",
  "umbrellaExcessAdditionalInsuredCheckbox",
  "otherInsuranceAdditionalInsuredCheckbox",
] as const;

export const ACORD30_WAIVER_FIELD_IDS = [
  "garageLiabilitySubrogationWaivedCheckbox",
  "garageKeepersSubrogationWaivedCheckbox",
  "generalLiabilitySubrogationWaivedCheckbox",
  "umbrellaExcessSubrogationWaivedCheckbox",
  "workersCompSubrogationWaivedCheckbox",
  "otherInsuranceSubrogationWaivedCheckbox",
] as const;

export interface ReconciledAcord30Projection {
  values: Record<string, string>;
  source: "canonical_opal" | "legacy_workbench_fallback";
  droppedCanonicalFieldIds: string[];
  /**
   * Fallback-only: ids the local projection emitted that the ACORD 30 schema
   * does not carry. The legacy path drops them rather than throwing, because
   * a pre-canonical record has no second source to fall back to.
   */
  droppedLegacyFieldIds: string[];
}

export class UnexpectedAcord30CanonicalFieldsError extends Error {
  readonly fieldIds: string[];

  constructor(fieldIds: string[]) {
    super(
      `Unexpected canonical ACORD 30 fields: ${fieldIds.join(", ")}. ` +
        "To accept a reviewed Opal field, append its id to " +
        "ACORD30_INTENTIONAL_NON_TEMPLATE_ALIASES in " +
        "src/lib/coi-acord30-authoritative.ts (drop it), or add it to " +
        "src/lib/acord30-schema.json (print it).",
    );
    this.name = "UnexpectedAcord30CanonicalFieldsError";
    this.fieldIds = fieldIds;
  }
}

function schemaValues(values: Record<string, string>): {
  values: Record<string, string>;
  intentionalAliases: string[];
  unexpected: string[];
} {
  const accepted: Record<string, string> = {};
  const intentionalAliases: string[] = [];
  const unexpected: string[] = [];

  for (const [fieldId, value] of Object.entries(values)) {
    if (ACORD30_FIELD_IDS.has(fieldId)) {
      accepted[fieldId] = value;
    } else if (ACORD30_NON_TEMPLATE_ALIAS_IDS.has(fieldId)) {
      intentionalAliases.push(fieldId);
    } else {
      unexpected.push(fieldId);
    }
  }
  return {
    values: accepted,
    intentionalAliases: intentionalAliases.sort(),
    unexpected: unexpected.sort(),
  };
}

function applyRequestContext(
  values: Record<string, string>,
  projectedValues: Record<string, string>,
): Record<string, string> {
  const next = { ...values };
  for (const fieldId of ACORD30_REQUEST_CONTEXT_FIELD_IDS) {
    const value = projectedValues[fieldId];
    if (typeof value === "string" && value.trim()) next[fieldId] = value;
  }
  return next;
}

/**
 * One ACORD 30 decision: use Opal's stored field map when present, because it
 * is the estate's superset. The mechanical census found 112 IDs and direct
 * source inspection found five additional helper-written garage IDs; the local
 * 45-cell mapper remains only for records that predate canonical persistence.
 */
export function reconcileAcord30Projection(
  projectedValues: Record<string, string>,
  options: Acord30ProjectionOptions = {},
): ReconciledAcord30Projection {
  // An empty stored map is no stored map: a row with no coverage cells cannot
  // out-rank the local projection, it would just blank the certificate.
  const stored = options.canonicalFieldValues;
  const canonical = stored && Object.keys(stored).length > 0 ? stored : null;
  const source = canonical
    ? "canonical_opal"
    : "legacy_workbench_fallback";
  const partition = schemaValues(canonical ?? projectedValues);
  // Canonical input fails closed on an unreviewed id; the legacy projection
  // drops it, because there is no other source for a pre-canonical record.
  if (canonical && partition.unexpected.length > 0) {
    throw new UnexpectedAcord30CanonicalFieldsError(partition.unexpected);
  }
  const values = canonical
    ? applyRequestContext(partition.values, projectedValues)
    : partition.values;

  const additionalInsuredAttested =
    options.coverageExtraction?.blanketAi === true
    || options.coverageExtraction?.scheduledAi === true;
  const waiverAttested =
    options.coverageExtraction?.waiverSubrogation === true;

  if (!additionalInsuredAttested) {
    for (const fieldId of ACORD30_ADDITIONAL_INSURED_FIELD_IDS) {
      if (fieldId in values) values[fieldId] = "";
    }
  }
  if (!waiverAttested) {
    for (const fieldId of ACORD30_WAIVER_FIELD_IDS) {
      if (fieldId in values) values[fieldId] = "";
    }
  }

  return {
    values,
    source,
    droppedCanonicalFieldIds: canonical ? partition.intentionalAliases : [],
    droppedLegacyFieldIds: canonical
      ? []
      : [...partition.intentionalAliases, ...partition.unexpected].sort(),
  };
}
