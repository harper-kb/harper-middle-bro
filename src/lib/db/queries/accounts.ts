import {
  BOOK_ORDER_BIND_STATUSES,
  emptyBookOrderRich,
  loadSupabaseBook,
  normalizeBookOrderRich,
  type BookOrderRichData,
  type BookOrderBindStatus,
} from "../../supabase-book.server";
import type { OrderReportingRangeId } from "../../order-reporting";
import {
  parseOrderSource,
  type AccountSourceId,
  type OrderSource,
} from "../../account-source";
import {
  IQ_STAGE_NO_STATUS,
  IQ_STAGE_TAG_IDS,
  IQ_STAGE_UNRECOGNIZED,
  type IqStageFilterId,
} from "../../iq-stage";
import {
  BROKER_GATE_IDS,
  BROKER_GATE_NONE,
  type BrokerGateFilterId,
} from "../../broker-gate";
import { MAX_SELECTED_CARRIERS } from "../../carrier-filter";
import {
  LOCATION_STATE_NONE,
  locationStateLabel,
  US_STATE_CODES,
  US_STATE_NAMES,
  type LocationStateFilterId,
} from "../../location-state";
import { DEFAULT_ACCOUNT_SORT, type AccountSort } from "../../account-sort";
import type { AccountDetail, Underwriter } from "../../types";
import { getDb } from "../connection";
import { mapAccount, mapPolicy, mapThread, mapUw } from "../mappers";

export function searchAccounts(query: string): AccountDetail[] {
  const db = getDb();
  const q = `%${query.trim().toLowerCase()}%`;
  const rows = db
    .prepare(
      `SELECT * FROM accounts
       WHERE lower(name) LIKE ? OR lower(coalesce(dba,'')) LIKE ? OR lower(industry) LIKE ?
       ORDER BY name LIMIT 25`,
    )
    .all(q, q, q) as Record<string, unknown>[];

  if (!query.trim()) {
    const all = db
      .prepare(`SELECT * FROM accounts ORDER BY name`)
      .all() as Record<string, unknown>[];
    return all.map((r) => getAccountDetail(r.id as string)!);
  }

  return rows.map((r) => getAccountDetail(r.id as string)!);
}

export function listAccounts(): AccountDetail[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id FROM accounts ORDER BY name`)
    .all() as { id: string }[];
  return rows.map((r) => getAccountDetail(r.id)!);
}

/**
 * Every eligible account synced from the live Harper book. Eligibility is a
 * real order row — preserved local account history without an order is hidden.
 * `co-` ids are the book rows (same convention the refresh pruner uses);
 * fictional seed accounts are excluded.
 */
export function listBookAccounts(): AccountDetail[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id FROM accounts
       WHERE id LIKE 'co-%'
         AND EXISTS (
           SELECT 1 FROM book_orders o WHERE o.account_id = accounts.id
         )
       ORDER BY name`,
    )
    .all() as { id: string }[];
  return rows.map((r) => getAccountDetail(r.id)!);
}

export interface BookOrderNavigationCounts {
  allOrders: number;
  pendingOrders: number;
  boundOrders: number;
  lostOrders: number;
}

/**
 * Order-grain counts for the four Records navigation views.
 */
export function getBookOrderNavigationCounts(): BookOrderNavigationCounts {
  const row = getDb()
    .prepare(
      `SELECT
         count(*) AS allOrders,
         count(*) FILTER (WHERE bind_status = 'pending') AS pendingOrders,
         count(*) FILTER (WHERE bind_status = 'bound') AS boundOrders,
         count(*) FILTER (WHERE bind_status = 'lost') AS lostOrders
       FROM book_orders
       WHERE account_id LIKE 'co-%'`,
    )
    .get() as Record<keyof BookOrderNavigationCounts, number>;
  return {
    allOrders: Number(row.allOrders) || 0,
    pendingOrders: Number(row.pendingOrders) || 0,
    boundOrders: Number(row.boundOrders) || 0,
    lostOrders: Number(row.lostOrders) || 0,
  };
}

export interface BookOrderListItem {
  id: string;
  harperOrderId: number;
  label: string;
  /** Authoritative `orders_temp.created_at`; the deal-age basis. */
  createdAt: string | null;
  orderedAt: string | null;
  eventAt: string | null;
  bindStatus: BookOrderBindStatus;
  revenueCents: number | null;
  revenueMicros: number | null;
  rich: BookOrderRichData;
  policyNumbers: string[];
  inconsistency: string | null;
  /**
   * Persisted `book_orders.source` — the same column the IQ/Broker filter
   * partitions on, so a preview badge can never disagree with the view that
   * surfaced it. Null stays unclassified rather than defaulting to broker.
   */
  source: OrderSource | null;
  /** Authoritative `orders_temp.tag`; null = No status. */
  iqStageTag: string | null;
  /**
   * Newest gate override (`service_workbench_gate_overrides.current_gate`);
   * null = Gate unavailable. Drives the rail and the Broker Gate filter.
   */
  brokerGate: string | null;
  brokerGateAt: string | null;
}

export interface BookAccountListItem {
  id: string;
  name: string;
  dba: string | null;
  state: string;
  orderCount: number;
  orders: BookOrderListItem[];
  /**
   * True when any of the account's book orders — all of them, not just the
   * ones the current view filtered down to — carries a visible Service Note
   * in the snapshot. False is a verified account-level "no notes yet", which
   * lets an expanded order card render its empty Service state instantly
   * instead of holding a skeleton through the live round-trip.
   */
  hasServiceNotes: boolean;
}

type BookOrderRow = {
  id: string;
  harper_order_id: number;
  created_at: string | null;
  ordered_at: string | null;
  event_at: string | null;
  bind_status: string;
  revenue_cents: number | null;
  revenue_micros: number | null;
  rich_json: string;
  policy_numbers_json: string;
  inconsistency: string | null;
  source: string | null;
  iq_stage_tag: string | null;
  broker_gate: string | null;
  broker_gate_at: string | null;
};

/**
 * All visible orders for one book account, loaded at order grain by stable ID.
 * Creation time is the authoritative sort basis; order ID breaks ties.
 */
export function getBookAccountOrders(accountId: string): BookOrderListItem[] {
  if (!/^co-\d+$/.test(accountId)) return [];
  const rows = getDb()
    .prepare(
      `SELECT id, harper_order_id, created_at, ordered_at, event_at,
              bind_status, revenue_cents, revenue_micros, rich_json,
              policy_numbers_json, inconsistency, source, iq_stage_tag,
              broker_gate, broker_gate_at
       FROM book_orders
       WHERE account_id = ?
       ORDER BY created_at DESC, harper_order_id DESC`,
    )
    .all(accountId) as BookOrderRow[];

  return rows.flatMap((row) => {
    const harperOrderId = Number(row.harper_order_id);
    if (!Number.isSafeInteger(harperOrderId)) return [];
    const policyRaw = JSON.parse(row.policy_numbers_json) as unknown;
    const policyNumbers = Array.isArray(policyRaw)
      ? policyRaw.map(String)
      : [];
    const richRaw = JSON.parse(row.rich_json) as unknown;
    const rich =
      richRaw && typeof richRaw === "object"
        ? normalizeBookOrderRich(
            richRaw as BookOrderRichData,
            policyNumbers.length,
          )
        : emptyBookOrderRich(policyNumbers.length);
    if (
      !(BOOK_ORDER_BIND_STATUSES as readonly string[]).includes(row.bind_status)
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        harperOrderId,
        label: `Order #${harperOrderId}`,
        createdAt: row.created_at,
        orderedAt: row.ordered_at,
        eventAt: row.event_at,
        bindStatus: row.bind_status as BookOrderBindStatus,
        revenueCents: row.revenue_cents,
        revenueMicros: row.revenue_micros,
        rich,
        policyNumbers,
        inconsistency: row.inconsistency,
        source: parseOrderSource(row.source),
        iqStageTag: row.iq_stage_tag,
        brokerGate: row.broker_gate,
        brokerGateAt: row.broker_gate_at,
      },
    ];
  });
}

export interface BookAccountsPage {
  /** Book accounts matching the search (all book accounts when unfiltered). */
  total: number;
  /** Of matching accounts, how many have at least one Bound order. */
  withBoundOrders: number;
  /** Of matching accounts, how many have at least one Pending order. */
  withPendingOrders: number;
  /** Of matching accounts, how many have at least one Lost order. */
  withLostOrders: number;
  /** Bound orders across the matching account set. */
  boundOrderCount: number;
  /** Pending (actively awaiting bind) orders across the matching account set. */
  pendingOrderCount: number;
  /** Lost orders (only lost deals) across the matching account set. */
  lostOrderCount: number;
  /** Sum of known orders_temp.total_revenue values at the selected order grain. */
  revenueMicros: number | null;
  missingRevenueOrderCount: number;
  rows: BookAccountListItem[];
}

export type BookOrdersViewMode = "all" | BookOrderBindStatus;

/**
 * SQL predicate on a book_orders alias for the IQ Stage multi-select.
 * Empty selection = all stages (no clause). Always scopes to IQ source so a
 * stage never silently matches a Broker order.
 */
function iqStageOrderSql(
  alias: string,
  stages: readonly IqStageFilterId[],
): string {
  if (stages.length === 0) return "";
  const declared = IQ_STAGE_TAG_IDS.map((id) => `'${id}'`).join(", ");
  const clauses: string[] = [];
  for (const stage of stages) {
    if (stage === IQ_STAGE_NO_STATUS) {
      clauses.push(
        `(${alias}.iq_stage_tag IS NULL OR trim(${alias}.iq_stage_tag) = '')`,
      );
    } else if (stage === IQ_STAGE_UNRECOGNIZED) {
      clauses.push(
        `(${alias}.iq_stage_tag IS NOT NULL AND trim(${alias}.iq_stage_tag) <> '' AND lower(${alias}.iq_stage_tag) NOT IN (${declared}))`,
      );
    } else {
      clauses.push(`lower(${alias}.iq_stage_tag) = '${stage}'`);
    }
  }
  return ` AND ${alias}.source = 'iq' AND (${clauses.join(" OR ")})`;
}

/**
 * SQL predicate on a book_orders alias for the Broker Gate multi-select.
 * Empty selection = all gates (no clause). Always scopes to Broker source so
 * a gate never silently matches an IQ order.
 *
 * The normalization mirrors `coerceBrokerGateId`: live values are verified to
 * be exactly G1–G6 or NULL, and loose drift forms ("g4", "Gate 4") still land
 * on their gate rather than reading as unavailable. Anything that does not
 * coerce is the rail's "Gate unavailable" state, so the `gate:none` clause
 * matches it too — filter membership and card display can never disagree.
 */
function brokerGateOrderSql(
  alias: string,
  gates: readonly BrokerGateFilterId[],
): string {
  if (gates.length === 0) return "";
  const normalized = `replace(replace(replace(replace(upper(trim(${alias}.broker_gate)), 'GATE', 'G'), ' ', ''), '-', ''), '_', '')`;
  const known = BROKER_GATE_IDS.map((id) => `'${id}'`).join(", ");
  const clauses: string[] = [];
  for (const gate of gates) {
    if (gate === BROKER_GATE_NONE) {
      clauses.push(
        `(${alias}.broker_gate IS NULL OR ${normalized} NOT IN (${known}))`,
      );
    } else {
      clauses.push(`${normalized} = '${gate}'`);
    }
  }
  return ` AND ${alias}.source = 'broker' AND (${clauses.join(" OR ")})`;
}

/**
 * SQL predicate on a book_orders alias for the carrier multi-select: the
 * order carries at least one deal on any selected carrier entity (OR within
 * the selection). Empty selection = all carriers (no clause). Carrier keys
 * are data-derived — unlike the fixed stage/gate vocabularies they are never
 * interpolated, only bound as named parameters (@carrier0…@carrierN).
 */
function carrierOrderSql(alias: string, count: number): string {
  if (count === 0) return "";
  const names = Array.from({ length: count }, (_, i) => `@carrier${i}`);
  return ` AND EXISTS (
      SELECT 1 FROM book_order_carriers order_carriers
      WHERE order_carriers.order_id = ${alias}.id
        AND order_carriers.carrier_key IN (${names.join(", ")})
    )`;
}

interface AccountsFilterOpts {
  query?: string;
  mode?: BookOrdersViewMode;
  range?: OrderReportingRangeId;
  source?: AccountSourceId;
  /** Selected IQ Stage filter ids; empty means all stages. */
  iqStages?: readonly IqStageFilterId[];
  /** Selected Broker Gate filter ids; empty means all gates. */
  brokerGates?: readonly BrokerGateFilterId[];
  /** Selected canonical carrier keys; empty means all carriers. */
  carriers?: readonly string[];
  /** Selected location-state codes (+ state:none); empty means all states. */
  locationStates?: readonly LocationStateFilterId[];
}

/** The fixed USPS vocabulary as SQL literals (two-letter constants). */
const US_STATE_CODES_SQL = US_STATE_CODES.map((code) => `'${code}'`).join(
  ", ",
);

/** Normalized read of the stored account state, shared by predicate + facet. */
const ACCOUNT_STATE_SQL = "upper(trim(coalesce(accounts.state, '')))";

/**
 * SQL predicate on `accounts` for the Location State multi-select: the
 * account's stored location state (the value its row displays) is any
 * selected USPS code, OR — for `state:none` — missing/unrecognized. Account
 * grain, so it composes with the order-grain fragments by plain AND. Codes
 * bind as named parameters (@state0…@stateN).
 */
function locationStateSql(
  states: readonly LocationStateFilterId[],
): string {
  if (states.length === 0) return "";
  const codes = states.filter((state) => state !== LOCATION_STATE_NONE);
  const clauses: string[] = [];
  if (codes.length > 0) {
    const names = codes.map((_, i) => `@state${i}`);
    clauses.push(`${ACCOUNT_STATE_SQL} IN (${names.join(", ")})`);
  }
  if (codes.length !== states.length) {
    clauses.push(`${ACCOUNT_STATE_SQL} NOT IN (${US_STATE_CODES_SQL})`);
  }
  return ` AND (${clauses.join(" OR ")})`;
}

interface AccountsFilterSql {
  mode: BookOrdersViewMode;
  /** Named bind parameters for every fragment below. */
  params: Record<string, unknown>;
  /** Full accounts-level WHERE: search + source partition + order EXISTS. */
  where: string;
  /** Order-grain filter on alias `o` (starts with ` AND …` when present). */
  orderFilter: string;
  /** Stage/gate fragment on alias `o`, for the per-status KPI subqueries. */
  stageRowSql: string;
  /** Carrier fragment on alias `o`, same composition rule as stage/gate. */
  carrierRowSql: string;
  /** Reporting-window fragment on alias `o` for per-status KPI subqueries. */
  statusRangeFilter: string;
}

/**
 * The one filter-definition layer for the Accounts views: the page query and
 * the carrier facet both compose their SQL from these fragments, so the row
 * set, the KPI math and the carrier option set can never drift apart.
 */
function buildAccountsFilter(opts: AccountsFilterOpts): AccountsFilterSql {
  const mode = opts.mode ?? "all";
  const source = opts.source ?? "all";
  const iqStages = opts.iqStages ?? [];
  const brokerGates = opts.brokerGates ?? [];
  const carriers = (opts.carriers ?? []).slice(0, MAX_SELECTED_CARRIERS);
  const locationStates = opts.locationStates ?? [];
  const q = `%${(opts.query ?? "").trim().toLowerCase()}%`;
  const reportingWindow =
    opts.range &&
    opts.range !== "all-time"
      ? loadSupabaseBook()?.reportingWindows?.ranges[opts.range]
      : undefined;
  const rangeFilter = reportingWindow
    ? ` AND view_orders.event_at >= @rangeStart
        AND view_orders.event_at < @rangeEnd`
    : "";
  const rowRangeFilter = reportingWindow
    ? ` AND o.event_at >= @rangeStart AND o.event_at < @rangeEnd`
    : "";
  const stageViewSql =
    iqStageOrderSql("view_orders", iqStages) +
    brokerGateOrderSql("view_orders", brokerGates);
  const stageRowSql =
    iqStageOrderSql("o", iqStages) + brokerGateOrderSql("o", brokerGates);
  const carrierViewSql = carrierOrderSql("view_orders", carriers.length);
  const carrierRowSql = carrierOrderSql("o", carriers.length);
  // Strict partition on the deal-level source: the account qualifies only when
  // every order in the current view carries the selected source. Unclassified
  // (NULL) and mixed orders disqualify it, so those accounts surface only under
  // "All" rather than being silently counted as IQ or Broker.
  const sourceScope =
    mode === "all"
      ? (reportingWindow
          ? " AND src_orders.event_at >= @rangeStart AND src_orders.event_at < @rangeEnd"
          : "")
      : ` AND src_orders.bind_status = '${mode}'${
          reportingWindow
            ? " AND src_orders.event_at >= @rangeStart AND src_orders.event_at < @rangeEnd"
            : ""
        }`;
  const sourceFilter =
    source === "all"
      ? ""
      : ` AND NOT EXISTS (
          SELECT 1 FROM book_orders src_orders
          WHERE src_orders.account_id = accounts.id${sourceScope}
            AND (src_orders.source IS NULL OR src_orders.source <> '${source}')
        )`;
  const params: Record<string, unknown> = {
    q,
    rangeStart: reportingWindow?.startsAt ?? null,
    rangeEnd: reportingWindow?.endsAt ?? null,
  };
  carriers.forEach((key, i) => {
    params[`carrier${i}`] = key;
  });
  locationStates
    .filter((state) => state !== LOCATION_STATE_NONE)
    .forEach((code, i) => {
      params[`state${i}`] = code;
    });
  const accountOrderFilter =
    mode === "all"
      ? ` AND EXISTS (
          SELECT 1 FROM book_orders view_orders
          WHERE view_orders.account_id = accounts.id
          ${rangeFilter}
          ${stageViewSql}
          ${carrierViewSql}
        )`
      : ` AND EXISTS (
          SELECT 1 FROM book_orders view_orders
          WHERE view_orders.account_id = accounts.id
            AND view_orders.bind_status = '${mode}'
            ${rangeFilter}
            ${stageViewSql}
            ${carrierViewSql}
        )`;
  const orderFilter =
    mode === "all"
      ? `${rowRangeFilter}${stageRowSql}${carrierRowSql}`
      : ` AND o.bind_status = '${mode}'${rowRangeFilter}${stageRowSql}${carrierRowSql}`;
  const where = `accounts.id LIKE 'co-%'
    AND (
      lower(accounts.name) LIKE @q
      OR lower(coalesce(accounts.dba,'')) LIKE @q
    )${locationStateSql(locationStates)}${sourceFilter}${accountOrderFilter}`;
  const statusRangeFilter =
    reportingWindow
      ? ` AND o.event_at >= @rangeStart AND o.event_at < @rangeEnd`
      : "";

  return {
    mode,
    params,
    where,
    orderFilter,
    stageRowSql,
    carrierRowSql,
    statusRangeFilter,
  };
}

/**
 * The canonical representative date per records page, as a scalar per
 * account computed from the same filtered order set the row displays
 * (`orderFilter` is the row-grain filter on alias `o`):
 * - All Accounts: the representative order under the shared collapsed-row
 *   rule (pending > bound > lost, newest `created_at`, order id ties) — the
 *   same order whose stage/age/carrier the row shows — by its `created_at`.
 * - Pending / Lost: newest `orders_temp.created_at` among matching orders —
 *   the authoritative creation moment deal age is measured from. (Harper
 *   carries no lost/cancelled timestamp, so Lost uses the same date its
 *   rows already describe.)
 * - Bound: newest `event_at` among matching orders — the verified first
 *   bind event, the same date the Bound view's reporting window filters on.
 */
function representativeDateSql(
  mode: BookOrdersViewMode,
  orderFilter: string,
): string {
  if (mode === "bound") {
    return `(
      SELECT max(o.event_at) FROM book_orders o
      WHERE o.account_id = accounts.id${orderFilter}
    )`;
  }
  if (mode === "all") {
    return `(
      SELECT o.created_at FROM book_orders o
      WHERE o.account_id = accounts.id${orderFilter}
      ORDER BY CASE o.bind_status
          WHEN 'pending' THEN 0 WHEN 'bound' THEN 1 ELSE 2 END,
        o.created_at IS NULL, o.created_at DESC, o.harper_order_id DESC
      LIMIT 1
    )`;
  }
  return `(
    SELECT max(o.created_at) FROM book_orders o
    WHERE o.account_id = accounts.id${orderFilter}
  )`;
}

/**
 * Exactly the revenue figure the row displays: the sum of matching orders'
 * `revenue_micros`, NULL (unavailable) when any matching order is missing a
 * value, so a partial total never outranks a complete one. An explicit
 * $0.00 is a real value and sorts as one.
 */
function displayedRevenueSql(orderFilter: string): string {
  return `(
    SELECT CASE WHEN count(*) = count(o.revenue_micros)
      THEN sum(o.revenue_micros) ELSE NULL END
    FROM book_orders o
    WHERE o.account_id = accounts.id${orderFilter}
  )`;
}

/**
 * Select columns + ORDER BY for one deterministic total order.
 *
 * Date order is always active (Oldest first is the default ordering of every
 * Accounts page). A revenue order, when chosen, takes priority and the date
 * order arranges equal-revenue runs and the unavailable-revenue tail —
 * representative dates are nearly unique, so a date-first ordering would
 * make any revenue choice invisible. Null keys sort after valid ones on both
 * axes in both directions, and account name plus stable id close every
 * ordering so ties can never shuffle between pages or refreshes.
 */
function accountSortSql(
  sort: AccountSort,
  mode: BookOrdersViewMode,
  orderFilter: string,
): { select: string; orderBy: string } {
  const dateDirection = sort.date === "newest" ? "DESC" : "ASC";
  const dateKey = representativeDateSql(mode, orderFilter);
  if (sort.revenue === "none") {
    return {
      select: `${dateKey} AS sort_key,`,
      orderBy: `ORDER BY sort_key IS NULL, sort_key ${dateDirection}, name, accounts.id`,
    };
  }
  const revenueDirection = sort.revenue === "revenue-desc" ? "DESC" : "ASC";
  return {
    select: `${displayedRevenueSql(orderFilter)} AS sort_key, ${dateKey} AS sort_key2,`,
    orderBy: `ORDER BY sort_key IS NULL, sort_key ${revenueDirection}, sort_key2 IS NULL, sort_key2 ${dateDirection}, name, accounts.id`,
  };
}

/**
 * One page of the live book with orders attached — a single SQL pass instead
 * of per-account detail lookups, which do not scale to the ~10k accounts the
 * full book carries.
 */
export function listBookAccountsPage(opts: AccountsFilterOpts & {
  /** List ordering only — never changes eligibility, metrics or facets. */
  sort?: AccountSort;
  offset: number;
  limit: number;
}): BookAccountsPage {
  const db = getDb();
  const {
    mode,
    params,
    where,
    orderFilter,
    stageRowSql,
    carrierRowSql,
    statusRangeFilter,
  } = buildAccountsFilter(opts);
  const sortSql = accountSortSql(
    opts.sort ?? DEFAULT_ACCOUNT_SORT,
    mode,
    orderFilter,
  );
  const statusCount = (status: BookOrderBindStatus) => `(
           SELECT count(*) FROM book_orders o
           WHERE o.bind_status = '${status}'
             ${mode === "all" || status === mode ? statusRangeFilter : ""}
             ${stageRowSql}
             ${carrierRowSql}
             AND o.account_id IN (
               SELECT accounts.id FROM accounts WHERE ${where}
             )
         )`;
  // Distinct accounts (stable ids) carrying at least one order of the status
  // — an account with several same-status orders counts once.
  const accountsWithStatus = (status: BookOrderBindStatus) => `count(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM book_orders o
             WHERE o.account_id = accounts.id AND o.bind_status = '${status}'
               ${mode === "all" || status === mode ? statusRangeFilter : ""}
               ${stageRowSql}
               ${carrierRowSql}
           )
         )`;

  const counts = db
    .prepare(
      `SELECT
         count(*) AS total,
         ${accountsWithStatus("bound")} AS withBoundOrders,
         ${accountsWithStatus("pending")} AS withPendingOrders,
         ${accountsWithStatus("lost")} AS withLostOrders,
         ${statusCount("bound")} AS boundOrderCount,
         ${statusCount("pending")} AS pendingOrderCount,
         ${statusCount("lost")} AS lostOrderCount,
         (
           SELECT sum(o.revenue_micros) FROM book_orders o
           WHERE o.account_id IN (
             SELECT accounts.id FROM accounts WHERE ${where}
           )${orderFilter}
         ) AS revenueMicros,
         (
           SELECT count(*) FROM book_orders o
           WHERE o.revenue_micros IS NULL
             AND o.account_id IN (
               SELECT accounts.id FROM accounts WHERE ${where}
             )${orderFilter}
         ) AS missingRevenueOrderCount
       FROM accounts WHERE ${where}`,
    )
    .get(params) as {
    total: number;
    withBoundOrders: number;
    withPendingOrders: number;
    withLostOrders: number;
    boundOrderCount: number;
    pendingOrderCount: number;
    lostOrderCount: number;
    revenueMicros: number | null;
    missingRevenueOrderCount: number;
  };

  const rows = db
    .prepare(
      `SELECT id, name, dba, state,
              ${sortSql.select}
              (
                SELECT count(*) FROM book_orders o
                WHERE o.account_id = accounts.id${orderFilter}
              ) AS order_count,
              EXISTS (
                SELECT 1 FROM book_orders sn
                WHERE sn.account_id = accounts.id
                  AND json_extract(sn.rich_json, '$.serviceNote') IS NOT NULL
              ) AS has_service_notes,
              (
                SELECT COALESCE(json_group_array(json(j)), '[]')
                FROM (
                  SELECT json_object(
                    'id', o.id,
                    'harperOrderId', o.harper_order_id,
                    'createdAt', o.created_at,
                    'orderedAt', o.ordered_at,
                    'source', o.source,
                    'eventAt', o.event_at,
                    'bindStatus', o.bind_status,
                    'revenueCents', o.revenue_cents,
                    'revenueMicros', o.revenue_micros,
                    'rich', json(o.rich_json),
                    'policyNumbers', json(o.policy_numbers_json),
                    'inconsistency', o.inconsistency,
                    'iqStageTag', o.iq_stage_tag,
                    'brokerGate', o.broker_gate,
                    'brokerGateAt', o.broker_gate_at
                  ) AS j
                  FROM book_orders o
                  WHERE o.account_id = accounts.id${orderFilter}
                  ORDER BY COALESCE(o.ordered_at, '') DESC, o.harper_order_id ASC
                )
              ) AS orders_json
       FROM accounts
       WHERE ${where}
       ${sortSql.orderBy}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: opts.limit, offset: opts.offset }) as (Record<
    string,
    unknown
  > & { order_count: number; orders_json: string })[];

  return {
    total: counts.total,
    withBoundOrders: counts.withBoundOrders,
    withPendingOrders: counts.withPendingOrders,
    withLostOrders: counts.withLostOrders,
    boundOrderCount: counts.boundOrderCount,
    pendingOrderCount: counts.pendingOrderCount,
    lostOrderCount: counts.lostOrderCount,
    revenueMicros:
      counts.revenueMicros === null ? null : Number(counts.revenueMicros),
    missingRevenueOrderCount: Number(counts.missingRevenueOrderCount) || 0,
    rows: rows.map((r) => {
      const parsed = JSON.parse(r.orders_json) as unknown;
      const rawOrders = Array.isArray(parsed) ? parsed : [];
      const orders: BookOrderListItem[] = rawOrders.flatMap((entry) => {
        const o =
          typeof entry === "string"
            ? (JSON.parse(entry) as Record<string, unknown>)
            : (entry as Record<string, unknown>);
        const harperOrderId = Number(o.harperOrderId);
        if (!Number.isFinite(harperOrderId)) return [];
        const policyRaw = o.policyNumbers;
        const policyNumbers = Array.isArray(policyRaw)
          ? policyRaw.map(String)
          : typeof policyRaw === "string"
            ? (JSON.parse(policyRaw) as string[])
            : [];
        return [
          {
            id: String(o.id ?? `order-${harperOrderId}`),
            harperOrderId,
            label: `Order #${harperOrderId}`,
            createdAt:
              o.createdAt === null || o.createdAt === undefined
                ? null
                : String(o.createdAt),
            orderedAt:
              o.orderedAt === null || o.orderedAt === undefined
                ? null
                : String(o.orderedAt),
            eventAt:
              o.eventAt === null || o.eventAt === undefined
                ? null
                : String(o.eventAt),
            // Unknown values (e.g. rows written before a refresh) degrade to
            // lost — never to a fabricated Bound or Pending.
            bindStatus: (BOOK_ORDER_BIND_STATUSES as readonly string[]).includes(
              String(o.bindStatus),
            )
              ? (String(o.bindStatus) as BookOrderBindStatus)
              : "lost",
            revenueCents:
              o.revenueCents === null || o.revenueCents === undefined
                ? null
                : Number(o.revenueCents),
            revenueMicros:
              o.revenueMicros === null || o.revenueMicros === undefined
                ? null
                : Number(o.revenueMicros),
            rich:
              o.rich && typeof o.rich === "object"
                ? normalizeBookOrderRich(
                    o.rich as BookOrderRichData,
                    policyNumbers.length,
                  )
                : emptyBookOrderRich(policyNumbers.length),
            policyNumbers,
            inconsistency:
              o.inconsistency === null || o.inconsistency === undefined
                ? null
                : String(o.inconsistency),
            source: parseOrderSource(o.source),
            iqStageTag:
              o.iqStageTag === null ||
              o.iqStageTag === undefined ||
              String(o.iqStageTag).trim() === ""
                ? null
                : String(o.iqStageTag).trim(),
            brokerGate:
              o.brokerGate === null ||
              o.brokerGate === undefined ||
              String(o.brokerGate).trim() === ""
                ? null
                : String(o.brokerGate).trim(),
            brokerGateAt:
              o.brokerGateAt === null || o.brokerGateAt === undefined
                ? null
                : String(o.brokerGateAt),
          } satisfies BookOrderListItem,
        ];
      });
      return {
        id: r.id as string,
        name: r.name as string,
        dba: (r.dba as string | null) ?? null,
        state: r.state as string,
        orderCount: Number(r.order_count) || orders.length,
        orders,
        hasServiceNotes: Boolean(r.has_service_notes),
      };
    }),
  };
}

/** One selectable carrier entity in the Accounts carrier filter. */
export interface BookCarrierFacetOption {
  /** Canonical carrier-entity key (see src/lib/carrier-filter.ts). */
  key: string;
  /** Book-wide most common verified display spelling for the key. */
  label: string;
  /** Matching orders under every current non-carrier constraint. */
  orderCount: number;
}

export interface BookCarrierFacet {
  /** Available options, alphabetical by label. */
  options: BookCarrierFacetOption[];
  /**
   * Selected keys with no matching order under the current non-carrier
   * constraints — kept visible (never silently dropped) with the best label
   * the book can give them, alphabetical by label.
   */
  unavailableSelected: { key: string; label: string }[];
}

/** Book-wide label election: most orders carry it, ties break alphabetically. */
const CARRIER_LABEL_SQL = `(
  SELECT c2.carrier_name FROM book_order_carriers c2
  WHERE c2.carrier_key = order_carriers.carrier_key
  GROUP BY c2.carrier_name
  ORDER BY count(*) DESC, c2.carrier_name ASC
  LIMIT 1
)`;

/**
 * Contextual carrier options for the Accounts views — the facet the carrier
 * multi-select offers.
 *
 * Derived from the complete filtered order set (never the visible page)
 * under every active filter except the carrier selection itself, so adding a
 * second carrier never collapses the menu to the first one. Counts are
 * matching orders under the current non-carrier constraints. Composed from
 * the same `buildAccountsFilter` fragments as `listBookAccountsPage`, so the
 * option set and the rows describe the same data revision by construction.
 */
export function listBookAccountCarrierFacet(
  opts: Omit<AccountsFilterOpts, "carriers"> & {
    /** Current selection, for availability marking — not for filtering. */
    selectedCarriers?: readonly string[];
  },
): BookCarrierFacet {
  const db = getDb();
  // Facet self-exclusion: every active filter except the carrier selection.
  const { params, where, orderFilter } = buildAccountsFilter({
    ...opts,
    carriers: [],
  });
  const rows = db
    .prepare(
      `SELECT
         order_carriers.carrier_key AS key,
         ${CARRIER_LABEL_SQL} AS label,
         count(*) AS orderCount
       FROM book_order_carriers order_carriers
       JOIN book_orders o ON o.id = order_carriers.order_id
       WHERE o.account_id IN (
           SELECT accounts.id FROM accounts WHERE ${where}
         )${orderFilter}
       GROUP BY order_carriers.carrier_key
       ORDER BY label COLLATE NOCASE ASC, key ASC`,
    )
    .all(params) as { key: string; label: string; orderCount: number }[];

  const options = rows.map((row) => ({
    key: row.key,
    label: row.label,
    orderCount: Number(row.orderCount) || 0,
  }));
  const available = new Set(options.map((option) => option.key));
  const labelLookup = db.prepare(
    `SELECT carrier_name FROM book_order_carriers
     WHERE carrier_key = ?
     GROUP BY carrier_name
     ORDER BY count(*) DESC, carrier_name ASC
     LIMIT 1`,
  );
  const unavailableSelected = (opts.selectedCarriers ?? [])
    .filter((key) => !available.has(key))
    .map((key) => {
      const row = labelLookup.get(key) as
        | { carrier_name: string }
        | undefined;
      // A key the whole book no longer knows keeps its normalized form as a
      // readable degraded label rather than disappearing from the control.
      return { key, label: row?.carrier_name ?? key };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return { options, unavailableSelected };
}

/** One selectable location state in the Accounts State & Sort control. */
export interface BookLocationStateFacetOption {
  /** Filter id: a USPS code, or state:none for Unknown / Not set. */
  id: LocationStateFilterId;
  /** Prominent short code (CA); null for Unknown / Not set. */
  code: string | null;
  /** Full name label ("California" / "Unknown / Not set"). */
  label: string;
  /** Distinct matching accounts under every non-state constraint. */
  accountCount: number;
}

export interface BookLocationStateFacet {
  /** Available options, codes alphabetical, Unknown / Not set last. */
  options: BookLocationStateFacetOption[];
  /** Selected ids with no matching account under current non-state filters. */
  unavailableSelected: { id: LocationStateFilterId; label: string }[];
}

/**
 * Contextual location-state options for the Accounts views. Derived from the
 * complete filtered account set (never the visible page) under every active
 * filter except the state selection itself — same facet self-exclusion rule
 * as carriers, same shared `buildAccountsFilter` fragments, so options and
 * rows always describe one data revision. Counts are distinct matching
 * accounts (state is an account-level attribute). Stored values that are not
 * recognized USPS codes — missing or legacy — surface as one explicit
 * Unknown / Not set bucket, never under a real state.
 */
export function listBookAccountLocationStateFacet(
  opts: Omit<AccountsFilterOpts, "locationStates"> & {
    /** Current selection, for availability marking — not for filtering. */
    selectedStates?: readonly LocationStateFilterId[];
  },
): BookLocationStateFacet {
  const db = getDb();
  // Facet self-exclusion: every active filter except the state selection.
  const { params, where } = buildAccountsFilter({
    ...opts,
    locationStates: [],
  });
  const rows = db
    .prepare(
      `SELECT
         CASE WHEN ${ACCOUNT_STATE_SQL} IN (${US_STATE_CODES_SQL})
           THEN ${ACCOUNT_STATE_SQL} ELSE '' END AS code,
         count(*) AS accountCount
       FROM accounts
       WHERE ${where}
       GROUP BY code
       ORDER BY code`,
    )
    .all(params) as { code: string; accountCount: number }[];

  const options: BookLocationStateFacetOption[] = [];
  let noneCount = 0;
  for (const row of rows) {
    if (row.code === "") {
      noneCount += Number(row.accountCount) || 0;
      continue;
    }
    options.push({
      id: row.code,
      code: row.code,
      label: US_STATE_NAMES[row.code] ?? row.code,
      accountCount: Number(row.accountCount) || 0,
    });
  }
  if (noneCount > 0) {
    options.push({
      id: LOCATION_STATE_NONE,
      code: null,
      label: locationStateLabel(LOCATION_STATE_NONE),
      accountCount: noneCount,
    });
  }

  const available = new Set(options.map((option) => option.id));
  const unavailableSelected = (opts.selectedStates ?? [])
    .filter((id) => !available.has(id))
    .map((id) => ({ id, label: locationStateLabel(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { options, unavailableSelected };
}

/** Payment landed — the account moves from pre-bind into active service. */
export function markAccountPaymentReceived(accountId: string): void {
  getDb()
    .prepare(
      `UPDATE accounts SET status = 'active', payment_received_at = ? WHERE id = ?`,
    )
    .run(new Date().toISOString(), accountId);
}

export function getUnderwriter(id: string): Underwriter | null {
  const row = getDb()
    .prepare(`SELECT * FROM underwriters WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapUw(row) : null;
}

export function getAccountDetail(id: string): AccountDetail | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM accounts WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  const account = mapAccount(row);
  const primaryUw = getUnderwriter(account.primaryUwId)!;
  const backupUw = account.backupUwId
    ? getUnderwriter(account.backupUwId)
    : null;
  const policies = (
    db
      .prepare(`SELECT * FROM policies WHERE account_id = ? ORDER BY carrier, id`)
      .all(id) as Record<string, unknown>[]
  ).map(mapPolicy);
  const threads = (
    db
      .prepare(
        `SELECT * FROM threads WHERE account_id = ? ORDER BY updated_at DESC`,
      )
      .all(id) as Record<string, unknown>[]
  ).map(mapThread);

  return { ...account, primaryUw, backupUw, policies, threads };
}

export function updateUnderwriter(
  id: string,
  patch: Partial<Pick<Underwriter, "name" | "email" | "phone" | "portal" | "notes">>,
): Underwriter {
  const db = getDb();
  const current = getUnderwriter(id);
  if (!current) throw new Error("Underwriter not found");

  const next = { ...current, ...patch };
  db.prepare(
    `UPDATE underwriters SET name = ?, email = ?, phone = ?, portal = ?, notes = ? WHERE id = ?`,
  ).run(next.name, next.email, next.phone, next.portal, next.notes, id);
  return next;
}

export function listUnderwriters(): Underwriter[] {
  const rows = getDb()
    .prepare(`SELECT * FROM underwriters ORDER BY carrier, name`)
    .all() as Record<string, unknown>[];
  return rows.map(mapUw);
}
