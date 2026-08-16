/**
 * All Accounts data check — verifies listBookAccountsPage() against the live
 * book shape: only accounts with real orders, one account row, unique orders,
 * three-state order lifecycle from deals_v2 (Bound / Pending = actively
 * awaiting bind / Lost; deal-less shells excluded), and no Industry field.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/all-accounts-check.ts
 */
import { getDb } from "../src/lib/db/connection";
import { listBookAccountsPage } from "../src/lib/db/queries/accounts";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const db = getDb();
const dbCount = (
  db
    .prepare(
      `SELECT count(*) AS c
       FROM accounts
       WHERE id LIKE 'co-%'
         AND EXISTS (
           SELECT 1 FROM book_orders o WHERE o.account_id = accounts.id
         )`,
    )
    .get() as { c: number }
).c;
const orderTableCount = (
  db.prepare(`SELECT count(*) AS c FROM book_orders`).get() as { c: number }
).c;

const first = listBookAccountsPage({ offset: 0, limit: 100 });
check(`page total matches SQLite (${first.total} = ${dbCount})`, first.total === dbCount);
check(
  `orders synced into book_orders (${orderTableCount})`,
  orderTableCount > 0,
);
check(
  `bound + pending aggregates present (${first.boundOrderCount} bound / ${first.pendingOrderCount} pending)`,
  first.boundOrderCount + first.pendingOrderCount > 0,
);
check(
  `accounts with Bound orders present (${first.withBoundOrders})`,
  first.withBoundOrders > 0 && first.withBoundOrders <= first.total,
);
check("no seed accounts leak in", first.rows.every((a) => a.id.startsWith("co-")));

const seen = new Set<string>();
const orderIds = new Set<string>();
let dupes = 0;
let withOrders = 0;
let withoutOrders = 0;
const statusSeen = { bound: 0, pending: 0, lost: 0 };
let countMismatch = 0;
let nonBoundWithPolicy = 0;
let industryLeak = 0;
let multiOrder: { id: string; count: number } | null = null;
let singleOrder: string | null = null;
let pendingExample: string | null = null;
let boundExample: string | null = null;
let lostExample: string | null = null;

for (let offset = 0; offset < first.total; offset += 500) {
  const { rows } = listBookAccountsPage({ offset, limit: 500 });
  for (const a of rows) {
    if (seen.has(a.id)) dupes += 1;
    seen.add(a.id);
    if ("industry" in a) industryLeak += 1;
    if (a.orderCount !== a.orders.length) countMismatch += 1;
    if (a.orderCount === 0) withoutOrders += 1;
    else withOrders += 1;
    if (a.orderCount > 1 && !multiOrder) {
      multiOrder = { id: a.id, count: a.orderCount };
    }
    if (a.orderCount === 1 && !singleOrder) singleOrder = a.id;

    const onAccount = new Set<string>();
    for (const o of a.orders) {
      if (onAccount.has(o.id) || orderIds.has(o.id)) dupes += 1;
      onAccount.add(o.id);
      orderIds.add(o.id);
      statusSeen[o.bindStatus] += 1;
      if (o.bindStatus === "bound") {
        if (!boundExample && o.policyNumbers.length > 0) {
          boundExample = `${a.name} / ${o.label} / ${o.policyNumbers.join(",")}`;
        }
      } else {
        if (o.policyNumbers.length > 0) nonBoundWithPolicy += 1;
        if (o.bindStatus === "pending" && !pendingExample) {
          pendingExample = `${a.name} / ${o.label}`;
        }
        if (o.bindStatus === "lost" && !lostExample) {
          lostExample = `${a.name} / ${o.label}`;
        }
      }
    }
  }
}

check(`all pages cover every account once (${seen.size} = ${dbCount})`, seen.size === dbCount);
check("no duplicate accounts/orders across pages", dupes === 0);
check(`orderCount equals displayed orders (mismatches=${countMismatch})`, countMismatch === 0);
check(
  `every displayed account has at least one order (${withOrders})`,
  withOrders === first.total,
);
check("no displayed account has zero orders", withoutOrders === 0);
check(
  `multi-order account present (${multiOrder ? `${multiOrder.id}: ${multiOrder.count}` : "none"})`,
  Boolean(multiOrder),
);
check(`single-order account present (${singleOrder ?? "none"})`, Boolean(singleOrder));
check(`Bound example present (${boundExample ?? "none"})`, Boolean(boundExample));
check(`Pending example present (${pendingExample ?? "none"})`, Boolean(pendingExample));
check(`Lost example present (${lostExample ?? "none"})`, Boolean(lostExample));
check(
  "non-Bound orders never show fabricated policy numbers",
  nonBoundWithPolicy === 0,
);
check("Industry removed from page payload", industryLeak === 0);
check(
  `bound count matches aggregate (${statusSeen.bound} = ${first.boundOrderCount})`,
  statusSeen.bound === first.boundOrderCount,
);
check(
  `pending count matches aggregate (${statusSeen.pending} = ${first.pendingOrderCount})`,
  statusSeen.pending === first.pendingOrderCount,
);
check(
  `lost count matches aggregate (${statusSeen.lost} = ${first.lostOrderCount})`,
  statusSeen.lost === first.lostOrderCount,
);
check(
  `Bound + Pending + Lost partition every order (${
    statusSeen.bound + statusSeen.pending + statusSeen.lost
  } = ${orderIds.size})`,
  statusSeen.bound + statusSeen.pending + statusSeen.lost === orderIds.size,
);
check(
  "no inactive (deal-less) orders enter the book",
  (
    db
      .prepare(
        `SELECT count(*) AS c FROM book_orders WHERE bind_status NOT IN ('bound','pending','lost')`,
      )
      .get() as { c: number }
  ).c === 0,
);

const probe = first.rows.find((r) => r.orderCount > 0) ?? first.rows[0];
if (probe) {
  const hit = listBookAccountsPage({
    query: probe.name.slice(0, 8),
    offset: 0,
    limit: 50,
  });
  check(
    `search returns account with its orders (${hit.total} match)`,
    hit.total >= 1 &&
      hit.rows.some((a) => a.id === probe.id && a.orderCount === probe.orderCount),
  );
}

function verifyFilteredMode(mode: "pending" | "bound" | "lost") {
  const expectedStatus = mode;
  const filtered = listBookAccountsPage({
    mode,
    offset: 0,
    limit: 100,
  });
  const expectedAccounts = (
    db
      .prepare(
        `SELECT count(*) AS c
         FROM accounts
         WHERE id LIKE 'co-%'
           AND EXISTS (
             SELECT 1 FROM book_orders o
             WHERE o.account_id = accounts.id
               AND o.bind_status = ?
           )`,
      )
      .get(mode) as { c: number }
  ).c;
  const expectedOrders = (
    db
      .prepare(
        `SELECT count(*) AS c
         FROM book_orders o
         JOIN accounts a ON a.id = o.account_id
         WHERE a.id LIKE 'co-%' AND o.bind_status = ?`,
      )
      .get(mode) as { c: number }
  ).c;

  const accountIds = new Set<string>();
  const filteredOrderIds = new Set<string>();
  let filteredDupes = 0;
  let wrongStatus = 0;
  let countMismatch = 0;
  let nonBoundPolicies = 0;
  let boundWithoutPolicyOrWarning = 0;
  for (let offset = 0; offset < filtered.total; offset += 500) {
    const page = listBookAccountsPage({ mode, offset, limit: 500 });
    for (const account of page.rows) {
      if (accountIds.has(account.id)) filteredDupes += 1;
      accountIds.add(account.id);
      if (account.orderCount !== account.orders.length) countMismatch += 1;
      for (const order of account.orders) {
        if (filteredOrderIds.has(order.id)) filteredDupes += 1;
        filteredOrderIds.add(order.id);
        if (order.bindStatus !== expectedStatus) wrongStatus += 1;
        if (
          mode === "bound" &&
          order.policyNumbers.length === 0 &&
          !order.inconsistency
        ) {
          boundWithoutPolicyOrWarning += 1;
        }
        if (mode !== "bound" && order.policyNumbers.length > 0) {
          nonBoundPolicies += 1;
        }
      }
    }
  }

  check(
    `${mode} view account total matches DB (${filtered.total} = ${expectedAccounts})`,
    filtered.total === expectedAccounts,
  );
  check(
    `${mode} view displays each matching account once`,
    accountIds.size === filtered.total && filteredDupes === 0,
  );
  check(
    `${mode} view order total matches DB (${filteredOrderIds.size} = ${expectedOrders})`,
    filteredOrderIds.size === expectedOrders,
  );
  check(`${mode} view contains only ${mode} orders`, wrongStatus === 0);
  check(`${mode} view order counts match`, countMismatch === 0);
  check(
    `${mode} view does not expose fabricated policy numbers`,
    mode === "bound" || nonBoundPolicies === 0,
  );
  check(
    "Bound orders have policy numbers or a visible inconsistency",
    boundWithoutPolicyOrWarning === 0,
  );

  const modeProbe = filtered.rows[0];
  if (modeProbe) {
    const hit = listBookAccountsPage({
      mode,
      query: modeProbe.name.slice(0, 8),
      offset: 0,
      limit: 50,
    });
    check(
      `${mode} search stays within the selected view`,
      hit.rows.some(
        (account) =>
          account.id === modeProbe.id &&
          account.orders.every((order) => order.bindStatus === mode),
      ),
    );
  }
}

verifyFilteredMode("pending");
verifyFilteredMode("bound");
verifyFilteredMode("lost");

// Pending ∪ Bound is a subset of All Accounts — accounts whose orders are all
// Lost/Inactive appear only in the All view (they still have real orders).
const unionAccountCount = (
  db
    .prepare(
      `SELECT count(*) AS c
       FROM (
         SELECT DISTINCT account_id
         FROM book_orders
         WHERE bind_status IN ('pending', 'bound')
       )`,
    )
    .get() as { c: number }
).c;
check(
  `Pending ∪ Bound accounts fit inside All Accounts (${unionAccountCount} <= ${first.total})`,
  unionAccountCount <= first.total,
);
const statusPartition = db
  .prepare(
    `SELECT
       count(*) AS total,
       count(*) FILTER (WHERE bind_status IN ('bound','pending','lost')) AS classified
     FROM book_orders`,
  )
  .get() as { total: number; classified: number };
check(
  `every synced order carries a recognized status (${statusPartition.classified} = ${statusPartition.total})`,
  statusPartition.classified === statusPartition.total,
);

const mixed = db
  .prepare(
    `SELECT a.id, a.name
     FROM accounts a
     WHERE a.id LIKE 'co-%'
       AND EXISTS (
         SELECT 1 FROM book_orders o
         WHERE o.account_id = a.id AND o.bind_status = 'pending'
       )
       AND EXISTS (
         SELECT 1 FROM book_orders o
         WHERE o.account_id = a.id AND o.bind_status = 'bound'
       )
     ORDER BY a.id
     LIMIT 1`,
  )
  .get() as { id: string; name: string } | undefined;

if (mixed) {
  const pendingHit = listBookAccountsPage({
    mode: "pending",
    query: mixed.name,
    offset: 0,
    limit: 100,
  }).rows.find((account) => account.id === mixed.id);
  const boundHit = listBookAccountsPage({
    mode: "bound",
    query: mixed.name,
    offset: 0,
    limit: 100,
  }).rows.find((account) => account.id === mixed.id);
  check(
    `mixed account appears in both views (${mixed.id})`,
    Boolean(pendingHit && boundHit),
  );
  check(
    "mixed account is status-filtered independently",
    Boolean(
      pendingHit?.orders.every((order) => order.bindStatus === "pending") &&
        boundHit?.orders.every((order) => order.bindStatus === "bound"),
    ),
  );
} else {
  check("mixed account exists for cross-view verification", false);
}

process.exit(failed ? 1 : 0);
