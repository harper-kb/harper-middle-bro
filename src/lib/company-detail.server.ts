import "server-only";

import { resolveCompanyTimeZone } from "./company-time-zone";
import {
  META_COMPANY_DETAILS_SYNCED_AT,
  readBookMeta,
} from "./db/book-meta";
import { getDb } from "./db/connection";
import {
  runSupabaseManagementQuery,
  type SupabaseManagementQueryPriority,
} from "./supabase-management.server";
import {
  subscribeToSharedInFlight,
  type SharedInFlight,
} from "./shared-inflight.server";
import type {
  CompanyContact,
  CompanyOverview,
  PaymentHistoryItem,
  PaymentHistoryPage,
  PaymentHistoryStatus,
} from "./company-detail-types";

const OVERVIEW_TTL_MS = 5 * 60_000;
const OVERVIEW_STALE_TTL_MS = 30 * 60_000;
/** Age under which a persisted payment page is served as-is, no refetch. */
const PAYMENT_TTL_MS = 60_000;
/** Sweep horizon for persisted payment/detail payloads. */
const REMOTE_CACHE_PRUNE_MS = 7 * 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 200;
/** One bounded retry for transient Management API failures. */
const RETRY_DELAY_MS = 350;

type CacheEntry<T> = { value: T; freshUntil: number; staleUntil: number };

// The live-fallback overview cache (used only until the book mirror syncs)
// stays in memory; payment pages persist in SQLite's remote_cache instead,
// so a page the operator saw before a restart answers instantly after one.
const overviewCache = new Map<number, CacheEntry<CompanyOverview>>();
const overviewInFlight = new Map<number, Promise<CompanyOverview>>();
type InFlightPaymentHistory = SharedInFlight<PaymentHistoryPage> & {
  requestId: symbol;
};

const paymentInFlight = new Map<string, InFlightPaymentHistory>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(fetcher: () => Promise<T>): Promise<T> {
  try {
    return await fetcher();
  } catch (cause) {
    // Retrying inside a known quota window only doubles the wait. Let the
    // caller return Retry-After while the shared gate protects the window.
    if (
      cause instanceof Error &&
      (cause.message === "supabase_management_http_429" ||
        cause.name === "AbortError")
    ) {
      throw cause;
    }
    await delay(RETRY_DELAY_MS);
    return await fetcher();
  }
}

type CompanyRow = {
  id: number | string;
  company_name: string | null;
  company_street_address_1: string | null;
  company_street_address_2: string | null;
  company_city: string | null;
  company_state: string | null;
  company_state_code: string | null;
  company_postal_code: string | null;
  company_timezone: string | null;
  producer_id: number | string | null;
  producer_first_name: string | null;
  producer_last_name: string | null;
};

type ContactRow = {
  id: number | string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_primary_email: string | null;
  contact_primary_phone: string | null;
};

type PaymentRow = {
  event_id: string;
  event_kind: "payment" | "refund";
  raw_status: string | null;
  /**
   * `public.payments.completed` for rows backed by the payment-link registry.
   * It is written by the processor's transfer-succeeded webhook, so it can be
   * ahead of a CLS row that still says initiated/processing.
   */
  link_completed: boolean | null;
  amount: string | number | null;
  currency: string | null;
  payment_purpose: string | null;
  is_payment_link: boolean;
  occurred_at: string | null;
  created_at: string | null;
  order_id: number | string | null;
  safe_reference: string | null;
  created_by: string | null;
  total_count: number | string;
  settled_count?: number | string | null;
  settled_amount?: number | string | null;
  settled_currency?: string | null;
};

function trim(value: string | null | undefined): string | null {
  const next = value?.trim() ?? "";
  return next || null;
}

function assertCompanyId(companyId: number): void {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("invalid_company_id");
  }
}

function pruneCache<K, V>(cache: Map<K, CacheEntry<V>>): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.staleUntil <= now) cache.delete(key);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function decimalToCents(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const roundedFraction = `${fraction}000`.slice(0, 3);
  let cents = Number(whole) * 100 + Number(roundedFraction.slice(0, 2));
  if (Number(roundedFraction[2]) >= 5) cents += 1;
  if (sign === "-") cents *= -1;
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * One deliberate mapping for every raw status vocabulary in the payment read
 * model: CLS (`cpq.payment`: initiated/processing/settled/failed/returned/
 * cancelled), the payment-link registry (`public.payments`: completed/pending
 * derived from its boolean), and legacy Ascend (`public.payments_ascend`:
 * paid/void/processing_payment). Unmapped values stay `unknown` rather than
 * being guessed by substring.
 */
function paymentStatus(
  kind: PaymentRow["event_kind"],
  rawStatus: string,
  linkCompleted: boolean,
): PaymentHistoryStatus {
  if (kind === "refund") {
    if (rawStatus === "completed") return "refunded";
    if (rawStatus === "pending") return "refund_pending";
    if (rawStatus === "failed") return "refund_failed";
    return "unknown";
  }
  const base: PaymentHistoryStatus = (() => {
    if (rawStatus === "initiated" || rawStatus === "pending") {
      return "link_sent";
    }
    if (rawStatus === "processing" || rawStatus === "processing_payment") {
      return "processing";
    }
    if (
      rawStatus === "settled" ||
      rawStatus === "completed" ||
      rawStatus === "paid"
    ) {
      return "settled";
    }
    if (rawStatus === "failed") return "failed";
    if (rawStatus === "returned") return "returned";
    if (rawStatus === "cancelled" || rawStatus === "void") return "voided";
    return "unknown";
  })();
  // The registry's completed flag is written by the processor's
  // transfer-succeeded webhook; it outranks a CLS row that has not yet moved
  // past initiated/processing. Terminal CLS states (failed, returned,
  // cancelled) are never overridden.
  if (
    linkCompleted &&
    (base === "link_sent" || base === "processing" || base === "unknown")
  ) {
    return "settled";
  }
  return base;
}

function paymentType(
  kind: PaymentRow["event_kind"],
  isPaymentLink: boolean,
): PaymentHistoryItem["type"] {
  if (kind === "refund") return "refund";
  return isPaymentLink ? "payment_link" : "payment";
}

async function fetchCompanyOverview(companyId: number): Promise<CompanyOverview> {
  const companySql = `
    SELECT
      c.id,
      c.company_name,
      c.company_street_address_1,
      c.company_street_address_2,
      c.company_city,
      c.company_state,
      company_state.abbreviation AS company_state_code,
      c.company_postal_code,
      c.company_timezone,
      producer.id AS producer_id,
      producer.first_name AS producer_first_name,
      producer.last_name AS producer_last_name
    FROM public.companies c
    LEFT JOIN LATERAL (
      SELECT s.abbreviation
      FROM public.states s
      WHERE LOWER(TRIM(s.name)) = LOWER(TRIM(c.company_state))
         OR LOWER(TRIM(s.abbreviation)) = LOWER(TRIM(c.company_state))
      ORDER BY s.id ASC
      LIMIT 1
    ) company_state ON true
    LEFT JOIN LATERAL (
      SELECT p.id, p.first_name, p.last_name
      FROM public.producers p
      WHERE p.user_slug = NULLIF(TRIM(c.producer_assigned), '')
        AND COALESCE(p.active, false) = true
      ORDER BY p.id DESC
      LIMIT 1
    ) producer ON true
    WHERE c.id = ${companyId}
      AND COALESCE(c.is_testing_user, false) = false
    LIMIT 1
  `;
  const contactsSql = `
    SELECT
      cc.id,
      cc.contact_first_name,
      cc.contact_last_name,
      cc.contact_primary_email,
      cc.contact_primary_phone
    FROM public.companies_contacts cc
    WHERE cc.company_id = ${companyId}
      AND (
        NULLIF(TRIM(cc.contact_first_name), '') IS NOT NULL
        OR NULLIF(TRIM(cc.contact_last_name), '') IS NOT NULL
        OR NULLIF(TRIM(cc.contact_primary_email), '') IS NOT NULL
        OR NULLIF(TRIM(cc.contact_primary_phone), '') IS NOT NULL
      )
    ORDER BY cc.created_at ASC NULLS LAST, cc.id ASC
    LIMIT 200
  `;

  const [companyRows, contactRows] = await Promise.all([
    runSupabaseManagementQuery<CompanyRow>(companySql, 15_000),
    runSupabaseManagementQuery<ContactRow>(contactsSql, 15_000),
  ]);
  const row = companyRows[0];
  if (!row) throw new Error("company_detail_not_found");
  const companyName = trim(row.company_name);
  if (!companyName) throw new Error("company_name_missing");

  const contacts: CompanyContact[] = contactRows.flatMap((contact) => {
    const id = Number(contact.id);
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    const name =
      [trim(contact.contact_first_name), trim(contact.contact_last_name)]
        .filter(Boolean)
        .join(" ") || "Unnamed contact";
    return [
      {
        id,
        name,
        role: null,
        email: trim(contact.contact_primary_email),
        phone: trim(contact.contact_primary_phone),
        isPrimary: false,
      },
    ];
  });

  const producerId = Number(row.producer_id);
  const producerName = [
    trim(row.producer_first_name),
    trim(row.producer_last_name),
  ]
    .filter(Boolean)
    .join(" ");
  const timeZone = resolveCompanyTimeZone({
    storedTimeZone: row.company_timezone,
    state: trim(row.company_state_code) ?? row.company_state,
  });
  if (!timeZone.timeZone) {
    console.info("company_timezone_unavailable", {
      companyId,
      reason: timeZone.unavailableReason,
    });
  }

  return {
    companyId,
    name: companyName,
    dba: null,
    producer:
      Number.isSafeInteger(producerId) && producerId > 0 && producerName
        ? { id: producerId, name: producerName }
        : null,
    location: {
      address1: trim(row.company_street_address_1),
      address2: trim(row.company_street_address_2),
      city: trim(row.company_city),
      state: trim(row.company_state),
      stateCode: trim(row.company_state_code),
      postalCode: trim(row.company_postal_code),
      country: null,
    },
    timeZone: {
      id: timeZone.timeZone,
      source: timeZone.source,
      unavailableReason: timeZone.unavailableReason,
    },
    contacts,
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
}

/**
 * The overview straight from the SQLite book mirror — no network. Null when
 * the mirror has not synced yet or the account is not (or no longer) in the
 * book, in which case the caller falls back to the legacy live read.
 */
export function loadLocalCompanyOverview(
  companyId: number,
): CompanyOverview | null {
  const db = getDb();
  const syncedAt = readBookMeta(db, META_COMPANY_DETAILS_SYNCED_AT);
  if (!syncedAt) return null;
  const accountId = `co-${companyId}`;
  const account = db
    .prepare(`SELECT name, dba FROM accounts WHERE id = ?`)
    .get(accountId) as { name: string; dba: string | null } | undefined;
  const detail = db
    .prepare(
      `SELECT address1, address2, city, state, state_code, postal_code,
              time_zone, producer_id, producer_name
       FROM book_company_details WHERE account_id = ?`,
    )
    .get(accountId) as
    | {
        address1: string | null;
        address2: string | null;
        city: string | null;
        state: string | null;
        state_code: string | null;
        postal_code: string | null;
        time_zone: string | null;
        producer_id: number | null;
        producer_name: string | null;
      }
    | undefined;
  if (!account || !detail) return null;

  const contactRows = db
    .prepare(
      `SELECT contact_id, name, email, phone
       FROM book_contacts WHERE account_id = ?
       ORDER BY position ASC`,
    )
    .all(accountId) as {
    contact_id: number;
    name: string;
    email: string | null;
    phone: string | null;
  }[];
  const contacts: CompanyContact[] = contactRows.map((row) => ({
    id: row.contact_id,
    name: row.name,
    role: null,
    email: row.email,
    phone: row.phone,
    isPrimary: false,
  }));

  const timeZone = resolveCompanyTimeZone({
    storedTimeZone: detail.time_zone,
    state: detail.state_code ?? detail.state,
  });

  return {
    companyId,
    name: account.name,
    dba: account.dba,
    producer:
      detail.producer_id !== null && detail.producer_name
        ? { id: detail.producer_id, name: detail.producer_name }
        : null,
    location: {
      address1: detail.address1,
      address2: detail.address2,
      city: detail.city,
      state: detail.state,
      stateCode: detail.state_code,
      postalCode: detail.postal_code,
      country: null,
    },
    timeZone: {
      id: timeZone.timeZone,
      source: timeZone.source,
      unavailableReason: timeZone.unavailableReason,
    },
    contacts,
    fetchedAt: syncedAt,
    stale: false,
  };
}

export async function loadCompanyOverview(
  companyId: number,
): Promise<CompanyOverview> {
  assertCompanyId(companyId);
  // Local-first: the book mirror answers instantly once synced, and the
  // two-minute refresh keeps it current. The live path below survives as the
  // fallback for the window before the first mirrored snapshot lands.
  const local = loadLocalCompanyOverview(companyId);
  if (local) return local;
  const cached = overviewCache.get(companyId);
  if (cached && cached.freshUntil > Date.now()) return cached.value;
  const existing = overviewInFlight.get(companyId);
  if (existing) return existing;

  const request = fetchWithRetry(() => fetchCompanyOverview(companyId))
    .then((value) => {
      pruneCache(overviewCache);
      const now = Date.now();
      overviewCache.set(companyId, {
        value,
        freshUntil: now + OVERVIEW_TTL_MS,
        staleUntil: now + OVERVIEW_STALE_TTL_MS,
      });
      return value;
    })
    .catch((cause) => {
      if (cached && cached.staleUntil > Date.now()) {
        return { ...cached.value, stale: true };
      }
      throw cause;
    })
    .finally(() => overviewInFlight.delete(companyId));
  overviewInFlight.set(companyId, request);
  return request;
}

/**
 * Canonical company payment history.
 *
 * A displayed row is one of:
 * - one canonical row per payment link (`public.payments` is the registry
 *   every producer surface — Big Brother, payments-service, slash pay —
 *   writes into, attached directly by `company_id` with a globally unique
 *   `payment_link_id`), merged with its CLS record (`cpq.payment`, joined on
 *   `processor_reference_id = payment_link_id`) when one exists;
 * - a CLS payment with no link (financed portions, direct charges), reached
 *   through every account mapped to the company — not only the primary;
 * - a legacy Ascend payment (`public.payments_ascend`, by `company_id`);
 * - a refund (`cpq.refund`).
 *
 * Duplicate CLS rows for the same link and transfer collapse into one row; a
 * link legitimately reused for a second transfer keeps a row per transfer.
 * Timestamps prefer the state-specific column (settled_at for settled,
 * failed_at for failed/returned, created for link-sent) with documented
 * fallbacks. Order attribution uses invoice.legacy_order_id when CLS has it;
 * registry-only rows attribute through a non-deleted deal's transfer_id or an
 * unambiguous match to an order's designated client_initial_payment, else
 * stay unattributed rather than guessing.
 */
async function fetchPaymentHistory(
  companyId: number,
  offset: number,
  limit: number,
  priority: SupabaseManagementQueryPriority,
  signal?: AbortSignal,
): Promise<PaymentHistoryPage> {
  const sql = `
    WITH company_accounts AS (
      SELECT DISTINCT account_id
      FROM backwards_compatibility.company_account
      WHERE company_id = ${companyId}
    ),
    company_orders AS (
      SELECT ot.id, ot.client_initial_payment
      FROM public.orders_temp ot
      WHERE ot.company_id = ${companyId}
        AND COALESCE(ot.is_deleted, false) = false
    ),
    link_records AS (
      SELECT
        pp.id,
        NULLIF(TRIM(pp.payment_link_id), '') AS payment_link_id,
        CASE
          WHEN pp."amount_USD" ~ '^[0-9]+(\\.[0-9]+)?$' THEN pp."amount_USD"
        END AS amount,
        COALESCE(pp.completed, false) AS completed,
        NULLIF(TRIM(pp.created_by), '') AS created_by,
        NULLIF(TRIM(pp.transfer_id), '') AS transfer_id,
        COALESCE(pp.created_at, pp.updated_at) AS created_at,
        COALESCE(pp.updated_at, pp.created_at) AS updated_at
      FROM public.payments pp
      WHERE pp.company_id = ${companyId}
        AND COALESCE(
          NULLIF(TRIM(pp.payment_link_id), ''),
          NULLIF(TRIM(pp.transfer_id), '')
        ) IS NOT NULL
    ),
    cls_rows AS (
      SELECT
        p.id,
        p.status,
        p.amount,
        p.currency,
        p.payment_purpose,
        p.processor_reference_id,
        p.payment_reference,
        p.payment_link_key,
        p.link_url,
        p.initiated_at,
        p.processing_at,
        p.settled_at,
        p.failed_at,
        p.cancelled_at,
        p.created_at,
        p.updated_at,
        invoice.legacy_order_id,
        CASE
          WHEN p.processor_reference_id LIKE 'payment_link_%'
          THEN p.processor_reference_id
        END AS link_ref
      FROM cpq.payment p
      LEFT JOIN insurance.invoice invoice ON invoice.id = p.invoice_id
      WHERE p.account_id IN (SELECT account_id FROM company_accounts)
        OR p.processor_reference_id IN (
          SELECT payment_link_id FROM link_records
          WHERE payment_link_id IS NOT NULL
        )
    ),
    cls_ranked AS (
      SELECT
        c.*,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(c.link_ref, 'cls-row:' || c.id::text)
          ORDER BY (c.status = 'settled') DESC,
            c.updated_at DESC NULLS LAST, c.id DESC
        ) AS link_rank,
        FIRST_VALUE(c.payment_reference) OVER (
          PARTITION BY COALESCE(c.link_ref, 'cls-row:' || c.id::text)
          ORDER BY (c.status = 'settled') DESC,
            c.updated_at DESC NULLS LAST, c.id DESC
        ) AS canonical_reference
      FROM cls_rows c
    ),
    cls_primary AS (
      SELECT * FROM cls_ranked WHERE link_rank = 1
    ),
    cls_extra AS (
      -- A link ref reused for a second, genuinely different transfer keeps
      -- its own row; duplicate CLS rows for the same transfer collapse.
      SELECT * FROM cls_ranked
      WHERE link_rank > 1
        AND payment_reference IS DISTINCT FROM canonical_reference
    ),
    link_order_candidates AS (
      SELECT
        l.payment_link_id,
        deal.order_number::bigint AS order_id,
        1 AS precedence
      FROM link_records l
      JOIN public.deals_v2 deal
        ON l.transfer_id IS NOT NULL
        AND deal.transfer_id = l.transfer_id
        AND deal.company_id = ${companyId}
        AND COALESCE(deal.is_deleted, false) = false
        AND deal.order_number IS NOT NULL
      WHERE l.payment_link_id IS NOT NULL

      UNION ALL

      SELECT l.payment_link_id, ord.id::bigint, 2
      FROM link_records l
      JOIN company_orders ord
        ON ord.client_initial_payment IS NOT NULL
        AND l.amount IS NOT NULL
        AND ord.client_initial_payment = l.amount::numeric
      WHERE l.payment_link_id IS NOT NULL
    ),
    link_order_map AS (
      -- Strongest unambiguous evidence wins; an amount matching two orders
      -- attributes to neither.
      SELECT DISTINCT ON (payment_link_id) payment_link_id, order_id
      FROM (
        SELECT payment_link_id, precedence, MIN(order_id) AS order_id
        FROM link_order_candidates
        GROUP BY payment_link_id, precedence
        HAVING COUNT(DISTINCT order_id) = 1
      ) unambiguous
      ORDER BY payment_link_id, precedence ASC
    ),
    events AS (
      SELECT
        COALESCE(
          'link:' || COALESCE(l.payment_link_id, c.link_ref),
          'payment:' || c.id::text
        ) AS event_id,
        'payment'::text AS event_kind,
        COALESCE(
          c.status,
          CASE WHEN l.completed THEN 'completed' ELSE 'pending' END
        ) AS raw_status,
        COALESCE(l.completed, false) AS link_completed,
        COALESCE(c.amount::text, l.amount) AS amount,
        COALESCE(NULLIF(c.currency, ''), 'USD') AS currency,
        c.payment_purpose,
        (
          l.id IS NOT NULL
          OR c.link_ref IS NOT NULL
          OR c.link_url IS NOT NULL
          OR NULLIF(c.payment_link_key, '') IS NOT NULL
        ) AS is_payment_link,
        CASE
          WHEN c.id IS NULL THEN
            CASE WHEN l.completed THEN l.updated_at ELSE l.created_at END
          WHEN l.completed IS TRUE AND c.status IN ('initiated', 'processing')
            THEN COALESCE(c.settled_at, l.updated_at, c.updated_at, c.created_at)
          WHEN c.status IN ('returned', 'failed')
            THEN COALESCE(c.failed_at, c.updated_at, c.created_at)
          WHEN c.status = 'settled'
            THEN COALESCE(c.settled_at, c.updated_at, c.created_at)
          WHEN c.status = 'cancelled'
            THEN COALESCE(c.cancelled_at, c.updated_at, c.created_at)
          WHEN c.status = 'processing'
            THEN COALESCE(c.processing_at, c.updated_at, c.created_at)
          ELSE COALESCE(c.initiated_at, c.created_at, l.created_at)
        END AS occurred_at_ts,
        COALESCE(c.created_at, l.created_at) AS created_at_ts,
        COALESCE(c.legacy_order_id::bigint, map.order_id) AS order_id,
        RIGHT(
          COALESCE(
            NULLIF(c.processor_reference_id, ''),
            NULLIF(c.payment_reference, ''),
            l.payment_link_id,
            l.transfer_id,
            c.id::text,
            l.id::text
          ),
          6
        ) AS safe_reference,
        l.created_by
      FROM link_records l
      FULL JOIN cls_primary c ON c.link_ref = l.payment_link_id
      LEFT JOIN link_order_map map
        ON map.payment_link_id = l.payment_link_id

      UNION ALL

      SELECT
        'payment:' || c.id::text,
        'payment',
        c.status,
        false,
        c.amount::text,
        COALESCE(NULLIF(c.currency, ''), 'USD'),
        c.payment_purpose,
        true,
        CASE
          WHEN c.status IN ('returned', 'failed')
            THEN COALESCE(c.failed_at, c.updated_at, c.created_at)
          WHEN c.status = 'settled'
            THEN COALESCE(c.settled_at, c.updated_at, c.created_at)
          WHEN c.status = 'cancelled'
            THEN COALESCE(c.cancelled_at, c.updated_at, c.created_at)
          WHEN c.status = 'processing'
            THEN COALESCE(c.processing_at, c.updated_at, c.created_at)
          ELSE COALESCE(c.initiated_at, c.created_at)
        END,
        c.created_at,
        c.legacy_order_id::bigint,
        RIGHT(
          COALESCE(
            NULLIF(c.processor_reference_id, ''),
            NULLIF(c.payment_reference, ''),
            c.id::text
          ),
          6
        ),
        NULL
      FROM cls_extra c

      UNION ALL

      SELECT
        'ascend:' || ascend.id::text,
        'payment',
        ascend.status,
        false,
        ROUND(ascend."amount_USD"::numeric, 2)::text,
        'USD',
        ascend.payment_option,
        false,
        ascend.updated_at,
        ascend.updated_at,
        NULL::bigint,
        RIGHT(COALESCE(ascend.pid::text, ascend.id::text), 6),
        NULLIF(TRIM(ascend.producer), '')
      FROM public.payments_ascend ascend
      WHERE ascend.company_id = ${companyId}

      UNION ALL

      SELECT
        'refund:' || refund.id::text,
        'refund',
        refund.status,
        false,
        refund.amount::text,
        COALESCE(NULLIF(refund.currency, ''), 'USD'),
        refund.reason,
        false,
        CASE refund.status
          WHEN 'completed' THEN COALESCE(refund.settled_at, refund.updated_at, refund.created_at)
          WHEN 'failed' THEN COALESCE(refund.failed_at, refund.updated_at, refund.created_at)
          ELSE COALESCE(refund.initiated_at, refund.created_at)
        END,
        refund.created_at,
        invoice.legacy_order_id::bigint,
        RIGHT(COALESCE(NULLIF(refund.refund_reference, ''), refund.id::text), 6),
        NULL
      FROM cpq.refund refund
      JOIN cpq.payment payment ON payment.id = refund.payment_id
      LEFT JOIN insurance.invoice invoice ON invoice.id = payment.invoice_id
      WHERE payment.account_id IN (SELECT account_id FROM company_accounts)
        OR payment.processor_reference_id IN (
          SELECT payment_link_id FROM link_records
          WHERE payment_link_id IS NOT NULL
        )
    ),
    normalized_events AS (
      SELECT
        events.*,
        (
          events.event_kind = 'payment'
          AND (
            LOWER(COALESCE(events.raw_status, '')) IN ('settled', 'completed', 'paid')
            OR (
              COALESCE(events.link_completed, false)
              AND LOWER(COALESCE(events.raw_status, ''))
                NOT IN ('failed', 'returned', 'cancelled', 'void')
            )
          )
        ) AS is_settled
      FROM events
    ),
    payment_summary AS (
      SELECT
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE is_settled) AS settled_count,
        CASE
          WHEN COUNT(*) FILTER (WHERE is_settled) = 0 THEN '0'
          WHEN
            COUNT(*) FILTER (WHERE is_settled)
              = COUNT(*) FILTER (
                  WHERE is_settled
                    AND amount IS NOT NULL
                    AND amount ~ '^-?[0-9]+(\\.[0-9]+)?$'
                )
            AND COUNT(
              DISTINCT UPPER(COALESCE(NULLIF(currency, ''), 'USD'))
            ) FILTER (WHERE is_settled) = 1
          THEN COALESCE(
            SUM(
              CASE
                WHEN amount ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  THEN amount::numeric
              END
            ) FILTER (WHERE is_settled),
            0
          )::text
          ELSE NULL
        END AS settled_amount,
        CASE
          WHEN COUNT(*) FILTER (WHERE is_settled) = 0 THEN 'USD'
          WHEN COUNT(
            DISTINCT UPPER(COALESCE(NULLIF(currency, ''), 'USD'))
          ) FILTER (WHERE is_settled) = 1
          THEN MIN(UPPER(COALESCE(NULLIF(currency, ''), 'USD')))
            FILTER (WHERE is_settled)
          ELSE NULL
        END AS settled_currency
      FROM normalized_events
    )
    SELECT
      events.event_id,
      events.event_kind,
      events.raw_status,
      events.link_completed,
      events.amount,
      events.currency,
      events.payment_purpose,
      events.is_payment_link,
      events.occurred_at_ts::text AS occurred_at,
      events.created_at_ts::text AS created_at,
      events.order_id,
      events.safe_reference,
      events.created_by,
      payment_summary.total_count,
      payment_summary.settled_count,
      payment_summary.settled_amount,
      payment_summary.settled_currency
    FROM normalized_events events
    CROSS JOIN payment_summary
    ORDER BY events.occurred_at_ts DESC NULLS LAST, events.event_id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const rows = await runSupabaseManagementQuery<PaymentRow>(sql, 20_000, {
    priority,
    signal,
  });
  const items: PaymentHistoryItem[] = rows.flatMap((row) => {
    const rawStatus = trim(row.raw_status)?.toLowerCase() ?? "unknown";
    const occurredAt = trim(row.occurred_at) ?? trim(row.created_at);
    const createdAt = trim(row.created_at);
    if (!occurredAt || !createdAt) return [];
    const orderId = Number(row.order_id);
    return [
      {
        id: row.event_id,
        type: paymentType(row.event_kind, row.is_payment_link),
        status: paymentStatus(
          row.event_kind,
          rawStatus,
          row.link_completed === true,
        ),
        rawStatus,
        amountCents: decimalToCents(row.amount),
        currency: trim(row.currency)?.toUpperCase() ?? null,
        occurredAt,
        createdAt,
        orderId:
          Number.isSafeInteger(orderId) && orderId > 0 ? orderId : null,
        createdBy: trim(row.created_by),
        safeReference: `••••${trim(row.safe_reference) ?? "unknown"}`,
      },
    ];
  });
  const summaryRow = rows[0];
  const hasReportedSummary =
    summaryRow !== undefined &&
    Object.prototype.hasOwnProperty.call(summaryRow, "settled_count");
  const settledItems = items.filter((item) => item.status === "settled");
  const fallbackCurrencies = new Set(
    settledItems.flatMap((item) => (item.currency ? [item.currency] : [])),
  );
  const fallbackSummaryComplete =
    settledItems.every(
      (item) => item.amountCents !== null && item.currency !== null,
    ) && fallbackCurrencies.size <= 1;
  const reportedSettledCount = Number(summaryRow?.settled_count);
  const settledCount =
    hasReportedSummary &&
    Number.isSafeInteger(reportedSettledCount) &&
    reportedSettledCount >= 0
      ? reportedSettledCount
      : settledItems.length;
  const settledAmountCents = hasReportedSummary
    ? decimalToCents(summaryRow?.settled_amount ?? null)
    : fallbackSummaryComplete
      ? settledItems.reduce(
          (sum, item) => sum + (item.amountCents ?? 0),
          0,
        )
      : null;
  const settledCurrency = hasReportedSummary
    ? (trim(summaryRow?.settled_currency)?.toUpperCase() ?? null)
    : settledItems.length === 0
      ? "USD"
      : fallbackSummaryComplete
        ? (fallbackCurrencies.values().next().value ?? "USD")
        : null;

  return {
    companyId,
    items,
    total: Number(rows[0]?.total_count ?? 0),
    settledAmountCents,
    settledCurrency,
    settledCount,
    offset,
    limit,
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
}

function paymentCacheKey(
  companyId: number,
  offset: number,
  limit: number,
): string {
  return `payments:v1:${companyId}:${offset}:${limit}`;
}

function readPersistedPaymentPage(
  key: string,
): { page: PaymentHistoryPage; ageMs: number } | null {
  const row = getDb()
    .prepare(`SELECT payload, fetched_at FROM remote_cache WHERE cache_key = ?`)
    .get(key) as { payload: string; fetched_at: number } | undefined;
  if (!row) return null;
  try {
    return {
      page: JSON.parse(row.payload) as PaymentHistoryPage,
      ageMs: Math.max(0, Date.now() - row.fetched_at),
    };
  } catch {
    return null;
  }
}

function persistPaymentPage(key: string, page: PaymentHistoryPage): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_cache (cache_key, payload, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at`,
  ).run(key, JSON.stringify(page), Date.now());
  db.prepare(`DELETE FROM remote_cache WHERE fetched_at <= ?`).run(
    Date.now() - REMOTE_CACHE_PRUNE_MS,
  );
}

/** One shared live refetch per key, persisted on success. */
function revalidatePaymentHistory(
  companyId: number,
  offset: number,
  limit: number,
  key: string,
  priority: SupabaseManagementQueryPriority = "interactive",
  signal?: AbortSignal,
): Promise<PaymentHistoryPage> {
  const existing = paymentInFlight.get(key);
  if (existing) {
    if (priority === "background") existing.keepAlive = true;
    return subscribeToSharedInFlight(existing, signal);
  }
  const controller = new AbortController();
  const requestId = Symbol();
  const request = fetchWithRetry(() =>
    fetchPaymentHistory(
      companyId,
      offset,
      limit,
      priority,
      controller.signal,
    ),
  )
    .then((value) => {
      persistPaymentPage(key, value);
      return value;
    })
    .finally(() => {
      if (paymentInFlight.get(key)?.requestId === requestId) {
        paymentInFlight.delete(key);
      }
    });
  const entry: InFlightPaymentHistory = {
    promise: request,
    controller,
    requestId,
    subscribers: 0,
    keepAlive: priority === "background",
  };
  paymentInFlight.set(key, entry);
  return subscribeToSharedInFlight(entry, signal);
}

/** Refresh one previously viewed payment page without blocking a UI request. */
export async function revalidateCachedPaymentHistory({
  companyId,
  offset,
  limit,
}: {
  companyId: number;
  offset: number;
  limit: number;
}): Promise<boolean> {
  assertCompanyId(companyId);
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const key = paymentCacheKey(companyId, safeOffset, safeLimit);
  if (!readPersistedPaymentPage(key)) return false;
  await revalidatePaymentHistory(
    companyId,
    safeOffset,
    safeLimit,
    key,
    "background",
  );
  return true;
}

/**
 * Local-always after first view: a fresh page returns as-is and any older
 * persisted page returns instantly, honestly flagged stale, while a background
 * refresh replaces it. Only a key this desk has never seen blocks on live SQL.
 */
export async function loadPaymentHistory({
  companyId,
  offset = 0,
  limit = 20,
  signal,
}: {
  companyId: number;
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PaymentHistoryPage> {
  assertCompanyId(companyId);
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const key = paymentCacheKey(companyId, safeOffset, safeLimit);
  const cached = readPersistedPaymentPage(key);
  if (cached && cached.ageMs < PAYMENT_TTL_MS) return cached.page;
  if (cached) {
    void revalidatePaymentHistory(
      companyId,
      safeOffset,
      safeLimit,
      key,
      "background",
    ).catch(
      (cause) => {
        console.warn("payment_history_revalidate_failed", {
          companyId,
          errorCategory:
            cause instanceof Error ? cause.message : "unknown_payment_error",
        });
      },
    );
    return { ...cached.page, stale: true };
  }
  return revalidatePaymentHistory(
    companyId,
    safeOffset,
    safeLimit,
    key,
    "interactive",
    signal,
  );
}
