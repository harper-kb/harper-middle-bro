import { describe, expect, it } from "vitest";

import {
  completionToFieldValues,
  deterministicCompletionToFieldValues,
  legacyCompletionToFieldValues,
  type Completion,
} from "@/lib/coi-engine/coi-generate";
import { docFactsFromExtraction } from "@/lib/coi-engine/coi-doc-extract";
import { canonicalCoiInputFromFieldValues } from "@/lib/coi-engine/coi-deterministic-mapper";
import {
  coiPolicyLineFromText,
  type CanonicalCoiGenerationInput,
  type CoiGenerationPolicy,
} from "@/lib/coi-engine/coi-generation-contract";

function policy(
  over: Partial<CoiGenerationPolicy> & Pick<CoiGenerationPolicy, "line">,
): CoiGenerationPolicy {
  return {
    displayName: over.line,
    carrierRef: "carrier-A",
    policyNumber: "",
    effectiveDate: "",
    expirationDate: "",
    coverageBasis: "unknown",
    limits: [],
    ...over,
  };
}

function completion(
  generationInput: CanonicalCoiGenerationInput,
): Completion {
  return {
    namedInsured: {
      value: generationInput.insured.legalName,
      source: "policy",
    },
    insuredAddress: { value: "", source: "policy" },
    insuredStreet: generationInput.insured.address.street1,
    insuredStreet2: generationInput.insured.address.street2,
    insuredCity: generationInput.insured.address.city,
    insuredState: generationInput.insured.address.state,
    insuredZip: generationInput.insured.address.zip,
    carrier: {
      value: generationInput.carriers[0]?.legalName ?? "",
      source: "policy",
    },
    carrierNaic: generationInput.carriers[0]?.naicCode ?? null,
    policyNumber: {
      value: generationInput.policies[0]?.policyNumber ?? "",
      source: "policy",
    },
    effectiveDate: {
      value: generationInput.policies[0]?.effectiveDate ?? "",
      source: "policy",
    },
    expirationDate: {
      value: generationInput.policies[0]?.expirationDate ?? "",
      source: "policy",
    },
    coverageLines: generationInput.policies.map(
      (entry) => entry.displayName,
    ),
    coverageSource: "policy",
    limits: generationInput.policies.flatMap((entry) =>
      entry.limits.map((limit) => ({
        line: entry.displayName,
        label: limit.rawLabel,
        amount: limit.amount,
      })),
    ),
    limitsSource: "policy",
    deductible: { value: "", source: "missing" },
    holderName: { value: "Synthetic Holder LLC", source: "request" },
    holderAddress: {
      value: "99 Example Street",
      source: "request",
    },
    descriptionOfOperations: { value: "", source: "missing" },
    specialWording: null,
    generationInput,
  };
}

const baseAddress = {
  street1: "100 Synthetic Avenue",
  street2: "Suite 200",
  city: "Testville",
  state: "CA",
  zip: "99999",
  country: "US",
};

describe("deterministic COI generator contract", () => {
  it.each([
    "Workers Comp",
    "workers comp",
    "WORKERS COMP",
    "Worker's Compensation",
    "Worker’s Compensation",
    "Workers' Compensation",
    "Workers’ Compensation",
    "W/C",
    "WC",
  ])("routes the live workers-comp spelling %j to the WC section", (spelling) => {
    expect(coiPolicyLineFromText(spelling)).toBe("workers_comp");
  });

  it("keeps the legacy fold's deliberately unsupported work-comp names on OTHER", () => {
    expect(coiPolicyLineFromText("Work Comp")).toBe("other");
    expect(coiPolicyLineFromText("Workman's Comp")).toBe("other");
  });

  it("keeps the flag-off projection byte-for-byte on the legacy path", () => {
    const value = completion({
      insured: { legalName: "Synthetic Fabrication LLC", address: baseAddress },
      carriers: [
        {
          ref: "carrier-A",
          slot: "A",
          legalName: "Synthetic Mutual",
          naicCode: "10001",
        },
      ],
      policies: [
        policy({
          line: "cgl",
          displayName: "Commercial General Liability",
          policyNumber: "SYN-GL-99",
          coverageBasis: "claims_made",
        }),
      ],
    });

    expect(
      completionToFieldValues(value, {
        deterministicGeneratorEnabled: false,
      }),
    ).toEqual(legacyCompletionToFieldValues(value));
  });

  it("prints claims-made and never occurrence for an explicit claims-made policy", () => {
    const value = completion({
      insured: { legalName: "Synthetic Fabrication LLC", address: baseAddress },
      carriers: [
        {
          ref: "carrier-A",
          slot: "A",
          legalName: "Synthetic Mutual",
          naicCode: "10001",
        },
      ],
      policies: [
        policy({
          line: "cgl",
          displayName: "Commercial General Liability",
          policyNumber: "SYN-CLAIMS-99",
          effectiveDate: "2026-01-01",
          expirationDate: "2027-01-01",
          coverageBasis: "claims_made",
          limits: [
            {
              key: "each_occurrence",
              amount: "$1,000,000",
              rawLabel: "Each Claim",
            },
          ],
        }),
      ],
    });

    const values = deterministicCompletionToFieldValues(value);

    expect(values.cglClaimsMadeCheckbox).toBe("Y");
    expect(values.cglOccurrenceCheckbox).toBeUndefined();
    expect(values.eachOccurrenceLimit).toBe("$1,000,000");
  });

  it("leaves both liability-basis boxes blank when the policy is unknown", () => {
    const value = completion({
      insured: { legalName: "Synthetic Fabrication LLC", address: baseAddress },
      carriers: [],
      policies: [
        policy({
          line: "cgl",
          displayName: "Commercial General Liability",
          policyNumber: "SYN-UNKNOWN-99",
          coverageBasis: "unknown",
        }),
      ],
    });

    const values = deterministicCompletionToFieldValues(value);

    expect(values.cglClaimsMadeCheckbox).toBeUndefined();
    expect(values.cglOccurrenceCheckbox).toBeUndefined();
  });

  it("does not treat an explicit false checkbox as claims-made", () => {
    const input = canonicalCoiInputFromFieldValues({
      cglPolicyNumber: "SYN-FALSE-99",
      cglClaimsMadeCheckbox: false,
      cglOccurrenceCheckbox: true,
    });

    expect(input.policies[0]?.coverageBasis).toBe("occurrence");
  });

  it("maps an A-F carrier roster and each policy's own carrier reference", () => {
    const value = completion({
      insured: { legalName: "Synthetic Fabrication LLC", address: baseAddress },
      carriers: [
        {
          ref: "carrier-gl",
          slot: "A",
          legalName: "Synthetic GL Mutual",
          naicCode: "10001",
        },
        {
          ref: "carrier-umbrella",
          slot: "B",
          legalName: "Synthetic Umbrella Mutual",
          naicCode: "10002",
        },
        {
          ref: "carrier-wc",
          slot: "C",
          legalName: "Synthetic WC Mutual",
          naicCode: "01003",
        },
      ],
      policies: [
        policy({
          line: "cgl",
          displayName: "Commercial General Liability",
          carrierRef: "carrier-gl",
          policyNumber: "SYN-GL-99",
          coverageBasis: "occurrence",
        }),
        policy({
          line: "umbrella",
          displayName: "Umbrella Liability",
          carrierRef: "carrier-umbrella",
          policyNumber: "SYN-UMB-99",
          coverageBasis: "occurrence",
        }),
        policy({
          line: "workers_comp",
          displayName: "Workers Compensation",
          carrierRef: "carrier-wc",
          policyNumber: "SYN-WC-99",
        }),
      ],
    });

    const values = deterministicCompletionToFieldValues(value);

    expect(values).toMatchObject({
      insurerAName: "Synthetic GL Mutual",
      insurerANaicNumber: "10001",
      insurerBName: "Synthetic Umbrella Mutual",
      insurerBNaicNumber: "10002",
      insurerCName: "Synthetic WC Mutual",
      insurerCNaicNumber: "01003",
      cglInsurerLetter: "A",
      cglPolicyNumber: "SYN-GL-99",
      umbrellaInsurerLetter: "B",
      umbrellaPolicyNumber: "SYN-UMB-99",
      workersCompInsurerLetter: "C",
      workersCompPolicyNumber: "SYN-WC-99",
    });
  });

  it("prefers an attributed policy over an earlier empty shell for the same line", () => {
    const value = completion({
      insured: { legalName: "Synthetic Fabrication LLC", address: baseAddress },
      carriers: [
        {
          ref: "carrier-wc",
          slot: "A",
          legalName: "Synthetic WC Mutual",
          naicCode: "01003",
        },
      ],
      policies: [
        policy({
          line: "workers_comp",
          displayName: "Workers Comp",
          carrierRef: "",
        }),
        policy({
          line: "workers_comp",
          displayName: "Workers Compensation",
          carrierRef: "carrier-wc",
          policyNumber: "SYN-WC-FILLED-99",
          effectiveDate: "2026-01-01",
          expirationDate: "2027-01-01",
          limits: [
            {
              key: "workers_comp_each_accident",
              amount: "$500,000",
              rawLabel: "Each Accident",
            },
          ],
        }),
      ],
    });

    expect(deterministicCompletionToFieldValues(value)).toMatchObject({
      workersCompInsurerLetter: "A",
      workersCompPolicyNumber: "SYN-WC-FILLED-99",
      workersCompPolicyEffectiveDate: "01/01/2026",
      workersCompPolicyExpirationDate: "01/01/2027",
      workersCompEachAccidentLimit: "$500,000",
    });
  });

  it("retains street line 2 and country as separate canonical fields", () => {
    const value = completion({
      insured: { legalName: "Synthetic Fabrication LLC", address: baseAddress },
      carriers: [],
      policies: [],
    });

    const values = deterministicCompletionToFieldValues(value);

    expect(values["insuredAddress.street1"]).toBe("100 Synthetic Avenue");
    expect(values["insuredAddress.street2"]).toBe("Suite 200");
    expect(values["insuredAddress.country"]).toBe("US");
  });

  it("leaves the certificate holder cell blank when the holder is not identified", () => {
    const value = completion({
      insured: { legalName: "Synthetic Fabrication LLC", address: baseAddress },
      carriers: [],
      policies: [],
    });
    value.holderName = { value: "", source: "missing" };

    expect(
      deterministicCompletionToFieldValues(value).certificateHolderNameLine1,
    ).toBeUndefined();
  });

  it("carries extraction NAIC, full address, and coverage_basis into the contract", () => {
    const facts = docFactsFromExtraction(
      {
        policy: {
          declarations: {
            named_insured: {
              legal_name: "Synthetic Fabrication LLC",
              address: {
                street: "100 Synthetic Avenue\nSuite 200",
                city: "Testville",
                state: "CA",
                zip: "99999",
                country: "US",
              },
            },
            carrier: {
              name: "Synthetic Claims Mutual",
              naic_code: "01004",
            },
            policy_number: "SYN-CLAIMS-100",
            policy_term: {
              effective_date: "2026-01-01",
              expiration_date: "2027-01-01",
            },
            coverage_lines: [
              {
                coverage_type: "Commercial General Liability",
                coverage_basis: "CLAIMS_MADE",
                limits: [
                  {
                    label: "Each Claim",
                    amount: "$1,000,000",
                  },
                ],
              },
            ],
          },
        },
      },
      {
        artifactId: "harper:artifact:synthetic",
        docName: "Synthetic policy.pdf",
        classificationType: "POLICY_DOCUMENT",
      },
    );

    expect(facts?.generationInput).toMatchObject({
      insured: {
        address: {
          street1: "100 Synthetic Avenue",
          street2: "Suite 200",
          country: "US",
        },
      },
      carriers: [
        {
          slot: "A",
          legalName: "Synthetic Claims Mutual",
          naicCode: "01004",
        },
      ],
      policies: [
        {
          line: "cgl",
          policyNumber: "SYN-CLAIMS-100",
          coverageBasis: "claims_made",
        },
      ],
    });
  });
});
