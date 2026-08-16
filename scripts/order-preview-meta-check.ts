/**
 * Order preview metadata check — source, revenue and deal age as the previews
 * will actually render them, verified against the synced book in SQLite.
 *
 * Guards the three claims the preview makes:
 *   source   — equals the persisted book_orders.source the IQ/Broker filter
 *              partitions on; NULL never becomes broker
 *   revenue  — micros and cents agree, and NULL stays distinct from 0
 *   age      — measured from orders_temp.created_at in America/Los_Angeles,
 *              non-negative, and free of the ordered_date outliers
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/order-preview-meta-check.ts
 */
import { getDb } from "../src/lib/db/connection";
import { listBookAccountsPage } from "../src/lib/db/queries/accounts";
import {
  dealAgeDays,
  dealAgeLabel,
  dealAgeNeedsAttention,
  harperCalendarDay,
  harperTimestampLabel,
} from "../src/lib/order-age";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const db = getDb();
const todayDay = harperCalendarDay(new Date())!;
console.log(`INFO  Harper calendar day: ${todayDay}`);

const totals = db
  .prepare(
    `SELECT
       count(*) AS orders,
       count(created_at) AS with_created_at,
       count(*) FILTER (WHERE created_at < '2020-01-01') AS absurdly_old,
       count(source) AS with_source,
       count(*) FILTER (WHERE source = 'iq') AS iq,
       count(*) FILTER (WHERE source = 'broker') AS broker,
       count(*) FILTER (WHERE source = 'mixed') AS mixed,
       count(revenue_micros) AS with_revenue,
       count(*) FILTER (WHERE revenue_micros = 0) AS zero_revenue
     FROM book_orders`,
  )
  .get() as Record<string, number>;

check(
  `every book order carries created_at (${totals.with_created_at} / ${totals.orders})`,
  totals.orders > 0 && totals.with_created_at === totals.orders,
);
check(
  `no created_at predates the trading window (${totals.absurdly_old} absurd)`,
  totals.absurdly_old === 0,
);
check(
  `source persisted for classification (${totals.iq} iq / ${totals.broker} broker / ${totals.mixed} mixed, ${
    totals.orders - totals.with_source
  } unclassified)`,
  totals.with_source > 0 && totals.iq > 0 && totals.broker > 0,
);
check(
  `revenue present on most orders (${totals.with_revenue} / ${totals.orders}, ${totals.zero_revenue} authoritative zeros)`,
  totals.with_revenue > 0,
);

// The preview reads the same source column the filter partitions on, so an
// IQ-filtered page can only contain IQ orders.
for (const source of ["iq", "broker"] as const) {
  const page = listBookAccountsPage({
    mode: "pending",
    source,
    offset: 0,
    limit: 200,
  });
  const orders = page.rows.flatMap((account) => account.orders);
  check(
    `pending/${source}: every previewed order reports source "${source}" (${orders.length} orders)`,
    orders.length > 0 && orders.every((order) => order.source === source),
  );
}

// Every projected field must match the row it came from — the JSON projection
// in listBookAccountsPage is the seam most likely to drift.
const sample = db
  .prepare(
    `SELECT id, harper_order_id, account_id, created_at, revenue_micros, revenue_cents, source
     FROM book_orders
     ORDER BY created_at DESC
     LIMIT 40`,
  )
  .all() as {
  id: string;
  harper_order_id: number;
  account_id: string;
  created_at: string | null;
  revenue_micros: number | null;
  revenue_cents: number | null;
  source: string | null;
}[];

let projectionMismatches = 0;
let centsMismatches = 0;
let negativeAges = 0;
let checkedRows = 0;
let attentionRows = 0;
const ageHistogram = new Map<number, number>();

for (const row of sample) {
  const page = listBookAccountsPage({
    query: "",
    offset: 0,
    limit: 1,
  });
  void page;
  const account = db
    .prepare(`SELECT name FROM accounts WHERE id = ?`)
    .get(row.account_id) as { name: string } | undefined;
  if (!account) continue;
  const hit = listBookAccountsPage({
    query: account.name,
    offset: 0,
    limit: 100,
  })
    .rows.flatMap((a) => a.orders)
    .find((order) => order.id === row.id);
  if (!hit) continue;
  checkedRows += 1;

  if (
    hit.createdAt !== row.created_at ||
    hit.revenueMicros !== row.revenue_micros ||
    hit.source !== row.source
  ) {
    projectionMismatches += 1;
  }

  // Micros are a six-place copy of the same numeric that produced cents.
  if (
    row.revenue_micros !== null &&
    row.revenue_cents !== null &&
    Math.round(row.revenue_micros / 10_000) !== row.revenue_cents
  ) {
    centsMismatches += 1;
  }

  const age = dealAgeDays(hit.createdAt, todayDay);
  if (age === null) continue;
  if (age < 0) negativeAges += 1;
  ageHistogram.set(age, (ageHistogram.get(age) ?? 0) + 1);
  if (dealAgeNeedsAttention(age)) attentionRows += 1;
}

check(`sample rows resolved through the page query (${checkedRows})`, checkedRows > 0);
check(
  `projected createdAt / revenueMicros / source match the row (${projectionMismatches} mismatches)`,
  projectionMismatches === 0,
);
check(
  `revenue micros round-trip to the stored cents (${centsMismatches} mismatches)`,
  centsMismatches === 0,
);
check(`no negative deal ages (${negativeAges})`, negativeAges === 0);

const ages = [...ageHistogram.entries()].sort((a, b) => a[0] - b[0]);
console.log(
  `INFO  newest-40 age spread: ${ages
    .map(([days, count]) => `${dealAgeLabel(days)}×${count}`)
    .join(", ")}`,
);
console.log(`INFO  of those, ${attentionRows} would show the attention state`);

// Oldest pending order proves the attention path renders on live data.
const oldestPending = db
  .prepare(
    `SELECT harper_order_id, created_at, revenue_micros, source
     FROM book_orders
     WHERE bind_status = 'pending' AND created_at IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 1`,
  )
  .get() as
  | {
      harper_order_id: number;
      created_at: string;
      revenue_micros: number | null;
      source: string | null;
    }
  | undefined;

if (oldestPending) {
  const age = dealAgeDays(oldestPending.created_at, todayDay)!;
  check(
    `oldest pending order escalates (#${oldestPending.harper_order_id}, ${dealAgeLabel(age)}, created ${harperTimestampLabel(oldestPending.created_at)})`,
    dealAgeNeedsAttention(age),
  );
} else {
  check("a pending order exists to exercise the attention path", false);
}

const newest = db
  .prepare(
    `SELECT harper_order_id, created_at FROM book_orders
     WHERE created_at IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
  )
  .get() as { harper_order_id: number; created_at: string } | undefined;
if (newest) {
  const newestAge = dealAgeDays(newest.created_at, todayDay)!;
  check(
    `newest order reads as a neutral age (#${newest.harper_order_id}, ${dealAgeLabel(newestAge)})`,
    !dealAgeNeedsAttention(newestAge),
  );
} else {
  check("an order with a creation timestamp exists", false);
}

process.exit(failed ? 1 : 0);
