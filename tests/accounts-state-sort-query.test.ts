import { beforeAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * Location State filtering and account sorting in the Accounts page query,
 * against a synthetic in-memory book with known shapes: missing and legacy
 * state values, representative-date preference across mixed statuses, the
 * bound view's bind-event date, explicit zero versus unavailable revenue,
 * and deliberate ties. The query module's singleton connection is swapped
 * for the fixture database.
 */

const mem = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db/connection", () => ({
  getDb: () => mem.db,
  resetDatabase: () => {},
}));

const { migrate } = await import("@/lib/db/migrate");
const {
  listBookAccountCarrierFacet,
  listBookAccountLocationStateFacet,
  listBookAccountsPage,
} = await import("@/lib/db/queries/accounts");
const { carrierKeyFromName } = await import("@/lib/carrier-filter");
const { LOCATION_STATE_NONE } = await import("@/lib/location-state");

interface FixtureOrder {
  id: string;
  accountId: string;
  harperOrderId: number;
  bindStatus: "pending" | "bound" | "lost";
  createdAt: string;
  eventAt: string | null;
  revenueMicros: number | null;
  carrier: string | null;
}

/**
 * Representative dates by the shared rule (pending > bound > lost, newest
 * created_at):  Alpha 08-05 (pending beats its newer bound order),
 * Bravo 08-07, Charlie 08-01, Delta 08-05 (ties Alpha), Echo 08-03,
 * Foxtrot 08-06 (bound beats its newer lost order).
 * Displayed revenue (all view): Alpha 300M, Bravo unavailable (null order),
 * Charlie explicit 0, Delta 50M, Echo 50M (deliberate tie with Delta so the
 * date order visibly arranges an equal-revenue run), Foxtrot 305M.
 */
const ORDERS: FixtureOrder[] = [
  { id: "order-101", accountId: "co-1", harperOrderId: 101, bindStatus: "pending", createdAt: "2026-08-05T10:00:00+00", eventAt: "2026-08-05T10:00:00+00", revenueMicros: 100_000_000, carrier: "Hiscox Ins Co" },
  { id: "order-102", accountId: "co-1", harperOrderId: 102, bindStatus: "bound", createdAt: "2026-08-09T10:00:00+00", eventAt: "2026-08-10T10:00:00+00", revenueMicros: 200_000_000, carrier: "NEXT Insurance US Inc" },
  { id: "order-201", accountId: "co-2", harperOrderId: 201, bindStatus: "pending", createdAt: "2026-08-07T10:00:00+00", eventAt: "2026-08-07T10:00:00+00", revenueMicros: null, carrier: "Coterie Insurance" },
  { id: "order-301", accountId: "co-3", harperOrderId: 301, bindStatus: "bound", createdAt: "2026-08-01T10:00:00+00", eventAt: "2026-08-12T10:00:00+00", revenueMicros: 0, carrier: "Hiscox Ins Co" },
  { id: "order-401", accountId: "co-4", harperOrderId: 401, bindStatus: "pending", createdAt: "2026-08-05T10:00:00+00", eventAt: "2026-08-05T10:00:00+00", revenueMicros: 50_000_000, carrier: "Coterie Insurance" },
  { id: "order-501", accountId: "co-5", harperOrderId: 501, bindStatus: "lost", createdAt: "2026-08-03T10:00:00+00", eventAt: null, revenueMicros: 50_000_000, carrier: "Markel Insurance Company" },
  { id: "order-601", accountId: "co-6", harperOrderId: 601, bindStatus: "bound", createdAt: "2026-08-06T10:00:00+00", eventAt: "2026-08-08T10:00:00+00", revenueMicros: 300_000_000, carrier: "NEXT Insurance US Inc" },
  { id: "order-602", accountId: "co-6", harperOrderId: 602, bindStatus: "lost", createdAt: "2026-08-11T10:00:00+00", eventAt: null, revenueMicros: 5_000_000, carrier: "Markel Insurance Company" },
];

const ACCOUNTS = [
  { id: "co-1", name: "Alpha Logistics", state: "CA" },
  { id: "co-2", name: "Bravo Builders", state: "FL" },
  { id: "co-3", name: "Charlie Cafe", state: "" },
  { id: "co-4", name: "Delta Dental", state: "CA" },
  { id: "co-5", name: "Echo Farm", state: "Massachusetts." },
  { id: "co-6", name: "Foxtrot Freight", state: "NY" },
];

beforeAll(() => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    `INSERT INTO underwriters (id, name, email, carrier) VALUES ('uw-x', 'X', 'x@example.com', 'X')`,
  ).run();
  const insertAccount = db.prepare(
    `INSERT INTO accounts (id, name, industry, state, primary_uw_id)
     VALUES (@id, @name, 'Testing', @state, 'uw-x')`,
  );
  for (const account of ACCOUNTS) insertAccount.run(account);
  const insertOrder = db.prepare(
    `INSERT INTO book_orders (
       id, account_id, harper_order_id, created_at, ordered_at, event_at,
       bind_status, revenue_cents, revenue_micros, rich_json,
       policy_numbers_json, source
     ) VALUES (
       @id, @accountId, @harperOrderId, @createdAt, @createdAt, @eventAt,
       @bindStatus, NULL, @revenueMicros, @richJson, '[]', 'broker'
     )`,
  );
  const insertCarrier = db.prepare(
    `INSERT OR IGNORE INTO book_order_carriers (order_id, carrier_key, carrier_name)
     VALUES (?, ?, ?)`,
  );
  for (const order of ORDERS) {
    insertOrder.run({
      ...order,
      richJson: JSON.stringify({
        deals: [
          {
            dealId: order.harperOrderId,
            carrierName: order.carrier,
            isInstantQuote: false,
          },
        ],
      }),
    });
    const key = carrierKeyFromName(order.carrier);
    if (key) insertCarrier.run(order.id, key, order.carrier!.trim());
  }
  mem.db = db;
});

type PageOpts = Parameters<typeof listBookAccountsPage>[0];

function page(
  opts: Omit<PageOpts, "offset" | "limit"> &
    Partial<Pick<PageOpts, "offset" | "limit">>,
) {
  return listBookAccountsPage({ offset: 0, limit: 100, ...opts });
}

function ids(result: ReturnType<typeof page>): string[] {
  return result.rows.map((row) => row.id);
}

describe("location state filtering in listBookAccountsPage", () => {
  it("changes nothing when no state is selected", () => {
    // Default ordering is oldest-first by representative date.
    expect(ids(page({ mode: "all" }))).toEqual([
      "co-3", "co-5", "co-1", "co-4", "co-6", "co-2",
    ]);
  });

  it("filters accounts by their displayed location state with OR semantics", () => {
    expect(ids(page({ mode: "all", locationStates: ["CA"] }))).toEqual([
      "co-1",
      "co-4",
    ]);
    expect(
      ids(page({ mode: "all", locationStates: ["CA", "NY"] })),
    ).toEqual(["co-1", "co-4", "co-6"]);
  });

  it("sends missing and legacy values to Unknown / Not set, never a real state", () => {
    expect(
      ids(page({ mode: "all", locationStates: [LOCATION_STATE_NONE] })),
    ).toEqual(["co-3", "co-5"]);
    // "Massachusetts." (legacy junk) must not match MA.
    expect(ids(page({ mode: "all", locationStates: ["MA"] }))).toEqual([]);
    expect(
      ids(page({ mode: "all", locationStates: ["CA", LOCATION_STATE_NONE] })),
    ).toEqual(["co-3", "co-5", "co-1", "co-4"]);
  });

  it("ANDs with records state, carriers and search — and recomputes metrics", () => {
    expect(
      ids(page({ mode: "pending", locationStates: [LOCATION_STATE_NONE] })),
    ).toEqual([]);
    expect(
      ids(
        page({
          mode: "all",
          locationStates: ["CA"],
          carriers: ["hiscox ins co"],
        }),
      ),
    ).toEqual(["co-1"]);
    expect(
      ids(page({ mode: "all", locationStates: ["CA"], query: "delta" })),
    ).toEqual(["co-4"]);
    const ca = page({ mode: "all", locationStates: ["CA"] });
    expect(ca.total).toBe(2);
    expect(ca.revenueMicros).toBe(350_000_000);
    expect(ca.pendingOrderCount).toBe(2);
    expect(ca.boundOrderCount).toBe(1);
  });
});

describe("listBookAccountLocationStateFacet", () => {
  it("derives contextual options with account counts, Unknown last", () => {
    const facet = listBookAccountLocationStateFacet({ mode: "all" });
    expect(facet.options).toEqual([
      { id: "CA", code: "CA", label: "California", accountCount: 2 },
      { id: "FL", code: "FL", label: "Florida", accountCount: 1 },
      { id: "NY", code: "NY", label: "New York", accountCount: 1 },
      {
        id: LOCATION_STATE_NONE,
        code: null,
        label: "Unknown / Not set",
        accountCount: 2,
      },
    ]);
  });

  it("scopes options to the records state and other filters", () => {
    const pending = listBookAccountLocationStateFacet({ mode: "pending" });
    expect(pending.options).toEqual([
      { id: "CA", code: "CA", label: "California", accountCount: 2 },
      { id: "FL", code: "FL", label: "Florida", accountCount: 1 },
    ]);
    const hiscox = listBookAccountLocationStateFacet({
      mode: "all",
      carriers: ["hiscox ins co"],
    });
    expect(hiscox.options.map((option) => option.id)).toEqual([
      "CA",
      LOCATION_STATE_NONE,
    ]);
  });

  it("excludes only its own selection (facet self-exclusion)", () => {
    const facet = listBookAccountLocationStateFacet({
      mode: "all",
      selectedStates: ["CA"],
    });
    expect(facet.options).toEqual(
      listBookAccountLocationStateFacet({ mode: "all" }).options,
    );
    expect(facet.unavailableSelected).toEqual([]);
  });

  it("keeps selected states visible when another filter removes them", () => {
    const facet = listBookAccountLocationStateFacet({
      mode: "lost",
      selectedStates: ["NY", "FL"],
    });
    // Lost accounts: Echo (legacy state) and Foxtrot (NY).
    expect(facet.options.map((option) => option.id)).toEqual([
      "NY",
      LOCATION_STATE_NONE,
    ]);
    expect(facet.unavailableSelected).toEqual([
      { id: "FL", label: "Florida" },
    ]);
  });

  it("constrains the Carrier facet by state, and vice versa", () => {
    const carriers = listBookAccountCarrierFacet({
      mode: "all",
      locationStates: ["NY"],
    });
    expect(carriers.options.map((option) => option.key)).toEqual([
      "markel insurance company",
      "next insurance us inc",
    ]);
  });
});

const OLDEST = { date: "oldest", revenue: "none" } as const;
const NEWEST = { date: "newest", revenue: "none" } as const;

describe("account sorting in listBookAccountsPage", () => {
  it("defaults to oldest first by the representative date", () => {
    const unsorted = page({ mode: "all" });
    const explicit = page({ mode: "all", sort: OLDEST });
    expect(ids(unsorted)).toEqual(ids(explicit));
    expect(ids(unsorted)).toEqual([
      "co-3", // 08-01
      "co-5", // 08-03
      "co-1", // 08-05 — ties Delta, name breaks it
      "co-4", // 08-05
      "co-6", // 08-06
      "co-2", // 08-07
    ]);
  });

  it("sorts All Accounts by the representative order's creation date", () => {
    // Alpha's pending order (08-05) outranks its newer bound order (08-09),
    // Foxtrot's bound (08-06) outranks its newer lost (08-11) — the same
    // preference the collapsed row's stage/age describe.
    expect(ids(page({ mode: "all", sort: NEWEST }))).toEqual([
      "co-2", // 08-07
      "co-6", // 08-06
      "co-1", // 08-05 — ties Delta, name breaks it
      "co-4", // 08-05
      "co-5", // 08-03
      "co-3", // 08-01
    ]);
  });

  it("sorts the Bound view by the verified bind event, not creation", () => {
    // By created_at the order would be Alpha (08-09), Foxtrot (08-06),
    // Charlie (08-01); by bind event it is Charlie (08-12), Alpha (08-10),
    // Foxtrot (08-08).
    expect(ids(page({ mode: "bound", sort: NEWEST }))).toEqual([
      "co-3",
      "co-1",
      "co-6",
    ]);
    expect(ids(page({ mode: "bound", sort: OLDEST }))).toEqual([
      "co-6",
      "co-1",
      "co-3",
    ]);
  });

  it("sorts Pending and Lost by the age-basis creation date", () => {
    expect(ids(page({ mode: "pending", sort: NEWEST }))).toEqual([
      "co-2", // 08-07
      "co-1", // 08-05 tie → name
      "co-4",
    ]);
    expect(ids(page({ mode: "lost", sort: NEWEST }))).toEqual([
      "co-6", // 08-11
      "co-5", // 08-03
    ]);
  });

  it("puts an active revenue order first and lets the date order arrange ties", () => {
    // Bravo's only order has null revenue → unavailable → after every valid
    // value in both directions. Charlie's explicit $0 is a real value.
    // Delta and Echo tie at 50M: the date order decides between them.
    expect(
      ids(page({ mode: "all", sort: { date: "oldest", revenue: "revenue-desc" } })),
    ).toEqual([
      "co-6", // 305M
      "co-1", // 300M
      "co-5", // 50M — oldest (08-03) leads the equal-revenue run
      "co-4", // 50M (08-05)
      "co-3", // 0 — explicit zero outranks nothing but stays a value
      "co-2", // unavailable
    ]);
    expect(
      ids(page({ mode: "all", sort: { date: "newest", revenue: "revenue-desc" } })),
    ).toEqual([
      "co-6",
      "co-1",
      "co-4", // 50M — newest (08-05) now leads the equal-revenue run
      "co-5", // 50M (08-03)
      "co-3",
      "co-2",
    ]);
    expect(
      ids(page({ mode: "all", sort: { date: "oldest", revenue: "revenue-asc" } })),
    ).toEqual([
      "co-3", // 0 first
      "co-5", // 50M (08-03)
      "co-4", // 50M (08-05)
      "co-1",
      "co-6",
      "co-2", // unavailable still last
    ]);
    expect(
      ids(page({ mode: "all", sort: { date: "newest", revenue: "revenue-asc" } })),
    ).toEqual(["co-3", "co-4", "co-5", "co-1", "co-6", "co-2"]);
  });

  it("recomputes the revenue sort key from the filtered order set", () => {
    // Under the bound view Alpha's revenue is only its bound order (200M),
    // so Foxtrot (300M) outranks it, and Charlie's $0 comes last of the
    // valid values.
    expect(
      ids(page({ mode: "bound", sort: { date: "oldest", revenue: "revenue-desc" } })),
    ).toEqual(["co-6", "co-1", "co-3"]);
    // With a carrier narrowing Alpha to its pending Hiscox order (100M),
    // Charlie ($0 bound Hiscox) still sorts after it.
    expect(
      ids(
        page({
          mode: "all",
          carriers: ["hiscox ins co"],
          sort: { date: "oldest", revenue: "revenue-desc" },
        }),
      ),
    ).toEqual(["co-1", "co-3"]);
  });

  it("never changes eligibility, metrics or facet options", () => {
    const baseline = page({ mode: "all" });
    const sorts = [
      NEWEST,
      { date: "oldest", revenue: "revenue-desc" },
      { date: "newest", revenue: "revenue-asc" },
    ] as const;
    for (const sort of sorts) {
      const sorted = page({ mode: "all", sort });
      expect(sorted.total).toBe(baseline.total);
      expect(sorted.revenueMicros).toBe(baseline.revenueMicros);
      expect(sorted.pendingOrderCount).toBe(baseline.pendingOrderCount);
      expect([...ids(sorted)].sort()).toEqual([...ids(baseline)].sort());
    }
  });

  it("paginates stably without duplicating or skipping ties", () => {
    const sorts = [
      OLDEST,
      NEWEST,
      { date: "oldest", revenue: "revenue-desc" },
      { date: "newest", revenue: "revenue-asc" },
    ] as const;
    for (const sort of sorts) {
      const whole = ids(page({ mode: "all", sort }));
      const paged = [
        ...ids(page({ mode: "all", sort, offset: 0, limit: 2 })),
        ...ids(page({ mode: "all", sort, offset: 2, limit: 2 })),
        ...ids(page({ mode: "all", sort, offset: 4, limit: 2 })),
      ];
      expect(paged).toEqual(whole);
    }
  });
});
