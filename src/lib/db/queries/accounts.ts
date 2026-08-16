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
  /** Newest gate override; null = Gate unavailable. Display-only. */
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
 * One page of the live book with orders attached — a single SQL pass instead
 * of per-account detail lookups, which do not scale to the ~10k accounts the
 * full book carries.
 */
export function listBookAccountsPage(opts: {
  query?: string;
  mode?: BookOrdersViewMode;
  range?: OrderReportingRangeId;
  source?: AccountSourceId;
  /** Selected IQ Stage filter ids; empty means all stages. */
  iqStages?: readonly IqStageFilterId[];
  offset: number;
  limit: number;
}): BookAccountsPage {
  const db = getDb();
  const mode = opts.mode ?? "all";
  const source = opts.source ?? "all";
  const iqStages = opts.iqStages ?? [];
  const q = `%${(opts.query ?? "").trim().toLowerCase()}%`;
  const reportingWindow =
    (mode === "pending" || mode === "bound") &&
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
  const stageViewSql = iqStageOrderSql("view_orders", iqStages);
  const stageRowSql = iqStageOrderSql("o", iqStages);
  // Strict partition on the deal-level source: the account qualifies only when
  // every order in the current view carries the selected source. Unclassified
  // (NULL) and mixed orders disqualify it, so those accounts surface only under
  // "All" rather than being silently counted as IQ or Broker.
  const sourceScope =
    mode === "all"
      ? ""
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
  const params = {
    q,
    rangeStart: reportingWindow?.startsAt ?? null,
    rangeEnd: reportingWindow?.endsAt ?? null,
  };
  const accountOrderFilter =
    mode === "all"
      ? ` AND EXISTS (
          SELECT 1 FROM book_orders view_orders
          WHERE view_orders.account_id = accounts.id
          ${stageViewSql}
        )`
      : ` AND EXISTS (
          SELECT 1 FROM book_orders view_orders
          WHERE view_orders.account_id = accounts.id
            AND view_orders.bind_status = '${mode}'
            ${rangeFilter}
            ${stageViewSql}
        )`;
  const orderFilter =
    mode === "all"
      ? stageRowSql
      : ` AND o.bind_status = '${mode}'${rowRangeFilter}${stageRowSql}`;
  const where = `accounts.id LIKE 'co-%'
    AND (
      lower(accounts.name) LIKE @q
      OR lower(coalesce(accounts.dba,'')) LIKE @q
    )${sourceFilter}${accountOrderFilter}`;

  const statusRangeFilter =
    reportingWindow && mode !== "all"
      ? ` AND o.event_at >= @rangeStart AND o.event_at < @rangeEnd`
      : "";
  const statusCount = (status: BookOrderBindStatus) => `(
           SELECT count(*) FROM book_orders o
           WHERE o.bind_status = '${status}'
             ${status === mode ? statusRangeFilter : ""}
             ${stageRowSql}
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
               ${status === mode ? statusRangeFilter : ""}
               ${stageRowSql}
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
              (
                SELECT count(*) FROM book_orders o
                WHERE o.account_id = accounts.id${orderFilter}
              ) AS order_count,
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
       ORDER BY name
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
      };
    }),
  };
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
