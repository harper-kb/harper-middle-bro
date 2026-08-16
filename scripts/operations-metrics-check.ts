/**
 * Read-only operational KPI check for one explicit Harper business date.
 *
 * Runs the seven-day Eastern history aggregate the stats bar uses, picks the
 * requested business date, and verifies every metric on that day against
 * independently listed record IDs.
 *
 * It also prints a CAND block for the two definitions that live Harper data
 * could not distinguish on 2026-08-15, because every candidate collapsed to
 * the same number on that low-volume Saturday:
 *   - COIs Sent: prepare-email rows vs every coi_edit_log row vs distinct deals.
 *   - Bind Sent same-day: joined through the envelope's own order vs any order
 *     created that day on the same company (BigBrother's documented rule).
 * Run this on a normal weekday and compare the CAND lines against the
 * BigBrother header to settle which definition each tile uses.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npx tsx --tsconfig scripts/tsconfig.render-check.json \
 *     scripts/operations-metrics-check.ts 2026-08-15
 */
import {
  BIND_SENT_TIME_ZONE,
  OPERATIONS_METRICS_SQL,
  parseOperationsMetricsRow,
  type OperationsMetricsRow,
} from "../src/lib/db/operations-metrics";

type BindDetailRow = {
  bind_envelope_ids: unknown;
  bind_raw_rows: unknown;
  bind_distinct_events: unknown;
  bind_missing_order: unknown;
  same_day_by_order: unknown;
  same_day_by_company: unknown;
};

type ZoneDetailRow = {
  new_order_ids: unknown;
  bound_deal_ids: unknown;
  coi_ids: unknown;
  new_orders_distinct_companies: unknown;
  bound_distinct_orders: unknown;
  cois_all_triggers: unknown;
  cois_distinct_deals: unknown;
  bound_deleted: unknown;
  bound_cancelled: unknown;
  bound_missing_policy: unknown;
  bound_orders_with_multiple_deals: unknown;
};

/** Weekday volume runs to hundreds of rows; keep the transcript readable. */
const MAX_PRINTED_IDS = 10;

let failures = 0;

function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

function integer(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`expected a non-negative integer, received ${String(value)}`);
  }
  return parsed;
}

function ids(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string | number =>
      typeof item === "string" || typeof item === "number",
  );
}

function sample(list: Array<string | number>): string {
  if (list.length === 0) return "none";
  const head = list.slice(0, MAX_PRINTED_IDS).join(", ");
  const rest = list.length - MAX_PRINTED_IDS;
  return rest > 0 ? `${head} … +${rest} more` : head;
}

/** Flags a definition whose candidates disagree, so it needs a live comparison. */
function candidate(label: string, values: Record<string, number>) {
  const distinct = new Set(Object.values(values));
  const rendered = Object.entries(values)
    .map(([name, value]) => `${name} ${value}`)
    .join(" | ");
  const verdict =
    distinct.size === 1
      ? "candidates agree"
      : "CANDIDATES DISAGREE — compare against BigBrother";
  console.log(`CAND  ${label}: ${rendered}  (${verdict})`);
}

async function managementQuery<T>(query: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    throw new Error("SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set");
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`management API ${response.status}: ${body.slice(0, 300)}`);
  }
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) {
    throw new Error("management API returned a non-array body");
  }
  return rows as T[];
}

async function main() {
  const businessDate = process.argv[2];
  if (!businessDate) {
    throw new Error("pass an explicit business date in YYYY-MM-DD format");
  }

  const aggregateRows = await managementQuery<OperationsMetricsRow>(
    OPERATIONS_METRICS_SQL,
  );
  const metrics = parseOperationsMetricsRow(aggregateRows[0]);
  const bind = metrics.bindDays.find(
    (candidate) => candidate.businessDate === businessDate,
  );
  if (!bind) {
    throw new Error(
      `business date ${businessDate} is outside the current bind window (${
        metrics.bindDays[metrics.bindDays.length - 1].businessDate
      } … ${metrics.bindDays[0].businessDate})`,
    );
  }

  console.log(
    `INFO  Bind Sent window ${bind.businessDate} ${BIND_SENT_TIME_ZONE} [${bind.window.startsAt}, ${bind.window.endsAt})`,
  );
  console.log(
    `INFO  Bind Sent ${bind.total} (${bind.sameDay} same-day / ${bind.backlog} backlog)`,
  );

  const [bindDetail] = await managementQuery<BindDetailRow>(`
WITH w AS (
  SELECT
    timestamptz '${bind.window.startsAt}' AS starts_at,
    timestamptz '${bind.window.endsAt}' AS ends_at
),
bind_rows AS (
  SELECT de.envelope_id, de.order_id, de.company_id, de.updated_at
  FROM public.docusign_envelopes de
  CROSS JOIN w
  WHERE de.sent_at >= w.starts_at
    AND de.sent_at < w.ends_at
    AND de.subject ILIKE '%binding packet%'
),
bind_events AS (
  SELECT DISTINCT ON (envelope_id) envelope_id, order_id, company_id
  FROM bind_rows
  ORDER BY envelope_id, updated_at DESC
),
classified AS (
  SELECT
    be.envelope_id,
    be.order_id,
    EXISTS (
      SELECT 1 FROM public.orders_temp o CROSS JOIN w
      WHERE o.id = be.order_id
        AND NOT COALESCE(o.is_deleted, false)
        AND o.created_at >= w.starts_at AND o.created_at < w.ends_at
    ) AS same_day_by_order,
    EXISTS (
      SELECT 1 FROM public.orders_temp o CROSS JOIN w
      WHERE o.company_id = be.company_id
        AND NOT COALESCE(o.is_deleted, false)
        AND o.created_at >= w.starts_at AND o.created_at < w.ends_at
    ) AS same_day_by_company
  FROM bind_events be
)
SELECT
  (SELECT COALESCE(json_agg(envelope_id ORDER BY envelope_id), '[]') FROM classified) AS bind_envelope_ids,
  (SELECT COUNT(*) FROM bind_rows) AS bind_raw_rows,
  (SELECT COUNT(DISTINCT envelope_id) FROM bind_rows) AS bind_distinct_events,
  (
    SELECT COUNT(*)
    FROM classified c
    LEFT JOIN public.orders_temp ot ON ot.id = c.order_id
    WHERE ot.id IS NULL
  ) AS bind_missing_order,
  (SELECT COUNT(*) FROM classified WHERE same_day_by_order) AS same_day_by_order,
  (SELECT COUNT(*) FROM classified WHERE same_day_by_company) AS same_day_by_company`);

  if (!bindDetail) throw new Error("bind detail query returned no row");
  const bindIds = ids(bindDetail.bind_envelope_ids);
  console.log(`INFO  bind envelope IDs: ${sample(bindIds)}`);

  check("Bind Sent reconciles", bind.sameDay + bind.backlog === bind.total);
  check("Bind Sent ID count matches", bindIds.length === bind.total);
  check(
    "Bind Sent is not inflated by duplicate envelope rows",
    integer(bindDetail.bind_raw_rows) === integer(bindDetail.bind_distinct_events),
  );
  check(
    "Bind Sent same-day matches the shipped order-join definition",
    integer(bindDetail.same_day_by_order) === bind.sameDay,
  );
  console.log(
    `INFO  ${integer(bindDetail.bind_missing_order)} bind events have no matching order`,
  );
  candidate("Bind Sent same-day", {
    "by envelope order (shipped)": integer(bindDetail.same_day_by_order),
    "by same-company order (BigBrother doc)": integer(bindDetail.same_day_by_company),
  });

  for (const zone of metrics.zones) {
    const day = zone.days.find(
      (candidate) => candidate.businessDate === businessDate,
    );
    if (!day) {
      console.log("");
      console.log(
        `INFO  ${zone.timeZone} has no ${businessDate} row (its business day is behind Eastern) — skipped`,
      );
      continue;
    }

    const [detail] = await managementQuery<ZoneDetailRow>(`
WITH w AS (
  SELECT
    timestamptz '${day.window.startsAt}' AS starts_at,
    timestamptz '${day.window.endsAt}' AS ends_at
),
new_orders AS (
  SELECT ot.id, ot.company_id
  FROM public.orders_temp ot
  CROSS JOIN w
  WHERE NOT COALESCE(ot.is_deleted, false)
    AND ot.created_at >= w.starts_at
    AND ot.created_at < w.ends_at
),
bound_deals AS (
  SELECT d.*
  FROM public.deals_v2 d
  CROSS JOIN w
  WHERE d.bound_at >= w.starts_at
    AND d.bound_at < w.ends_at
),
cois AS (
  SELECT l.id, l.deal_id, l.trigger
  FROM public.coi_edit_log l
  CROSS JOIN w
  WHERE l.created_at >= w.starts_at
    AND l.created_at < w.ends_at
)
SELECT
  (SELECT COALESCE(json_agg(id ORDER BY id), '[]') FROM new_orders) AS new_order_ids,
  (SELECT COALESCE(json_agg(id ORDER BY id), '[]') FROM bound_deals) AS bound_deal_ids,
  (SELECT COALESCE(json_agg(id ORDER BY id), '[]') FROM cois WHERE trigger = 'prepare-email') AS coi_ids,
  (SELECT COUNT(DISTINCT company_id) FROM new_orders) AS new_orders_distinct_companies,
  (SELECT COUNT(DISTINCT order_number) FROM bound_deals WHERE order_number IS NOT NULL) AS bound_distinct_orders,
  (SELECT COUNT(*) FROM cois) AS cois_all_triggers,
  (SELECT COUNT(DISTINCT deal_id) FROM cois WHERE trigger = 'prepare-email') AS cois_distinct_deals,
  (SELECT COUNT(*) FROM bound_deals WHERE COALESCE(is_deleted, false)) AS bound_deleted,
  (
    SELECT COUNT(*)
    FROM bound_deals
    WHERE cancelled_date IS NOT NULL OR policy_status ILIKE 'cancel%'
  ) AS bound_cancelled,
  (
    SELECT COUNT(*)
    FROM bound_deals
    WHERE NULLIF(BTRIM(policy_number), '') IS NULL
  ) AS bound_missing_policy,
  (
    SELECT COUNT(*)
    FROM (
      SELECT order_number
      FROM bound_deals
      WHERE order_number IS NOT NULL
      GROUP BY order_number
      HAVING COUNT(*) > 1
    ) duplicates
  ) AS bound_orders_with_multiple_deals`);

    if (!detail) throw new Error(`detail query returned no row for ${zone.timeZone}`);
    const newOrderIds = ids(detail.new_order_ids);
    const boundDealIds = ids(detail.bound_deal_ids);
    const coiIds = ids(detail.coi_ids);

    console.log("");
    console.log(
      `INFO  ${zone.timeZone} ${day.businessDate} (UTC-${zone.utcOffsetMinutes / 60}) ` +
        `New Orders ${day.newOrders}, Bound ${day.bound}, COIs Sent ${day.coisSent}`,
    );
    console.log(`INFO    new order IDs: ${sample(newOrderIds)}`);
    console.log(`INFO    bound deal IDs: ${sample(boundDealIds)}`);
    console.log(`INFO    COI log IDs: ${sample(coiIds)}`);
    console.log(
      `INFO    quality: ${integer(detail.bound_deleted)} deleted, ` +
        `${integer(detail.bound_cancelled)} cancelled, ` +
        `${integer(detail.bound_missing_policy)} missing-policy bound deals; ` +
        `${integer(detail.bound_orders_with_multiple_deals)} orders with multiple bound deals`,
    );

    check(
      `${zone.timeZone} New Orders ID count matches`,
      newOrderIds.length === day.newOrders,
    );
    check(
      `${zone.timeZone} Bound ID count matches`,
      boundDealIds.length === day.bound,
    );
    check(
      `${zone.timeZone} COIs Sent ID count matches`,
      coiIds.length === day.coisSent,
    );

    candidate(`${zone.timeZone} COIs Sent`, {
      "prepare-email (shipped)": day.coisSent,
      "all triggers": integer(detail.cois_all_triggers),
      "distinct deals": integer(detail.cois_distinct_deals),
    });
    candidate(`${zone.timeZone} New Orders`, {
      "orders (shipped)": day.newOrders,
      "distinct companies": integer(detail.new_orders_distinct_companies),
    });
    candidate(`${zone.timeZone} Bound`, {
      "deals (shipped)": day.bound,
      "distinct orders": integer(detail.bound_distinct_orders),
    });
  }

  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error("FAIL ", error instanceof Error ? error.message : error);
  process.exit(1);
});
