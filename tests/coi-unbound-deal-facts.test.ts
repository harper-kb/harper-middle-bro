import { describe, it, expect } from "vitest";
import { buildCompletion, completionToFieldValues, runChecker, type CoverageExtractionFacts } from "@/lib/coi-engine/coi-generate";
import type { CoiContext } from "@/lib/coi-engine/coi-context";

// ── AN UNBOUND DEAL CONTRIBUTES NO CERTIFICATE FACT (feedback plane #1128) ────
// The plane item — "Coverage line removed: WC — WC. Why: No workers' comp" —
// was first answered by dropping the unbound deal's COVERAGE LINES from the
// completion ladder. That left the same quoted row still feeding the ladder's
// other rungs: its policy number, its term dates and its carrier. Those print
// on WHICHEVER line does get certificated (completionToFieldValues stamps
// c.policyNumber / c.effectiveDate / c.expirationDate into every section it
// opens), so a quoted WC row could put its own number and term on a
// document-sourced GL row — a worse paper than the extra WC section the
// operator blanked.
//
// Same law, same source: coi-data.ts's ledger rule ("BOUND = real policy number
// AND deal_stage 'bound'; anything else (quote/pending/null) is UNBOUND") and
// coi-checklist.ts's line-bind item ("NEVER certificate a line that is not
// actually bound — direct E&O exposure").
//
// Synthetic 99-band ids only.

function ctx(over: Partial<CoiContext> = {}): CoiContext {
  return {
    companyId: "99931128",
    issued: null,
    company: { name: "Synthetic Drywall LLC", industry: "Drywall contracting", subIndustry: null, city: "Testville", state: "TX", email: null },
    policy: null,
    deal: null,
    holder: { name: "Sample Holder LLC", address: null, source: "request" },
    generatedCert: null,
    docs: [],
    binder: null,
    carrierFromDocs: null,
    docExtraction: null,
    priorCert: null,
    billing: null,
    dealLines: [],
    requestedLines: [],
    policies: [],
    ...over,
  };
}

// deal_stage 'quote' — a quote is not a bind.
const quotedWcDeal: NonNullable<CoiContext["deal"]> = {
  coverageType: ["WC"],
  policyNumber: "SYN-99-WC-0001",
  carrier: "Synthetic Quoting Mutual",
  wholesaler: null,
  effectiveDate: "2026-06-01T00:00:00Z",
  expirationDate: "2027-06-01T00:00:00Z",
  bound: false,
};

const glBinderExtraction: NonNullable<CoiContext["docExtraction"]> = {
  artifactId: "harper:artifact:syn99931128",
  docName: "Synthetic GL Binder.pdf",
  classificationType: "binder",
  namedInsured: null,
  insuredDba: null,
  insuredAddress: null,
  carrier: "Synthetic Documented Mutual",
  policyNumber: "SYN-99-GL-0002",
  effectiveDate: "2026-07-01T00:00:00Z",
  expirationDate: "2027-07-01T00:00:00Z",
  coverageLines: ["General Liability"],
  limits: [],
  deductible: null,
};

describe("the quoted deal's policy number and term never ride another line's row", () => {
  const context = ctx({ deal: quotedWcDeal, docExtraction: glBinderExtraction });

  it("resolves the number and dates from the bound evidence, not the quote", () => {
    const c = buildCompletion(context);
    expect(c.policyNumber.value).toBe("SYN-99-GL-0002");
    expect(c.policyNumber.source).toBe("document");
    expect(c.effectiveDate.value).toBe("07/01/2026");
    expect(c.effectiveDate.source).toBe("document");
    expect(c.expirationDate.value).toBe("07/01/2027");
    expect(c.expirationDate.source).toBe("document");
  });

  it("names the carrier that wrote the certificated line, not the one that quoted", () => {
    const c = buildCompletion(context);
    expect(c.carrier.value).toBe("Synthetic Documented Mutual");
    expect(c.carrier.source).toBe("document");
  });

  it("stamps the ACORD 25 GL row with the binder's number and term", () => {
    const values = completionToFieldValues(buildCompletion(context));
    expect(values.cglPolicyNumber).toBe("SYN-99-GL-0002");
    expect(values.cglPolicyEffectiveDate).toBe("07/01/2026");
    expect(values.cglPolicyExpirationDate).toBe("07/01/2027");
    expect(values.insurerAName).toBe("Synthetic Documented Mutual");
    // Nothing anywhere on the form carries the quote.
    expect(Object.values(values)).not.toContain("SYN-99-WC-0001");
    expect(Object.values(values)).not.toContain("06/01/2026");
  });
});

describe("an unbound deal alone fills nothing", () => {
  const context = ctx({ deal: quotedWcDeal });

  it("leaves the number, term and carrier honestly missing", () => {
    const c = buildCompletion(context);
    expect(c.policyNumber).toEqual({ value: "", source: "missing" });
    expect(c.effectiveDate).toEqual({ value: "", source: "missing" });
    expect(c.expirationDate).toEqual({ value: "", source: "missing" });
    expect(c.carrier).toEqual({ value: "", source: "missing" });
  });

  it("flags each gap instead of printing the quote's values", () => {
    const check = runChecker(buildCompletion(context), context);
    for (const field of ["Policy number", "Effective date", "Expiration date", "Carrier"]) {
      expect(check.reconciled.find((r) => r.field === field)?.ok, field).toBe(false);
    }
    expect(check.reconciled.every((r) => !r.detail.includes("SYN-99-WC-0001"))).toBe(true);
  });

  it("keeps review warnings out of Description of Operations", () => {
    const values = completionToFieldValues(buildCompletion(context));
    expect(values.insurerAName).toBeUndefined();
    expect(values.descriptionOfOperations).toBe("");
  });
});

describe("the bound row and the seam's fail-closed guard are untouched", () => {
  it("a BOUND deal still serves its number, term and carrier", () => {
    const c = buildCompletion(ctx({ deal: { ...quotedWcDeal, bound: true } }));
    expect(c.policyNumber).toEqual({ value: "SYN-99-WC-0001", source: "deal" });
    expect(c.effectiveDate).toEqual({ value: "06/01/2026", source: "deal" });
    expect(c.carrier).toEqual({ value: "Synthetic Quoting Mutual", source: "deal" });
    expect(completionToFieldValues(c).workersCompPolicyNumber).toBe("SYN-99-WC-0001");
  });

  it("a policy-forms seam row for a DIFFERENT policy still fails closed against the deal's number", () => {
    // The seam row is nulled when any tier already resolved another number —
    // the deal's number counts for that guard even when the row is unbound, so
    // dropping the unbound deal from the ladder must not open this door.
    const coverageExtraction: CoverageExtractionFacts = {
      policyNumber: "SYN-99-XX-0009",
      carrier: "Synthetic Seam Mutual",
      paperVerifiedCarrier: null,
      effectiveDate: "2026-08-01T00:00:00Z",
      expirationDate: "2027-08-01T00:00:00Z",
    };
    const c = buildCompletion(ctx({ deal: quotedWcDeal }), { coverageExtraction });
    expect(c.policyNumber).toEqual({ value: "", source: "missing" });
    expect(c.carrier).toEqual({ value: "", source: "missing" });
  });
});
