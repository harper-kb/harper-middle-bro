import { beforeAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * Carrier filtering and the carrier facet in the Accounts page query, against
 * a synthetic in-memory book with known carrier shapes: multi-carrier orders,
 * display-case variants of one carrier entity, similar-but-different names,
 * and an order with no carrier identity at all. The query module's singleton
 * connection is swapped for the fixture database.
 */

const mem = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db/connection", () => ({
  getDb: () => mem.db,
  resetDatabase: () => {},
}));

const { migrate } = await import("@/lib/db/migrate");
const {
  getBookOrderNavigationCounts,
  listBookAccountCarrierFacet,
  listBookAccountsPage,
} = await import("@/lib/db/queries/accounts");
const { carrierKeyFromName } = await import("@/lib/carrier-filter");

interface FixtureOrder {
  id: string;
  accountId: string;
  harperOrderId: number;
  bindStatus: "pending" | "bound" | "lost";
  source: "iq" | "broker" | null;
  revenueMicros: number | null;
  brokerGate?: string | null;
  iqStageTag?: string | null;
  carriers: (string | null)[];
}

const ORDERS: FixtureOrder[] = [
  // Alpha: pending IQ Hiscox + bound Broker NEXT — several orders across
  // different carriers and states on one account.
  { id: "order-11", accountId: "co-1", harperOrderId: 11, bindStatus: "pending", source: "iq", revenueMicros: 100_000_000, carriers: ["Hiscox Ins Co"] },
  { id: "order-12", accountId: "co-1", harperOrderId: 12, bindStatus: "bound", source: "broker", revenueMicros: 200_000_000, carriers: ["NEXT Insurance US Inc"] },
  // Beta: pending Broker on gate G4.
  { id: "order-21", accountId: "co-2", harperOrderId: 21, bindStatus: "pending", source: "broker", revenueMicros: 300_000_000, brokerGate: "G4", carriers: ["Coterie Insurance"] },
  // Gamma: bound IQ on the ALL-CAPS variant of Hiscox (same entity), plus a
  // lost Broker order on Markel, plus a bound Broker on the similar-but-
  // different "Markel American Ins Co".
  { id: "order-31", accountId: "co-3", harperOrderId: 31, bindStatus: "bound", source: "iq", revenueMicros: null, carriers: ["HISCOX INS CO"] },
  { id: "order-32", accountId: "co-3", harperOrderId: 32, bindStatus: "lost", source: "broker", revenueMicros: 40_000_000, carriers: ["Markel Insurance Company"] },
  { id: "order-33", accountId: "co-3", harperOrderId: 33, bindStatus: "bound", source: "broker", revenueMicros: 60_000_000, carriers: ["Markel American Ins Co"] },
  // Delta: one pending IQ order quoting two carriers at once.
  { id: "order-41", accountId: "co-4", harperOrderId: 41, bindStatus: "pending", source: "iq", revenueMicros: 50_000_000, carriers: ["Hiscox Ins Co", "Coterie Insurance"] },
  // Epsilon: pending Broker order with no carrier identity (legacy shape).
  { id: "order-51", accountId: "co-5", harperOrderId: 51, bindStatus: "pending", source: "broker", revenueMicros: 70_000_000, carriers: [null] },
];

const ACCOUNTS = [
  { id: "co-1", name: "Alpha Logistics", dba: null },
  { id: "co-2", name: "Beta Builders", dba: null },
  { id: "co-3", name: "Gamma Cafe", dba: null },
  { id: "co-4", name: "Delta Dental", dba: "Delta Smiles" },
  { id: "co-5", name: "Epsilon Farm", dba: null },
];

beforeAll(() => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    `INSERT INTO underwriters (id, name, email, carrier) VALUES ('uw-x', 'X', 'x@example.com', 'X')`,
  ).run();
  const insertAccount = db.prepare(
    `INSERT INTO accounts (id, name, dba, industry, state, primary_uw_id)
     VALUES (@id, @name, @dba, 'Testing', 'CA', 'uw-x')`,
  );
  for (const account of ACCOUNTS) insertAccount.run(account);

  const insertOrder = db.prepare(
    `INSERT INTO book_orders (
       id, account_id, harper_order_id, created_at, ordered_at, event_at,
       bind_status, revenue_cents, revenue_micros, rich_json,
       policy_numbers_json, inconsistency, source, iq_stage_tag,
       broker_gate, broker_gate_at
     ) VALUES (
       @id, @accountId, @harperOrderId, @createdAt, @orderedAt, @eventAt,
       @bindStatus, @revenueCents, @revenueMicros, @richJson, '[]', NULL,
       @source, @iqStageTag, @brokerGate, NULL
     )`,
  );
  const insertCarrier = db.prepare(
    `INSERT OR IGNORE INTO book_order_carriers (order_id, carrier_key, carrier_name)
     VALUES (?, ?, ?)`,
  );
  for (const order of ORDERS) {
    const deals = order.carriers.map((name, index) => ({
      dealId: order.harperOrderId * 10 + index,
      dealStage: order.bindStatus === "bound" ? "bound" : "sold",
      carrierName: name,
      isInstantQuote: order.source === "iq",
    }));
    insertOrder.run({
      id: order.id,
      accountId: order.accountId,
      harperOrderId: order.harperOrderId,
      createdAt: `2026-08-0${(order.harperOrderId % 8) + 1}T00:00:00Z`,
      orderedAt: "2026-08-01",
      eventAt: "2026-08-01T00:00:00Z",
      bindStatus: order.bindStatus,
      revenueCents: order.revenueMicros === null ? null : order.revenueMicros / 10_000,
      revenueMicros: order.revenueMicros,
      richJson: JSON.stringify({ deals }),
      source: order.source,
      iqStageTag: order.iqStageTag ?? null,
      brokerGate: order.brokerGate ?? null,
    });
    // Derived rows exactly as the sync writes them.
    for (const name of order.carriers) {
      const key = carrierKeyFromName(name);
      if (key) insertCarrier.run(order.id, key, name!.trim());
    }
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

describe("Records navigation order counts", () => {
  it("counts order rows in every Records view", () => {
    expect(getBookOrderNavigationCounts()).toEqual({
      allOrders: 8,
      pendingOrders: 4,
      boundOrders: 3,
      lostOrders: 1,
    });
  });
});

describe("carrier filtering in listBookAccountsPage", () => {
  it("changes nothing when no carrier is selected", () => {
    const result = page({ mode: "all" });
    // Default ordering: oldest first by representative date, names on ties.
    expect(result.rows.map((row) => row.id)).toEqual([
      "co-4",
      "co-1",
      "co-5",
      "co-2",
      "co-3",
    ]);
  });

  it("filters accounts, attached orders, counts and revenue to matching orders only", () => {
    const result = page({ mode: "all", carriers: ["hiscox ins co"] });
    expect(result.rows.map((row) => row.id)).toEqual(["co-4", "co-1", "co-3"]);
    // Alpha keeps only its Hiscox order — the NEXT bound order is gone from
    // the row, its count and its revenue.
    const alpha = result.rows.find((row) => row.id === "co-1")!;
    expect(alpha.orders.map((order) => order.id)).toEqual(["order-11"]);
    expect(alpha.orderCount).toBe(1);
    // The ALL-CAPS display variant on Gamma is the same carrier entity.
    const gamma = result.rows.find((row) => row.id === "co-3")!;
    expect(gamma.orders.map((order) => order.id)).toEqual(["order-31"]);
    expect(result.pendingOrderCount).toBe(2); // order-11, order-41
    expect(result.boundOrderCount).toBe(1); // order-31
    expect(result.lostOrderCount).toBe(0);
    // Revenue: 100M (order-11) + 50M (order-41); order-31 is null → excluded
    // and reported as missing.
    expect(result.revenueMicros).toBe(150_000_000);
    expect(result.missingRevenueOrderCount).toBe(1);
    expect(result.withPendingOrders).toBe(2);
    expect(result.withBoundOrders).toBe(1);
    expect(result.withLostOrders).toBe(0);
  });

  it("uses OR across selected carriers and never duplicates rows or orders", () => {
    const result = page({
      mode: "all",
      carriers: ["hiscox ins co", "coterie insurance"],
    });
    expect(result.rows.map((row) => row.id)).toEqual([
      "co-4",
      "co-1",
      "co-2",
      "co-3",
    ]);
    // Delta's single order carries both selected carriers — one row, once.
    const delta = result.rows.find((row) => row.id === "co-4")!;
    expect(delta.orders.map((order) => order.id)).toEqual(["order-41"]);
    const allOrderIds = result.rows.flatMap((row) =>
      row.orders.map((order) => order.id),
    );
    expect(new Set(allOrderIds).size).toBe(allOrderIds.length);
  });

  it("combines with the records state using AND semantics", () => {
    const result = page({ mode: "pending", carriers: ["hiscox ins co"] });
    // Gamma's Hiscox order is bound, so Gamma disappears from Pending.
    expect(result.rows.map((row) => row.id)).toEqual(["co-4", "co-1"]);
    for (const row of result.rows) {
      for (const order of row.orders) {
        expect(order.bindStatus).toBe("pending");
      }
    }
    const bound = page({ mode: "bound", carriers: ["hiscox ins co"] });
    expect(bound.rows.map((row) => row.id)).toEqual(["co-3"]);
    const lost = page({ mode: "lost", carriers: ["hiscox ins co"] });
    expect(lost.rows).toHaveLength(0);
  });

  it("combines with the source partition using AND semantics", () => {
    // Alpha and Gamma mix IQ and Broker orders, so under IQ only Delta
    // remains for Hiscox.
    const result = page({
      mode: "all",
      source: "iq",
      carriers: ["hiscox ins co"],
    });
    expect(result.rows.map((row) => row.id)).toEqual(["co-4"]);
  });

  it("combines with the Broker Gate filter", () => {
    const gated = page({
      mode: "pending",
      source: "broker",
      brokerGates: ["G4"],
      carriers: ["coterie insurance"],
    });
    expect(gated.rows.map((row) => row.id)).toEqual(["co-2"]);
    const wrongCarrier = page({
      mode: "pending",
      source: "broker",
      brokerGates: ["G4"],
      carriers: ["hiscox ins co"],
    });
    expect(wrongCarrier.rows).toHaveLength(0);
  });

  it("combines with the accounts search", () => {
    const result = page({
      mode: "all",
      query: "gamma",
      carriers: ["hiscox ins co"],
    });
    expect(result.rows.map((row) => row.id)).toEqual(["co-3"]);
    expect(result.total).toBe(1);
  });

  it("keeps similar names apart — Markel Insurance ≠ Markel American", () => {
    const markel = page({
      mode: "all",
      carriers: ["markel insurance company"],
    });
    expect(markel.rows.map((row) => row.id)).toEqual(["co-3"]);
    expect(markel.rows[0]!.orders.map((order) => order.id)).toEqual([
      "order-32",
    ]);
    const markelAmerican = page({
      mode: "all",
      carriers: ["markel american ins co"],
    });
    expect(markelAmerican.rows[0]!.orders.map((order) => order.id)).toEqual([
      "order-33",
    ]);
  });

  it("drops accounts whose only orders carry no carrier identity", () => {
    const result = page({ mode: "all", carriers: ["hiscox ins co"] });
    expect(result.rows.map((row) => row.id)).not.toContain("co-5");
    // And an unknown key matches nothing rather than everything.
    const unknown = page({ mode: "all", carriers: ["no such carrier"] });
    expect(unknown.total).toBe(0);
    expect(unknown.rows).toHaveLength(0);
    expect(unknown.revenueMicros).toBeNull();
  });

  it("resets cleanly when the selection empties again", () => {
    const filtered = page({ mode: "all", carriers: ["coterie insurance"] });
    expect(filtered.total).toBe(2);
    const unfiltered = page({ mode: "all", carriers: [] });
    expect(unfiltered.total).toBe(5);
  });
});

describe("listBookAccountCarrierFacet", () => {
  it("derives contextual options with order counts and elected labels", () => {
    const facet = listBookAccountCarrierFacet({ mode: "all" });
    expect(facet.options).toEqual([
      { key: "coterie insurance", label: "Coterie Insurance", orderCount: 2 },
      // Two "Hiscox Ins Co" orders beat one "HISCOX INS CO" — the most
      // common verified spelling is the label, and the variants are one key.
      { key: "hiscox ins co", label: "Hiscox Ins Co", orderCount: 3 },
      { key: "markel american ins co", label: "Markel American Ins Co", orderCount: 1 },
      { key: "markel insurance company", label: "Markel Insurance Company", orderCount: 1 },
      { key: "next insurance us inc", label: "NEXT Insurance US Inc", orderCount: 1 },
    ]);
    expect(facet.unavailableSelected).toEqual([]);
  });

  it("scopes options to the records state", () => {
    const pending = listBookAccountCarrierFacet({ mode: "pending" });
    expect(pending.options.map((option) => option.key)).toEqual([
      "coterie insurance",
      "hiscox ins co",
    ]);
    const bound = listBookAccountCarrierFacet({ mode: "bound" });
    expect(bound.options.map((option) => option.key)).toEqual([
      "hiscox ins co",
      "markel american ins co",
      "next insurance us inc",
    ]);
    const lost = listBookAccountCarrierFacet({ mode: "lost" });
    expect(lost.options.map((option) => option.key)).toEqual([
      "markel insurance company",
    ]);
  });

  it("scopes options to the source partition", () => {
    const iq = listBookAccountCarrierFacet({ mode: "all", source: "iq" });
    // Only Delta is a pure-IQ account in view; its single order quotes both.
    expect(iq.options.map((option) => option.key)).toEqual([
      "coterie insurance",
      "hiscox ins co",
    ]);
    const broker = listBookAccountCarrierFacet({ mode: "all", source: "broker" });
    // Beta and Epsilon are pure-Broker; Epsilon's order has no carrier.
    expect(broker.options.map((option) => option.key)).toEqual([
      "coterie insurance",
    ]);
  });

  it("scopes options to the accounts search and the Broker Gate filter", () => {
    const searched = listBookAccountCarrierFacet({ mode: "all", query: "alpha" });
    expect(searched.options.map((option) => option.key)).toEqual([
      "hiscox ins co",
      "next insurance us inc",
    ]);
    const gated = listBookAccountCarrierFacet({
      mode: "pending",
      source: "broker",
      brokerGates: ["G4"],
    });
    expect(gated.options.map((option) => option.key)).toEqual([
      "coterie insurance",
    ]);
  });

  it("excludes the carrier selection itself from the option derivation", () => {
    const facet = listBookAccountCarrierFacet({
      mode: "all",
      selectedCarriers: ["hiscox ins co"],
    });
    // Selecting Hiscox must not collapse the menu to Hiscox.
    expect(facet.options.map((option) => option.key)).toContain(
      "coterie insurance",
    );
    expect(facet.options.map((option) => option.key)).toContain(
      "hiscox ins co",
    );
    expect(facet.unavailableSelected).toEqual([]);
  });

  it("keeps selected carriers visible when another filter removes them", () => {
    // NEXT exists only on a bound order: under Pending it is unavailable but
    // must stay named with the book's best label.
    const facet = listBookAccountCarrierFacet({
      mode: "pending",
      selectedCarriers: ["next insurance us inc", "hiscox ins co"],
    });
    expect(facet.options.map((option) => option.key)).toContain(
      "hiscox ins co",
    );
    expect(facet.unavailableSelected).toEqual([
      { key: "next insurance us inc", label: "NEXT Insurance US Inc" },
    ]);
  });

  it("labels a key the book no longer knows with its own normalized form", () => {
    const facet = listBookAccountCarrierFacet({
      mode: "all",
      selectedCarriers: ["departed carrier co"],
    });
    expect(facet.unavailableSelected).toEqual([
      { key: "departed carrier co", label: "departed carrier co" },
    ]);
  });

  it("derives options from the whole filtered set, not the visible page", () => {
    // A one-account page still offers carriers that only exist on accounts
    // beyond it (Markel lives on Gamma, the last row of the default order).
    const firstPage = page({ mode: "all", limit: 1 });
    expect(firstPage.rows.map((row) => row.id)).toEqual(["co-4"]);
    const facet = listBookAccountCarrierFacet({ mode: "all" });
    expect(facet.options.map((option) => option.key)).toContain(
      "markel insurance company",
    );
  });

  it("agrees with the page query about what one carrier matches", () => {
    const facet = listBookAccountCarrierFacet({ mode: "all" });
    for (const option of facet.options) {
      const filtered = page({ mode: "all", carriers: [option.key] });
      const matched =
        filtered.boundOrderCount +
        filtered.pendingOrderCount +
        filtered.lostOrderCount;
      expect(matched).toBe(option.orderCount);
    }
  });
});
