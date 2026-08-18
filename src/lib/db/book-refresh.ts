import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  BOOK_ORDER_BIND_STATUSES,
  loadSupabaseBook,
  setSupabaseBookCache,
  UNASSIGNED_UNDERWRITER,
  type BookCompanyContact,
  type BookCompanyDetail,
  type BookContactKey,
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
import { normalizeLocationState } from "../location-state";
import type {
  BookOrderServiceNote,
  BookServiceNoteEntry,
} from "../service-note";
import {
  readBookRefreshStatus,
  recordBookRefreshFailure,
  recordBookRefreshSuccess,
} from "./book-refresh-status";
import {
  describeDelta,
  diffBookDigests,
  fetchBookDigests,
  isEmptyDelta,
  readBookDigests,
  writeBookDigests,
  type BookDelta,
} from "./book-digest";
import {
  isRateLimited,
  rateLimitResetMs,
  runSupabaseManagementQuery,
} from "../supabase-management.server";
import {
  OPERATIONS_METRICS_SQL,
  parseOperationsMetricsRow,
  writeOperationsMetricsSnapshot,
  type OperationsMetricsRow,
} from "./operations-metrics";
import {
  replaceAccountServiceNotes,
  syncAccountsAndPolicies,
} from "./seed";

/**
 * Live book refresh: every two minutes, pull whatever changed in the real
 * Harper book (Supabase Postgres) and upsert it into local SQLite through the
 * same overlay path the boot seed uses (`data/supabase-book.local.json` +
 * `syncAccountsAndPolicies`).
 *
 * Incremental by digest, not by watermark. Harper has no `updated_at` on
 * `orders_temp` or `deals_v2`, so there is no timestamp to filter on — see
 * `book-digest.ts`. Each tick sweeps one short hash per eligible order and
 * company, and only rows whose hash moved are fetched in full. An unchanged
 * book therefore costs one sweep and skips the snapshot write and the 10k-row
 * SQLite upsert entirely, which is what makes two minutes affordable where the
 * old whole-book pull needed five. Every half hour a tick pulls the whole book
 * anyway, to re-derive the handful of display names that live in directory
 * tables outside the digest.
 *
 * A newly created order usually has no deal attached yet, so it is not book
 * eligible and will not appear in All Accounts until one is. The stats bar's
 * New Orders counter does not wait for that: it is refreshed on every tick
 * straight from `orders_temp.created_at` (see `refreshOperationsMetrics`).
 *
 * Reads go through the Supabase Management API SQL endpoint
 * (`POST /v1/projects/$REF/database/query`) — the same read path the
 * Supabase MCP uses — so the only credentials needed are
 * `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in `.env.local`.
 * Without them the refresher stays off and the app serves the last
 * snapshot (or the fictional seed on a clean clone), exactly as before.
 *
 * Failure policy: never wipe. Any fetch/mapping/validation error keeps the
 * last good book in place and is retried on the next tick. A rate-limited tick
 * waits out the window the quota itself reports rather than retrying into the
 * same wall, and is not recorded as a failed refresh: the Management API quota
 * is shared account-wide, so being refused says nothing about this book, which
 * is still whole and still being served. Starvation long enough to matter
 * surfaces on its own, as a snapshot the desk shows as stale. The stored
 * digests are only advanced after the book they describe is safely on disk, so
 * an interrupted cycle repeats itself instead of skipping rows.
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

/**
 * Tick cadence. Every tick sweeps Harper for changed rows and fetches only
 * those, so this is affordable where the old whole-book pull was not.
 */
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

/**
 * How often a tick pulls the whole book instead of a delta. The digest sweep
 * is exact for everything the book persists, so this is a safety net rather
 * than the mechanism: it re-derives the display names that live in directory
 * tables outside the digest (carrier, wholesaler, producer, note author) and
 * bounds any drift from a bug in the delta path.
 */
const FULL_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;

const BOOK_PATH = path.join(process.cwd(), "data", "supabase-book.local.json");

/**
 * Authoritative book eligibility: a non-test company with a real order that
 * has at least one non-deleted deal in a recognized lifecycle stage. Orders
 * without such a deal are inert shells and stay out of Step Bro entirely.
 */
const FULL_BOOK_CTE = `
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

/**
 * Ids for a scoped read, or null for the whole book. Only validated safe
 * integers are ever interpolated — these come from Harper's own numeric keys
 * by way of the digest sweep, never from anything an operator typed.
 */
export type IdScope = readonly number[] | null;

function idList(ids: readonly number[]): string {
  const safe = ids.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (safe.length === 0) throw new Error("scoped read with no valid ids");
  return safe.join(", ");
}

/**
 * The `book` CTE every downstream query joins against. A scoped refresh swaps
 * the eligibility scan for the explicit company list the sweep produced, which
 * is what turns a whole-book read into a handful of rows.
 */
function bookCte(companyIds: IdScope): string {
  if (!companyIds) return FULL_BOOK_CTE;
  return `
WITH book AS (
  SELECT id FROM unnest(ARRAY[${idList(companyIds)}]::bigint[]) AS id
)`;
}

/**
 * Book companies, each carrying its normalized search keys for global company
 * search. Emails are lowercased and phones reduced to digits in Postgres, so
 * punctuation, spacing and the +1 country code cannot block a match. Both the
 * company primary contact and every `companies_contacts` row are indexed
 * because they disagree on part of the book.
 *
 * Only the normalized key is pulled for search — the search path never holds
 * a formatted email or phone. The company-page overview mirror rides along in
 * the same read: location, stored timezone, the producer resolved from
 * `producer_assigned`, and the display contacts the Contacts card shows.
 *
 * Deliberately folded into the accounts read rather than run as its own query:
 * both are company grain, and the Management API rate-limits the whole desk,
 * so the refresh should not spend a request it does not need.
 */
const accountsSql = (companyIds: IdScope) => `${bookCte(companyIds)},
search_keys AS (
  SELECT c.id AS company_id, 'email'::text AS kind,
         lower(TRIM(c.company_primary_email)) AS value
  FROM companies c WHERE c.id IN (SELECT id FROM book)
  UNION
  SELECT c.id, 'phone', regexp_replace(COALESCE(c.company_primary_phone, ''), '[^0-9]', '', 'g')
  FROM companies c WHERE c.id IN (SELECT id FROM book)
  UNION
  SELECT cc.company_id, 'email', lower(TRIM(cc.contact_primary_email))
  FROM companies_contacts cc WHERE cc.company_id IN (SELECT id FROM book)
  UNION
  SELECT cc.company_id, 'phone', regexp_replace(COALESCE(cc.contact_primary_phone, ''), '[^0-9]', '', 'g')
  FROM companies_contacts cc WHERE cc.company_id IN (SELECT id FROM book)
),
grouped_keys AS (
  SELECT company_id,
    COALESCE(json_agg(value) FILTER (WHERE kind = 'email'), '[]'::json) AS emails,
    COALESCE(json_agg(value) FILTER (WHERE kind = 'phone'), '[]'::json) AS phones
  FROM search_keys
  WHERE (kind = 'email' AND value LIKE '%_@_%')
     OR (kind = 'phone' AND length(value) >= 7)
  GROUP BY company_id
)
SELECT c.id, c.company_name, c.company_industry, c.company_state,
       c.general_stage::text AS stage,
       COALESCE(g.emails, '[]'::json) AS search_emails,
       COALESCE(g.phones, '[]'::json) AS search_phones,
       c.company_street_address_1,
       c.company_street_address_2,
       c.company_city,
       state_code.abbreviation AS company_state_code,
       c.company_postal_code,
       c.company_timezone,
       producer.id AS producer_id,
       producer.first_name AS producer_first_name,
       producer.last_name AS producer_last_name,
       COALESCE(ct.contacts, '[]'::json) AS display_contacts
FROM companies c
LEFT JOIN grouped_keys g ON g.company_id = c.id
LEFT JOIN LATERAL (
  SELECT s.abbreviation
  FROM public.states s
  WHERE LOWER(TRIM(s.name)) = LOWER(TRIM(c.company_state))
     OR LOWER(TRIM(s.abbreviation)) = LOWER(TRIM(c.company_state))
  ORDER BY s.id ASC
  LIMIT 1
) state_code ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.first_name, p.last_name
  FROM public.producers p
  WHERE p.user_slug = NULLIF(TRIM(c.producer_assigned), '')
    AND COALESCE(p.active, false) = true
  ORDER BY p.id DESC
  LIMIT 1
) producer ON true
LEFT JOIN LATERAL (
  SELECT json_agg(json_build_object(
           'id', x.id,
           'first_name', x.contact_first_name,
           'last_name', x.contact_last_name,
           'email', x.contact_primary_email,
           'phone', x.contact_primary_phone
         ) ORDER BY x.ord) AS contacts
  FROM (
    SELECT cc.id, cc.contact_first_name, cc.contact_last_name,
           cc.contact_primary_email, cc.contact_primary_phone,
           ROW_NUMBER() OVER (
             ORDER BY cc.created_at ASC NULLS LAST, cc.id ASC
           ) AS ord
    FROM public.companies_contacts cc
    WHERE cc.company_id = c.id
      AND (
        NULLIF(TRIM(cc.contact_first_name), '') IS NOT NULL
        OR NULLIF(TRIM(cc.contact_last_name), '') IS NOT NULL
        OR NULLIF(TRIM(cc.contact_primary_email), '') IS NOT NULL
        OR NULLIF(TRIM(cc.contact_primary_phone), '') IS NOT NULL
      )
    ORDER BY cc.created_at ASC NULLS LAST, cc.id ASC
    LIMIT 200
  ) x
) ct ON true
WHERE c.id IN (SELECT id FROM book)
ORDER BY c.company_name`;

const policiesSql = (companyIds: IdScope) => `${bookCte(companyIds)}
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
const ordersSql = (orderIds: IdScope) => `${
  orderIds ? "WITH" : `${FULL_BOOK_CTE},`
}
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
    -- Order-grain producer by stable FK. companies.producer_assigned is a
    -- company-level slug that disagrees with how the order was actually
    -- written (it differs from this join on a large share of the book), so
    -- the preview reads the same grain as carrier, status and IQ/Broker.
    ot.producer AS producer_id,
    NULLIF(
      TRIM(COALESCE(prod.first_name, '') || ' ' || COALESCE(prod.last_name, '')),
      ''
    ) AS producer_name,
    -- IQ Stage / BB "Step" column (operator-set; filter axis, not Gate).
    NULLIF(TRIM(ot.tag), '') AS iq_stage_tag
  FROM orders_temp ot
  LEFT JOIN internal_agents pn_agent
    ON pn_agent.id = ot.producer_notes_updated_by
  LEFT JOIN producers prod ON prod.id = ot.producer
  WHERE ${
    orderIds
      ? `ot.id IN (${idList(orderIds)})`
      : "ot.company_id IN (SELECT id FROM book)"
  }
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
  o.producer_id,
  o.producer_name,
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
 * Every visible Workbench Service Note on book companies — one batched read
 * of `public.service_note_entries` (soft-delete via deleted_at). Ordering
 * matches BigBrother: created_at DESC NULLS LAST, id DESC. Not Producer Notes.
 *
 * All entries, not just the latest per order: the same result set feeds both
 * the per-order latest-note snapshot on `rich.serviceNote` (rows where
 * `rn = 1`) and the mirrored account-scoped thread the expanded note cards
 * read from SQLite — measured live the whole corpus is ~4.6k rows / ~0.4 MB,
 * a fraction of the digest sweep, so returning it whole costs less than a
 * second request would.
 *
 * Scoped by company rather than by order even on a delta refresh: the thread
 * and `note_count` are company grain, so narrowing to the changed orders
 * would drop sibling entries and understate the badge. The digest sweep folds
 * the company-wide note count and newest note id in, so a note added
 * anywhere on the company flags it for this read.
 */
const serviceNotesSql = (companyIds: IdScope) => `${bookCte(companyIds)}
SELECT
  n.order_id,
  n.company_id,
  n.id::text AS note_id,
  n.body,
  n.created_at::text AS created_at,
  COALESCE(
    NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''),
    'Unknown author'
  ) AS author,
  n.note_count,
  n.rn
FROM (
  SELECT
    e.id,
    e.order_id,
    e.company_id,
    e.body,
    e.created_at,
    e.author_internal_agent_id,
    COUNT(*) OVER (PARTITION BY e.company_id) AS note_count,
    ROW_NUMBER() OVER (
      PARTITION BY e.order_id
      ORDER BY e.created_at DESC NULLS LAST, e.id DESC
    ) AS rn
  FROM public.service_note_entries e
  WHERE e.deleted_at IS NULL
    AND e.company_id IN (SELECT id FROM book)
) n
LEFT JOIN public.internal_agents a ON a.id = n.author_internal_agent_id
ORDER BY n.company_id, n.created_at DESC, n.id DESC`;

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
  /** Normalized, search-only contact keys — never display values. */
  search_emails: unknown;
  search_phones: unknown;
  company_street_address_1: string | null;
  company_street_address_2: string | null;
  company_city: string | null;
  company_state_code: string | null;
  company_postal_code: string | null;
  company_timezone: string | null;
  producer_id: number | string | null;
  producer_first_name: string | null;
  producer_last_name: string | null;
  /** JSON array of display contacts for the company page's Contacts card. */
  display_contacts: unknown;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function companyDetailFromRow(row: CompanyRow): BookCompanyDetail {
  const contacts = arrayValue(row.display_contacts).flatMap(
    (value): BookCompanyContact[] => {
      if (!value || typeof value !== "object") return [];
      const contact = value as Record<string, unknown>;
      const id = Number(contact.id);
      if (!Number.isSafeInteger(id) || id <= 0) return [];
      const name =
        [textOrNull(contact.first_name), textOrNull(contact.last_name)]
          .filter(Boolean)
          .join(" ") || "Unnamed contact";
      return [
        {
          id,
          name,
          email: textOrNull(contact.email),
          phone: textOrNull(contact.phone),
        },
      ];
    },
  );
  const producerId = Number(row.producer_id);
  const producerName = [
    textOrNull(row.producer_first_name),
    textOrNull(row.producer_last_name),
  ]
    .filter(Boolean)
    .join(" ");
  return {
    accountId: `co-${row.id}`,
    address1: textOrNull(row.company_street_address_1),
    address2: textOrNull(row.company_street_address_2),
    city: textOrNull(row.company_city),
    state: textOrNull(row.company_state),
    stateCode: textOrNull(row.company_state_code),
    postalCode: textOrNull(row.company_postal_code),
    timeZone: textOrNull(row.company_timezone),
    producerId:
      Number.isSafeInteger(producerId) && producerId > 0 && producerName
        ? producerId
        : null,
    producerName:
      Number.isSafeInteger(producerId) && producerId > 0 && producerName
        ? producerName
        : null,
    contacts,
  };
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
  producer_id: number | null;
  producer_name: string | null;
  iq_stage_tag: string | null;
  broker_gate: string | null;
  broker_gate_at: string | null;
  bind_status: string;
  policy_numbers: unknown;
  deals: unknown;
}

interface ServiceNoteRow {
  order_id: number;
  company_id: number;
  note_id: string;
  body: string | null;
  created_at: string | null;
  author: string | null;
  note_count: number | string | null;
  /** 1 = newest visible entry on its order (feeds `rich.serviceNote`). */
  rn: number | string;
}

/** One validated thread entry from a sweep row, or null when unusable. */
function serviceNoteEntryFromRow(
  row: ServiceNoteRow,
): BookServiceNoteEntry | null {
  const orderId = Number(row.order_id);
  const companyId = Number(row.company_id);
  const noteId = String(row.note_id ?? "").trim();
  const createdAt =
    row.created_at === null || row.created_at === undefined
      ? ""
      : String(row.created_at).trim();
  if (
    !Number.isSafeInteger(orderId) ||
    !Number.isSafeInteger(companyId) ||
    companyId <= 0 ||
    !noteId ||
    !createdAt
  ) {
    return null;
  }
  return {
    id: noteId,
    accountId: `co-${companyId}`,
    orderId,
    body: typeof row.body === "string" ? row.body : "",
    author:
      typeof row.author === "string" && row.author.trim()
        ? row.author.trim()
        : "Unknown author",
    createdAt,
  };
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
      state: normalizeLocationState(r.company_state),
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
  const serviceNoteEntries: BookServiceNoteEntry[] = [];
  const seenNoteIds = new Set<string>();
  for (const row of serviceNoteRows) {
    const entry = serviceNoteEntryFromRow(row);
    if (!entry) continue;
    // Full thread mirror: every visible entry on a book company.
    if (accountIds.has(entry.accountId) && !seenNoteIds.has(entry.id)) {
      seenNoteIds.add(entry.id);
      serviceNoteEntries.push(entry);
    }
    // Latest-per-order snapshot on rich.serviceNote — rn = 1 rows only.
    if (Number(row.rn) !== 1 || serviceNotesByOrder.has(entry.orderId)) {
      continue;
    }
    const noteCountRaw = Number(row.note_count);
    serviceNotesByOrder.set(entry.orderId, {
      id: entry.id,
      body: entry.body,
      author: entry.author,
      createdAt: entry.createdAt,
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
      producerId: Number.isSafeInteger(row.producer_id)
        ? Number(row.producer_id)
        : null,
      producerName:
        typeof row.producer_name === "string" && row.producer_name.trim()
          ? row.producer_name.trim()
          : null,
    });
  }

  if (boundWithoutPolicy > 0) {
    console.warn(
      `[book-refresh] ${boundWithoutPolicy} bound order(s) missing issued policy numbers`,
    );
  }

  const contactKeys: BookContactKey[] = [];
  const seenKeys = new Set<string>();
  const companyDetails: BookCompanyDetail[] = [];
  for (const row of companyRows) {
    const accountId = `co-${row.id}`;
    if (!accountIds.has(accountId)) continue;
    companyDetails.push(companyDetailFromRow(row));
    for (const [kind, raw] of [
      ["email", row.search_emails],
      ["phone", row.search_phones],
    ] as const) {
      for (const entry of arrayValue(raw)) {
        const value = String(entry ?? "").trim();
        if (!value) continue;
        const dedupe = `${accountId}|${kind}|${value}`;
        if (seenKeys.has(dedupe)) continue;
        seenKeys.add(dedupe);
        contactKeys.push({ accountId, kind, value });
      }
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    source: "supabase companies/deals_v2/orders_temp",
    accounts,
    policies,
    orders,
    contactKeys,
    serviceNoteEntries,
    companyDetails,
    reportingWindows: parseReportingWindows(reportingWindowsRow),
    stageFieldsPresent: true,
    serviceNotesPresent: true,
    searchFieldsPresent: true,
    noteThreadsPresent: true,
    companyDetailsPresent: true,
  };
}

/** Run one read-only SQL statement through the Supabase Management API. */
async function runManagementQuery<T>(sql: string): Promise<T[]> {
  return runSupabaseManagementQuery<T>(sql, 120_000, {
    priority: "refresh",
  });
}

export function isRefreshConfigured(): boolean {
  return Boolean(process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF);
}

/**
 * Publish a completed book: atomic snapshot to disk, then into the loader
 * cache and SQLite through the same overlay path the boot seed uses.
 */
function publishBook(db: Database.Database, book: SupabaseBook): void {
  if (book.accounts.length === 0) throw new Error("refresh produced an empty book");

  // Atomic snapshot: the boot path and a mid-write crash both only ever see
  // a complete file.
  fs.mkdirSync(path.dirname(BOOK_PATH), { recursive: true });
  const tmp = `${BOOK_PATH}.tmp`;
  // Compact — at ~10k accounts a pretty-printed snapshot is >10MB.
  fs.writeFileSync(tmp, JSON.stringify(book) + "\n");
  fs.renameSync(tmp, BOOK_PATH);

  setSupabaseBookCache(book);
  syncAccountsAndPolicies(db);
}

/**
 * Operations metrics — the stats bar's New Orders / Bound / COIs Sent counters.
 * Refreshed on every tick, delta or not: a brand-new order usually arrives
 * before any deal is attached to it, so it is not yet book-eligible and no
 * amount of order-grain delta work would surface it. This is the read that
 * makes New Orders move the moment the order lands.
 */
async function refreshOperationsMetrics(): Promise<void> {
  const rows = await runManagementQuery<OperationsMetricsRow>(
    OPERATIONS_METRICS_SQL,
  );
  writeOperationsMetricsSnapshot(parseOperationsMetricsRow(rows[0]));
}

/**
 * One full refresh cycle: fetch the whole book → map → validate → publish.
 * Throws on failure; callers log and keep the last good book.
 *
 * Queries are issued serially rather than in parallel. Six concurrent
 * whole-book statements were the shape that tripped the Management API's rate
 * limit (`supabase_management_http_429` in the refresh log), and nothing here
 * needs them to overlap.
 *
 * The digest sweep runs *before* the book reads, not after, and that order is
 * load-bearing. A change landing mid-cycle then lands in the book but not in
 * the stored digests, so the next tick sees a mismatch and refetches those
 * rows — a redundant fetch. Sweeping afterwards would store a digest for a
 * change this cycle never fetched, and the next tick would consider it already
 * applied and skip it until the following full reconcile.
 */
export async function refreshBook(db: Database.Database): Promise<SupabaseBook> {
  const sweep = await fetchBookDigests();
  const companyRows = await runManagementQuery<CompanyRow>(accountsSql(null));
  const dealRows = await runManagementQuery<DealRow>(policiesSql(null));
  const orderRows = await runManagementQuery<OrderRow>(ordersSql(null));
  const serviceNoteRows = await runManagementQuery<ServiceNoteRow>(
    serviceNotesSql(null),
  );
  const reportingWindowRows = await runManagementQuery<ReportingWindowsRow>(
    REPORTING_WINDOWS_SQL,
  );
  const book = buildBook(
    companyRows,
    dealRows,
    orderRows,
    reportingWindowRows[0],
    serviceNoteRows,
  );
  publishBook(db, book);
  if (sweep.length > 0) writeBookDigests(db, sweep);
  await refreshOperationsMetrics();
  return book;
}

/**
 * Splice a scoped refresh into the book already in hand.
 *
 * `patch` is whatever `buildBook` produced from the delta rows, and the scopes
 * say which ids the patch is authoritative for. Everything in scope is dropped
 * from the base and replaced by the patch, so a row that was refetched and came
 * back ineligible (deleted between sweep and fetch) correctly disappears rather
 * than lingering as its old self.
 *
 * Accounts, policies and contact keys move together at company grain: a policy
 * set is only meaningful whole, and `primaryUwId` is derived from it.
 */
export function mergeBook(
  base: SupabaseBook,
  patch: SupabaseBook,
  scope: {
    orderIds: readonly number[];
    departedOrderIds: readonly number[];
    companyIds: readonly number[];
    departedCompanyIds: readonly number[];
  },
): SupabaseBook {
  const orderKeys = new Set(
    [...scope.orderIds, ...scope.departedOrderIds].map((id) => `order-${id}`),
  );
  const accountKeys = new Set(
    [...scope.companyIds, ...scope.departedCompanyIds].map((id) => `co-${id}`),
  );

  const accounts = base.accounts
    .filter((account) => !accountKeys.has(account.id))
    .concat(patch.accounts);
  const policies = base.policies
    .filter((policy) => !accountKeys.has(policy.accountId))
    .concat(patch.policies);
  const orders = base.orders
    .filter((order) => !orderKeys.has(order.id))
    .concat(patch.orders);
  const contactKeys = base.contactKeys
    .filter((key) => !accountKeys.has(key.accountId))
    .concat(patch.contactKeys);
  // Note threads and company details move at company grain like policies:
  // the scoped reads return each covered company complete, so the patch is
  // authoritative for every account it covers.
  const serviceNoteEntries = (base.serviceNoteEntries ?? [])
    .filter((entry) => !accountKeys.has(entry.accountId))
    .concat(patch.serviceNoteEntries ?? []);
  const companyDetails = (base.companyDetails ?? [])
    .filter((detail) => !accountKeys.has(detail.accountId))
    .concat(patch.companyDetails ?? []);

  return {
    fetchedAt: patch.fetchedAt,
    source: patch.source ?? base.source,
    accounts,
    policies,
    orders,
    contactKeys,
    serviceNoteEntries,
    companyDetails,
    schedules: base.schedules,
    // Only refetched when the cached windows have rolled over.
    reportingWindows: patch.reportingWindows ?? base.reportingWindows,
    stageFieldsPresent: true,
    serviceNotesPresent: true,
    searchFieldsPresent: true,
    noteThreadsPresent: true,
    companyDetailsPresent: true,
  };
}

/**
 * Reporting windows are relative to the Harper business day, so they expire on
 * their own even when nothing in the book changed. The soonest boundary is the
 * end of the Last 30 Days range (tomorrow, PT), and that rollover also covers
 * the weekly ones — so one comparison decides whether the tick has to spend a
 * request re-deriving them in Postgres.
 */
function reportingWindowsStale(book: SupabaseBook): boolean {
  const endsAt = book.reportingWindows?.ranges["last-30-days"]?.endsAt;
  if (!endsAt) return true;
  const boundary = Date.parse(endsAt);
  return !Number.isFinite(boundary) || Date.now() >= boundary;
}

export interface DeltaRefreshResult {
  book: SupabaseBook;
  delta: BookDelta;
  /** Requests spent against the shared Management API quota. */
  requests: number;
}

/**
 * One incremental refresh cycle.
 *
 * Sweep Harper for a digest per eligible order and company, diff it against the
 * digests this instance last stored, and fetch full rows only for what moved.
 * An unchanged book costs a single sweep plus the metrics read; nothing is
 * written, and the 22MB snapshot and 10k-row SQLite upsert are skipped
 * entirely, which is what makes a two-minute cadence affordable.
 *
 * Throws when there is no book to merge into — the caller falls back to a full
 * refresh, which is also the bootstrap path on a clean instance.
 */
export async function refreshBookDelta(
  db: Database.Database,
): Promise<DeltaRefreshResult> {
  const base = loadSupabaseBook();
  if (!base) throw new Error("no book to merge into — full refresh required");

  const sweep = await fetchBookDigests();
  if (sweep.length === 0) throw new Error("sweep returned no rows");
  const delta = diffBookDigests(readBookDigests(db), sweep);
  let requests = 1;

  if (isEmptyDelta(delta) && !reportingWindowsStale(base)) {
    await refreshOperationsMetrics();
    // The stored digests already match the sweep; nothing to write.
    return { book: base, delta, requests: requests + 1 };
  }

  // Order payloads come first: they carry the company id every other scoped
  // read needs, including for an order that arrived on a company this instance
  // has never seen.
  const orderRows =
    delta.changedOrderIds.length > 0
      ? await runManagementQuery<OrderRow>(ordersSql(delta.changedOrderIds))
      : [];
  if (delta.changedOrderIds.length > 0) requests += 1;

  const companyIds = [
    ...new Set([
      ...delta.changedCompanyIds,
      ...orderRows.map((row) => Number(row.company_id)),
    ]),
  ].filter((id) => Number.isSafeInteger(id) && id > 0);

  let companyRows: CompanyRow[] = [];
  let dealRows: DealRow[] = [];
  let serviceNoteRows: ServiceNoteRow[] = [];
  if (companyIds.length > 0) {
    companyRows = await runManagementQuery<CompanyRow>(accountsSql(companyIds));
    dealRows = await runManagementQuery<DealRow>(policiesSql(companyIds));
    serviceNoteRows = await runManagementQuery<ServiceNoteRow>(
      serviceNotesSql(companyIds),
    );
    requests += 3;
  }

  let reportingWindowRow: ReportingWindowsRow | undefined;
  if (reportingWindowsStale(base)) {
    const rows = await runManagementQuery<ReportingWindowsRow>(
      REPORTING_WINDOWS_SQL,
    );
    reportingWindowRow = rows[0];
    requests += 1;
  }

  const patch = buildBook(
    companyRows,
    dealRows,
    orderRows,
    reportingWindowRow,
    serviceNoteRows,
  );
  const book = mergeBook(base, patch, {
    orderIds: delta.changedOrderIds,
    departedOrderIds: delta.departedOrderIds,
    companyIds,
    departedCompanyIds: delta.departedCompanyIds,
  });

  publishBook(db, book);
  // Only after the merged book is on disk and in SQLite: a digest stored ahead
  // of its payload would make the next tick skip data it never fetched.
  writeBookDigests(db, sweep);
  await refreshOperationsMetrics();
  return { book, delta, requests: requests + 1 };
}

/** Interactive write-through timeout — a POST response is waiting on this. */
const NOTE_WRITE_THROUGH_TIMEOUT_MS = 8_000;

/**
 * Targeted note-mirror refresh for one company, used as the write-through
 * after a service-note POST: the author must see their note on the very next
 * read, not on the next tick. Updates only the SQLite mirror — the snapshot
 * stays owned by the refresh cycle, whose next sweep sees the note's digest
 * change and folds the same rows in properly. A publish racing this write can
 * briefly revert the mirror, and that same digest mismatch heals it one tick
 * later.
 */
export async function refreshCompanyServiceNotes(
  db: Database.Database,
  companyId: number,
): Promise<void> {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("invalid company id for note refresh");
  }
  const rows = await runSupabaseManagementQuery<ServiceNoteRow>(
    serviceNotesSql([companyId]),
    NOTE_WRITE_THROUGH_TIMEOUT_MS,
  );
  const entries = rows
    .map(serviceNoteEntryFromRow)
    .filter((entry): entry is BookServiceNoteEntry => entry !== null);
  replaceAccountServiceNotes(db, `co-${companyId}`, entries);
}

function bookSummary(book: SupabaseBook): string {
  const active = book.accounts.filter((a) => a.status === "active").length;
  const cancelled = book.accounts.filter((a) => a.status === "cancelled").length;
  const preBind = book.accounts.length - active - cancelled;
  const byStatus = new Map<string, number>();
  for (const o of book.orders) {
    byStatus.set(o.bindStatus, (byStatus.get(o.bindStatus) ?? 0) + 1);
  }
  return (
    `${book.accounts.length} accounts (${active} active, ${preBind} pre_bind, ` +
    `${cancelled} cancelled), ${book.policies.length} policies, ` +
    `${book.orders.length} orders (${byStatus.get("bound") ?? 0} bound, ` +
    `${byStatus.get("pending") ?? 0} pending, ${byStatus.get("lost") ?? 0} lost)`
  );
}

export type RemoteCacheRevalidationTarget =
  | {
      kind: "order-detail";
      companyId: number;
      orderId: number;
    }
  | {
      kind: "payment-history";
      companyId: number;
      offset: number;
      limit: number;
    };

const MAX_REMOTE_CACHE_REVALIDATIONS_PER_TICK = 6;

/**
 * Previously viewed live-enrichment pages only. Oldest entries go first, and
 * work is bounded so a delta tick cannot turn into another whole-book pull.
 */
export function selectChangedRemoteCacheTargets(
  db: Database.Database,
  delta: BookDelta,
  limit = MAX_REMOTE_CACHE_REVALIDATIONS_PER_TICK,
): RemoteCacheRevalidationTarget[] {
  if (limit <= 0) return [];
  const changedOrders = new Set(delta.changedOrderIds);
  const affectedCompanies = new Set(delta.changedCompanyIds);
  if (delta.changedOrderIds.length > 0) {
    const placeholders = delta.changedOrderIds.map(() => "?").join(", ");
    const owners = db
      .prepare(
        `SELECT account_id FROM book_orders
         WHERE harper_order_id IN (${placeholders})`,
      )
      .all(...delta.changedOrderIds) as Array<{ account_id: string }>;
    for (const owner of owners) {
      const match = owner.account_id.match(/^co-(\d+)$/);
      if (match) affectedCompanies.add(Number(match[1]));
    }
  }
  const rows = db
    .prepare(
      `SELECT cache_key
       FROM remote_cache
       WHERE cache_key LIKE 'order-detail:v2:%'
          OR cache_key LIKE 'payments:v1:%'
       ORDER BY fetched_at ASC`,
    )
    .all() as Array<{ cache_key: string }>;
  const parsed = rows.flatMap(
    (row): Array<RemoteCacheRevalidationTarget> => {
      const detail = row.cache_key.match(/^order-detail:v2:(\d+):(\d+)$/);
      if (detail) {
        const companyId = Number(detail[1]);
        const orderId = Number(detail[2]);
        if (!changedOrders.has(orderId)) return [];
        affectedCompanies.add(companyId);
        return [{ kind: "order-detail", companyId, orderId }];
      }
      const payment = row.cache_key.match(/^payments:v1:(\d+):(\d+):(\d+)$/);
      if (!payment) return [];
      return [
        {
          kind: "payment-history",
          companyId: Number(payment[1]),
          offset: Number(payment[2]),
          limit: Number(payment[3]),
        },
      ];
    },
  );
  return parsed
    .filter(
      (target) =>
        target.kind === "order-detail" ||
        affectedCompanies.has(target.companyId),
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}

async function revalidateChangedRemoteCaches(
  db: Database.Database,
  delta: BookDelta,
): Promise<void> {
  const targets = selectChangedRemoteCacheTargets(db, delta);
  if (targets.length === 0) return;
  const [{ revalidateCachedOrderDetail }, { revalidateCachedPaymentHistory }] =
    await Promise.all([
      import("../order-detail.server"),
      import("../company-detail.server"),
    ]);

  for (const target of targets) {
    try {
      if (target.kind === "order-detail") {
        await revalidateCachedOrderDetail(target);
      } else {
        await revalidateCachedPaymentHistory(target);
      }
    } catch (cause) {
      console.warn("remote_cache_revalidate_failed", {
        kind: target.kind,
        companyId: target.companyId,
        errorCategory:
          cause instanceof Error ? cause.message : "unknown_remote_cache_error",
      });
      if (isRateLimited(cause)) break;
    }
  }
}

/**
 * Refresh bookkeeping that has to outlive dev-mode module re-evaluation, so a
 * hot reload cannot start a second timer or lose the reconcile clock.
 */
interface RefreshState {
  running: boolean;
  /** Ticks are skipped until this moment after the quota refuses us. */
  backoffUntil: number;
  consecutiveRateLimits: number;
}

const STATE = Symbol.for("stepbro.bookRefreshState");

function refreshState(): RefreshState {
  const g = globalThis as Record<symbol, RefreshState | undefined>;
  g[STATE] ??= {
    running: false,
    backoffUntil: 0,
    consecutiveRateLimits: 0,
  };
  return g[STATE];
}

/**
 * Ceiling for the doubling fallback, used only when a refusal arrives without
 * a reset window to wait out. Long enough to let a shared quota recover.
 */
const MAX_BACKOFF_MS = 16 * 60 * 1000;

async function runRefreshSafely(
  db: Database.Database,
  trigger: string,
  mode: "full" | "delta",
) {
  const state = refreshState();
  // A tick that overruns its interval must not stack a second cycle on top of
  // itself — that is how one slow refresh turns into a burst.
  if (state.running) {
    console.warn(`[book-refresh] ${trigger}: previous cycle still running — skipped`);
    return;
  }
  if (Date.now() < state.backoffUntil) return;
  state.running = true;

  try {
    let summary: string;
    let revalidationDelta: BookDelta | null = null;
    if (mode === "full") {
      const book = await refreshBook(db);
      summary = `full — ${bookSummary(book)}`;
    } else {
      const { book, delta, requests } = await refreshBookDelta(db);
      revalidationDelta = delta;
      summary = isEmptyDelta(delta)
        ? `no change (${requests} request(s))`
        : `${describeDelta(delta)} — ${bookSummary(book)} (${requests} request(s))`;
    }
    state.consecutiveRateLimits = 0;
    state.backoffUntil = 0;

    const completedAt = new Date().toISOString();
    try {
      recordBookRefreshSuccess(completedAt, { full: mode === "full" });
    } catch (statusError) {
      console.error(
        "[book-refresh] refresh succeeded but sync metadata could not be recorded:",
        statusError instanceof Error ? statusError.message : statusError,
      );
    }
    console.log(`[book-refresh] ${trigger}: ${summary}`);
    if (revalidationDelta && !isEmptyDelta(revalidationDelta)) {
      void revalidateChangedRemoteCaches(db, revalidationDelta);
    }
  } catch (err) {
    if (isRateLimited(err)) {
      state.consecutiveRateLimits += 1;
      // The quota refuses for the remainder of its minute and reports how much
      // of that is left, so waiting past it buys nothing and costs freshness.
      // Doubling is only for a refusal that arrived without a window.
      const wait =
        rateLimitResetMs(err) ??
        Math.min(
          REFRESH_INTERVAL_MS * 2 ** state.consecutiveRateLimits,
          MAX_BACKOFF_MS,
        );
      state.backoffUntil = Date.now() + wait;
      console.warn(
        `[book-refresh] ${trigger}: rate limited — backing off ${Math.round(
          wait / 1000,
        )}s (keeping last good book)`,
      );
    } else {
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
  } finally {
    state.running = false;
  }
}

function snapshotAgeMs(): number {
  try {
    return Date.now() - fs.statSync(BOOK_PATH).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * A delta tick can only splice into a book it already has, described by digests
 * it already stored. Anything else — a clean instance, a snapshot from before
 * the IQ Stage / Service Note / search fields shipped, or a digest table that
 * has not been populated yet — needs the whole book first.
 *
 * The reconcile clock is read from disk rather than from process memory so a
 * restart resumes the schedule. Deriving it in memory meant every boot spent a
 * whole-book pull, which in dev is every hot restart and was enough on its own
 * to exhaust the shared quota.
 */
function fullRefreshRequired(db: Database.Database): boolean {
  const snapshot = loadSupabaseBook();
  if (
    !snapshot ||
    snapshot.stageFieldsPresent === false ||
    snapshot.serviceNotesPresent === false ||
    snapshot.searchFieldsPresent === false ||
    snapshot.noteThreadsPresent === false ||
    snapshot.companyDetailsPresent === false
  ) {
    return true;
  }
  if (readBookDigests(db).size === 0) return true;
  const lastFullAt = readBookRefreshStatus().lastFullRefreshAt;
  const lastFull = lastFullAt ? Date.parse(lastFullAt) : Number.NaN;
  if (!Number.isFinite(lastFull)) return true;
  return Date.now() - lastFull >= FULL_RECONCILE_INTERVAL_MS;
}

// Survives dev-mode module re-evaluation — one timer per process, ever.
const SCHEDULED = Symbol.for("stepbro.bookRefreshScheduled");

/**
 * Start the two-minute refresh loop (idempotent per process). Called from
 * `getDb()` so anything that touches the database keeps the book current.
 *
 * Each tick is a delta: one digest sweep, then scoped reads for whatever moved.
 * Every half hour a tick pulls the whole book instead, as a reconcile against
 * anything the digest cannot see (see `FULL_RECONCILE_INTERVAL_MS`).
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

  const tick = (trigger: string) => {
    const mode = fullRefreshRequired(db) ? "full" : "delta";
    void runRefreshSafely(db, trigger, mode);
  };

  // Boot catch-up runs async, so the first page load is not held hostage by the
  // network. A snapshot younger than one tick is already current enough.
  if (fullRefreshRequired(db) || snapshotAgeMs() > REFRESH_INTERVAL_MS) {
    tick("boot");
  }

  const timer = setInterval(() => tick("interval"), REFRESH_INTERVAL_MS);
  timer.unref();
}
