/**
 * Build the real-book overlay from a Harper tools export.
 *
 * Run: npx tsx --conditions react-server scripts/import-harper-book.ts
 *
 * Input  data/harper-policy-state.local.json   (gitignored, you create it)
 * Output data/supabase-book.local.json         (gitignored, the app boots from it)
 *
 * The input is what the Harper MCP returns, saved verbatim:
 *
 *   {
 *     "policies": [ ...rows from `data policy-state read` ],
 *     "prefills": { "<company_id>": { ...values_125 from `forms acord prefill` } }
 *   }
 *
 * `policies` is required — it carries the coverage lines, and those are the
 * schedule of record. `prefills` is optional and supplies the insured's
 * mailing address for the certificate's INSURED box; a company without one
 * imports with a blank address, which the sheet prints as blank rather than
 * guessing.
 *
 * Nothing here reaches the network. The MCP read is the operator's step, so
 * the import is reproducible from a file someone can inspect first.
 */

import fs from "node:fs";
import path from "node:path";
import { buildBookFromRows } from "../src/lib/adapters/harper/book";
import type {
  HarperExtraction,
  HarperPolicyRow,
  HarperPrefill,
} from "../src/lib/adapters/harper/policy-state";

const IN = path.join(process.cwd(), "data", "harper-policy-state.local.json");
const OUT = path.join(process.cwd(), "data", "supabase-book.local.json");

function main() {
  if (!fs.existsSync(IN)) {
    console.error(`No export at ${IN}.

Produce one with the Harper MCP and save it verbatim:
  data policy-state read --limit 200            -> .policies
  forms acord prefill --company-id <id>         -> .prefills["<id>"] (values_125)
  documents company list --company-id <id>      -> find the POLICY_DOCUMENT artifact
  documents extraction get --artifact-id <id>   -> .extractions["<policy_id>"]
`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(IN, "utf-8")) as {
    policies?: HarperPolicyRow[];
    rows?: HarperPolicyRow[];
    prefills?: Record<string, HarperPrefill>;
    extractions?: Record<string, HarperExtraction>;
  };
  // `rows` is what the read returns inside its envelope; accept either.
  const rows = raw.policies ?? raw.rows ?? [];
  const prefills = raw.prefills ?? {};
  const extractions = raw.extractions ?? {};
  if (rows.length === 0) {
    console.error("Export carried no policy rows.");
    process.exit(1);
  }

  const built = buildBookFromRows(rows, { prefills, extractions });
  const accounts = new Map(built.accounts.map((a) => [a.id, a]));
  const policies = built.policies;
  const schedules = built.schedules;
  const dropped = built.stats.droppedLimits;
  const noIdentity = built.stats.endorsementsWithoutIdentity;
  const skipped = built.stats.skipped;
  const unscheduled = built.stats.unscheduled;
  const endorsementCount = built.stats.endorsements;
  const backed = built.stats.backing;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        accounts: [...accounts.values()],
        policies,
        schedules,
      },
      null,
      2,
    ),
  );

  const withLimits = Object.values(schedules).filter((s) => s.limits.length > 0).length;
  console.log(`accounts        ${accounts.size}`);
  console.log(`policies        ${policies.length}   (skipped ${skipped} unusable rows)`);
  console.log(`schedules       ${withLimits} with limits · ${unscheduled} with no coverage lines`);
  console.log(`endorsements    ${endorsementCount} filed · ${backed} that can back an AI / waiver claim`);
  console.log(
    `markets         ${built.stats.placed} policies on a known market desk · ${policies.length - built.stats.placed} left with the placeholder`,
  );
  if (built.stats.unplaced.length > 0) {
    console.log(
      `\nnumbers that look like a brand's but sit on other paper (${built.stats.unplaced.length}):`,
    );
    for (const u of built.stats.unplaced.slice(0, 10)) console.log(`  ${u}`);
  }
  if (noIdentity.length > 0) {
    // An endorsement without an edition is not filed as backing: the
    // verifier treats form identity as form + edition, because two editions
    // of the same form are different paper.
    console.log(`\nendorsements with no edition, so not usable as backing (${noIdentity.length}):`);
    for (const n of noIdentity.slice(0, 10)) console.log(`  ${n}`);
  }
  if (dropped.length > 0) {
    // Never silent: a limit the desk has no box for is a gap on the
    // certificate, and the operator is the one who can judge whether it
    // matters for the coverage being certified.
    console.log(`\nlimits with no ACORD box on this desk (${dropped.length}):`);
    for (const d of dropped.slice(0, 20)) console.log(`  ${d}`);
    if (dropped.length > 20) console.log(`  …and ${dropped.length - 20} more`);
  }
  console.log(`\nwrote ${OUT}`);
  console.log("Locally: delete data/underwriter-desk.db* and restart to boot from it.");
  console.log(
    "Deployed: node scripts/pack-harper-book.mjs, then paste the variables into the service.",
  );
}

main();
