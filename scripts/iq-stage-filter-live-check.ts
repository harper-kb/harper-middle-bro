/**
 * IQ Stage filter check against the live local book. The regression this pins:
 * the filter reached the UI while `book_orders.iq_stage_tag` was still empty,
 * so every stage read as "No status" and the KPI numbers never moved.
 *
 * Verifies the snapshot actually carries `orders_temp.tag`, that the stage
 * options partition the unfiltered set exactly once per order, that selecting
 * stages moves accounts / orders / revenue, that multi-select is a union, and
 * that returned rows only carry orders in the selected stages.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/iq-stage-filter-live-check.ts
 */
import { getDb } from "../src/lib/db/connection";
import { listBookAccountsPage } from "../src/lib/db/queries/accounts";
import {
  IQ_STAGE_FILTER_OPTIONS,
  iqStageFromTag,
  type IqStageFilterId,
} from "../src/lib/iq-stage";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const db = getDb();

const tagged = (
  db
    .prepare(
      `SELECT count(*) AS c FROM book_orders
       WHERE source = 'iq' AND iq_stage_tag IS NOT NULL`,
    )
    .get() as { c: number }
).c;
check(
  `book_orders carries orders_temp.tag on IQ orders (${tagged} tagged)`,
  tagged > 0,
);

const page = (mode: "all" | "pending", iqStages: IqStageFilterId[]) =>
  listBookAccountsPage({
    mode,
    source: "iq",
    range: mode === "pending" ? "all-time" : undefined,
    iqStages,
    offset: 0,
    limit: 500,
  });

for (const mode of ["all", "pending"] as const) {
  const unfiltered = page(mode, []);
  const orderKey = mode === "pending" ? "pendingOrderCount" : "orderCount";
  const unfilteredOrders =
    mode === "pending"
      ? unfiltered.pendingOrderCount
      : unfiltered.boundOrderCount +
        unfiltered.pendingOrderCount +
        unfiltered.lostOrderCount;

  // Every stage option, summed, must reproduce the unfiltered order grain —
  // no order counted twice, none dropped between buckets.
  let bucketOrders = 0;
  let movedStages = 0;
  const accountsSeen = new Set<string>();
  for (const option of IQ_STAGE_FILTER_OPTIONS) {
    const filtered = page(mode, [option.id]);
    const orders =
      mode === "pending"
        ? filtered.pendingOrderCount
        : filtered.boundOrderCount +
          filtered.pendingOrderCount +
          filtered.lostOrderCount;
    bucketOrders += orders;
    if (orders > 0 && orders < unfilteredOrders) movedStages += 1;
    for (const row of filtered.rows) {
      accountsSeen.add(row.id);
      const offStage = row.orders.filter(
        (o) => iqStageFromTag(o.iqStageTag).id !== option.id,
      );
      check(
        `${mode}/${option.id}: expanded rows carry only this stage (${row.id})`,
        offStage.length === 0,
      );
      if (offStage.length > 0) break;
    }
    check(
      `${mode}/${option.id}: filtered accounts never exceed unfiltered (${filtered.total} <= ${unfiltered.total})`,
      filtered.total <= unfiltered.total,
    );
  }
  check(
    `${mode}: stage buckets partition ${orderKey} exactly (${bucketOrders} = ${unfilteredOrders})`,
    bucketOrders === unfilteredOrders,
  );
  check(
    `${mode}: at least two stages return a strict subset — the filter moves the numbers (${movedStages})`,
    movedStages >= 2,
  );
  check(
    `${mode}: no stage surfaces an account outside the unfiltered set (${accountsSeen.size} <= ${unfiltered.total})`,
    accountsSeen.size <= unfiltered.total,
  );

  // Multi-select is OR: the pair matches the union of its singles at order
  // grain, and revenue rises with it rather than staying pinned to unfiltered.
  const ranked = IQ_STAGE_FILTER_OPTIONS.map((option) => {
    const p = page(mode, [option.id]);
    return {
      id: option.id,
      orders:
        mode === "pending"
          ? p.pendingOrderCount
          : p.boundOrderCount + p.pendingOrderCount + p.lostOrderCount,
      revenue: p.revenueMicros ?? 0,
    };
  })
    .filter((s) => s.orders > 0)
    .sort((a, b) => b.orders - a.orders);

  if (ranked.length >= 2) {
    const [a, b] = ranked;
    const pair = page(mode, [a.id, b.id]);
    const pairOrders =
      mode === "pending"
        ? pair.pendingOrderCount
        : pair.boundOrderCount + pair.pendingOrderCount + pair.lostOrderCount;
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
    check(`${mode}: at least two populated stages to union`, false);
  }
}

// `orders_temp.tag` is set on Broker orders too, so the stage predicate has to
// scope to IQ source itself — otherwise a stage selection would pull Broker
// orders into an IQ-filtered page.
const brokerTagged = (
  db
    .prepare(
      `SELECT count(*) AS c FROM book_orders
       WHERE source = 'broker' AND iq_stage_tag IS NOT NULL`,
    )
    .get() as { c: number }
).c;
const stagedAll = listBookAccountsPage({
  mode: "all",
  source: "iq",
  iqStages: ["binder_received"],
  offset: 0,
  limit: 500,
});
const leaked = stagedAll.rows.flatMap((row) =>
  row.orders.filter((o) => o.source !== "iq"),
);
check(
  `stage selection stays on IQ orders though ${brokerTagged} Broker orders carry a tag`,
  leaked.length === 0,
);

if (failed > 0) {
  console.error(`\niq-stage-filter-live-check: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\niq-stage-filter-live-check: ok");
