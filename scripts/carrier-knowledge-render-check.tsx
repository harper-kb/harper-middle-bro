/**
 * Carrier Intelligence render self-check — run with:
 *   npx tsx scripts/carrier-knowledge-render-check.tsx
 *
 * Renders the carrier-page region to static markup and asserts the two
 * enforced seed rules print prominently on the ISC set, empty categories
 * show the honest empty state, and the operator form carries the
 * enforcement-requires-code-review microcopy. No db, no server.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { CarrierIntelligence } from "../src/components/CarrierIntelligence";
import { knowledgeForCarrier } from "../src/lib/carrier-knowledge";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

const iscHtml = renderToStaticMarkup(
  <CarrierIntelligence
    carrierName="ISC"
    entries={knowledgeForCarrier("ISC")}
    accent="#b45f3c"
  />,
);

check(
  "ISC region renders the Carrier Intelligence heading",
  iscHtml.includes("Carrier Intelligence") &&
    iscHtml.includes("What The Desk Knows About ISC"),
);
check(
  "Seed rule 1 card renders (excess takes no Additional Insured)",
  iscHtml.includes("Excess Lines Cannot Take Additional Insured Status") &&
    iscHtml.includes("isc-excess-no-additional-insured"),
);
check(
  "Seed rule 2 card renders (Colorado contractors/lease 10-day NOC)",
  iscHtml.includes(
    "No 10-Day Notice Of Cancellation For Non-Payment — Lease Vertical, Colorado",
  ) && iscHtml.includes("isc-co-contractors-lease-no-10-day-noc"),
);
check(
  "Enforced entries carry the Enforced In Code chip",
  iscHtml.includes("Enforced In Code"),
);
check(
  "Writing companies group lists all four ISC writers with NAIC codes",
  ["17534", "25798", "38776", "10713"].every((naic) =>
    iscHtml.includes(`NAIC ${naic}`),
  ),
);
check(
  "Cards carry source and recorded date",
  iscHtml.includes("Desk Experience · Recorded 2026-08-08") &&
    iscHtml.includes("Carrier Documentation · Recorded 2026-08-08"),
);
check(
  "Operator form states that enforcement requires code review",
  iscHtml.includes("code review"),
);

// A carrier with sparse knowledge shows honest empty states, not filler.
const thimbleHtml = renderToStaticMarkup(
  <CarrierIntelligence
    carrierName="Thimble"
    entries={knowledgeForCarrier("Thimble")}
    accent="#1a2c36"
  />,
);
check(
  "Empty categories render the honest empty state",
  thimbleHtml.includes("No Verified Notes Yet — Add What The Desk Learns"),
);
check(
  "No invented entries appear for a sparse carrier",
  !thimbleHtml.includes("Enforced In Code"),
);

console.log(
  failures === 0
    ? "\nAll render checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
