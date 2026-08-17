/**
 * Live incremental-refresh check against the real Harper book.
 *
 * The claim the delta path has to earn is equivalence: splicing scoped reads
 * into the book in hand must produce exactly the book a whole-book pull would
 * have produced. This establishes a full-refresh baseline, invalidates a sample
 * of stored digests to force those rows down the delta path, and diffs the two
 * books row by row.
 *
 *   set -a; source .env.local; set +a
 *   npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/book-delta-live-check.ts
 */
import {
  isRefreshConfigured,
  refreshBook,
  refreshBookDelta,
} from "../src/lib/db/book-refresh";
import { readBookDigests } from "../src/lib/db/book-digest";
import { getDb } from "../src/lib/db/connection";
import { readOperationsMetricsSnapshot } from "../src/lib/db/operations-metrics";
import {
  setSupabaseBookCache,
  type SupabaseBook,
} from "../src/lib/supabase-book.server";

let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Comparable, order-independent shape for one book. */
function fingerprint(book: SupabaseBook) {
  const by = <T>(rows: readonly T[], key: (row: T) => string) =>
    [...rows].sort((a, b) => key(a).localeCompare(key(b)));
  return {
    accounts: JSON.stringify(by(book.accounts, (a) => a.id)),
    policies: JSON.stringify(by(book.policies, (p) => p.id)),
    orders: JSON.stringify(by(book.orders, (o) => o.id)),
    contactKeys: JSON.stringify(
      by(book.contactKeys, (k) => `${k.accountId}|${k.kind}|${k.value}`),
    ),
  };
}

function firstDifference(a: string, b: string): string {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      const from = Math.max(0, i - 120);
      return `at ${i}:\n    baseline: …${a.slice(from, i + 160)}\n    delta:    …${b.slice(from, i + 160)}`;
    }
  }
  return "identical";
}

async function main() {
  check("refresh credentials configured", isRefreshConfigured());
  if (failed) process.exit(1);

  const db = getDb();

  console.log("\n-- baseline: full refresh --");
  let started = Date.now();
  const baseline = await refreshBook(db);
  console.log(
    `INFO  full refresh in ${Date.now() - started}ms — ${
      baseline.accounts.length
    } accounts, ${baseline.orders.length} orders, ${baseline.policies.length} policies`,
  );
  const digestsAfterFull = readBookDigests(db);
  check(
    `full refresh stored a digest baseline (${digestsAfterFull.size} rows)`,
    digestsAfterFull.size > 0,
  );
  check(
    "one digest per order plus one per account",
    digestsAfterFull.size ===
      baseline.orders.length + baseline.accounts.length,
    `${digestsAfterFull.size} digests vs ${baseline.orders.length} orders + ${baseline.accounts.length} accounts`,
  );

  console.log("\n-- idle tick --");
  started = Date.now();
  const idle = await refreshBookDelta(db);
  console.log(`INFO  idle tick in ${Date.now() - started}ms`);
  check(
    "an unchanged book reports no delta",
    idle.delta.changedOrderIds.length === 0 &&
      idle.delta.departedOrderIds.length === 0 &&
      idle.delta.changedCompanyIds.length === 0 &&
      idle.delta.departedCompanyIds.length === 0,
    JSON.stringify({
      changedOrders: idle.delta.changedOrderIds.length,
      departedOrders: idle.delta.departedOrderIds.length,
      changedCompanies: idle.delta.changedCompanyIds.length,
      departedCompanies: idle.delta.departedCompanyIds.length,
    }),
  );
  check(
    `an idle tick costs 2 requests (spent ${idle.requests})`,
    idle.requests === 2,
  );

  console.log("\n-- forced delta: equivalence with the full refresh --");
  // Invalidating stored digests is exactly what Harper changing a row looks
  // like to the refresher, without waiting for the book to move on its own.
  const sampleOrders = baseline.orders
    .slice(0, 25)
    .map((order) => order.harperOrderId);
  const sampleCompanies = baseline.accounts
    .slice(0, 5)
    .map((account) => Number(account.id.replace("co-", "")));
  const invalidate = db.prepare(
    `UPDATE book_sync_digests SET digest = 'forced' WHERE kind = ? AND id = ?`,
  );
  for (const id of sampleOrders) invalidate.run("order", String(id));
  for (const id of sampleCompanies) invalidate.run("company", String(id));

  started = Date.now();
  const forced = await refreshBookDelta(db);
  console.log(
    `INFO  forced tick in ${Date.now() - started}ms, ${forced.requests} request(s)`,
  );
  check(
    `delta picked up exactly the invalidated orders (${forced.delta.changedOrderIds.length})`,
    forced.delta.changedOrderIds.length === sampleOrders.length,
    `expected ${sampleOrders.length}`,
  );
  check(
    "delta reported no spurious departures",
    forced.delta.departedOrderIds.length === 0 &&
      forced.delta.departedCompanyIds.length === 0,
  );

  const before = fingerprint(baseline);
  const after = fingerprint(forced.book);
  for (const key of ["accounts", "policies", "orders", "contactKeys"] as const) {
    check(
      `${key} identical after the delta merge`,
      before[key] === after[key],
      before[key] === after[key]
        ? undefined
        : firstDifference(before[key], after[key]),
    );
  }

  console.log("\n-- a new order arriving --");
  // To the refresher, a brand-new Harper order is simply an id the sweep
  // reports and the local digest store has never seen. Dropping a known order
  // from the local book and its digest reproduces that exactly, without writing
  // anything to Harper.
  const arrival = baseline.orders.find((o) => o.rich.deals.length > 0)!;
  const arrivalId = arrival.harperOrderId;
  db.prepare(
    `DELETE FROM book_sync_digests WHERE kind = 'order' AND id = ?`,
  ).run(String(arrivalId));
  db.prepare(`DELETE FROM book_orders WHERE id = ?`).run(arrival.id);
  setSupabaseBookCache({
    ...forced.book,
    orders: forced.book.orders.filter((o) => o.id !== arrival.id),
  });
  check(
    `order ${arrivalId} is absent before the tick`,
    db.prepare(`SELECT 1 FROM book_orders WHERE id = ?`).get(arrival.id) ===
      undefined,
  );

  const arrived = await refreshBookDelta(db);
  check(
    `the tick fetched the unseen order (${arrivalId})`,
    arrived.delta.changedOrderIds.includes(arrivalId),
    JSON.stringify(arrived.delta.changedOrderIds),
  );
  check(
    "the new order landed in SQLite",
    db.prepare(`SELECT 1 FROM book_orders WHERE id = ?`).get(arrival.id) !==
      undefined,
  );
  check(
    "the new order is byte-identical to the full refresh",
    JSON.stringify(arrived.book.orders.find((o) => o.id === arrival.id)) ===
      JSON.stringify(arrival),
    JSON.stringify(arrived.book.orders.find((o) => o.id === arrival.id)),
  );
  check(
    "the rest of the book is untouched by the arrival",
    fingerprint(arrived.book).orders === before.orders,
  );

  console.log("\n-- departure detection --");
  db.prepare(
    `INSERT OR REPLACE INTO book_sync_digests (kind, id, digest) VALUES ('order', '999999999', 'ghost')`,
  ).run();
  const departed = await refreshBookDelta(db);
  check(
    "an order missing from the sweep is reported as departed",
    departed.delta.departedOrderIds.includes(999999999),
    JSON.stringify(departed.delta.departedOrderIds),
  );
  check(
    "a departure does not disturb the rest of the book",
    fingerprint(departed.book).orders === before.orders,
  );

  console.log("\n-- New Orders counter --");
  const metrics = readOperationsMetricsSnapshot();
  check("operations metrics snapshot is present", metrics !== null);
  if (metrics) {
    const zone = metrics.zones[0];
    const today = zone?.days[0];
    console.log(
      `INFO  ${zone?.timeZone} ${today?.businessDate}: New Orders ${today?.newOrders}, Bound ${today?.bound}, COIs Sent ${today?.coisSent}`,
    );
    check(
      "metrics were recalculated by this run",
      Math.abs(Date.now() - Date.parse(metrics.calculatedAt)) < 5 * 60 * 1000,
      `calculatedAt ${metrics.calculatedAt}`,
    );
  }

  console.log("\n-- restoring a clean digest baseline --");
  await refreshBook(db);
  console.log("INFO  full refresh re-run; stored digests match the live book.");

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL ", err instanceof Error ? err.message : err);
  process.exit(1);
});
