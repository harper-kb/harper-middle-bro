import { describe, it, expect } from "vitest";
import { checkerChipView } from "@/lib/coi-engine/coi-checker-receipt";
import { runChecker, buildCompletion } from "@/lib/coi-engine/coi-generate";
import type { CoiContext } from "@/lib/coi-engine/coi-context";

// ── THE CHECKER RECEIPTS (Lane 2, 2026-07-08 — Tanya's lying-chip receipt) ────
// Her ranked #1: "the checker renders 'reconciles' on a card whose own body
// says there is no document on file to reconcile against (Golden Hour), and
// over blank holder-address fields on the READY card (Prairie Sky)." The law:
// a verdict never renders without a source; the chip states what it checked
// against what, field by field; and it renders NOTHING when it verified
// nothing.

const R = (field: string, ok = true) => ({ field, ok, detail: `${field}: checked.` });

describe("the chip derivation laws", () => {
  it("no check → no chip", () => {
    expect(checkerChipView(null)).toBeNull();
    expect(checkerChipView(undefined)).toBeNull();
  });

  it("a 'match' with ZERO receipts renders NOTHING — never 'reconciles' (the verdict-needs-receipts law)", () => {
    expect(checkerChipView({ status: "match", flags: [], reconciled: [] })).toBeNull();
    expect(checkerChipView({ status: "match", flags: [], reconciled: [], basis: "the bound-policy record" })).toBeNull();
  });

  it("receipts with NO basis and a record-only document verification render the explicit can't-verify — grey, never green", () => {
    const chip = checkerChipView(
      { status: "match", flags: [], reconciled: [R("Named insured"), R("Carrier")] },
      { state: "record_only" },
    );
    expect(chip).not.toBeNull();
    expect(chip!.tone).toBe("cannot");
    expect(chip!.label).toContain("can't verify");
    expect(chip!.label).toContain("no binder or dec page");
  });

  it("receipts with no basis and a FAILED document check say the check didn't run — absence is never claimed", () => {
    const chip = checkerChipView({ status: "match", flags: [], reconciled: [R("Carrier")] }, { state: "unavailable" });
    expect(chip!.tone).toBe("cannot");
    expect(chip!.label).toContain("didn't run");
  });

  it("receipts with no basis at all never read as a verdict", () => {
    const chip = checkerChipView({ status: "match", flags: [], reconciled: [R("Carrier")] });
    expect(chip!.tone).toBe("cannot");
    expect(chip!.label).toContain("no source to verify against");
  });

  it("a real basis + clean receipts = the verified chip with the field-by-field summary (the walk's asked-for shape)", () => {
    const chip = checkerChipView(
      {
        status: "match",
        flags: [],
        reconciled: [R("Named insured"), R("Carrier"), R("Policy number")],
        basis: 'the binder document "Meridian Specialty Coverage Binder"',
      },
      { state: "verified", verifiedAgainst: { name: "Meridian Specialty Coverage Binder" } },
    );
    expect(chip!.tone).toBe("verified");
    expect(chip!.label).toBe("Checker: 3 fields verified");
    expect(chip!.summary).toContain("Checked 3 fields against");
    expect(chip!.summary).toContain("3 match; 0 to confirm");
    expect(chip!.receipts).toHaveLength(3);
  });

  it("flags always surface as the confirm chip, with the empty fields named in the receipts", () => {
    const chip = checkerChipView({
      status: "flagged",
      flags: ["Holder mailing address empty on the certificate — confirm/add before sending."],
      reconciled: [R("Named insured"), { field: "Holder mailing address", ok: false, detail: "Holder mailing address empty on the certificate — confirm/add before sending." }],
      basis: "the bound-policy record (insurance.policy)",
    });
    expect(chip!.tone).toBe("confirm");
    expect(chip!.label).toBe("Checker: 1 to confirm");
    expect(chip!.summary).toContain("1 to confirm");
  });
});

describe("runChecker carries its basis (what it checked against)", () => {
  const baseCtx = {
    companyId: "99930001",
    issued: null,
    company: { name: "Carden Vale Coffee LLC", industry: "cafe", subIndustry: null, city: "Fargo", state: "ND", email: null },
    policy: null,
    deal: null,
    binder: null,
    holder: { name: "Sample Holder LP", address: null },
    docs: [],
    carrierFromDocs: null,
  } as unknown as CoiContext;

  it("nothing to check against → basis null (and the chip refuses a verdict)", () => {
    const completion = buildCompletion(baseCtx);
    const check = runChecker(completion, baseCtx);
    expect(check.basis).toBeNull();
    const chip = checkerChipView(check);
    expect(chip?.tone).not.toBe("verified");
  });

  it("a binder on file → the basis names the document", () => {
    const ctx = { ...baseCtx, binder: { name: "Sample Mutual Coverage Binder", artifactId: "a-1", createdAt: "2026-06-01" } } as unknown as CoiContext;
    const completion = buildCompletion(ctx);
    const check = runChecker(completion, ctx);
    expect(check.basis).toContain('the binder document "Sample Mutual Coverage Binder"');
  });

  it("a certificate with NO holder flags the missing holder once — the address flag never double-charges the same gap (the Bugbot catch)", () => {
    const ctx = { ...baseCtx, holder: { name: null, address: null } } as unknown as CoiContext;
    const check = runChecker(buildCompletion(ctx), ctx);
    expect(check.flags.some((f) => /certificate holder not identified/i.test(f))).toBe(true);
    expect(check.reconciled.some((r) => r.field === "Holder mailing address")).toBe(false);
  });

  it("an empty holder mailing address is a NAMED confirm — never silence under a clean verdict (Prairie Sky's class)", () => {
    const ctx = {
      ...baseCtx,
      policy: {
        namedInsured: "Carden Vale Coffee LLC",
        policyNumber: "SM-GL-000111",
        status: "bound",
        effectiveDate: "2026-03-01",
        expirationDate: "2027-03-01",
        coverageLines: ["General Liability"],
        limits: [{ line: "General Liability", label: "Each Occurrence", amount: "$1,000,000" }],
        deductible: null,
      },
      deal: { coverageType: ["General Liability"], policyNumber: "SM-GL-000111", carrier: "Sample Mutual", wholesaler: null, bound: true, effectiveDate: "2026-03-01", expirationDate: "2027-03-01" },
    } as unknown as CoiContext;
    const check = runChecker(buildCompletion(ctx), ctx);
    expect(check.flags.some((f) => /holder mailing address/i.test(f))).toBe(true);
    expect(check.reconciled.some((r) => r.field === "Holder mailing address" && !r.ok)).toBe(true);
  });
});

// (HTA's third describe block exercised its demo-bench fixtures — not ported;
// the chip and checker laws above are the pinned behavior.)
