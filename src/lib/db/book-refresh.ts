import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  BOOK_ORDER_BIND_STATUSES,
  loadSupabaseBook,
  setSupabaseBookCache,
  UNASSIGNED_UNDERWRITER,
  type BookOrder,
  type BookOrderBindStatus,
  type BookMoneyLine,
  type BookOrderDeal,
  type BookOrderRichData,
  type BookReportingWindows,
  type SupabaseBook,
} from "../supabase-book.server";
import type { Account, Policy } from "../types";
import { classifyOrderSource } from "../account-source";
import type { BookOrderServiceNote } from "../service-note";
import {
  recordBookRefreshFailure,
  recordBookRefreshSuccess,
} from "./book-refresh-status";
import { runSupabaseManagementQuery } from "../supabase-management.server";
import {
  OPERATIONS_METRICS_SQL,
  parseOperationsMetricsRow,
  writeOperationsMetricsSnapshot,
  type OperationsMetricsRow,
} from "./operations-metrics";
import { syncAccountsAndPolicies } from "./seed";

/**
 * Live book refresh: every five minutes, pull the curated slice of the real
 * Harper book (Supabase Postgres) and upsert it into local SQLite through the
 * same overlay path the boot seed uses (`data/supabase-book.local.json` +
 * `syncAccountsAndPolicies`).
 *
 * Reads go through the Supabase Management API SQL endpoint
 * (`POST /v1/projects/$REF/database/query`) — the same read path the
 * Supabase MCP uses — so the only credentials needed are
 * `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in `.env.local`.
 * Without them the refresher stays off and the app serves the last
 * snapshot (or the fictional seed on a clean clone), exactly as before.
 *
 * Failure policy: never wipe. Any fetch/mapping/validation error keeps the
 * last good book in place and is retried on the next tick.
 *
 * Eligibility — every non-test company with at least one real, non-deleted
 * `orders_temp` row that carries a non-deleted deal in a recognized stage
 * (bound / sold / confirmed / paid / lost). Company/submission/contact rows
 * without such an order never enter the Step Bro book — nor do deal-less
 * "inactive" order shells. Policy rows still exclude cancelled deals so the
 * desk/cert pipeline never issues off a cancelled policy — those accounts
 * simply show no policy number.
 *
 * Orders (All Accounts accordion) come from `orders_temp`, linked to deals by
 * `deals_v2.order_number = orders_temp.id`. Status per order, from its
 * non-deleted deals:
 *   bound    — at least one deal with `deal_stage = 'bound'`.
 *   pending  — no bound deal, but an actionable deal still moving toward bind
 *              (`sold` / `confirmed` / `paid`). Matches BigBrother's
 *              "actively awaiting bind" pending-orders definition — a lost
 *              deal is NOT pending work.
 *   lost     — no bound/actionable deal, at least one lost deal.
 * Every book order is exactly one of the three, so Bound + Pending + Lost
 * always equals the order total. Policy numbers come only from bound deals —
 * never from account status or fabricated placeholders.
 */

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const BOOK_PATH = path.join(process.cwd(), "data", "supabase-book.local.json");

/**
 * Authoritative book eligibility: a non-test company with a real order that
 * has at least one non-deleted deal in a recognized lifecycle stage. Orders
 * without such a deal are inert shells and stay out of Step Bro entirely.
 */
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

/**
 * Every non-deleted order on a book company that classifies as bound /
 * pending / lost, with lifecycle status + policy numbers derived from linked
 * deals (stable IDs — not company name). Deal-less order shells are excluded
 * here and from book eligibility. Aggregated once via CTE joins — not
 * per-row EXISTS/subselects.
 */
const ORDERS_SQL = `${BOOK_CTE},
orders AS (
  SELECT
    ot.id,
    ot.company_id,
    ot.created_at::text AS created_at,
    ot.ordered_date::text AS ordered_date,
    ot.payment_type,
    ot.pfa_quote_number,
    ot.order_documents,
    ot.taxes,
    ot.fees,
    ot.total_premium::text AS total_premium,
    ot.commission_revenue::text AS commission_revenue,
    ot.harper_service_fee::text AS harper_service_fee,
    ot.total_revenue::text AS total_revenue,
    ot.initial_payment_date::text AS initial_payment_date,
    ot.producer_notes,
    ot.producer_notes_updated_at::text AS producer_notes_updated_at,
    ot.producer_notes_updated_by,
    NULLIF(
      TRIM(
        COALESCE(pn_agent.first_name, '') || ' ' || COALESCE(pn_agent.last_name, '')
      ),
      ''
    ) AS producer_notes_updated_by_name,
    -- IQ Stage / BB "Step" column (operator-set; filter axis, not Gate).
    NULLIF(TRIM(ot.tag), '') AS iq_stage_tag
  FROM orders_temp ot
  LEFT JOIN internal_agents pn_agent
    ON pn_agent.id = ot.producer_notes_updated_by
  WHERE ot.company_id IN (SELECT id FROM book)
    AND COALESCE(ot.is_deleted, false) = false
),
deal_state AS (
  SELECT
    d.order_number AS id,
    bool_or(d.deal_stage = 'bound') AS has_bound,
    bool_or(d.deal_stage IN ('sold', 'confirmed', 'paid')) AS has_open,
    bool_or(d.deal_stage = 'lost') AS has_lost,
    min(COALESCE(d.ai_bound_at, d.bound_at))
      FILTER (
        WHERE d.deal_stage = 'bound'
           OR d.ai_bound_at IS NOT NULL
           OR d.bound_at IS NOT NULL
      ) AS first_bound_at,
    COALESCE(
      json_agg(DISTINCT NULLIF(TRIM(d.policy_number), ''))
        FILTER (
          WHERE d.deal_stage = 'bound'
            AND NULLIF(TRIM(d.policy_number), '') IS NOT NULL
        ),
      '[]'::json
    ) AS policy_numbers,
    jsonb_agg(
      jsonb_build_object(
        'deal_id', d.id,
        'deal_stage', d.deal_stage,
        'carrier_name', COALESCE(ic.name, NULLIF(d.carrier, ''), NULLIF(d.ai_carrier, '')),
        'wholesaler_name', COALESCE(ga.name, NULLIF(d.wholesaler, ''), NULLIF(d.ai_wholesaler, '')),
        'premium', d.premium::text,
        'policy_number', NULLIF(TRIM(d.policy_number), ''),
        'is_instant_quote', COALESCE(d.is_instant_quote, false),
        'bound_at', COALESCE(d.ai_bound_at, d.bound_at)::text,
        'effective_date', d.effective_date::text,
        'expiration_date', d.expiration_date::text
      )
      ORDER BY d.id
    ) AS deals
  FROM deals_v2 d
  LEFT JOIN insurance_carriers ic ON ic.code = d.carrier
  LEFT JOIN general_agents ga ON ga.code = d.wholesaler
  WHERE d.order_number IN (SELECT id FROM orders)
    AND COALESCE(d.is_deleted, false) = false
  GROUP BY d.order_number
),
-- Broker Gate: newest override per order (BB checkout G1–G6). Display only.
latest_gate AS (
  SELECT DISTINCT ON (g.order_id)
    g.order_id,
    g.current_gate,
    g.created_at::text AS broker_gate_at
  FROM service_workbench_gate_overrides g
  WHERE g.order_id IN (SELECT id FROM orders)
  ORDER BY g.order_id, g.created_at DESC, g.id DESC
)
SELECT
  o.id,
  o.company_id,
  o.created_at,
  o.ordered_date,
  CASE WHEN ds.has_bound THEN ds.first_bound_at::text
       WHEN ds.has_open THEN o.ordered_date
       ELSE NULL
  END AS event_at,
  o.payment_type,
  o.pfa_quote_number,
  o.order_documents,
  o.taxes,
  o.fees,
  o.total_premium,
  o.commission_revenue,
  o.harper_service_fee,
  o.total_revenue,
  o.initial_payment_date,
  o.producer_notes,
  o.producer_notes_updated_at,
  o.producer_notes_updated_by_name,
  o.iq_stage_tag,
  lg.current_gate AS broker_gate,
  lg.broker_gate_at,
  CASE
    WHEN ds.has_bound THEN 'bound'
    WHEN ds.has_open THEN 'pending'
    ELSE 'lost'
  END AS bind_status,
  CASE
    WHEN ds.has_bound THEN COALESCE(ds.policy_numbers, '[]'::json)
    ELSE '[]'::json
  END AS policy_numbers,
  ds.deals
FROM orders o
JOIN deal_state ds ON ds.id = o.id
LEFT JOIN latest_gate lg ON lg.order_id = o.id
WHERE ds.has_bound OR ds.has_open OR ds.has_lost
ORDER BY o.company_id, o.id`;

/**
 * Latest visible Workbench Service Note per book-company order — one batched
 * read of `public.service_note_entries` (soft-delete via deleted_at). Ordering
 * matches BigBrother: created_at DESC NULLS LAST, id DESC. Not Producer Notes.
 */
const SERVICE_NOTES_SQL = `${BOOK_CTE}
SELECT
  n.order_id,
  n.id::text AS note_id,
  n.body,
  n.created_at::text AS created_at,
  COALESCE(
    NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''),
    'Harper operator'
  ) AS author,
  n.note_count
FROM (
  SELECT
    e.id,
    e.order_id,
    e.body,
    e.created_at,
    e.author_internal_agent_id,
    COUNT(*) OVER (PARTITION BY e.order_id) AS note_count,
    ROW_NUMBER() OVER (
      PARTITION BY e.order_id
      ORDER BY e.created_at DESC NULLS LAST, e.id DESC
    ) AS rn
  FROM public.service_note_entries e
  WHERE e.deleted_at IS NULL
    AND e.company_id IN (SELECT id FROM book)
) n
LEFT JOIN public.internal_agents a ON a.id = n.author_internal_agent_id
WHERE n.rn = 1`;

const REPORTING_WINDOWS_SQL = `
WITH anchor AS (
  SELECT
    (now() AT TIME ZONE 'America/Los_Angeles')::date AS today,
    (
      (now() AT TIME ZONE 'America/Los_Angeles')::date
      - (extract(isodow FROM now() AT TIME ZONE 'America/Los_Angeles')::int - 1)
    )::date AS monday
)
SELECT
  (monday::timestamp AT TIME ZONE 'America/Los_Angeles')::text AS this_week_start,
  ((monday + 7)::timestamp AT TIME ZONE 'America/Los_Angeles')::text AS this_week_end,
  ((monday - 7)::timestamp AT TIME ZONE 'America/Los_Angeles')::text AS last_week_start,
  (monday::timestamp AT TIME ZONE 'America/Los_Angeles')::text AS last_week_end,
  ((today - 29)::timestamp AT TIME ZONE 'America/Los_Angeles')::text AS last_30_start,
  ((today + 1)::timestamp AT TIME ZONE 'America/Los_Angeles')::text AS last_30_end,
  monday::text AS this_week_start_on,
  (monday + 6)::text AS this_week_end_on,
  (monday - 7)::text AS last_week_start_on,
  (monday - 1)::text AS last_week_end_on,
  (today - 29)::text AS last_30_start_on,
  today::text AS last_30_end_on
FROM anchor`;

interface CompanyRow {
  id: number;
  company_name: string | null;
  company_industry: string | null;
  company_state: string | null;
  stage: string | null;
}

interface DealRow {
  id: number;
  company_id: number;
  policy_number: string | null;
  carrier: string | null;
  premium: string | null;
  effective_date: string;
  expiration_date: string;
  coverage_type: unknown;
  deal_stage: string;
}

interface OrderRow {
  id: number;
  company_id: number;
  created_at: string | null;
  ordered_date: string | null;
  event_at: string | null;
  payment_type: string | null;
  pfa_quote_number: string | null;
  order_documents: unknown;
  taxes: unknown;
  fees: unknown;
  total_premium: string | null;
  commission_revenue: string | null;
  harper_service_fee: string | null;
  total_revenue: string | null;
  initial_payment_date: string | null;
  producer_notes: string | null;
  producer_notes_updated_at: string | null;
  producer_notes_updated_by_name: string | null;
  iq_stage_tag: string | null;
  broker_gate: string | null;
  broker_gate_at: string | null;
  bind_status: string;
  policy_numbers: unknown;
  deals: unknown;
}

interface ServiceNoteRow {
  order_id: number;
  note_id: string;
  body: string | null;
  created_at: string | null;
  author: string | null;
  note_count: number | string | null;
}

interface ReportingWindowsRow {
  this_week_start: string;
  this_week_end: string;
  last_week_start: string;
  last_week_end: string;
  last_30_start: string;
  last_30_end: string;
  this_week_start_on: string;
  this_week_end_on: string;
  last_week_start_on: string;
  last_week_end_on: string;
  last_30_start_on: string;
  last_30_end_on: string;
}

/** Placeholders that appear in deals_v2 but are not real issued numbers. */
const POLICY_NUMBER_PLACEHOLDERS = new Set([
  "unknown",
  "pending",
  "n/a",
  "na",
  "none",
  "null",
]);

function parsePolicyNumbers(raw: unknown): string[] {
  let values: unknown[] = [];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      values = Array.isArray(parsed) ? parsed : [];
    } catch {
      values = [];
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
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

function arrayValue(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function decimalToFixed(raw: unknown, scale: number): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(raw).trim());
  if (!match) return null;
  const negative = match[1] === "-";
  const fraction = (match[3] ?? "").padEnd(scale + 1, "0");
  const factor = BigInt(10) ** BigInt(scale);
  let fixed =
    BigInt(match[2]) * factor +
    BigInt(fraction.slice(0, scale) || "0") +
    (Number(fraction[scale] ?? "0") >= 5 ? BigInt(1) : BigInt(0));
  if (negative) fixed = -fixed;
  const value = Number(fixed);
  return Number.isSafeInteger(value) ? value : null;
}

/** Decimal-safe USD parser. Rounds half away from zero to integer cents. */
export function decimalToCents(raw: unknown): number | null {
  return decimalToFixed(raw, 2);
}

/** Six-place fixed point preserves source numerics until the final KPI rounding. */
export function decimalToMicros(raw: unknown): number | null {
  return decimalToFixed(raw, 6);
}

function parseMoneyLines(raw: unknown, kind: "tax" | "fee"): BookMoneyLine[] {
  return arrayValue(raw).map((value, index) => {
    const row =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    return {
      name:
        String(
          row.name ??
            row[`${kind}_type`] ??
            `${kind === "tax" ? "Tax" : "Fee"} ${index + 1}`,
        ).trim(),
      amountCents: decimalToCents(
        row.amount ?? row[`${kind}_amount`] ?? null,
      ),
    };
  });
}

function sumKnownMoney(lines: BookMoneyLine[]): number | null {
  const values = lines
    .map((line) => line.amountCents)
    .filter((value): value is number => value !== null);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function parseOrderDeals(raw: unknown): BookOrderDeal[] {
  return arrayValue(raw).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const dealId = Number(row.deal_id);
    if (!Number.isSafeInteger(dealId)) return [];
    const boundAt =
      row.bound_at === null || row.bound_at === undefined
        ? null
        : String(row.bound_at);
    const dealStage =
      row.deal_stage === null || row.deal_stage === undefined
        ? null
        : String(row.deal_stage);
    return [
      {
        dealId,
        dealStage,
        carrierName:
          row.carrier_name === null || row.carrier_name === undefined
            ? null
            : String(row.carrier_name),
        wholesalerName:
          row.wholesaler_name === null || row.wholesaler_name === undefined
            ? null
            : String(row.wholesaler_name),
        premiumCents: decimalToCents(row.premium),
        policyNumber:
          row.policy_number === null || row.policy_number === undefined
            ? null
            : String(row.policy_number),
        isInstantQuote: row.is_instant_quote === true,
        isBound: Boolean(boundAt) || dealStage?.toLowerCase() === "bound",
        boundAt,
        effectiveDate:
          row.effective_date === null || row.effective_date === undefined
            ? null
            : String(row.effective_date),
        expirationDate:
          row.expiration_date === null || row.expiration_date === undefined
            ? null
            : String(row.expiration_date),
      },
    ];
  });
}

function parseReportingWindows(
  row: ReportingWindowsRow | undefined,
): BookReportingWindows | undefined {
  if (!row) return undefined;
  return {
    timeZone: "America/Los_Angeles",
    ranges: {
      "this-week": {
        startsAt: row.this_week_start,
        endsAt: row.this_week_end,
        startsOn: row.this_week_start_on,
        endsOn: row.this_week_end_on,
      },
      "last-week": {
        startsAt: row.last_week_start,
        endsAt: row.last_week_end,
        startsOn: row.last_week_start_on,
        endsOn: row.last_week_end_on,
      },
      "last-30-days": {
        startsAt: row.last_30_start,
        endsAt: row.last_30_end,
        startsOn: row.last_30_start_on,
        endsOn: row.last_30_end_on,
      },
    },
  };
}

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
const UW_BY_CARRIER: ReadonlyArray<readonly [string, string]> = [
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

const STATE_CODES: Record<string, string> = {
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

function normalizeState(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] ?? s;
}

function splitDba(rawName: unknown): { name: string; dba: string | null } {
  const name = String(rawName ?? "").trim();
  const m = name.match(/^(.*?)[,.]?\s+DBA\s+(.+)$/i);
  if (m && m[1].trim() && m[2].trim()) return { name: m[1].trim(), dba: m[2].trim() };
  return { name, dba: null };
}

function mapCoverages(raw: unknown): string[] {
  let tokens: unknown[] = [];
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

function matchUnderwriter(carrier: unknown): string {
  const c = String(carrier ?? "").toLowerCase();
  for (const [needle, uwId] of UW_BY_CARRIER) {
    if (c.includes(needle)) return uwId;
  }
  // "ISC" is too short for substring matching — require a word boundary.
  if (/\bisc\b/.test(c)) return "uw-isc-1";
  return UNASSIGNED_UNDERWRITER.id;
}

export function buildBook(
  companyRows: CompanyRow[],
  dealRows: DealRow[],
  orderRows: OrderRow[] = [],
  reportingWindowsRow?: ReportingWindowsRow,
  serviceNoteRows: ServiceNoteRow[] = [],
): SupabaseBook {
  const accounts: Account[] = companyRows.map((r) => {
    const { name, dba } = splitDba(r.company_name);
    const stage = String(r.stage ?? "");
    return {
      id: `co-${r.id}`,
      name,
      dba,
      industry: String(r.company_industry ?? "").trim() || "Unclassified",
      addressLine1: null,
      city: null,
      state: normalizeState(r.company_state),
      zip: null,
      primaryUwId: UNASSIGNED_UNDERWRITER.id, // resolved from policies below
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
  const seenTerms = new Set<string>();
  const policies: Policy[] = dealRows
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
      premiumCents: Math.round((Number.parseFloat(d.premium ?? "") || 0) * 100),
      quoteInsuredName: null,
      quoteCarrier: null,
      issuingCarrier: null,
    }));

  // Primary UW per account = desk matching the carrier of its first policy.
  const firstPolicyByAccount = new Map<string, Policy>();
  for (const p of policies) {
    if (!firstPolicyByAccount.has(p.accountId)) firstPolicyByAccount.set(p.accountId, p);
  }
  for (const a of accounts) {
    const p = firstPolicyByAccount.get(a.id);
    if (p) a.primaryUwId = matchUnderwriter(p.carrier);
  }

  const seenOrderIds = new Set<number>();
  const serviceNotesByOrder = new Map<number, BookOrderServiceNote>();
  for (const row of serviceNoteRows) {
    const orderId = Number(row.order_id);
    if (!Number.isFinite(orderId) || serviceNotesByOrder.has(orderId)) continue;
    const noteId = String(row.note_id ?? "").trim();
    const createdAt =
      row.created_at === null || row.created_at === undefined
        ? ""
        : String(row.created_at).trim();
    if (!noteId || !createdAt) continue;
    const noteCountRaw = Number(row.note_count);
    serviceNotesByOrder.set(orderId, {
      id: noteId,
      body: typeof row.body === "string" ? row.body : "",
      author:
        typeof row.author === "string" && row.author.trim()
          ? row.author.trim()
          : "Harper operator",
      createdAt,
      noteCount:
        Number.isFinite(noteCountRaw) && noteCountRaw > 0
          ? Math.floor(noteCountRaw)
          : 1,
    });
  }

  const orders: BookOrder[] = [];
  let boundWithoutPolicy = 0;
  for (const row of orderRows) {
    const accountId = `co-${row.company_id}`;
    if (!accountIds.has(accountId)) continue;
    if (seenOrderIds.has(row.id)) continue;
    seenOrderIds.add(row.id);

    // Unexpected status values are skipped — never guess a lifecycle state.
    if (
      !(BOOK_ORDER_BIND_STATUSES as readonly string[]).includes(row.bind_status)
    ) {
      console.warn(
        `[book-refresh] order ${row.id} carries unknown status "${row.bind_status}" — skipped`,
      );
      continue;
    }
    const bindStatus = row.bind_status as BookOrderBindStatus;
    const policyNumbers = parsePolicyNumbers(row.policy_numbers);
    const deals = parseOrderDeals(row.deals);
    const taxes = parseMoneyLines(row.taxes, "tax");
    const fees = parseMoneyLines(row.fees, "fee");
    const totalPremiumCents = decimalToCents(row.total_premium);
    const taxesCents = sumKnownMoney(taxes);
    const feesCents = sumKnownMoney(fees);
    const totalCostCents =
      totalPremiumCents !== null || taxesCents !== null || feesCents !== null
        ? (totalPremiumCents ?? 0) + (taxesCents ?? 0) + (feesCents ?? 0)
        : null;
    const rich: BookOrderRichData = {
      paymentType: row.payment_type,
      pfaQuoteNumber: row.pfa_quote_number,
      initialPaymentAt: row.initial_payment_date,
      documentCount: arrayValue(row.order_documents).length,
      policyCount: deals.length,
      totalPremiumCents,
      taxesCents,
      feesCents,
      totalCostCents,
      commissionRevenueCents: decimalToCents(row.commission_revenue),
      harperServiceFeeCents: decimalToCents(row.harper_service_fee),
      taxes,
      fees,
      producerNote: row.producer_notes,
      producerNoteUpdatedAt: row.producer_notes_updated_at,
      producerNoteUpdatedByName: row.producer_notes_updated_by_name
        ? String(row.producer_notes_updated_by_name).trim() || null
        : null,
      serviceNote: serviceNotesByOrder.get(row.id) ?? null,
      deals,
    };
    let inconsistency: string | null = null;
    if (bindStatus === "bound" && policyNumbers.length === 0) {
      inconsistency =
        "Bound deal on file but no issued policy number on deals_v2 — investigate.";
      boundWithoutPolicy += 1;
      console.warn(
        `[book-refresh] order ${row.id} (company ${row.company_id}) is bound without a real policy number`,
      );
    }

    const iqStageTag =
      typeof row.iq_stage_tag === "string" && row.iq_stage_tag.trim()
        ? row.iq_stage_tag.trim()
        : null;
    const brokerGate =
      typeof row.broker_gate === "string" && row.broker_gate.trim()
        ? row.broker_gate.trim()
        : null;
    const brokerGateAt =
      typeof row.broker_gate_at === "string" && row.broker_gate_at.trim()
        ? row.broker_gate_at
        : null;

    orders.push({
      id: `order-${row.id}`,
      accountId,
      harperOrderId: row.id,
      createdAt: row.created_at ? String(row.created_at) : null,
      orderedAt: row.ordered_date ? String(row.ordered_date) : null,
      eventAt: row.event_at ? String(row.event_at) : null,
      bindStatus,
      revenueCents: decimalToCents(row.total_revenue),
      revenueMicros: decimalToMicros(row.total_revenue),
      rich,
      policyNumbers,
      inconsistency,
      source: classifyOrderSource(deals),
      iqStageTag,
      brokerGate,
      brokerGateAt,
    });
  }

  if (boundWithoutPolicy > 0) {
    console.warn(
      `[book-refresh] ${boundWithoutPolicy} bound order(s) missing issued policy numbers`,
    );
  }

  return {
    fetchedAt: new Date().toISOString(),
    source: "supabase companies/deals_v2/orders_temp",
    accounts,
    policies,
    orders,
    reportingWindows: parseReportingWindows(reportingWindowsRow),
    stageFieldsPresent: true,
    serviceNotesPresent: true,
  };
}

/** Run one read-only SQL statement through the Supabase Management API. */
async function runManagementQuery<T>(sql: string): Promise<T[]> {
  return runSupabaseManagementQuery<T>(sql);
}

export function isRefreshConfigured(): boolean {
  return Boolean(process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF);
}

/**
 * One refresh cycle: fetch → map → validate → snapshot to disk → upsert into
 * SQLite. Throws on failure; callers log and keep the last good book.
 */
export async function refreshBook(db: Database.Database): Promise<SupabaseBook> {
  const [
    companyRows,
    dealRows,
    orderRows,
    serviceNoteRows,
    reportingWindowRows,
    operationsMetricsRows,
  ] = await Promise.all([
    runManagementQuery<CompanyRow>(ACCOUNTS_SQL),
    runManagementQuery<DealRow>(POLICIES_SQL),
    runManagementQuery<OrderRow>(ORDERS_SQL),
    runManagementQuery<ServiceNoteRow>(SERVICE_NOTES_SQL),
    runManagementQuery<ReportingWindowsRow>(REPORTING_WINDOWS_SQL),
    runManagementQuery<OperationsMetricsRow>(OPERATIONS_METRICS_SQL),
  ]);
  const book = buildBook(
    companyRows,
    dealRows,
    orderRows,
    reportingWindowRows[0],
    serviceNoteRows,
  );
  const operationsMetrics = parseOperationsMetricsRow(operationsMetricsRows[0]);
  if (book.accounts.length === 0) throw new Error("refresh produced an empty book");

  // Atomic snapshot: the boot path and a mid-write crash both only ever see
  // a complete file.
  fs.mkdirSync(path.dirname(BOOK_PATH), { recursive: true });
  const tmp = `${BOOK_PATH}.tmp`;
  // Compact — at ~10k accounts a pretty-printed snapshot is >10MB.
  fs.writeFileSync(tmp, JSON.stringify(book) + "\n");
  fs.renameSync(tmp, BOOK_PATH);
  writeOperationsMetricsSnapshot(operationsMetrics);

  setSupabaseBookCache(book);
  syncAccountsAndPolicies(db);
  return book;
}

async function runRefreshSafely(db: Database.Database, trigger: string) {
  try {
    const book = await refreshBook(db);
    const completedAt = new Date().toISOString();
    try {
      recordBookRefreshSuccess(completedAt);
    } catch (statusError) {
      console.error(
        "[book-refresh] refresh succeeded but sync metadata could not be recorded:",
        statusError instanceof Error ? statusError.message : statusError,
      );
    }
    const active = book.accounts.filter((a) => a.status === "active").length;
    const cancelled = book.accounts.filter(
      (a) => a.status === "cancelled",
    ).length;
    const preBind = book.accounts.length - active - cancelled;
    const byStatus = new Map<string, number>();
    for (const o of book.orders) {
      byStatus.set(o.bindStatus, (byStatus.get(o.bindStatus) ?? 0) + 1);
    }
    console.log(
      `[book-refresh] ${trigger}: ${book.accounts.length} accounts (${active} active, ${
        preBind
      } pre_bind, ${cancelled} cancelled), ${book.policies.length} policies, ${
        book.orders.length
      } orders (${byStatus.get("bound") ?? 0} bound, ${
        byStatus.get("pending") ?? 0
      } pending, ${byStatus.get("lost") ?? 0} lost)`,
    );
  } catch (err) {
    try {
      recordBookRefreshFailure(new Date().toISOString());
    } catch (statusError) {
      console.error(
        "[book-refresh] failure metadata could not be recorded:",
        statusError instanceof Error ? statusError.message : statusError,
      );
    }
    console.error(
      `[book-refresh] ${trigger} failed — keeping last good book:`,
      err instanceof Error ? err.message : err,
    );
  }
}

function snapshotAgeMs(): number {
  try {
    return Date.now() - fs.statSync(BOOK_PATH).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// Survives dev-mode module re-evaluation — one timer per process, ever.
const SCHEDULED = Symbol.for("stepbro.bookRefreshScheduled");

/**
 * Start the five-minute refresh loop (idempotent per process). Called from
 * `getDb()` so anything that touches the database keeps the book current.
 */
export function scheduleBookRefresh(db: Database.Database) {
  const g = globalThis as Record<symbol, boolean | undefined>;
  if (g[SCHEDULED]) return;
  g[SCHEDULED] = true;

  if (!isRefreshConfigured()) {
    console.warn(
      "[book-refresh] SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set — live refresh disabled, serving last snapshot",
    );
    return;
  }

  // Boot catch-up: refresh now (async, so the first page load isn't held
  // hostage by the network) when the snapshot is stale, or when it predates
  // IQ Stage / Broker Gate / Service Note fields — a fresh-looking snapshot
  // from the old query would blank those surfaces until the next tick.
  const snapshot = loadSupabaseBook();
  if (
    snapshotAgeMs() > REFRESH_INTERVAL_MS ||
    snapshot?.stageFieldsPresent === false ||
    snapshot?.serviceNotesPresent === false
  ) {
    void runRefreshSafely(db, "boot");
  }

  const timer = setInterval(() => void runRefreshSafely(db, "interval"), REFRESH_INTERVAL_MS);
  timer.unref();
}
