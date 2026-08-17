/**
 * Location State filter + account sorting check against the live local book,
 * mirroring carrier-filter-live-check. The invariants this pins: the state
 * facet partitions the real account set exactly once per account, filtering
 * moves rows/metrics consistently with the JS membership helper, every sort
 * is a deterministic total order that survives pagination, the sort keys
 * agree with the shared representative-order/revenue display rules, and the
 * sorted query stays interactive on the full book.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/state-sort-live-check.ts
 */
import { getDb } from "../src/lib/db/connection";
import {
  listBookAccountLocationStateFacet,
  listBookAccountsPage,
} from "../src/lib/db/queries/accounts";
import {
  accountMatchesLocationStates,
  isUsStateCode,
  LOCATION_STATE_NONE,
} from "../src/lib/location-state";
import { pickRepresentativeOrder } from "../src/lib/account-row-model";
import type { AccountSort } from "../src/lib/account-sort";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

getDb();

// ——— Facet partition ———
const facet = listBookAccountLocationStateFacet({ mode: "all" });
const unfiltered = listBookAccountsPage({ mode: "all", offset: 0, limit: 1 });
check(
  `state facet offers options (${facet.options.length})`,
  facet.options.length > 1,
);
check(
  `every option is a USPS code or the one Unknown bucket`,
  facet.options.every(
    (option) => option.id === LOCATION_STATE_NONE || isUsStateCode(option.id),
  ),
);
const bucketSum = facet.options.reduce((sum, o) => sum + o.accountCount, 0);
check(
  `state buckets partition the account set exactly (${bucketSum} = ${unfiltered.total})`,
  bucketSum === unfiltered.total,
);

// ——— Filtering agreement ———
const top = [...facet.options]
  .filter((option) => option.id !== LOCATION_STATE_NONE)
  .sort((a, b) => b.accountCount - a.accountCount)
  .slice(0, 2);
for (const option of top) {
  const result = listBookAccountsPage({
    mode: "all",
    locationStates: [option.id],
    offset: 0,
    limit: 5000,
  });
  check(
    `${option.id}: filtered total matches the facet count (${result.total} = ${option.accountCount})`,
    result.total === option.accountCount,
  );
  check(
    `${option.id}: every row matches by the shared JS rule`,
    result.rows.every((row) =>
      accountMatchesLocationStates(row.state, [option.id]),
    ),
  );
}
if (top.length === 2) {
  const a = listBookAccountsPage({ mode: "all", locationStates: [top[0]!.id], offset: 0, limit: 1 });
  const b = listBookAccountsPage({ mode: "all", locationStates: [top[1]!.id], offset: 0, limit: 1 });
  const both = listBookAccountsPage({
    mode: "all",
    locationStates: [top[0]!.id, top[1]!.id],
    offset: 0,
    limit: 1,
  });
  check(
    `state multi-select is a disjoint union (${a.total} + ${b.total} = ${both.total})`,
    a.total + b.total === both.total,
  );
}

// ——— Sort keys agree with the display rules ———
function displayedRevenue(
  orders: readonly { revenueMicros: number | null }[],
): number | null {
  let sum = 0;
  for (const order of orders) {
    if (order.revenueMicros === null) return null;
    sum += order.revenueMicros;
  }
  return sum;
}

function isOrdered(
  values: (string | number | null)[],
  direction: "asc" | "desc",
): boolean {
  let seenNull = false;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null) {
      seenNull = true;
      continue;
    }
    if (seenNull) return false;
    const prev = i > 0 ? values[i - 1] : null;
    if (prev === null) continue;
    if (direction === "desc" ? prev < value : prev > value) return false;
  }
  return true;
}

for (const mode of ["all", "pending", "bound", "lost"] as const) {
  const newest = listBookAccountsPage({
    mode,
    sort: { date: "newest", revenue: "none" },
    offset: 0,
    limit: 500,
  });
  const keys = newest.rows.map((row) => {
    if (mode === "bound") {
      const events = row.orders
        .map((order) => order.eventAt)
        .filter((value): value is string => value !== null);
      return events.length > 0 ? events.sort().at(-1)! : null;
    }
    return pickRepresentativeOrder(row.orders)?.createdAt ?? null;
  });
  check(
    `${mode}: newest ordering matches the canonical representative date (${newest.rows.length} rows)`,
    isOrdered(keys, "desc"),
  );
  // The default ordering is the same representative date, oldest first.
  const byDefault = listBookAccountsPage({ mode, offset: 0, limit: 500 });
  const defaultKeys = byDefault.rows.map((row) => {
    if (mode === "bound") {
      const events = row.orders
        .map((order) => order.eventAt)
        .filter((value): value is string => value !== null);
      return events.length > 0 ? events.sort().at(-1)! : null;
    }
    return pickRepresentativeOrder(row.orders)?.createdAt ?? null;
  });
  check(
    `${mode}: default ordering is oldest-first by the same date`,
    isOrdered(defaultKeys, "asc"),
  );
  const revenue = listBookAccountsPage({
    mode,
    sort: { date: "oldest", revenue: "revenue-desc" },
    offset: 0,
    limit: 500,
  });
  check(
    `${mode}: revenue ordering matches the displayed aggregate`,
    isOrdered(revenue.rows.map((row) => displayedRevenue(row.orders)), "desc"),
  );
  check(
    `${mode}: sorting never changes eligibility (${revenue.total} = ${listBookAccountsPage({ mode, offset: 0, limit: 1 }).total})`,
    revenue.total === listBookAccountsPage({ mode, offset: 0, limit: 1 }).total,
  );
}

// ——— Combined sort: revenue leads, the date order arranges equal runs ———
{
  const combined = listBookAccountsPage({
    mode: "all",
    sort: { date: "newest", revenue: "revenue-desc" },
    offset: 0,
    limit: 500,
  });
  const revenueOk = isOrdered(
    combined.rows.map((row) => displayedRevenue(row.orders)),
    "desc",
  );
  let tieOk = true;
  let ties = 0;
  for (let i = 1; i < combined.rows.length; i++) {
    const prev = combined.rows[i - 1]!;
    const row = combined.rows[i]!;
    const prevRevenue = displayedRevenue(prev.orders);
    const rowRevenue = displayedRevenue(row.orders);
    if (prevRevenue === null || prevRevenue !== rowRevenue) continue;
    ties += 1;
    const prevDate = pickRepresentativeOrder(prev.orders)?.createdAt ?? null;
    const rowDate = pickRepresentativeOrder(row.orders)?.createdAt ?? null;
    if (prevDate !== null && rowDate !== null && prevDate < rowDate) {
      tieOk = false;
    }
  }
  check(
    `combined sort: revenue leads and newest arranges ${ties} equal-revenue adjacencies`,
    revenueOk && tieOk,
  );
}

// ——— Pagination stability under every sort ———
const PAGINATION_SORTS: { label: string; sort?: AccountSort }[] = [
  { label: "default (oldest)" },
  { label: "newest", sort: { date: "newest", revenue: "none" } },
  { label: "revenue-desc", sort: { date: "oldest", revenue: "revenue-desc" } },
  { label: "revenue-asc,newest", sort: { date: "newest", revenue: "revenue-asc" } },
];
for (const { label, sort } of PAGINATION_SORTS) {
  const whole = listBookAccountsPage({ mode: "all", sort, offset: 0, limit: 300 }).rows.map((r) => r.id);
  const paged = [
    ...listBookAccountsPage({ mode: "all", sort, offset: 0, limit: 100 }).rows,
    ...listBookAccountsPage({ mode: "all", sort, offset: 100, limit: 100 }).rows,
    ...listBookAccountsPage({ mode: "all", sort, offset: 200, limit: 100 }).rows,
  ].map((r) => r.id);
  check(
    `${label}: three pages reproduce the first 300 rows exactly`,
    JSON.stringify(paged) === JSON.stringify(whole) &&
      new Set(paged).size === paged.length,
  );
}

// ——— Planner + timings ———
const db = getDb();
const statePlan = db
  .prepare(
    `EXPLAIN QUERY PLAN
     SELECT count(*) FROM accounts
     WHERE accounts.id LIKE 'co-%'
       AND upper(trim(coalesce(accounts.state, ''))) IN ('CA', 'NY')`,
  )
  .all() as { detail: string }[];
console.log(
  `INFO  state predicate plan: ${statePlan.map((row) => row.detail).join(" | ")}`,
);

function time(label: string, run: () => void, budgetMs: number) {
  const start = performance.now();
  run();
  const elapsed = performance.now() - start;
  check(`${label} (${elapsed.toFixed(1)}ms <= ${budgetMs}ms)`, elapsed <= budgetMs);
}
time(
  "state facet stays interactive",
  () => listBookAccountLocationStateFacet({ mode: "all" }),
  250,
);
time(
  "default (oldest) page stays interactive",
  () => listBookAccountsPage({ mode: "all", offset: 0, limit: 100 }),
  400,
);
time(
  "combined-sorted page stays interactive",
  () =>
    listBookAccountsPage({
      mode: "all",
      sort: { date: "newest", revenue: "revenue-desc" },
      offset: 0,
      limit: 100,
    }),
  400,
);
time(
  "sorted + filtered page stays interactive",
  () =>
    listBookAccountsPage({
      mode: "pending",
      source: "broker",
      sort: { date: "oldest", revenue: "revenue-desc" },
      locationStates: top.map((option) => option.id),
      offset: 0,
      limit: 100,
    }),
  400,
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll state & sort live checks passed");
