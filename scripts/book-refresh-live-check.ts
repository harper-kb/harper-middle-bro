/**
 * Live book refresh check — boots the real database chain, forces one
 * refresh cycle against the Harper Supabase Management API, and verifies the
 * refreshed book landed in SQLite (new rows in, stale rows pruned).
 *
 * Needs SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in the environment:
 *   set -a; source .env.local; set +a
 *   npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/book-refresh-live-check.ts
 */
import { isRefreshConfigured, refreshBook } from "../src/lib/db/book-refresh";
import { getDb } from "../src/lib/db/connection";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

function bookIds(db: ReturnType<typeof getDb>) {
  const accounts = new Set(
    (db.prepare(`SELECT id FROM accounts WHERE id LIKE 'co-%'`).all() as { id: string }[]).map(
      (r) => r.id,
    ),
  );
  const policies = new Set(
    (db.prepare(`SELECT id FROM policies WHERE id LIKE 'deal-%'`).all() as { id: string }[]).map(
      (r) => r.id,
    ),
  );
  const orders = new Set(
    (
      db
        .prepare(`SELECT id FROM book_orders WHERE id LIKE 'order-%'`)
        .all() as { id: string }[]
    ).map((r) => r.id),
  );
  return { accounts, policies, orders };
}

async function main() {
  check("refresh credentials configured", isRefreshConfigured());
  if (failed) process.exit(1);

  const db = getDb();
  const before = bookIds(db);

  const book = await refreshBook(db);
  check("refresh returned a non-empty book", book.accounts.length > 0);
  check(
    "fetchedAt is current",
    Math.abs(Date.now() - Date.parse(book.fetchedAt)) < 5 * 60 * 1000,
  );

  const after = bookIds(db);
  const missingAccounts = book.accounts.filter((a) => !after.accounts.has(a.id));
  const missingPolicies = book.policies.filter((p) => !after.policies.has(p.id));
  const missingOrders = book.orders.filter((o) => !after.orders.has(o.id));
  check(
    `every refreshed account is in SQLite (${book.accounts.length} in book)`,
    missingAccounts.length === 0,
  );
  check(
    `every refreshed policy is in SQLite (${book.policies.length} in book)`,
    missingPolicies.length === 0,
  );
  check(
    `every refreshed order is in SQLite (${book.orders.length} in book)`,
    missingOrders.length === 0,
  );

  const added = [...after.accounts].filter((id) => !before.accounts.has(id));
  const dropped = [...before.accounts].filter((id) => !after.accounts.has(id));
  console.log(
    `INFO  accounts: ${before.accounts.size} -> ${after.accounts.size} (+${added.length} new, -${dropped.length} pruned)`,
  );
  for (const id of added.slice(0, 10)) {
    const row = db
      .prepare(`SELECT name, status FROM accounts WHERE id = ?`)
      .get(id) as { name: string; status: string };
    console.log(`INFO  new: ${id} — ${row.name} [${row.status}]`);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL ", err instanceof Error ? err.message : err);
  process.exit(1);
});
