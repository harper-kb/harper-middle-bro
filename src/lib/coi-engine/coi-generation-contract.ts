export const COI_CARRIER_SLOTS = ["A", "B", "C", "D", "E", "F"] as const;

export type CoiCarrierSlot = (typeof COI_CARRIER_SLOTS)[number];
export type CoiCoverageBasis = "occurrence" | "claims_made" | "unknown";
export type CoiPolicyLine =
  | "cgl"
  | "auto"
  | "umbrella"
  | "workers_comp"
  | "other";

export type CoiLimitKey =
  | "each_occurrence"
  | "general_aggregate"
  | "products_completed_ops"
  | "personal_adv_injury"
  | "damage_to_rented"
  | "med_exp"
  | "combined_single_limit"
  | "bodily_injury_per_person"
  | "bodily_injury_per_accident"
  | "property_damage"
  | "umbrella_each_occurrence"
  | "umbrella_aggregate"
  | "retention"
  | "workers_comp_each_accident"
  | "workers_comp_disease_each_employee"
  | "workers_comp_disease_policy_limit";

/**
 * The policy-derived contract consumed by deterministic COI generation.
 *
 * It is intentionally independent from any PDF template. A template that
 * cannot render a field must not force the canonical value to be dropped or
 * crammed into a sibling cell.
 */
export interface CanonicalCoiGenerationInput {
  insured: {
    legalName: string;
    address: CoiGenerationAddress;
  };
  carriers: CoiGenerationCarrier[];
  policies: CoiGenerationPolicy[];
}

export interface CoiGenerationAddress {
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface CoiGenerationCarrier {
  /**
   * Stable reference used by policies. It is not a display value.
   * The A-F slot is explicit so row letters and insurer blocks cannot diverge.
   */
  ref: string;
  slot: CoiCarrierSlot;
  legalName: string;
  /**
   * Five-character string. Leading zeroes are significant.
   * Blank means reference-data enrichment did not resolve uniquely.
   */
  naicCode: string;
}

export interface CoiGenerationLimit {
  /**
   * Canonical semantic key. Extraction adapters may leave this null only when
   * the source label does not map conservatively.
   */
  key: CoiLimitKey | null;
  amount: string;
  rawLabel: string;
}

export interface CoiGenerationPolicy {
  line: CoiPolicyLine;
  displayName: string;
  carrierRef: string;
  policyNumber: string;
  effectiveDate: string;
  expirationDate: string;
  coverageBasis: CoiCoverageBasis;
  limits: CoiGenerationLimit[];
}

export function emptyCoiAddress(): CoiGenerationAddress {
  return {
    street1: "",
    street2: "",
    city: "",
    state: "",
    zip: "",
    country: "",
  };
}

/**
 * The workers-comp spelling predicate mirrored from the legacy certificate
 * section fold. Keep this conservative: every match moves a policy onto the
 * ACORD workers-comp row, while known misses remain on OTHER. The legacy path
 * keeps its established inline predicate so this flag-off change is a no-op.
 */
export function isWorkersCompPolicyLineText(value: unknown): boolean {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return (
    /^w\s*\/?\s*c\b/.test(normalized) ||
    (normalized.includes("worker") && normalized.includes("comp")) ||
    /employer'?s'? liability/.test(normalized)
  );
}

export function coiPolicyLineFromText(value: unknown): CoiPolicyLine {
  const words = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (words.includes("umbrella") || words.includes("excess liability")) {
    return "umbrella";
  }
  if (isWorkersCompPolicyLineText(value)) {
    return "workers_comp";
  }
  if (
    words.includes("commercial auto") ||
    words.includes("business auto") ||
    words.includes("automobile liability") ||
    words.includes("auto liability") ||
    words === "auto"
  ) {
    return "auto";
  }
  if (
    words.includes("general liability") ||
    words.includes("business liability") ||
    words === "gl" ||
    words === "cgl"
  ) {
    return "cgl";
  }
  return "other";
}

export function coiCoverageBasisFromValue(value: unknown): CoiCoverageBasis {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "occurrence") return "occurrence";
  if (normalized === "claims_made" || normalized === "claim_made") {
    return "claims_made";
  }
  return "unknown";
}
