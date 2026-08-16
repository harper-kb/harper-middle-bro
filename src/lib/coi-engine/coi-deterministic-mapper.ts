import {
  COI_CARRIER_SLOTS,
  coiPolicyLineFromText,
  emptyCoiAddress,
  type CanonicalCoiGenerationInput,
  type CoiCarrierSlot,
  type CoiCoverageBasis,
  type CoiGenerationLimit,
  type CoiGenerationPolicy,
  type CoiLimitKey,
  type CoiPolicyLine,
} from "./coi-generation-contract";

export interface DeterministicCoiProjectionContext {
  certificateDate: string;
  producerFields: Record<string, string>;
  holderName: string;
  holderAddress: string;
  descriptionOfOperations: string;
  additionalInsured: boolean;
  waiverOfSubrogation: boolean;
}

const LINE_ORDER: CoiPolicyLine[] = [
  "cgl",
  "auto",
  "umbrella",
  "workers_comp",
  "other",
];

const CLAIMS_MADE_LABELS = new Set([
  "each claim",
  "each claim limit",
  "bodily injury property damage each claim",
  "bodily injury property damage each claim limit",
]);

const OCCURRENCE_LABELS = new Set([
  "each occurrence",
  "each occurrence limit",
  "occurrence",
  "bodily injury property damage each occurrence",
  "bodily injury property damage each occurrence limit",
]);

function normalizedWords(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.join(" ") ?? "";
}

function checkboxOn(value: unknown): boolean {
  return ["true", "checked", "x", "yes", "y"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function formatPolicyDate(value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
    const [month, day, year] = text.split("/");
    return `${month.padStart(2, "0")}/${day.padStart(2, "0")}/${year}`;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  return text;
}

function inferredBasis(policy: CoiGenerationPolicy): CoiCoverageBasis {
  if (policy.coverageBasis !== "unknown") return policy.coverageBasis;
  const labels = new Set(policy.limits.map((limit) => normalizedWords(limit.rawLabel)));
  if ([...labels].some((label) => CLAIMS_MADE_LABELS.has(label))) {
    return "claims_made";
  }
  if ([...labels].some((label) => OCCURRENCE_LABELS.has(label))) {
    return "occurrence";
  }
  return "unknown";
}

function limitValue(
  policy: CoiGenerationPolicy,
  ...keys: CoiLimitKey[]
): string {
  return (
    policy.limits.find(
      (limit) => keys.includes(limit.key as CoiLimitKey) && nonEmpty(limit.amount),
    )?.amount ?? ""
  );
}

function carrierSlot(
  policy: CoiGenerationPolicy,
  carrierSlots: Map<string, CoiCarrierSlot>,
): CoiCarrierSlot | null {
  return carrierSlots.get(policy.carrierRef) ?? null;
}

function assignCarrierSlots(
  input: CanonicalCoiGenerationInput,
): Map<string, CoiCarrierSlot> {
  const assigned = new Map<string, CoiCarrierSlot>();
  const used = new Set<CoiCarrierSlot>();

  for (const carrier of input.carriers) {
    if (assigned.has(carrier.ref) || used.has(carrier.slot)) continue;
    assigned.set(carrier.ref, carrier.slot);
    used.add(carrier.slot);
  }

  const orderedPolicies = [...input.policies].sort(
    (left, right) =>
      LINE_ORDER.indexOf(left.line) - LINE_ORDER.indexOf(right.line),
  );
  for (const policy of orderedPolicies) {
    if (!policy.carrierRef || assigned.has(policy.carrierRef)) continue;
    const slot = COI_CARRIER_SLOTS.find((candidate) => !used.has(candidate));
    if (!slot) break;
    assigned.set(policy.carrierRef, slot);
    used.add(slot);
  }

  for (const carrier of input.carriers) {
    if (assigned.has(carrier.ref)) continue;
    const slot = COI_CARRIER_SLOTS.find((candidate) => !used.has(candidate));
    if (!slot) break;
    assigned.set(carrier.ref, slot);
    used.add(slot);
  }
  return assigned;
}

function selectedPolicies(
  input: CanonicalCoiGenerationInput,
): Map<CoiPolicyLine, CoiGenerationPolicy> {
  const selected = new Map<CoiPolicyLine, CoiGenerationPolicy>();
  for (const line of LINE_ORDER) {
    const candidates = input.policies.filter(
      (candidate) => candidate.line === line,
    );
    const policy =
      candidates.find(
        (candidate) =>
          Boolean(
            candidate.carrierRef ||
              candidate.policyNumber ||
              candidate.effectiveDate ||
              candidate.expirationDate ||
              candidate.coverageBasis !== "unknown" ||
              candidate.limits.some((limit) => nonEmpty(limit.amount)),
          ),
      ) ?? candidates[0];
    if (policy) selected.set(line, policy);
  }
  return selected;
}

function stampPolicyIdentity(
  values: Record<string, string>,
  policy: CoiGenerationPolicy,
  ids: {
    insurerLetter: string;
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
  },
  slots: Map<string, CoiCarrierSlot>,
): void {
  const slot = carrierSlot(policy, slots);
  if (slot) values[ids.insurerLetter] = slot;
  if (policy.policyNumber) values[ids.policyNumber] = policy.policyNumber;
  if (policy.effectiveDate) {
    values[ids.effectiveDate] = formatPolicyDate(policy.effectiveDate);
  }
  if (policy.expirationDate) {
    values[ids.expirationDate] = formatPolicyDate(policy.expirationDate);
  }
}

function stampLimit(
  values: Record<string, string>,
  fieldId: string,
  value: string,
): void {
  if (value) values[fieldId] = value;
}

function stampEndorsements(
  values: Record<string, string>,
  context: DeterministicCoiProjectionContext,
): void {
  if (!context.additionalInsured && !context.waiverOfSubrogation) return;
  const sections = [
    {
      policy: "cglPolicyNumber",
      ai: "cglAdditionalInsuredCheckbox",
      wos: "cglSubrogationWaivedCheckbox",
    },
    {
      policy: "autoLiabilityPolicyNumber",
      ai: "autoAdditionalInsuredCheckbox",
      wos: "autoSubrogationWaivedCheckbox",
    },
    {
      policy: "umbrellaPolicyNumber",
      ai: "umbrellaAdditionalInsuredCheckbox",
      wos: "umbrellaSubrogationWaivedCheckbox",
    },
    {
      policy: "workersCompPolicyNumber",
      ai: null,
      wos: "workersCompSubrogationWaivedCheckbox",
    },
    {
      policy: "otherInsurancePolicyNumber",
      ai: "otherInsuranceAdditionalInsuredCheckbox",
      wos: "otherInsuranceSubrogationWaivedCheckbox",
    },
  ] as const;
  for (const section of sections) {
    if (!values[section.policy]) continue;
    if (context.additionalInsured && section.ai) values[section.ai] = "Y";
    if (context.waiverOfSubrogation) values[section.wos] = "Y";
  }
}

/**
 * Pure canonical record -> ACORD 25 field-id projection.
 *
 * This is the promoted clean-room generation path. It deliberately has no
 * renderer knowledge and never fills a policy fact from a default.
 */
export function mapCanonicalCoiToAcord25Fields(
  input: CanonicalCoiGenerationInput,
  context: DeterministicCoiProjectionContext,
): Record<string, string> {
  const values: Record<string, string> = {
    certificateDate: context.certificateDate,
    ...context.producerFields,
    insuredName: input.insured.legalName,
  };
  const { address } = input.insured;
  if (address.street1) values["insuredAddress.street1"] = address.street1;
  if (address.street2) values["insuredAddress.street2"] = address.street2;
  if (address.city) values["insuredAddress.city"] = address.city;
  if (address.state) values["insuredAddress.state"] = address.state;
  if (address.zip) values["insuredAddress.zip"] = address.zip;
  // The current ACORD 25 template has no matching widget. Keeping the canonical
  // field in the projection prevents the model contract from dropping it.
  if (address.country) values["insuredAddress.country"] = address.country;

  const slots = assignCarrierSlots(input);
  for (const carrier of input.carriers) {
    const slot = slots.get(carrier.ref);
    if (!slot) continue;
    if (carrier.legalName) values[`insurer${slot}Name`] = carrier.legalName;
    if (/^\d{5}$/.test(carrier.naicCode)) {
      values[`insurer${slot}NaicNumber`] = carrier.naicCode;
    }
  }

  const policies = selectedPolicies(input);
  const cgl = policies.get("cgl");
  if (cgl) {
    values.commercialGeneralLiabilityCheckbox = "Y";
    stampPolicyIdentity(
      values,
      cgl,
      {
        insurerLetter: "cglInsurerLetter",
        policyNumber: "cglPolicyNumber",
        effectiveDate: "cglPolicyEffectiveDate",
        expirationDate: "cglPolicyExpirationDate",
      },
      slots,
    );
    const basis = inferredBasis(cgl);
    if (basis === "occurrence") values.cglOccurrenceCheckbox = "Y";
    if (basis === "claims_made") values.cglClaimsMadeCheckbox = "Y";
    stampLimit(values, "eachOccurrenceLimit", limitValue(cgl, "each_occurrence"));
    stampLimit(
      values,
      "damageToRentedPremisesLimit",
      limitValue(cgl, "damage_to_rented"),
    );
    stampLimit(values, "medExpLimit", limitValue(cgl, "med_exp"));
    stampLimit(
      values,
      "personalAndAdvInjuryLimit",
      limitValue(cgl, "personal_adv_injury"),
    );
    stampLimit(
      values,
      "generalAggregateLimit",
      limitValue(cgl, "general_aggregate"),
    );
    stampLimit(
      values,
      "productsCompOpAggLimit",
      limitValue(cgl, "products_completed_ops"),
    );
  }

  const auto = policies.get("auto");
  if (auto) {
    stampPolicyIdentity(
      values,
      auto,
      {
        insurerLetter: "autoLiabilityInsurerLetter",
        policyNumber: "autoLiabilityPolicyNumber",
        effectiveDate: "autoPolicyEffectiveDate",
        expirationDate: "autoPolicyExpirationDate",
      },
      slots,
    );
    stampLimit(
      values,
      "combinedSingleLimit",
      limitValue(auto, "combined_single_limit"),
    );
    stampLimit(
      values,
      "bodilyInjuryPerPersonLimit",
      limitValue(auto, "bodily_injury_per_person"),
    );
    stampLimit(
      values,
      "bodilyInjuryPerAccidentLimit",
      limitValue(auto, "bodily_injury_per_accident"),
    );
    stampLimit(
      values,
      "propertyDamageLimit",
      limitValue(auto, "property_damage"),
    );
  }

  const umbrella = policies.get("umbrella");
  if (umbrella) {
    values.umbrellaLiabilityCheckbox = "Y";
    stampPolicyIdentity(
      values,
      umbrella,
      {
        insurerLetter: "umbrellaInsurerLetter",
        policyNumber: "umbrellaPolicyNumber",
        effectiveDate: "umbrellaPolicyEffectiveDate",
        expirationDate: "umbrellaPolicyExpirationDate",
      },
      slots,
    );
    const basis = inferredBasis(umbrella);
    if (basis === "occurrence") values.umbrellaOccurrenceCheckbox = "Y";
    if (basis === "claims_made") values.umbrellaClaimsMadeCheckbox = "Y";
    stampLimit(
      values,
      "umbrellaEachOccurrenceLimit",
      limitValue(
        umbrella,
        "umbrella_each_occurrence",
        "each_occurrence",
      ),
    );
    stampLimit(
      values,
      "umbrellaAggregateLimit",
      limitValue(umbrella, "umbrella_aggregate", "general_aggregate"),
    );
    const retention = limitValue(umbrella, "retention");
    if (retention) {
      values.umbrellaRetentionCheckbox = "Y";
      values.retentionAmount = retention;
    }
  }

  const workersComp = policies.get("workers_comp");
  if (workersComp) {
    values.workersCompStatutoryCheckbox = "Y";
    stampPolicyIdentity(
      values,
      workersComp,
      {
        insurerLetter: "workersCompInsurerLetter",
        policyNumber: "workersCompPolicyNumber",
        effectiveDate: "workersCompPolicyEffectiveDate",
        expirationDate: "workersCompPolicyExpirationDate",
      },
      slots,
    );
    stampLimit(
      values,
      "workersCompEachAccidentLimit",
      limitValue(workersComp, "workers_comp_each_accident"),
    );
    stampLimit(
      values,
      "workersCompDiseaseEachEmployeeLimit",
      limitValue(workersComp, "workers_comp_disease_each_employee"),
    );
    stampLimit(
      values,
      "workersCompDiseasePolicyLimit",
      limitValue(workersComp, "workers_comp_disease_policy_limit"),
    );
  }

  const otherPolicies = input.policies.filter((policy) => policy.line === "other");
  if (otherPolicies.length) {
    values.otherInsuranceDescription = [
      ...new Set(
        otherPolicies
          .map((policy) => policy.displayName.trim())
          .filter(Boolean),
      ),
    ].join("; ");
    const identity = otherPolicies[0];
    const sameIdentity = otherPolicies.every(
      (policy) =>
        policy.policyNumber === identity.policyNumber &&
        policy.effectiveDate === identity.effectiveDate &&
        policy.expirationDate === identity.expirationDate &&
        policy.carrierRef === identity.carrierRef,
    );
    if (sameIdentity) {
      stampPolicyIdentity(
        values,
        identity,
        {
          insurerLetter: "otherInsuranceInsurerLetter",
          policyNumber: "otherInsurancePolicyNumber",
          effectiveDate: "otherInsurancePolicyEffectiveDate",
          expirationDate: "otherInsurancePolicyExpirationDate",
        },
        slots,
      );
    }
    const renderedLimits = otherPolicies
      .flatMap((policy) => policy.limits)
      .filter((limit) => limit.rawLabel && limit.amount)
      .map((limit) => `${limit.rawLabel}: ${limit.amount}`);
    if (renderedLimits.length) {
      values.otherInsuranceLimits = renderedLimits.join("; ");
    }
  }

  if (context.holderName) {
    values.certificateHolderNameLine1 = context.holderName;
  }
  if (context.holderAddress) {
    values["certificateHolderAddressLine1.street1"] = context.holderAddress;
  }
  values.descriptionOfOperations = context.descriptionOfOperations;
  stampEndorsements(values, context);
  return values;
}

function limit(
  values: Record<string, unknown>,
  field: string,
  key: CoiLimitKey,
  rawLabel: string,
): CoiGenerationLimit | null {
  const amount = String(values[field] ?? "").trim();
  return amount ? { key, amount, rawLabel } : null;
}

function policyFromFields(
  values: Record<string, unknown>,
  line: CoiPolicyLine,
  displayName: string,
  fields: {
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
    insurerLetter?: string;
  },
  limits: Array<CoiGenerationLimit | null>,
  coverageBasis: CoiCoverageBasis = "unknown",
): CoiGenerationPolicy | null {
  const policyNumber = String(values[fields.policyNumber] ?? "").trim();
  const effectiveDate = String(values[fields.effectiveDate] ?? "").trim();
  const expirationDate = String(values[fields.expirationDate] ?? "").trim();
  const presentLimits = limits.filter(
    (candidate): candidate is CoiGenerationLimit => candidate !== null,
  );
  if (!policyNumber && !effectiveDate && !expirationDate && !presentLimits.length) {
    return null;
  }
  const requestedSlot = String(
    values[fields.insurerLetter ?? ""] ?? "A",
  ).trim();
  const slot = COI_CARRIER_SLOTS.includes(requestedSlot as CoiCarrierSlot)
    ? requestedSlot
    : "A";
  return {
    line,
    displayName,
    carrierRef: `carrier-${slot}`,
    policyNumber,
    effectiveDate,
    expirationDate,
    coverageBasis,
    limits: presentLimits,
  };
}

/**
 * Adapter used by the committed parity harness and by migrations from stored
 * field-value baselines. It never reads truth while mapping; the supplied map
 * is itself the canonical input record.
 */
export function canonicalCoiInputFromFieldValues(
  values: Record<string, unknown>,
): CanonicalCoiGenerationInput {
  const carriers = COI_CARRIER_SLOTS.flatMap((slot) => {
    const legalName = String(values[`insurer${slot}Name`] ?? "").trim();
    const naicCode = String(values[`insurer${slot}NaicNumber`] ?? "").trim();
    return legalName || naicCode
      ? [
          {
            ref: `carrier-${slot}`,
            slot,
            legalName,
            naicCode,
          },
        ]
      : [];
  });
  const cglBasis: CoiCoverageBasis =
    checkboxOn(values.cglClaimsMadeCheckbox)
      ? "claims_made"
      : checkboxOn(values.cglOccurrenceCheckbox)
        ? "occurrence"
        : "unknown";
  const policies = [
    policyFromFields(
      values,
      "cgl",
      "Commercial General Liability",
      {
        policyNumber: "cglPolicyNumber",
        effectiveDate: "cglPolicyEffectiveDate",
        expirationDate: "cglPolicyExpirationDate",
        insurerLetter: "cglInsurerLetter",
      },
      [
        limit(values, "eachOccurrenceLimit", "each_occurrence", "Each Occurrence"),
        limit(values, "generalAggregateLimit", "general_aggregate", "General Aggregate"),
        limit(
          values,
          "productsCompOpAggLimit",
          "products_completed_ops",
          "Products-Completed Operations Aggregate",
        ),
        limit(
          values,
          "personalAndAdvInjuryLimit",
          "personal_adv_injury",
          "Personal and Advertising Injury",
        ),
        limit(values, "medExpLimit", "med_exp", "Medical Expense"),
        limit(
          values,
          "damageToRentedPremisesLimit",
          "damage_to_rented",
          "Damage to Premises Rented",
        ),
      ],
      cglBasis,
    ),
    policyFromFields(
      values,
      "auto",
      "Automobile Liability",
      {
        policyNumber: "autoLiabilityPolicyNumber",
        effectiveDate: "autoPolicyEffectiveDate",
        expirationDate: "autoPolicyExpirationDate",
        insurerLetter: "autoLiabilityInsurerLetter",
      },
      [
        limit(
          values,
          "combinedSingleLimit",
          "combined_single_limit",
          "Combined Single Limit",
        ),
        limit(
          values,
          "bodilyInjuryPerPersonLimit",
          "bodily_injury_per_person",
          "Bodily Injury (Per Person)",
        ),
        limit(
          values,
          "bodilyInjuryPerAccidentLimit",
          "bodily_injury_per_accident",
          "Bodily Injury (Per Accident)",
        ),
        limit(
          values,
          "propertyDamageLimit",
          "property_damage",
          "Property Damage",
        ),
      ],
    ),
    policyFromFields(
      values,
      "umbrella",
      "Umbrella Liability",
      {
        policyNumber: "umbrellaPolicyNumber",
        effectiveDate: "umbrellaPolicyEffectiveDate",
        expirationDate: "umbrellaPolicyExpirationDate",
        insurerLetter: "umbrellaInsurerLetter",
      },
      [
        limit(
          values,
          "umbrellaEachOccurrenceLimit",
          "umbrella_each_occurrence",
          "Each Occurrence",
        ),
        limit(
          values,
          "umbrellaAggregateLimit",
          "umbrella_aggregate",
          "Aggregate",
        ),
      ],
    ),
    policyFromFields(
      values,
      "workers_comp",
      "Workers Compensation",
      {
        policyNumber: "workersCompPolicyNumber",
        effectiveDate: "workersCompPolicyEffectiveDate",
        expirationDate: "workersCompPolicyExpirationDate",
        insurerLetter: "workersCompInsurerLetter",
      },
      [
        limit(
          values,
          "workersCompEachAccidentLimit",
          "workers_comp_each_accident",
          "Each Accident",
        ),
        limit(
          values,
          "workersCompDiseaseEachEmployeeLimit",
          "workers_comp_disease_each_employee",
          "Disease Each Employee",
        ),
        limit(
          values,
          "workersCompDiseasePolicyLimit",
          "workers_comp_disease_policy_limit",
          "Disease Policy Limit",
        ),
      ],
    ),
  ].filter((policy): policy is CoiGenerationPolicy => policy !== null);

  return {
    insured: {
      legalName: String(values.insuredName ?? "").trim(),
      address: {
        ...emptyCoiAddress(),
        street1: String(values["insuredAddress.street1"] ?? "").trim(),
        street2: String(values["insuredAddress.street2"] ?? "").trim(),
        city: String(values["insuredAddress.city"] ?? "").trim(),
        state: String(values["insuredAddress.state"] ?? "").trim(),
        zip: String(values["insuredAddress.zip"] ?? "").trim(),
        country: String(values["insuredAddress.country"] ?? "").trim(),
      },
    },
    carriers,
    policies,
  };
}

/**
 * Conservative free-label adapter retained at the extraction boundary.
 * Canonical records should carry keys; consumers never re-interpret labels.
 */
export function canonicalLimitKeyFromLabel(
  lineValue: unknown,
  labelValue: unknown,
): CoiLimitKey | null {
  const line = coiPolicyLineFromText(lineValue);
  const label = normalizedWords(labelValue);
  const words = new Set(label.split(" ").filter(Boolean));
  if (line === "cgl") {
    if (
      (words.has("each") && words.has("occurrence") &&
        !words.has("damage") && !words.has("medical") &&
        !words.has("products")) ||
      OCCURRENCE_LABELS.has(label) ||
      CLAIMS_MADE_LABELS.has(label)
    ) {
      return "each_occurrence";
    }
    if (words.has("general") && words.has("aggregate")) {
      return "general_aggregate";
    }
    if (
      words.has("products") &&
      !["other", "than", "products"].every((word) => words.has(word)) &&
      ((words.has("completed") &&
        (words.has("operations") || words.has("ops"))) ||
        (words.has("comp") && words.has("op")))
    ) {
      return "products_completed_ops";
    }
    if (
      words.has("personal") &&
      (words.has("advertising") || words.has("adv")) &&
      words.has("injury")
    ) {
      return "personal_adv_injury";
    }
    if (
      (words.has("medical") && words.has("expense")) ||
      (words.has("med") && words.has("exp"))
    ) {
      return "med_exp";
    }
    if (
      words.has("damage") &&
      words.has("premises") &&
      words.has("rented")
    ) {
      return "damage_to_rented";
    }
  }
  if (line === "auto") {
    if (
      (words.has("combined") && words.has("single") && words.has("limit")) ||
      words.has("csl")
    ) {
      return "combined_single_limit";
    }
    // Split BI/PD basis. #1866 mapped only CSL here, so a policy expressed as
    // split limits lost every sub-limit at this boundary — and the empty auto
    // cells then printed "Excluded" downstream. The contract already carries
    // these keys; mirror autoLimitFieldId's split handling.
    if (words.has("property") && words.has("damage")) {
      return "property_damage";
    }
    if (words.has("bodily") && words.has("injury")) {
      if (words.has("person")) return "bodily_injury_per_person";
      if (words.has("accident") || words.has("occurrence")) {
        return "bodily_injury_per_accident";
      }
    }
  }
  if (line === "umbrella") {
    if (words.has("each") && (words.has("occurrence") || words.has("claim"))) {
      return "umbrella_each_occurrence";
    }
    if (words.has("aggregate")) return "umbrella_aggregate";
    if (words.has("retention") || words.has("deductible")) return "retention";
  }
  if (line === "workers_comp") {
    if (words.has("each") && words.has("accident")) {
      return "workers_comp_each_accident";
    }
    if (
      words.has("disease") &&
      words.has("each") &&
      words.has("employee")
    ) {
      return "workers_comp_disease_each_employee";
    }
    if (
      words.has("disease") &&
      words.has("policy") &&
      words.has("limit")
    ) {
      return "workers_comp_disease_policy_limit";
    }
  }
  return null;
}
