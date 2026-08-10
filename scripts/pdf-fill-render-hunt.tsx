/**
 * PDF-fill render hunt — server-renders the real Certificate Studio for the
 * hunt's example accounts and scans the actual sheet markup for fill
 * failures (junk values, fabricated statements, dangling wording, missing
 * watermark). Companion to scripts/pdf-fill-hunt.ts.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/pdf-fill-render-hunt.tsx
 * (server-only is stubbed by the tsconfig — see scripts/run-checks.sh)
 */
import { renderToStaticMarkup } from "react-dom/server";
import { CertificateStudio } from "../src/components/CertificateStudio";
import { getAccountDetail } from "../src/lib/db";
import { getPolicyFormSet, type PolicyFormSet } from "../src/lib/forms";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function renderStudio(accountId: string): string {
  const account = getAccountDetail(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);
  const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
    account.policies.map((p) => [p.id, getPolicyFormSet(p)]),
  );
  return renderToStaticMarkup(
    <CertificateStudio
      account={account}
      policies={account.policies}
      formSets={formSets}
      guidance={{}}
    />,
  );
}

const JUNK = /undefined|NaN|\[object Object\]|Invalid Date/;

for (const id of [
  "acct-real-925460",
  "acct-real-925420",
  "acct-real-916015",
  "acct-meridian",
  "acct-northstar",
  "acct-greenleaf",
  "acct-metro",
]) {
  const html = renderStudio(id);
  check(`${id}: renders without junk markers`, !JUNK.test(html), JUNK.exec(html)?.[0]);
  check(
    `${id}: specimen watermark baked into the sheet`,
    html.includes("Specimen — Not Issued"),
  );
  check(
    `${id}: no dangling "per ." from a form-less endorsement`,
    !/per\s+\./.test(html.replace(/&#x27;|&quot;/g, "")),
  );
}

// Real ISC schedule fills the printed boxes off the dec.
{
  const html = renderStudio("acct-real-925460");
  check(
    "925460: GL Each Occurrence prints 1,000,000",
    html.includes("1,000,000"),
  );
  check(
    "925460: INSURER A prints the Hadron writer + NAIC 17534",
    html.includes("Hadron Specialty Insurance Company") && html.includes("17534"),
  );
}

// Schedule-less paper: no Excluded / no dollar is invented into a limit box.
{
  const html = renderStudio("acct-real-916015");
  check(
    "916015: no limit box prints a value on unscheduled paper",
    !html.includes('value="Excluded"') && !html.includes('value="Included"'),
  );
  check(
    "916015: policy number still prints in the GL row",
    html.includes("HSIC-ISC01-0000381"),
  );
}

// Overflow lines print inside the Description Of Operations box.
{
  const html = renderStudio("acct-meridian");
  check(
    "meridian: description carries the overflow schedule lines",
    html.includes("HSX-ME-902314") && html.includes("KIN-EV-902319"),
  );
}

// ACORD 30 garage grid renders for the garage account (form switch target).
{
  const html = renderStudio("acct-northstar");
  check(
    "northstar: studio offers the garage certificate form",
    html.includes("ACORD 30"),
  );
}

console.log(failures === 0 ? "\nAll render probes passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
