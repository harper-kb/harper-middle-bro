/**
 * Insured-address verifier self-check — run with:
 *   npx tsx --conditions react-server scripts/insured-address-verify-check.ts
 *
 * Exercises the cached INSURED-box verification route end to end against
 * the live geocoder:
 *   1. provider selection is honest — Google only when GOOGLE_MAPS_API_KEY
 *      is set, US Census Bureau geocoder otherwise;
 *   2. a Census-verified seed address comes back "verified";
 *   3. the verdict lands in the SQLite cache and the second call is served
 *      from it (proven with a sentinel, not timing).
 */

import Database from "better-sqlite3";
import path from "path";
import { POST } from "../src/app/api/validate/insured-address/route";
import { insuredAddressAdapterName } from "../src/lib/validate-contact.server";

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    console.log(`      ${detail}`);
  }
}

function post(address: string) {
  return POST(
    new Request("http://localhost/api/validate/insured-address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }),
  );
}

async function run() {
  const keyPresent = Boolean(process.env.GOOGLE_MAPS_API_KEY);
  check(
    "provider selection matches the configured key",
    insuredAddressAdapterName() === (keyPresent ? "google" : "census"),
    `key present=${keyPresent}, adapter=${insuredAddressAdapterName()}`,
  );

  const address = "2201 E 6th St, Austin, TX 78702";
  const first = (await (await post(address)).json()) as {
    status: string;
    provider: string;
    reason: string;
  };
  check(
    "seed address verifies",
    first.status === "verified" || first.status === "corrected",
    JSON.stringify(first),
  );
  check(
    "verdict names the verifier that actually ran",
    first.provider === insuredAddressAdapterName(),
    JSON.stringify(first),
  );

  const db = new Database(path.join(process.cwd(), "data", "underwriter-desk.db"));
  const row = db
    .prepare(
      `SELECT address_key, reason FROM address_verifications
       WHERE address_key LIKE '%2201 E 6TH ST%'`,
    )
    .get() as { address_key: string; reason: string } | undefined;
  check("verdict cached in SQLite", Boolean(row), "no address_verifications row");

  if (row) {
    // Sentinel proves the repeat call reads the cache, not the network.
    db.prepare(
      `UPDATE address_verifications SET reason = 'SENTINEL — Cache Hit' WHERE address_key = ?`,
    ).run(row.address_key);
    const second = (await (await post(address)).json()) as { reason: string };
    check(
      "repeat call is served from the cache",
      second.reason === "SENTINEL — Cache Hit",
      JSON.stringify(second),
    );
    db.prepare(
      `UPDATE address_verifications SET reason = ? WHERE address_key = ?`,
    ).run(row.reason, row.address_key);
  }

  console.log(failures === 0 ? "\nAll verifier checks passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
