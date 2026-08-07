/**
 * TicketPipeline render self-check — run with: npx tsx scripts/pipeline-render-check.tsx
 * Renders the stage strip for a fast-path ticket and a normal in-flight
 * ticket, asserting skip honesty and stamp placement. No db, no server.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { TicketPipeline } from "../src/components/TicketPipeline";
import type { Ticket } from "../src/lib/types";

const base: Ticket = {
  id: "tkt-check",
  accountId: "acct-greenleaf",
  requestType: "additional_insured",
  title: "Additional Insured — Willow Creek HOA",
  subject: "HOA asking for additional insured cert",
  source: "producer",
  requestedBy: "Maria Vega (Producer)",
  requestedByEmail: null,
  holderName: "Willow Creek HOA",
  holderAddress: null,
  wording: "Ongoing landscaping contract",
  namedOnPolicyRequired: false,
  fastPathBasis: null,
  escalatedToId: null,
  escalationNote: null,
  escalatedAt: null,
  escalationDueBy: null,
  escalationResolvedAt: null,
  status: "waiting_market",
  srNumber: "SR-10007",
  operatorId: null,
  docs: [],
  createdAt: "2026-08-06T16:00:00.000Z",
  updatedAt: "2026-08-06T18:00:00.000Z",
  closedAt: null,
};

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    console.log(`      ${detail}`);
  }
}

// Fast-path ticket: Intake → (skipped ×3) → Ready To Issue.
{
  const html = renderToStaticMarkup(
    <TicketPipeline
      ticket={{
        ...base,
        status: "ready_to_issue",
        fastPathBasis:
          "Blanket Applies — BP 04 48 07 13 On COT-BOP-331450 — Wording Only, No Quote Needed",
      }}
    />,
  );
  const skips = html.split("Skipped — Blanket Fast Path").length - 1;
  check(
    "Fast-path ticket skips exactly Drafting/Waiting/Needs You",
    skips === 3,
    `saw ${skips} skip labels`,
  );
  check(
    "Fast-path basis chip renders verbatim",
    html.includes("BP 04 48 07 13 On COT-BOP-331450"),
    html.slice(0, 300),
  );
}

// Normal in-flight ticket: no skips, no invented stamps.
{
  const html = renderToStaticMarkup(<TicketPipeline ticket={base} />);
  check(
    "Normal ticket shows no skipped stages",
    !html.includes("Skipped — Blanket Fast Path"),
    html.slice(0, 300),
  );
  const stamps = html.match(/Aug \d+, 2026/g) ?? [];
  check(
    "Only recorded stamps render (createdAt + updatedAt)",
    stamps.length === 2,
    `saw ${stamps.length} stamps: ${stamps.join(", ")}`,
  );
}

// Closed ticket: Delivered done, closed stamp shown.
{
  const html = renderToStaticMarkup(
    <TicketPipeline
      ticket={{
        ...base,
        status: "closed",
        closedAt: "2026-08-07T01:00:00.000Z",
      }}
    />,
  );
  check("Closed ticket marks the strip closed", html.includes("Closed"), html.slice(0, 300));
}

console.log(
  failures === 0 ? "\nAll pipeline checks passed." : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
