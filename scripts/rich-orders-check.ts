/**
 * Rich order verification against the refreshed local snapshot.
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/rich-orders-check.ts
 */
import {
  decimalToCents,
  decimalToMicros,
} from "../src/lib/db/book-refresh";
import { getDb } from "../src/lib/db/connection";
import { listBookAccountsPage } from "../src/lib/db/queries/accounts";
import { loadSupabaseBook } from "../src/lib/supabase-book.server";
import {
  buildIdempotencyKey,
  CAPABILITY_DEFS,
} from "../src/lib/adapters/agent-tools";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const book = loadSupabaseBook();
const db = getDb();
check("reporting windows share the refreshed snapshot", Boolean(book?.reportingWindows));
check("decimal parser rounds without floating point", decimalToCents("356.255") === 35626);
check("decimal parser preserves null revenue", decimalToCents(null) === null);
check(
  "six-place revenue precision is retained until aggregate formatting",
  decimalToMicros("356.255125") === 356255125,
);
check(
  "Bind Policy maps to the governed Harper Tools verb",
  CAPABILITY_DEFS.some(
    (capability) =>
      capability.id === "write.bind" &&
      capability.command === "sales deal bind",
  ),
);
check(
  "service notes map to the governed append verb",
  CAPABILITY_DEFS.some(
    (capability) =>
      capability.id === "write.service_note" &&
      capability.command === "service note append",
  ),
);
const idempotencyParts = {
  operatorId: "operator-check",
  capabilityId: "write.bind" as const,
  workItemId: "order-13061",
  fingerprint: "stable-request",
};
check(
  "governed action idempotency keys are deterministic",
  buildIdempotencyKey(idempotencyParts) ===
    buildIdempotencyKey(idempotencyParts),
);

for (const mode of ["pending", "bound"] as const) {
  const allTimeExpected = db
    .prepare(
      `SELECT count(DISTINCT account_id) AS accounts,
              count(*) AS orders,
              sum(revenue_micros) AS revenue
       FROM book_orders
       WHERE bind_status = ?`,
    )
    .get(mode) as {
    accounts: number;
    orders: number;
    revenue: number | null;
  };
  const allTimeActual = listBookAccountsPage({
    mode,
    range: "all-time",
    offset: 0,
    limit: 5,
  });
  check(
    `${mode}/all-time account total`,
    allTimeActual.total === allTimeExpected.accounts,
  );
  check(
    `${mode}/all-time order total`,
    (mode === "pending"
      ? allTimeActual.pendingOrderCount
      : allTimeActual.boundOrderCount) === allTimeExpected.orders,
  );
  check(
    `${mode}/all-time revenue`,
    allTimeActual.revenueMicros === allTimeExpected.revenue,
  );

  for (const range of ["this-week", "last-week", "last-30-days"] as const) {
    const window = book?.reportingWindows?.ranges[range];
    if (!window) continue;
    const expected = db
      .prepare(
        `SELECT
           count(DISTINCT account_id) AS accounts,
           count(*) AS orders,
           sum(revenue_micros) AS revenue,
           count(*) FILTER (WHERE revenue_micros IS NULL) AS missing
         FROM book_orders
         WHERE bind_status = ?
           AND event_at >= ?
           AND event_at < ?`,
      )
      .get(mode, window.startsAt, window.endsAt) as {
      accounts: number;
      orders: number;
      revenue: number | null;
      missing: number;
    };
    const actual = listBookAccountsPage({
      mode,
      range,
      offset: 0,
      limit: 5,
    });
    check(
      `${mode}/${range} account total`,
      actual.total === expected.accounts,
    );
    check(
      `${mode}/${range} order total`,
      (mode === "pending"
        ? actual.pendingOrderCount
        : actual.boundOrderCount) === expected.orders,
    );
    check(
      `${mode}/${range} order-grain revenue`,
      actual.revenueMicros === expected.revenue,
    );
    check(
      `${mode}/${range} missing revenue coverage`,
      actual.missingRevenueOrderCount === expected.missing,
    );
    check(
      `${mode}/${range} rows contain only matching events`,
      actual.rows.every((account) =>
        account.orders.every(
          (order) =>
            order.bindStatus === mode &&
            order.eventAt !== null &&
            order.eventAt >= window.startsAt &&
            order.eventAt < window.endsAt,
        ),
      ),
    );
  }
}

const lostDefault = listBookAccountsPage({
  mode: "lost",
  offset: 0,
  limit: 5,
});
const lostWithRange = listBookAccountsPage({
  mode: "lost",
  range: "last-week",
  offset: 0,
  limit: 5,
});
check(
  "Lost Orders deliberately ignores date range",
  lostDefault.total === lostWithRange.total &&
    lostDefault.lostOrderCount === lostWithRange.lostOrderCount &&
    lostDefault.revenueMicros === lostWithRange.revenueMicros,
);

const allDefault = listBookAccountsPage({ offset: 0, limit: 5 });
const allWithRange = listBookAccountsPage({
  mode: "all",
  range: "last-week",
  offset: 0,
  limit: 5,
});
check(
  "All Accounts remains unchanged by range",
  allDefault.total === allWithRange.total &&
    allDefault.boundOrderCount === allWithRange.boundOrderCount &&
    allDefault.pendingOrderCount === allWithRange.pendingOrderCount &&
    allDefault.lostOrderCount === allWithRange.lostOrderCount,
);

const representative = db
  .prepare(
    `SELECT revenue_cents, rich_json
     FROM book_orders
     WHERE harper_order_id = 13061`,
  )
  .get() as { revenue_cents: number | null; rich_json: string } | undefined;
const rich = representative
  ? (JSON.parse(representative.rich_json) as {
      paymentType?: string;
      documentCount?: number;
      totalPremiumCents?: number;
      commissionRevenueCents?: number;
      deals?: Array<{
        isInstantQuote?: boolean;
        carrierName?: string;
        wholesalerName?: string;
      }>;
    })
  : null;
check("representative order #13061 exists", Boolean(representative));
check("order #13061 is financed", rich?.paymentType === "financed");
check("order #13061 has one document", rich?.documentCount === 1);
check("order #13061 premium is $2,375", rich?.totalPremiumCents === 237500);
check(
  "order #13061 commission is $356.25",
  rich?.commissionRevenueCents === 35625,
);
check("order #13061 is Instant Quote", rich?.deals?.[0]?.isInstantQuote === true);
check(
  "order #13061 carrier resolves to Evanston",
  rich?.deals?.[0]?.carrierName === "Evanston Insurance Company",
);
check(
  "order #13061 wholesaler resolves to R T Connector",
  rich?.deals?.[0]?.wholesalerName === "R T Connector",
);

process.exit(failed ? 1 : 0);
