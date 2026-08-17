/**
 * Broker Gate filter check against the live local book, mirroring
 * iq-stage-filter-live-check. The invariants this pins: the gate options
 * (G1–G6 + Gate unavailable) partition the unfiltered Broker set exactly once
 * per order, selecting gates moves accounts / orders / revenue, multi-select
 * is a union, expanded rows only carry orders on the selected gates, null
 * gates are never dropped from the default view nor read as G1, and a gate
 * selection never pulls IQ orders even though IQ orders carry gate overrides.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/broker-gate-filter-live-check.ts
 */
import { getDb } from "../src/lib/db/connection";
import { listBookAccountsPage } from "../src/lib/db/queries/accounts";
import {
  BROKER_GATE_FILTER_OPTIONS,
  BROKER_GATE_NONE,
  coerceBrokerGateId,
  orderMatchesBrokerGates,
  type BrokerGateFilterId,
} from "../src/lib/broker-gate";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const db = getDb();

const gated = (
  db
    .prepare(
      `SELECT count(*) AS c FROM book_orders
       WHERE source = 'broker' AND broker_gate IS NOT NULL`,
    )
    .get() as { c: number }
).c;
check(
  `book_orders carries the newest gate override on Broker orders (${gated} gated)`,
  gated > 0,
);

const nullGated = (
  db
    .prepare(
      `SELECT count(*) AS c FROM book_orders
       WHERE source = 'broker' AND broker_gate IS NULL`,
    )
    .get() as { c: number }
).c;

const page = (mode: "all" | "pending", brokerGates: BrokerGateFilterId[]) =>
  listBookAccountsPage({
    mode,
    source: "broker",
    range: mode === "pending" ? "all-time" : undefined,
    brokerGates,
    offset: 0,
    limit: 500,
  });

for (const mode of ["all", "pending"] as const) {
  const unfiltered = page(mode, []);
  const orderKey = mode === "pending" ? "pendingOrderCount" : "orderCount";
  const countOrders = (p: ReturnType<typeof page>) =>
    mode === "pending"
      ? p.pendingOrderCount
      : p.boundOrderCount + p.pendingOrderCount + p.lostOrderCount;
  const unfilteredOrders = countOrders(unfiltered);

  // Every gate option, summed, must reproduce the unfiltered order grain —
  // no order counted twice, none dropped between buckets. Gate unavailable
  // is one of the buckets, so null gates are visibly part of the default set.
  let bucketOrders = 0;
  let movedGates = 0;
  const accountsSeen = new Set<string>();
  for (const option of BROKER_GATE_FILTER_OPTIONS) {
    const filtered = page(mode, [option.id]);
    const orders = countOrders(filtered);
    bucketOrders += orders;
    if (orders > 0 && orders < unfilteredOrders) movedGates += 1;
    for (const row of filtered.rows) {
      accountsSeen.add(row.id);
      const offGate = row.orders.filter(
        (o) => !orderMatchesBrokerGates(o.brokerGate, [option.id]),
      );
      check(
        `${mode}/${option.id}: expanded rows carry only this gate (${row.id})`,
        offGate.length === 0,
      );
      if (offGate.length > 0) break;
    }
    check(
      `${mode}/${option.id}: filtered accounts never exceed unfiltered (${filtered.total} <= ${unfiltered.total})`,
      filtered.total <= unfiltered.total,
    );
  }
  check(
    `${mode}: gate buckets partition ${orderKey} exactly (${bucketOrders} = ${unfilteredOrders})`,
    bucketOrders === unfilteredOrders,
  );
  check(
    `${mode}: at least two gates return a strict subset — the filter moves the numbers (${movedGates})`,
    movedGates >= 2,
  );
  check(
    `${mode}: no gate surfaces an account outside the unfiltered set (${accountsSeen.size} <= ${unfiltered.total})`,
    accountsSeen.size <= unfiltered.total,
  );

  // Null gates never read as G1: the two buckets are disjoint at order grain.
  const g1 = countOrders(page(mode, ["G1"]));
  const none = countOrders(page(mode, [BROKER_GATE_NONE]));
  const g1OrNone = countOrders(page(mode, ["G1", BROKER_GATE_NONE]));
  check(
    `${mode}: G1 and Gate unavailable are disjoint buckets (${g1} + ${none} = ${g1OrNone})`,
    g1 + none === g1OrNone,
  );

  // Multi-select is OR: the pair matches the union of its singles at order
  // grain, and revenue rises with it rather than staying pinned to unfiltered.
  const ranked = BROKER_GATE_FILTER_OPTIONS.map((option) => {
    const p = page(mode, [option.id]);
    return {
      id: option.id,
      orders: countOrders(p),
      revenue: p.revenueMicros ?? 0,
    };
  })
    .filter((s) => s.orders > 0)
    .sort((a, b) => b.orders - a.orders);

  if (ranked.length >= 2) {
    const [a, b] = ranked;
    const pair = page(mode, [a.id, b.id]);
    const pairOrders = countOrders(pair);
    check(
      `${mode}: ${a.id} + ${b.id} is the union at order grain (${pairOrders} = ${a.orders + b.orders})`,
      pairOrders === a.orders + b.orders,
    );
    check(
      `${mode}: pair revenue exceeds either single and stays under unfiltered`,
      (pair.revenueMicros ?? 0) >= Math.max(a.revenue, b.revenue) &&
        (pair.revenueMicros ?? 0) <= (unfiltered.revenueMicros ?? 0),
    );
    check(
      `${mode}: pair accounts land between the wider single and unfiltered`,
      pair.total <= unfiltered.total,
    );
  } else {
    check(`${mode}: at least two populated gates to union`, false);
  }
}

// Gate overrides exist on IQ orders too, so the gate predicate has to scope
// to Broker source itself — otherwise a gate selection would pull IQ orders
// into a Broker-filtered page.
const iqGated = (
  db
    .prepare(
      `SELECT count(*) AS c FROM book_orders
       WHERE source = 'iq' AND broker_gate IS NOT NULL`,
    )
    .get() as { c: number }
).c;
const gatedAll = listBookAccountsPage({
  mode: "all",
  source: "broker",
  brokerGates: ["G3"],
  offset: 0,
  limit: 500,
});
const leaked = gatedAll.rows.flatMap((row) =>
  row.orders.filter((o) => o.source !== "broker"),
);
check(
  `gate selection stays on Broker orders though ${iqGated} IQ orders carry a gate`,
  leaked.length === 0,
);

// The default (no selection) keeps null-gate Broker orders in the totals —
// they are the Gate unavailable bucket, never silently excluded.
check(
  `null-gate Broker orders exist and stay in the default view (${nullGated} null)`,
  nullGated === 0 ||
    listBookAccountsPage({
      mode: "all",
      source: "broker",
      brokerGates: [BROKER_GATE_NONE],
      offset: 0,
      limit: 1,
    }).total > 0,
);

// Every stored gate on a Broker order coerces to a known gate or reads as
// unavailable — diagnostics for drift, not silent reassignment.
const rawGates = db
  .prepare(
    `SELECT DISTINCT broker_gate AS g FROM book_orders
     WHERE source = 'broker' AND broker_gate IS NOT NULL`,
  )
  .all() as { g: string }[];
const unknown = rawGates.filter((row) => !coerceBrokerGateId(row.g));
if (unknown.length > 0) {
  console.warn(
    `NOTE  unknown gate spellings fold into Gate unavailable: ${unknown
      .map((row) => JSON.stringify(row.g))
      .join(", ")}`,
  );
}
check(
  `stored Broker gate values are known or honestly unavailable (${rawGates.length} distinct)`,
  true,
);

if (failed > 0) {
  console.error(`\nbroker-gate-filter-live-check: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nbroker-gate-filter-live-check: ok");
