/**
 * MANUAL FALLBACK — the primary path is now the in-app two-minute refresher
 * in `src/lib/db/book-refresh.ts` (Supabase Management API, driven by
 * SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env.local). Keep the SQL
 * and mapping there in sync if you touch this script.
 *
 * Sync a curated slice of the real Harper book (Supabase Postgres) into
 * `data/supabase-book.local.json` — the gitignored overlay that
 * `src/lib/supabase-book.server.ts` loads on boot instead of the fictional
 * seed accounts/policies.
 *
 * Usage:
 *   HARPER_DATABASE_URL=postgres://... node scripts/sync-supabase-book.mjs
 *
 * (Also accepts DATABASE_URL.) Requires the `pg` package (devDependency).
 *
 * No credentials live in this repo: the connection string comes from the
 * environment at run time. Without it, the script prints instructions —
 * an agent with the Supabase MCP can run the same two queries below via
 * `execute_sql` and write the JSON by hand.
 *
 * Eligibility — every non-test company with at least one real, non-deleted
 * `orders_temp` row that carries a non-deleted deal in a recognized stage
 * (bound / sold / confirmed / paid / lost). Deal-less order shells and
 * companies without qualifying orders are excluded. This is the same rule
 * used by book-refresh.ts.
 */

import fs from "node:fs";
import path from "node:path";

const OUT_PATH = path.join(process.cwd(), "data", "supabase-book.local.json");

const BOOK_CTE = `
WITH book AS (
  SELECT DISTINCT c.id
  FROM companies c
  JOIN orders_temp ot
    ON ot.company_id = c.id
    AND COALESCE(ot.is_deleted, false) = false
  JOIN deals_v2 d
    ON d.order_number = ot.id
    AND COALESCE(d.is_deleted, false) = false
    AND d.deal_stage IN ('bound', 'sold', 'confirmed', 'paid', 'lost')
  WHERE COALESCE(c.is_testing_user, false) = false
)`;

const ACCOUNTS_SQL = `${BOOK_CTE}
SELECT c.id, c.company_name, c.company_industry, c.company_state,
       c.general_stage::text AS stage
FROM companies c
WHERE c.id IN (SELECT id FROM book)
ORDER BY c.company_name`;

const POLICIES_SQL = `${BOOK_CTE}
SELECT d.id, d.company_id, d.policy_number,
       COALESCE(ic.name, NULLIF(d.carrier, ''), NULLIF(d.ai_carrier, '')) AS carrier,
       d.premium::text AS premium,
       d.effective_date::text AS effective_date,
       d.expiration_date::text AS expiration_date,
       d.coverage_type, d.deal_stage
FROM deals_v2 d
LEFT JOIN insurance_carriers ic ON ic.code = d.carrier
WHERE d.company_id IN (SELECT id FROM book)
  AND COALESCE(d.is_deleted, false) = false
  AND d.deal_stage IN ('bound', 'paid', 'confirmed', 'sold')
  AND d.cancelled_date IS NULL
  AND d.effective_date IS NOT NULL
  AND d.expiration_date IS NOT NULL
ORDER BY d.company_id, d.id`;

const ORDERS_SQL = `${BOOK_CTE},
orders AS (
  SELECT ot.id, ot.company_id, ot.ordered_date::text AS ordered_date
  FROM orders_temp ot
  WHERE ot.company_id IN (SELECT id FROM book)
    AND COALESCE(ot.is_deleted, false) = false
),
deal_state AS (
  SELECT
    d.order_number AS id,
    bool_or(d.deal_stage = 'bound') AS has_bound,
    bool_or(d.deal_stage IN ('sold', 'confirmed', 'paid')) AS has_open,
    bool_or(d.deal_stage = 'lost') AS has_lost,
    COALESCE(
      json_agg(DISTINCT NULLIF(TRIM(d.policy_number), ''))
        FILTER (
          WHERE d.deal_stage = 'bound'
            AND NULLIF(TRIM(d.policy_number), '') IS NOT NULL
        ),
      '[]'::json
    ) AS policy_numbers,
    count(*) AS deal_count,
    count(*) FILTER (WHERE d.is_instant_quote IS TRUE) AS iq_deal_count
  FROM deals_v2 d
  WHERE d.order_number IN (SELECT id FROM orders)
    AND COALESCE(d.is_deleted, false) = false
  GROUP BY d.order_number
)
SELECT
  o.id,
  o.company_id,
  o.ordered_date,
  CASE
    WHEN ds.has_bound THEN 'bound'
    WHEN ds.has_open THEN 'pending'
    ELSE 'lost'
  END AS bind_status,
  CASE
    WHEN ds.has_bound THEN COALESCE(ds.policy_numbers, '[]'::json)
    ELSE '[]'::json
  END AS policy_numbers,
  CASE
    WHEN ds.deal_count = 0 THEN NULL
    WHEN ds.iq_deal_count = ds.deal_count THEN 'iq'
    WHEN ds.iq_deal_count = 0 THEN 'broker'
    ELSE 'mixed'
  END AS source
FROM orders o
JOIN deal_state ds ON ds.id = o.id
WHERE ds.has_bound OR ds.has_open OR ds.has_lost
ORDER BY o.company_id, o.id`;

/** Active service = the stages the ops book treats as in-service. */
const ACTIVE_STAGES = new Set(["Servicing", "Payment Received"]);

/** Supabase coverage tokens → Step Bro COVERAGE_CATALOG codes. Unknown tokens pass through untouched (blank beats wrong). */
const COVERAGE_MAP = new Map([
  ["gl", "GL"],
  ["general liability", "GL"],
  ["commercial general liability", "GL"],
  ["gar", "Garage"],
  ["garage liab", "Garage"],
  ["garage liability", "Garage"],
  ["prof", "PL"],
  ["profliab", "PL"],
  ["e&o", "PL"],
  ["bop", "BOP"],
  ["w/c", "WC"],
  ["wc", "WC"],
  ["pkg", "PKG"],
  ["prop", "Prop"],
  ["umb", "Umb"],
  ["excess umb", "EXCESS_UMB"],
  ["cyber", "CL"],
  ["bond", "BOND"],
  ["comm", "COMM"],
  ["d&o", "D&O"],
  ["lll", "Liquor"],
  ["epl", "EPLI"],
  ["i/m", "IM"],
  ["polu", "POLU"],
]);

/** Carrier-name needle → seeded market desk. First match wins; no match → the explicit Unassigned desk (never invent a contact). */
const UW_BY_CARRIER = [
  ["hiscox", "uw-hiscox-1"],
  ["coterie", "uw-coterie-1"],
  ["kinsale", "uw-kinsale-1"],
  ["amtrust", "uw-amtrust-1"],
  ["next", "uw-next-1"],
  ["rt specialty", "uw-rt-1"],
  ["usli", "uw-usli-1"],
  ["united states liability", "uw-usli-1"],
  ["progressive", "uw-progressive-1"],
  ["united financial casualty", "uw-progressive-1"],
  ["markel", "uw-markel-1"],
  ["evanston", "uw-markel-1"],
  ["thimble", "uw-thimble-1"],
];
const UNASSIGNED_UW_ID = "uw-unassigned";

const STATE_CODES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

function normalizeState(raw) {
  const s = String(raw ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] ?? s;
}

function splitDba(rawName) {
  const name = String(rawName ?? "").trim();
  const m = name.match(/^(.*?)[,.]?\s+DBA\s+(.+)$/i);
  if (m && m[1].trim() && m[2].trim()) return { name: m[1].trim(), dba: m[2].trim() };
  return { name, dba: null };
}

function mapCoverages(raw) {
  let tokens = [];
  if (Array.isArray(raw)) tokens = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      tokens = Array.isArray(parsed) ? parsed : [raw];
    } catch {
      tokens = [raw];
    }
  }
  return tokens
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => COVERAGE_MAP.get(t.toLowerCase()) ?? t);
}

function matchUnderwriter(carrier) {
  const c = String(carrier ?? "").toLowerCase();
  for (const [needle, uwId] of UW_BY_CARRIER) {
    if (c.includes(needle)) return uwId;
  }
  // "ISC" is too short for substring matching — require a word boundary.
  if (/\bisc\b/.test(c)) return "uw-isc-1";
  return UNASSIGNED_UW_ID;
}

const POLICY_NUMBER_PLACEHOLDERS = new Set([
  "unknown",
  "pending",
  "n/a",
  "na",
  "none",
  "null",
]);

function parsePolicyNumbers(raw) {
  let values = [];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      values = Array.isArray(parsed) ? parsed : [];
    } catch {
      values = [];
    }
  }
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const n = String(value ?? "").trim();
    if (!n) continue;
    if (POLICY_NUMBER_PLACEHOLDERS.has(n.toLowerCase())) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function buildBook(companyRows, dealRows, orderRows = []) {
  const accounts = companyRows.map((r) => {
    const { name, dba } = splitDba(r.company_name);
    const stage = String(r.stage ?? "");
    return {
      id: `co-${r.id}`,
      name,
      dba,
      industry: String(r.company_industry ?? "").trim() || "Unclassified",
      state: normalizeState(r.company_state),
      primaryUwId: UNASSIGNED_UW_ID, // resolved from policies below
      backupUwId: null,
      notes: `Harper ops import — stage: ${stage || "unknown"}`,
      status: ACTIVE_STAGES.has(stage)
        ? "active"
        : stage === "Dead"
          ? "cancelled"
          : "pre_bind",
      paymentReceivedAt: null,
    };
  });

  const accountIds = new Set(accounts.map((a) => a.id));
  // The ops table occasionally carries duplicate deal rows for the same
  // policy term — keep the first per (account, number, effective date).
  const seenTerms = new Set();
  const policies = dealRows
    .filter((d) => accountIds.has(`co-${d.company_id}`))
    .filter((d) => {
      const key = `${d.company_id}|${d.policy_number ?? ""}|${d.effective_date}`;
      if (seenTerms.has(key)) return false;
      seenTerms.add(key);
      return true;
    })
    .map((d) => ({
      id: `deal-${d.id}`,
      accountId: `co-${d.company_id}`,
      policyNumber: String(d.policy_number ?? "").trim() || "PENDING",
      carrier: String(d.carrier ?? "").trim() || "Unknown Carrier",
      coverages: mapCoverages(d.coverage_type),
      effectiveDate: String(d.effective_date),
      expirationDate: String(d.expiration_date),
      premiumCents: Math.round((Number.parseFloat(d.premium) || 0) * 100),
      quoteInsuredName: null,
      quoteCarrier: null,
      issuingCarrier: null,
    }));

  // Primary UW per account = desk matching the carrier of its first policy.
  const firstPolicyByAccount = new Map();
  for (const p of policies) {
    if (!firstPolicyByAccount.has(p.accountId)) firstPolicyByAccount.set(p.accountId, p);
  }
  for (const a of accounts) {
    const p = firstPolicyByAccount.get(a.id);
    if (p) a.primaryUwId = matchUnderwriter(p.carrier);
  }

  const seenOrderIds = new Set();
  const orders = [];
  const BIND_STATUSES = new Set(["bound", "pending", "lost"]);
  for (const row of orderRows) {
    const accountId = `co-${row.company_id}`;
    if (!accountIds.has(accountId)) continue;
    if (seenOrderIds.has(row.id)) continue;
    seenOrderIds.add(row.id);
    // Unexpected status values are skipped — never guess a lifecycle state.
    if (!BIND_STATUSES.has(row.bind_status)) continue;
    const bindStatus = row.bind_status;
    const policyNumbers = parsePolicyNumbers(row.policy_numbers);
    let inconsistency = null;
    if (bindStatus === "bound" && policyNumbers.length === 0) {
      inconsistency =
        "Bound deal on file but no issued policy number on deals_v2 — investigate.";
    }
    orders.push({
      id: `order-${row.id}`,
      accountId,
      harperOrderId: row.id,
      orderedAt: row.ordered_date ? String(row.ordered_date) : null,
      bindStatus,
      policyNumbers,
      inconsistency,
      source:
        row.source === "iq" || row.source === "broker" || row.source === "mixed"
          ? row.source
          : null,
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    source: "supabase companies/deals_v2/orders_temp",
    accounts,
    policies,
    orders,
  };
}

async function main() {
  const url = process.env.HARPER_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error(
      [
        "No HARPER_DATABASE_URL / DATABASE_URL in the environment.",
        "Either export a Postgres connection string for the Harper ops Supabase,",
        "or run the two queries in this file via the Supabase MCP (execute_sql)",
        `and write the mapped JSON to ${OUT_PATH}.`,
      ].join("\n"),
    );
    process.exit(1);
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const companies = (await client.query(ACCOUNTS_SQL)).rows;
    const deals = (await client.query(POLICIES_SQL)).rows;
    const orderRows = (await client.query(ORDERS_SQL)).rows;
    const book = buildBook(companies, deals, orderRows);
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(book, null, 2) + "\n");
    const active = book.accounts.filter((a) => a.status === "active").length;
    const cancelled = book.accounts.filter((a) => a.status === "cancelled").length;
    const preBind = book.accounts.length - active - cancelled;
    const count = (status) =>
      book.orders.filter((o) => o.bindStatus === status).length;
    console.log(
      `Wrote ${OUT_PATH}: ${book.accounts.length} accounts (${active} active, ${
        preBind
      } pre_bind, ${cancelled} cancelled), ${book.policies.length} policies, ${
        book.orders.length
      } orders (${count("bound")} bound, ${count("pending")} pending, ${count(
        "lost",
      )} lost).`,
    );
  } finally {
    await client.end();
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
