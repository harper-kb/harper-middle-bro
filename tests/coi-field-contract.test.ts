import { describe, it, expect } from "vitest";
import {
  STATIC_FIELD_IDS,
  DETERMINISTIC_FIELD_IDS,
  orphanManifestFields,
  schemaFieldIds,
} from "@/lib/coi-engine/coi-field-contract";
import {
  buildCompletion,
  completionToFieldValues,
  limitFieldId,
  coverageRowForLine,
  runChecker,
  type Completion,
} from "@/lib/coi-engine/coi-generate";
import type { CoiContext } from "@/lib/coi-engine/coi-context";

// ── Class-B / Class-C guard ──────────────────────────────────────────────────
// A newly-added-but-unmapped ACORD field, or a typo in the manifest, fails CI
// instead of surfacing as an operator complaint. Full-context fixture asserts
// every STATIC field and every populated DETERMINISTIC field is written.

function fullCtx(): CoiContext {
  return {
    companyId: "99930099",
    issued: null,
    company: {
      name: "North Pier Fabrication LLC",
      industry: "metal fabrication",
      subIndustry: null,
      city: "Charleston",
      state: "SC",
      email: "ops@northpier.example",
      street1: "400 Harbor Way",
      street2: "Suite 12",
      zip: "29401",
    },
    policy: {
      namedInsured: "North Pier Fabrication LLC",
      policyNumber: "SYN-PKG-99930099",
      status: "bound",
      effectiveDate: "2026-01-01T00:00:00Z",
      expirationDate: "2027-01-01T00:00:00Z",
      coverageLines: [
        "Commercial General Liability",
        "Automobile Liability",
        "Umbrella / Excess Liability",
        "Workers Compensation & Employers' Liability",
      ],
      limits: [
        { line: "Commercial General Liability", label: "Each Occurrence", amount: "$1,000,000" },
        { line: "Commercial General Liability", label: "General Aggregate", amount: "$2,000,000" },
        { line: "Automobile Liability", label: "Combined Single Limit", amount: "$1,000,000" },
        { line: "Umbrella / Excess Liability", label: "Each Occurrence", amount: "$1,000,000" },
        { line: "Umbrella / Excess Liability", label: "Aggregate", amount: "$1,000,000" },
        { line: "Workers Compensation & Employers' Liability", label: "Each Accident", amount: "$1,000,000" },
        { line: "Workers Compensation & Employers' Liability", label: "Disease Each Employee", amount: "$1,000,000" },
        { line: "Workers Compensation & Employers' Liability", label: "Disease Policy Limit", amount: "$1,000,000" },
      ],
      deductible: null,
    },
    deal: {
      coverageType: ["gl", "auto", "umbrella", "wc"],
      policyNumber: "SYN-PKG-99930099",
      carrier: "Test Mutual Insurance Co",
      wholesaler: null,
      effectiveDate: "2026-01-01T00:00:00Z",
      expirationDate: "2027-01-01T00:00:00Z",
      bound: true,
    },
    holder: { name: "Sample Holder LP", address: "1 Main St, Charleston, SC 29401", source: "email" },
    generatedCert: null,
    docs: [],
    binder: null,
    carrierFromDocs: null,
    carrierNaic: "12345",
    docExtraction: null,
    priorCert: null,
    billing: null,
    dealLines: [],
    requestedLines: [],
    policies: [],
  };
}

describe("field-contract manifest integrity", () => {
  it("every STATIC + DETERMINISTIC field_id exists in acord25-schema.json", () => {
    expect(orphanManifestFields()).toEqual([]);
  });

  it("STATIC and DETERMINISTIC partitions do not overlap", () => {
    const overlap = STATIC_FIELD_IDS.filter((id) => (DETERMINISTIC_FIELD_IDS as readonly string[]).includes(id));
    expect(overlap).toEqual([]);
  });

  it("schema still has the expected field count (~130) — catch accidental schema wipe", () => {
    expect(schemaFieldIds().length).toBeGreaterThanOrEqual(120);
  });
});

describe("coverageRowForLine / limitFieldId — fail-closed", () => {
  it("classifies the four standard lines", () => {
    expect(coverageRowForLine("Commercial General Liability")).toBe("gl");
    expect(coverageRowForLine("Automobile Liability")).toBe("auto");
    expect(coverageRowForLine("Umbrella / Excess Liability")).toBe("umbrella");
    expect(coverageRowForLine("Workers Compensation & Employers' Liability")).toBe("wc");
  });

  it("refuses unrecognized lines and labels (never invents a cell)", () => {
    expect(coverageRowForLine("Inland Marine")).toBeNull();
    expect(limitFieldId("Inland Marine", "Each Occurrence")).toBeNull();
    expect(limitFieldId("Automobile Liability", "Mystery Sublimit")).toBeNull();
  });

  it("places WC / Auto / Umbrella limits on the correct field_ids", () => {
    expect(limitFieldId("Automobile Liability", "Combined Single Limit")).toBe("combinedSingleLimit");
    expect(limitFieldId("Umbrella / Excess Liability", "Each Occurrence")).toBe("umbrellaEachOccurrenceLimit");
    expect(limitFieldId("Umbrella / Excess Liability", "Per Occurrence")).toBe("umbrellaEachOccurrenceLimit");
    expect(limitFieldId("Workers Compensation & Employers' Liability", "Each Accident")).toBe(
      "workersCompEachAccidentLimit",
    );
  });

  it("maps 'per occurrence' and Liability+Medical compound labels to occurrence, not MED EXP", () => {
    expect(limitFieldId("General Liability", "Per Occurrence")).toBe("eachOccurrenceLimit");
    expect(
      limitFieldId(
        "General Liability",
        "Liability and Medical Expenses $2,000,000 per occurrence",
      ),
    ).toBe("eachOccurrenceLimit");
    expect(limitFieldId("General Liability", "Medical Expense")).toBe("medExpLimit");
    expect(limitFieldId("General Liability", "Med Exp")).toBe("medExpLimit");
  });
});

describe("completionToFieldValues — class-B completeness", () => {
  it("writes every STATIC field and every populated DETERMINISTIC field", () => {
    const c = buildCompletion(fullCtx());
    const values = completionToFieldValues(c);

    for (const id of STATIC_FIELD_IDS) {
      expect(values[id], `static field missing: ${id}`).toBeTruthy();
    }

    // Deterministic fields whose sources are present in fullCtx.
    const expectedPresent: string[] = [
      "insuredName",
      "insuredAddress.street1",
      "insuredAddress.street2",
      "insuredAddress.city",
      "insuredAddress.state",
      "insuredAddress.zip",
      "insurerAName",
      "insurerANaicNumber",
      "commercialGeneralLiabilityCheckbox",
      "cglOccurrenceCheckbox",
      "cglInsurerLetter",
      "cglPolicyNumber",
      "cglPolicyEffectiveDate",
      "cglPolicyExpirationDate",
      "eachOccurrenceLimit",
      "generalAggregateLimit",
      "autoLiabilityInsurerLetter",
      "autoLiabilityPolicyNumber",
      "combinedSingleLimit",
      "umbrellaLiabilityCheckbox",
      "umbrellaOccurrenceCheckbox",
      "umbrellaEachOccurrenceLimit",
      "workersCompInsurerLetter",
      "workersCompStatutoryCheckbox",
      "workersCompEachAccidentLimit",
      "workersCompDiseaseEachEmployeeLimit",
      "workersCompDiseasePolicyLimit",
    ];
    for (const id of expectedPresent) {
      expect(values[id], `deterministic field missing: ${id}`).toBeTruthy();
    }
  });

  it("leaves NAIC blank + checker-flags when carrier is known but NAIC is not", () => {
    const ctx = fullCtx();
    ctx.carrierNaic = null;
    const c = buildCompletion(ctx);
    const values = completionToFieldValues(c);
    expect(values.insurerAName).toBe("Test Mutual Insurance Co");
    expect(values.insurerANaicNumber).toBeUndefined();
    const check = runChecker(c, ctx);
    expect(check.flags.some((f) => /NAIC/i.test(f))).toBe(true);
  });

  it("flags an unmapped standard-row limit instead of placing it on the wrong cell", () => {
    const ctx = fullCtx();
    ctx.policy!.limits.push({ line: "Automobile Liability", label: "Mystery Sublimit", amount: "$500,000" });
    const c = buildCompletion(ctx);
    expect(c.limits.some((l) => l.label === "Mystery Sublimit")).toBe(true);
    const values = completionToFieldValues(c);
    // The mystery Auto limit must not overwrite the valid GL occurrence cell.
    expect(values.eachOccurrenceLimit).toBe("$1,000,000");
    const check = runChecker(c, ctx);
    expect(check.flags.some((f) => /unmapped|could not be placed/i.test(f))).toBe(true);
  });

  it("fills unmentioned limits as Excluded only on present coverage rows", () => {
    const ctx = fullCtx();
    ctx.policy!.coverageLines = ["Commercial General Liability"];
    ctx.policy!.limits = [
      {
        line: "Commercial General Liability",
        label: "Each Occurrence",
        amount: "Included",
      },
    ];

    const values = completionToFieldValues(buildCompletion(ctx));

    expect(values.eachOccurrenceLimit).toBe("Included");
    expect(values.damageToRentedPremisesLimit).toBe("Excluded");
    expect(values.medExpLimit).toBe("Excluded");
    expect(values.productsCompOpAggLimit).toBe("Excluded");
    expect(values.combinedSingleLimit).toBeUndefined();
    expect(values.workersCompEachAccidentLimit).toBeUndefined();
  });
});

describe("Completion shape — producer block is Harper identity", () => {
  it("stamps the canonical San Francisco producer identity", () => {
    const values = completionToFieldValues(buildCompletion(fullCtx()));
    expect(values.producerName).toBe("Harper Global Enterprises Inc dba Harper Global Insurance Agency");
    expect(values.producerContactName).toBe("Dakotah Rice");
    expect(values.producerPhone).toBe("470-839-4314");
    expect(values.producerEmail).toBe("service@harperinsure.com");
    expect(values["producerAddress.street1"]).toBe("425 Market Street");
    expect(values["producerAddress.street2"]).toBe("Suite 1300");
    expect(values["producerAddress.city"]).toBe("San Francisco");
    expect(values["producerAddress.state"]).toBe("CA");
    expect(values["producerAddress.zip"]).toBe("94105");
  });
});

// Keep Completion type exercise so unused-import lint doesn't fire on edits.
void (null as unknown as Completion);
