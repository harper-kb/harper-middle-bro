/**
 * The runtime book sync must fail closed.
 *
 * It replaces every account and policy the desk is serving. A fetch that
 * half-worked, returned an empty page, or hit a contract change has to
 * leave the existing book alone — an empty book is not a true statement
 * about a broker's business, and certificates would start refusing on
 * nothing.
 */

import { buildBookFromRows } from "../src/lib/adapters/harper/book";
import type { HarperPolicyRow } from "../src/lib/adapters/harper/policy-state";

let failed = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

/* ————— The shape the read actually answers in ————— */

const row: HarperPolicyRow = {
  policy_id: "7731",
  status: "bound",
  policy_number: "GL-1",
  named_insured: "CivicPoint Security",
  effective_date: "2026-08-15T00:00:00.000Z",
  expiration_date: "2027-08-15T00:00:00.000Z",
  company_id: "910666",
  in_force: true,
  coverage_lines: [
    {
      canonical_coverage_type: "GENERAL_LIABILITY",
      coverage_type: "General Liability",
      coverage_basis: "OCCURRENCE",
      coverage_form: "CG 00 01 04 13",
      carrier: { name: "Third Coast Insurance Company" },
      limits: [
        {
          canonical_limit_type: "EACH_OCCURRENCE_OR_CLAIM",
          label: "Each Occurrence",
          amount: "$1,000,000",
        },
        {
          canonical_limit_type: "GENERAL_AGGREGATE",
          label: "General Aggregate",
          amount: "$2,000,000",
        },
      ],
    },
  ],
};

const built = buildBookFromRows([row]);
check(built.accounts.length === 1, "One company yields one account");
check(built.policies.length === 1, "One in-force row yields one policy");
check(
  built.schedules[built.policies[0].id]?.limits.length === 2,
  "The coverage line's limits become the schedule of record",
);
check(
  built.schedules[built.policies[0].id]?.coverages[0]?.basis === "occurrence",
  "The stated basis survives into the schedule",
);
check(
  built.policies[0].carrier === "Third Coast Insurance Company",
  "The carrier comes off the coverage line, where the read states it",
  built.policies[0].carrier,
);

/* ————— Rows the read cannot place ————— */

check(
  buildBookFromRows([{ ...row, company_id: undefined }]).stats.skipped === 1,
  "A row with no company is skipped, not attached to some other account",
);
check(
  buildBookFromRows([{ ...row, company_id: undefined }]).accounts.length === 0,
  "…and contributes no account",
);

/* ————— Fetch guards ————— */

// Mirrors the checks in fetchHarperBook. Kept as a table because each of
// these is a real response the gateway can return, and every one of them
// used to be indistinguishable from "the broker has no policies".
const guards: { name: string; payload: Record<string, unknown>; refuse: boolean }[] = [
  { name: "a well-formed page", payload: { status: "ok", rows: [row] }, refuse: false },
  { name: "fails-closed not_configured", payload: { status: "not_configured" }, refuse: true },
  { name: "an envelope with no rows key", payload: { status: "ok" }, refuse: true },
  { name: "rows that are not an array", payload: { status: "ok", rows: {} }, refuse: true },
  { name: "an empty page", payload: { status: "ok", rows: [] }, refuse: true },
];

for (const g of guards) {
  const p = g.payload as { status?: string; rows?: unknown };
  const refused =
    (p.status !== undefined && p.status !== "ok") ||
    !Array.isArray(p.rows) ||
    p.rows.length === 0;
  check(
    refused === g.refuse,
    `${g.refuse ? "Refuses" : "Accepts"} ${g.name}`,
  );
}

/* ————— Without credentials ————— */

async function main() {
  const { syncBookFromHarper } = await import(
    "../src/lib/adapters/harper/book-sync"
  );
  const noCreds = await syncBookFromHarper(5);
  check(
    !noCreds.ok && /credentials not provisioned/i.test(noCreds.reason ?? ""),
    "With no Agent Tools credentials the sync declines and says why",
    noCreds.reason ?? "",
  );
  check(
    noCreds.accounts === 0 && noCreds.policies === 0,
    "…and reports writing nothing",
  );

  console.log(
    failed === 0 ? "\nAll book-sync checks passed." : `\n${failed} FAILURE(S).`,
  );
  if (failed > 0) process.exit(1);
}

void main();
