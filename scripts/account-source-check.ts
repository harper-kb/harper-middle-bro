/**
 * Account-source filter check. The authoritative IQ / Broker flag is
 * `deals_v2.is_instant_quote` at deal grain — the same field BigBrother's
 * WorkBench "Instant quotes" queue filters on. It lands on
 * `book_orders.source` as 'iq' | 'broker' | 'mixed' (NULL = no deals).
 *
 * Verifies the column is populated, that IQ / Broker partition strictly (no
 * account can satisfy both, and mixed accounts satisfy neither), that every
 * returned row really is all-one-source, and that pending IQ still reconciles
 * to BigBrother's queue.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/account-source-check.ts
 */
import { getDb } from "../src/lib/db/connection";
import { listBookAccountsPage } from "../src/lib/db/queries/accounts";
import type { BookOrdersViewMode } from "../src/lib/db/queries/accounts";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const db = getDb();

const dist = db
  .prepare(
    `SELECT
       sum(CASE WHEN source = 'iq' THEN 1 ELSE 0 END) AS iq,
       sum(CASE WHEN source = 'broker' THEN 1 ELSE 0 END) AS broker,
       sum(CASE WHEN source = 'mixed' THEN 1 ELSE 0 END) AS mixed,
       sum(CASE WHEN source IS NULL THEN 1 ELSE 0 END) AS unknown,
       count(*) AS total
     FROM book_orders`,
  )
  .get() as {
  iq: number;
  broker: number;
  mixed: number;
  unknown: number;
  total: number;
};

console.log(
  `book_orders.source — iq=${dist.iq} broker=${dist.broker} mixed=${dist.mixed} null=${dist.unknown} total=${dist.total}`,
);
check(
  "every book order is classified from its deals",
  dist.total > 0 && dist.unknown === 0 && dist.iq > 0 && dist.broker > 0,
);

/** Accounts whose orders in the given view are all one source. */
function strictAccountCount(mode: BookOrdersViewMode, source: string): number {
  const scope = mode === "all" ? "" : ` AND o.bind_status = '${mode}'`;
  return (
    db
      .prepare(
        `SELECT count(*) AS n FROM accounts
         WHERE id LIKE 'co-%'
           AND EXISTS (SELECT 1 FROM book_orders o WHERE o.account_id = accounts.id${scope})
           AND NOT EXISTS (
             SELECT 1 FROM book_orders o
             WHERE o.account_id = accounts.id${scope}
               AND (o.source IS NULL OR o.source <> ?)
           )`,
      )
      .get(source) as { n: number }
  ).n;
}

for (const mode of ["all", "pending", "bound", "lost"] as const) {
  const all = listBookAccountsPage({ mode, offset: 0, limit: 200, source: "all" });
  const iq = listBookAccountsPage({ mode, offset: 0, limit: 200, source: "iq" });
  const broker = listBookAccountsPage({
    mode,
    offset: 0,
    limit: 200,
    source: "broker",
  });

  check(
    `${mode}/IQ total matches SQL (${iq.total} = ${strictAccountCount(mode, "iq")})`,
    iq.total === strictAccountCount(mode, "iq"),
  );
  check(
    `${mode}/Broker total matches SQL (${broker.total} = ${strictAccountCount(mode, "broker")})`,
    broker.total === strictAccountCount(mode, "broker"),
  );
  check(
    `${mode}: IQ + Broker never exceeds All (${iq.total} + ${broker.total} <= ${all.total})`,
    iq.total + broker.total <= all.total,
  );

  // Strict partition: every order shown under a source really is that source.
  for (const [source, page] of [
    ["iq", iq],
    ["broker", broker],
  ] as const) {
    const offenders = page.rows.filter((row) =>
      row.orders.some((order) => {
        const stored = (
          db
            .prepare(`SELECT source FROM book_orders WHERE id = ?`)
            .get(order.id) as { source: string | null } | undefined
        )?.source;
        return stored !== source;
      }),
    );
    check(
      `${mode}/${source}: all listed orders are ${source} (${page.rows.length} accounts checked)`,
      offenders.length === 0,
    );
  }
}

// BigBrother WorkBench parity: its "Instant quotes" pending queue counts open
// IQ deals (58) over 54 companies. Step Bro counts orders, and excludes the one
// account holding both an IQ and a broker pending order.
const pendingIq = listBookAccountsPage({
  mode: "pending",
  source: "iq",
  offset: 0,
  limit: 200,
});
console.log(
  `pending/IQ — ${pendingIq.total} accounts, ${pendingIq.pendingOrderCount} pending orders`,
);
check(
  `pending IQ orders within one of BigBrother's 56 (${pendingIq.pendingOrderCount})`,
  Math.abs(pendingIq.pendingOrderCount - 56) <= 1,
);
check(
  `pending IQ accounts within one of BigBrother's 54 (${pendingIq.total})`,
  Math.abs(pendingIq.total - 54) <= 1,
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll account-source checks passed.");
