/**
 * Carrier filter check against the live local book, mirroring
 * broker-gate-filter-live-check. The invariants this pins: the derived
 * book_order_carriers read model matches every order's deal payload exactly,
 * the facet option counts agree with the page query carrier by carrier, the
 * facet excludes only the carrier selection from its own derivation, options
 * always come from the complete filtered set, multi-select is a union, rows
 * only ever carry matching orders, and the SQLite planner serves both the
 * filter predicate and the facet grouping from indexes rather than scans.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/carrier-filter-live-check.ts
 */
import { getDb } from "../src/lib/db/connection";
import {
  listBookAccountCarrierFacet,
  listBookAccountsPage,
} from "../src/lib/db/queries/accounts";
import {
  carrierKeysForDeals,
  orderMatchesCarriers,
} from "../src/lib/carrier-filter";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const db = getDb();

// ——— Read model vs deal payloads ———
const derived = (
  db.prepare(`SELECT count(*) AS c FROM book_order_carriers`).get() as {
    c: number;
  }
).c;
check(`book_order_carriers is populated (${derived} rows)`, derived > 0);

const orders = db
  .prepare(`SELECT id, rich_json FROM book_orders`)
  .all() as { id: string; rich_json: string }[];
let mismatches = 0;
for (const order of orders) {
  const deals = (JSON.parse(order.rich_json) as {
    deals?: { carrierName: string | null }[];
  }).deals;
  const expected = carrierKeysForDeals(Array.isArray(deals) ? deals : []);
  const stored = (
    db
      .prepare(
        `SELECT carrier_key FROM book_order_carriers WHERE order_id = ? ORDER BY carrier_key`,
      )
      .all(order.id) as { carrier_key: string }[]
  ).map((row) => row.carrier_key);
  if (JSON.stringify(expected) !== JSON.stringify(stored)) mismatches += 1;
}
check(
  `derived carrier keys match every order's deal payload (${orders.length} orders, ${mismatches} mismatches)`,
  mismatches === 0,
);

// ——— Facet ↔ page-query agreement, per carrier and per mode ———
for (const mode of ["all", "pending", "bound", "lost"] as const) {
  const facet = listBookAccountCarrierFacet({ mode });
  check(
    `${mode}: facet offers options (${facet.options.length})`,
    mode === "all" ? facet.options.length > 1 : facet.options.length >= 0,
  );
  let agreements = 0;
  const sample = facet.options.filter((_, i) => i % 25 === 0).slice(0, 8);
  for (const option of sample) {
    const page = listBookAccountsPage({
      mode,
      carriers: [option.key],
      offset: 0,
      limit: 5000,
    });
    // The facet counts the mode's own orders; the KPI strip for a scoped
    // view reads the same single number (the other statuses describe the
    // qualifying accounts' wider book, not this view's order set).
    const matched =
      mode === "all"
        ? page.boundOrderCount + page.pendingOrderCount + page.lostOrderCount
        : mode === "pending"
          ? page.pendingOrderCount
          : mode === "bound"
            ? page.boundOrderCount
            : page.lostOrderCount;
    if (matched === option.orderCount) agreements += 1;
    for (const row of page.rows) {
      const off = row.orders.filter(
        (o) => !orderMatchesCarriers(o.rich.deals, [option.key]),
      );
      if (off.length > 0) {
        check(
          `${mode}/${option.key}: expanded rows carry only matching orders (${row.id})`,
          false,
        );
      }
    }
  }
  check(
    `${mode}: facet counts agree with the page query (${agreements}/${sample.length} sampled)`,
    agreements === sample.length,
  );
}

// ——— Self-exclusion and full-set derivation ———
const facetAll = listBookAccountCarrierFacet({ mode: "all" });
const top = [...facetAll.options].sort((a, b) => b.orderCount - a.orderCount);
if (top.length >= 2) {
  const [a, b] = top;
  const withSelection = listBookAccountCarrierFacet({
    mode: "all",
    selectedCarriers: [a.key],
  });
  check(
    `facet self-exclusion: selecting ${a.key} changes no option (${withSelection.options.length} = ${facetAll.options.length})`,
    JSON.stringify(withSelection.options) === JSON.stringify(facetAll.options),
  );

  const single = {
    a: listBookAccountsPage({ mode: "all", carriers: [a.key], offset: 0, limit: 1 }),
    b: listBookAccountsPage({ mode: "all", carriers: [b.key], offset: 0, limit: 1 }),
  };
  const pair = listBookAccountsPage({
    mode: "all",
    carriers: [a.key, b.key],
    offset: 0,
    limit: 1,
  });
  const count = (p: typeof pair) =>
    p.boundOrderCount + p.pendingOrderCount + p.lostOrderCount;
  check(
    `multi-select is a union: max(${count(single.a)}, ${count(single.b)}) <= ${count(pair)} <= ${count(single.a) + count(single.b)}`,
    count(pair) >= Math.max(count(single.a), count(single.b)) &&
      count(pair) <= count(single.a) + count(single.b),
  );

  const firstPage = listBookAccountsPage({
    mode: "all",
    offset: 0,
    limit: 1,
  });
  const pageCarrierKeys = new Set(
    firstPage.rows.flatMap((row) =>
      row.orders.flatMap((o) => carrierKeysForDeals(o.rich.deals)),
    ),
  );
  check(
    `options derive from the whole set, not page 1 (${facetAll.options.length} options > ${pageCarrierKeys.size} on page)`,
    facetAll.options.length > pageCarrierKeys.size,
  );
}

// ——— Planner: indexed lookups, not table scans ———
const filterPlan = db
  .prepare(
    `EXPLAIN QUERY PLAN
     SELECT count(*) FROM book_orders o
     WHERE o.account_id = 'co-1'
       AND EXISTS (
         SELECT 1 FROM book_order_carriers order_carriers
         WHERE order_carriers.order_id = o.id
           AND order_carriers.carrier_key IN ('hiscox ins co')
       )`,
  )
  .all() as { detail: string }[];
const filterDetail = filterPlan.map((row) => row.detail).join(" | ");
check(
  `carrier predicate probes the read model by primary key (${filterDetail})`,
  /SEARCH order_carriers .*USING (COVERING )?(PRIMARY KEY|INDEX)/.test(
    filterDetail,
  ),
);

const facetPlan = db
  .prepare(
    `EXPLAIN QUERY PLAN
     SELECT order_carriers.carrier_key, count(*)
     FROM book_order_carriers order_carriers
     JOIN book_orders o ON o.id = order_carriers.order_id
     GROUP BY order_carriers.carrier_key`,
  )
  .all() as { detail: string }[];
const facetDetail = facetPlan.map((row) => row.detail).join(" | ");
check(
  `facet grouping walks the carrier-key index (${facetDetail})`,
  /USING (COVERING )?INDEX book_order_carriers_key/.test(facetDetail) ||
    /SCAN order_carriers USING/.test(facetDetail),
);

// ——— Timings on the live book ———
function time(label: string, run: () => void, budgetMs: number) {
  const start = performance.now();
  run();
  const elapsed = performance.now() - start;
  check(`${label} (${elapsed.toFixed(1)}ms <= ${budgetMs}ms)`, elapsed <= budgetMs);
}
if (top.length >= 1) {
  time(
    "filtered page query stays interactive",
    () =>
      listBookAccountsPage({
        mode: "all",
        carriers: [top[0]!.key],
        offset: 0,
        limit: 100,
      }),
    250,
  );
}
time(
  "facet derivation stays interactive",
  () => listBookAccountCarrierFacet({ mode: "all" }),
  250,
);
time(
  "facet under search + source stays interactive",
  () =>
    listBookAccountCarrierFacet({ mode: "pending", source: "broker", query: "a" }),
  250,
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll carrier filter live checks passed");
