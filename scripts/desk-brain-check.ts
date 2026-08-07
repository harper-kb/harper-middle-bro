/**
 * Desk Brain deterministic self-check — run with: npx tsx scripts/desk-brain-check.ts
 *
 * Exercises the intent engine against acct-greenleaf's real schedule of
 * record (FORM_SETS from src/lib/forms.ts — no db needed). Every check is a
 * plain assertion: same input, same answer, every run.
 */

import {
  askDeskBrain,
  DESK_BRAIN_REFUSAL,
  type DeskBrainBundle,
} from "../src/lib/desk-brain";
import { FORM_SETS } from "../src/lib/forms";
import type { QuoteSample } from "../src/lib/price-guidance";

// ——— Fixture: acct-greenleaf as seeded (seed.ts + FORM_SETS) ———

const FAST_PATH_BASIS =
  "Blanket Applies — BP 04 48 07 13 On COT-BOP-331450 — Wording Only, No Quote Needed";

function greenleafBundle(overrides?: Partial<DeskBrainBundle>): DeskBrainBundle {
  return {
    account: {
      id: "acct-greenleaf",
      name: "Greenleaf Landscaping LLC",
      dba: null,
      industry: "Landscaping",
      state: "FL",
      status: "active",
      paymentReceivedAt: "2025-11-14T18:02:00.000Z",
      primaryUwName: "Coterie Service Desk",
      primaryUwCarrier: "Coterie",
      backupUwName: null,
    },
    policies: [
      {
        id: "pol-greenleaf-bop",
        policyNumber: "COT-BOP-331450",
        carrier: "Coterie",
        coverages: ["BOP", "GL"],
        effectiveDate: "2025-11-15",
        expirationDate: "2026-11-15",
        premiumCents: 1_680_00,
      },
    ],
    formSets: { "pol-greenleaf-bop": FORM_SETS["pol-greenleaf-bop"] },
    ticket: {
      id: "tkt-greenleaf-hoa",
      srNumber: "SR-10007",
      status: "ready_to_issue",
      requestType: "additional_insured",
      requestTypeLabel: "Additional Insured",
      subject: "HOA asking for additional insured cert",
      holderName: "Willow Creek HOA",
      holderAddress: "1550 Newell Ave, Walnut Creek, CA 94596",
      fastPathBasis: FAST_PATH_BASIS,
      createdAt: "2026-08-06T16:00:00.000Z",
      updatedAt: "2026-08-06T16:05:00.000Z",
      closedAt: null,
    },
    threads: [],
    decisions: [],
    quoteSamples: [],
    ...overrides,
  };
}

const waiverSample = (n: number, cents: number): QuoteSample => ({
  threadId: `th-check-${n}`,
  carrier: "Coterie",
  requestType: "waiver_of_subrogation",
  offeredPremiumCents: cents,
  accountName: "Greenleaf Landscaping LLC",
  subject: "WOS request",
  createdAt: `2026-0${n}-01T12:00:00.000Z`,
});

// ——— Harness ———

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    console.log(`      ${detail}`);
  }
}

const bundle = greenleafBundle();

// 1. Blanket AI must cite the exact form on the exact policy.
{
  const r = askDeskBrain("Do they have blanket AI?", bundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("BP 04 48 07 13") &&
    r.answer.includes("COT-BOP-331450") &&
    r.citations.some((c) => c.label === "BP 04 48 07 13");
  check("Blanket AI cites BP 04 48 07 13 on COT-BOP-331450", ok, JSON.stringify(r));
}

// 2. Blanket waiver cites BP 04 97.
{
  const r = askDeskBrain("Blanket Waiver?", bundle);
  const ok =
    r.kind === "answer" && r.citations.some((c) => c.label === "BP 04 97 07 13");
  check("Blanket Waiver cites BP 04 97 07 13", ok, JSON.stringify(r));
}

// 3. GL each occurrence limit straight from the form set.
{
  const r = askDeskBrain("What's the GL each occurrence limit?", bundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("Each Occurrence $1,000,000") &&
    r.answer.includes("COT-BOP-331450");
  check("GL Each Occurrence answers $1,000,000", ok, JSON.stringify(r));
}

// 4. Included/Excluded lines state, never invent dollars.
{
  const r = askDeskBrain("GL Limits", bundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("Medical Expense Excluded") &&
    r.answer.includes("Personal & Advertising Injury Included");
  check("GL Limits states Included/Excluded honestly", ok, JSON.stringify(r));
}

// 5. Account status from status + paymentReceivedAt.
{
  const r = askDeskBrain("Is this account active?", bundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("Active") &&
    r.answer.includes("payment received");
  check("Account status answers Active with payment date", ok, JSON.stringify(r));
}

// 6. Price history under the 3-sample minimum refuses to name a number.
{
  const r = askDeskBrain("What do we usually pay for a waiver?", {
    ...bundle,
    quoteSamples: [waiverSample(1, 5000), waiverSample(2, 7500)],
  });
  const ok =
    r.kind === "answer" &&
    /lacks enough history|under the 3-quote minimum/.test(r.answer) &&
    !r.answer.includes("$");
  check("Price history with 2 samples suggests no number", ok, JSON.stringify(r));
}

// 7. Price history with 3+ samples answers with the real range.
{
  const r = askDeskBrain("What do we usually pay for a waiver?", {
    ...bundle,
    quoteSamples: [
      waiverSample(1, 5000),
      waiverSample(2, 7500),
      waiverSample(3, 10000),
    ],
  });
  const ok =
    r.kind === "answer" &&
    r.answer.includes("$50.00") &&
    r.answer.includes("$100.00") &&
    r.answer.includes("Indication only");
  check("Price history with 3 samples answers the range", ok, JSON.stringify(r));
}

// 8. Fast-path question surfaces the recorded basis verbatim.
{
  const r = askDeskBrain("Fast Path?", bundle);
  const ok = r.kind === "answer" && r.answer.includes(FAST_PATH_BASIS);
  check("Fast path answers the recorded basis", ok, JSON.stringify(r));
}

// 9. Ticket status + SR number.
{
  const r = askDeskBrain("Ticket Status", bundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("SR-10007") &&
    r.answer.includes("Ready To Issue");
  check("Ticket status answers SR + stage", ok, JSON.stringify(r));
}

// 10. Holder info from the ticket record.
{
  const r = askDeskBrain("Holder Info", bundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("Willow Creek HOA") &&
    r.answer.includes("1550 Newell Ave");
  check("Holder info answers name + address", ok, JSON.stringify(r));
}

// 11. Thread question with no threads answers honestly, no invention.
{
  const r = askDeskBrain("What did the underwriter say?", bundle);
  const ok = r.kind === "answer" && r.answer.includes("not gone to market");
  check("Thread question with no threads says so", ok, JSON.stringify(r));
}

// 12. Thread question quotes the actual underwriter reply.
{
  const r = askDeskBrain("What did the underwriter say?", {
    ...bundle,
    threads: [
      {
        id: "th-1",
        subject: "AI request — Willow Creek HOA",
        status: "closed",
        underwriterName: "Jordan Pike",
        carrier: "Coterie",
        policyNumber: "COT-BOP-331450",
        offeredPremiumCents: 0,
        createdAt: "2026-08-06T16:10:00.000Z",
        messages: [
          {
            role: "underwriter",
            direction: "inbound",
            subject: "RE: AI request",
            body: "Blanket AI applies per BP 04 48 — no endorsement needed, no charge.",
            premiumImpactCents: 0,
            createdAt: "2026-08-06T17:00:00.000Z",
          },
        ],
      },
    ],
  });
  const ok =
    r.kind === "answer" &&
    r.answer.includes("Jordan Pike") &&
    r.answer.includes("no endorsement needed");
  check("Thread question quotes the underwriter reply", ok, JSON.stringify(r));
}

// 13. Premium of each policy.
{
  const r = askDeskBrain("What's the premium of each policy?", bundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("$1,680.00") &&
    r.answer.includes("COT-BOP-331450");
  check("Premium answers $1,680.00 on COT-BOP-331450", ok, JSON.stringify(r));
}

// 14. Out-of-scope general knowledge refuses verbatim.
{
  const r = askDeskBrain("Who won the World Cup in 2022?", bundle);
  const ok = r.kind === "refusal" && r.answer === DESK_BRAIN_REFUSAL;
  check("General knowledge refuses verbatim", ok, JSON.stringify(r));
}

// 15. Question about ANOTHER account refuses verbatim.
{
  const r = askDeskBrain("What are the GL limits for Apex Construction?", bundle);
  const ok = r.kind === "refusal" && r.answer === DESK_BRAIN_REFUSAL;
  check("Other-account question refuses verbatim", ok, JSON.stringify(r));
}

// 16. Unmatchable in-domain rambling refuses verbatim.
{
  const r = askDeskBrain("Should we rewrite the whole book of business?", bundle);
  const ok = r.kind === "refusal" && r.answer === DESK_BRAIN_REFUSAL;
  check("Unmatched intent refuses verbatim", ok, JSON.stringify(r));
}

console.log(
  failures === 0
    ? "\nAll Desk Brain checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
