import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { listBookAccountsPage } from "@/lib/db/queries/accounts";
import {
  BROKER_GATE_FILTER_OPTIONS,
  coerceBrokerGateId,
  orderMatchesBrokerGates,
  type BrokerGateFilterId,
} from "@/lib/broker-gate";

/**
 * Broker Gate filtering in the Accounts page query, exercised against the
 * synced Harper book — the account partition, the OR-within-gate semantics,
 * the AND with search, and the KPI/revenue math are only meaningful against
 * real order shapes. Skips (with a note) when the local book has not synced.
 */

const DB_PATH = path.join(process.cwd(), "data", "underwriter-desk.db");

function readBook() {
  if (!fs.existsSync(DB_PATH)) return null;
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const hasOrders = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'book_orders'`,
      )
      .get();
    if (!hasOrders) return null;
    const gateCounts = db
      .prepare(
        `SELECT broker_gate AS gate, count(*) AS n FROM book_orders
         WHERE source = 'broker' AND bind_status = 'pending'
           AND broker_gate IS NOT NULL
         GROUP BY broker_gate ORDER BY n DESC`,
      )
      .all() as { gate: string; n: number }[];
    const usable = gateCounts.filter((row) => coerceBrokerGateId(row.gate));
    if (usable.length < 2) return null;
    return {
      topGate: coerceBrokerGateId(usable[0].gate)!,
      secondGate: coerceBrokerGateId(usable[1].gate)!,
    };
  } finally {
    db.close();
  }
}

const book = readBook();
const withBook = book ? describe : describe.skip;

function pendingBrokerPage(
  brokerGates: readonly BrokerGateFilterId[],
  extra: { query?: string; limit?: number } = {},
) {
  return listBookAccountsPage({
    mode: "pending",
    source: "broker",
    brokerGates,
    query: extra.query,
    offset: 0,
    limit: extra.limit ?? 5000,
  });
}

withBook("broker gate filtering in listBookAccountsPage", () => {
  it("returns only Broker accounts whose pending orders sit on the selected gate", () => {
    const gate = book!.topGate;
    const result = pendingBrokerPage([gate]);

    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.length).toBe(result.total);

    const accountIds = result.rows.map((row) => row.id);
    expect(new Set(accountIds).size).toBe(accountIds.length);

    const orderIds: string[] = [];
    for (const row of result.rows) {
      expect(row.orders.length).toBeGreaterThan(0);
      for (const order of row.orders) {
        orderIds.push(order.id);
        expect(order.source).toBe("broker");
        expect(order.bindStatus).toBe("pending");
        expect(orderMatchesBrokerGates(order.brokerGate, [gate])).toBe(true);
      }
    }
    // One row per authoritative order id — history/joins never duplicate.
    expect(new Set(orderIds).size).toBe(orderIds.length);
  });

  it("recalculates KPI counts and revenue from the gate-filtered set without duplication", () => {
    const gate = book!.topGate;
    const result = pendingBrokerPage([gate]);

    const orders = result.rows.flatMap((row) => row.orders);
    expect(result.pendingOrderCount).toBe(orders.length);

    const knownRevenue = orders
      .filter((order) => order.revenueMicros !== null)
      .reduce((sum, order) => sum + order.revenueMicros!, 0);
    const missing = orders.filter(
      (order) => order.revenueMicros === null,
    ).length;
    if (orders.some((order) => order.revenueMicros !== null)) {
      expect(result.revenueMicros).toBe(knownRevenue);
    } else {
      expect(result.revenueMicros).toBeNull();
    }
    expect(result.missingRevenueOrderCount).toBe(missing);
  });

  it("partitions every pending Broker order across the gate options, nulls included", () => {
    const unfiltered = pendingBrokerPage([], { limit: 1 });
    let sum = 0;
    for (const option of BROKER_GATE_FILTER_OPTIONS) {
      sum += pendingBrokerPage([option.id], { limit: 1 }).pendingOrderCount;
    }
    // Null/unknown gates are not silently excluded from the default view:
    // the single-option counts (Gate unavailable among them) cover exactly
    // the unfiltered Broker total, each order once under its own gate.
    expect(sum).toBe(unfiltered.pendingOrderCount);
  });

  it("uses OR across multiple selected gates", () => {
    const a = book!.topGate;
    const b = book!.secondGate;
    const single = {
      a: pendingBrokerPage([a], { limit: 1 }),
      b: pendingBrokerPage([b], { limit: 1 }),
    };
    const both = pendingBrokerPage([a, b], { limit: 1 });

    // Current gate is single-valued per order, so order counts add exactly.
    expect(both.pendingOrderCount).toBe(
      single.a.pendingOrderCount + single.b.pendingOrderCount,
    );
    // Accounts dedupe: an account carrying both gates counts once.
    expect(both.total).toBeGreaterThanOrEqual(
      Math.max(single.a.total, single.b.total),
    );
    expect(both.total).toBeLessThanOrEqual(single.a.total + single.b.total);
  });

  it("combines with the accounts search using AND semantics", () => {
    const gate = book!.topGate;
    const filtered = pendingBrokerPage([gate]);
    const target = filtered.rows.find((row) => row.name.length >= 6);
    if (!target) return;

    const searched = pendingBrokerPage([gate], { query: target.name });
    expect(searched.total).toBeGreaterThan(0);
    expect(searched.total).toBeLessThanOrEqual(filtered.total);
    expect(searched.rows.map((row) => row.id)).toContain(target.id);
    for (const row of searched.rows) {
      for (const order of row.orders) {
        expect(order.source).toBe("broker");
        expect(orderMatchesBrokerGates(order.brokerGate, [gate])).toBe(true);
      }
    }
  });

  it("leaves unfiltered Broker totals untouched when the selection is empty", () => {
    const unfiltered = pendingBrokerPage([], { limit: 1 });
    const everything = pendingBrokerPage(
      BROKER_GATE_FILTER_OPTIONS.map((option) => option.id),
      { limit: 1 },
    );
    expect(everything.total).toBe(unfiltered.total);
    expect(everything.pendingOrderCount).toBe(unfiltered.pendingOrderCount);
    expect(everything.revenueMicros).toBe(unfiltered.revenueMicros);
  });
});

if (!book) {
  console.warn(
    "[accounts-broker-gate-query.test] no synced book with broker gates in data/underwriter-desk.db — skipped",
  );
}
