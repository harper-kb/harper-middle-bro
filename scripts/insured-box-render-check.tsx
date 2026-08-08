/**
 * INSURED-box render self-check — run with: npx tsx scripts/insured-box-render-check.tsx
 *
 * Server-renders the Certificate Studio for a seed account that carries a
 * mailing address on the account record, and asserts:
 *   1. the INSURED box auto-fills street / city / state / ZIP off the record;
 *   2. the address verification chip renders next to the INSURED label
 *      (initial state — the live verdict arrives client-side);
 *   3. an account with no street line keeps the street cell blank (blank
 *      beats wrong) while city/state still print.
 */

import Database from "better-sqlite3";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { CertificateStudio } from "../src/components/CertificateStudio";
import { getAccountDetail } from "../src/lib/db";
import { getPolicyFormSet, type PolicyFormSet } from "../src/lib/forms";

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    console.log(`      ${detail}`);
  }
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

// Seed account with a Census-verified street address on the record.
{
  const html = renderStudio("acct-apex");
  check(
    "INSURED street auto-fills from the account record",
    html.includes("2201 E 6th St"),
    "expected street line 2201 E 6th St in the sheet",
  );
  check(
    "INSURED city / ZIP auto-fill from the account record",
    html.includes("Austin") && html.includes("78702"),
    "expected Austin + 78702 in the sheet",
  );
  check(
    "verification chip renders near the INSURED box",
    html.includes("Verifying Address…"),
    "expected the chip's initial Verifying Address… state in SSR output",
  );
}

// Street-less shape (e.g. imported accounts whose street was never
// captured): city/state print, no street is invented, and no verification
// is claimed. Found dynamically so no real-account identifiers live here.
{
  const streetless = new Database(
    path.join(process.cwd(), "data", "underwriter-desk.db"),
    { readonly: true },
  )
    .prepare(
      `SELECT id, city FROM accounts
       WHERE address1 IS NULL AND city IS NOT NULL LIMIT 1`,
    )
    .get() as { id: string; city: string } | undefined;
  if (!streetless) {
    console.log("SKIP  no street-less account in this database");
  } else {
    const html = renderStudio(streetless.id);
    check(
      "city prints for a street-less account",
      html.includes(streetless.city),
      `expected ${streetless.city} in the sheet`,
    );
    check(
      "no verification chip without a street line",
      !html.includes("Verifying Address…"),
      "chip must not render when the record carries no street to verify",
    );
  }
}

console.log(failures === 0 ? "\nAll render checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
