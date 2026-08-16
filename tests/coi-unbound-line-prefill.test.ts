import { describe, it, expect } from "vitest";
import { buildCompletion, completionToFieldValues, runChecker } from "@/lib/coi-engine/coi-generate";
import type { CoiContext } from "@/lib/coi-engine/coi-context";

// ── THE UNBOUND LINE NEVER PREFILLS (feedback plane #1128) ───────────────────
// The operator ask this pins: "Coverage line removed: WC — WC. Why: No workers'
// comp." — the bench printed a Workers Compensation section for an account that
// carries no workers' comp, and the operator had to blank it (the "removed"
// COI-edit shape = over-filled by the fill).
//
// The law is already written twice in this subsystem: coi-checklist.ts's
// line-bind item ("NEVER certificate a line that is not actually bound … direct
// E&O exposure") and coi-data.ts's ledger rule ("BOUND = real policy number AND
// deal_stage 'bound'; anything else (quote/pending/null) is UNBOUND"). Both ran
// only AFTER the fill. These pin it at the fill: the completion ladder's deal
// tier contributes coverage lines only when that deal row is bound.
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

const quotedWcDeal: NonNullable<CoiContext["deal"]> = {
  coverageType: ["WC"],
  policyNumber: "SYN-99-WC-0001",
  carrier: "Synthetic Mutual",
  wholesaler: null,
  effectiveDate: "2026-06-01T00:00:00Z",
  expirationDate: "2027-06-01T00:00:00Z",
  // deal_stage 'quote' — a quote is not a bind.
  bound: false,
};

describe("an UNBOUND deal line never prefills the certificate", () => {
  it("drops the quoted WC line from the completion instead of certificating it", () => {
    const c = buildCompletion(ctx({ deal: quotedWcDeal }));
    expect(c.coverageLines).toEqual([]);
    // Never "deal" — the deal named a line it did not bind.
    expect(c.coverageSource).toBe("missing");
  });

  it("leaves every ACORD 25 Workers Compensation cell unset (nothing for the operator to blank)", () => {
    const values = completionToFieldValues(buildCompletion(ctx({ deal: quotedWcDeal })));
    expect(values.workersCompPolicyNumber).toBeUndefined();
    expect(values.workersCompPolicyEffectiveDate).toBeUndefined();
    expect(values.workersCompPolicyExpirationDate).toBeUndefined();
    expect(Object.keys(values).filter((k) => k.startsWith("workersComp"))).toEqual([]);
  });

  it("does not divert the unbound line to the OTHER row either", () => {
    const values = completionToFieldValues(buildCompletion(ctx({ deal: quotedWcDeal })));
    expect(values.otherInsuranceDescription).toBeUndefined();
  });

  it("the checker names the unbound deal record rather than claiming no coverage is on file", () => {
    const context = ctx({ deal: quotedWcDeal });
    const check = runChecker(buildCompletion(context), context);
    const line = check.reconciled.find((r) => r.field === "Coverage lines");
    expect(line?.ok).toBe(false);
    // The NO-FALSE-ABSENCE LAW: a quoted WC row exists, so "no coverage line
    // found" would be a false absence claim.
    expect(line?.detail).not.toBe("No coverage line found on the policy/deal.");
    expect(line?.detail.toLowerCase()).toContain("unbound");
    expect(line?.detail).toContain("Workers Compensation");
  });

  it("falls through to the next evidence tier — the document extraction's own lines still fill", () => {
    const c = buildCompletion(
      ctx({
        deal: quotedWcDeal,
        docExtraction: {
          artifactId: "harper:artifact:syn99931128",
          docName: "Synthetic GL Binder.pdf",
          classificationType: "binder",
          namedInsured: null,
          insuredDba: null,
          insuredAddress: null,
          carrier: "Synthetic Mutual",
          policyNumber: "SYN-99-GL-0002",
          effectiveDate: null,
          expirationDate: null,
          coverageLines: ["General Liability"],
          limits: [],
          deductible: null,
        },
      }),
    );
    expect(c.coverageLines).toEqual(["Commercial General Liability"]);
    expect(c.coverageSource).toBe("document");
    const values = completionToFieldValues(c);
    expect(values.cglPolicyNumber).toBeDefined();
    expect(values.workersCompPolicyNumber).toBeUndefined();
  });
});

describe("the bound tiers are untouched", () => {
  it("a BOUND deal row still prefills its lines and the WC section", () => {
    const c = buildCompletion(ctx({ deal: { ...quotedWcDeal, bound: true } }));
    expect(c.coverageLines).toEqual(["Workers Compensation & Employers' Liability"]);
    expect(c.coverageSource).toBe("deal");
    const values = completionToFieldValues(c);
    expect(values.workersCompPolicyNumber).toBe("SYN-99-WC-0001");
  });

  it("the bound-policy record still outranks the deal tier, unbound deal or not", () => {
    const c = buildCompletion(
      ctx({
        policy: {
          namedInsured: "Synthetic Drywall LLC",
          policyNumber: "SYN-99-GL-0007",
          status: "bound",
          effectiveDate: "2026-05-01T00:00:00Z",
          expirationDate: "2027-05-01T00:00:00Z",
          coverageLines: ["General Liability"],
          limits: [],
          deductible: null,
        },
        deal: quotedWcDeal,
      }),
    );
    expect(c.coverageLines).toEqual(["Commercial General Liability"]);
    expect(c.coverageSource).toBe("policy");
    const values = completionToFieldValues(c);
    expect(values.workersCompPolicyNumber).toBeUndefined();
  });
});
