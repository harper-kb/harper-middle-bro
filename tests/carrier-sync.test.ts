import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { backfillBookOrderCarriers, migrate } from "@/lib/db/migrate";
import { syncAccountsAndPolicies } from "@/lib/db/seed";
import {
  emptyBookOrderRich,
  setSupabaseBookCache,
  type BookOrder,
  type BookOrderDeal,
  type SupabaseBook,
} from "@/lib/supabase-book.server";
import type { Account } from "@/lib/types";

/**
 * The carrier read-model rows (book_order_carriers) travel with the book
 * sync: derived per order on upsert, replaced when an order's deals change
 * carrier, swept when the order leaves the book, and backfilled once on a
 * database that predates the table. This is what makes a new carrier appear
 * in the filter on the same refresh tick as its order.
 */

function deal(dealId: number, carrierName: string | null): BookOrderDeal {
  return {
    dealId,
    dealStage: "sold",
    carrierName,
    wholesalerName: null,
    premiumCents: null,
    policyNumber: null,
    isInstantQuote: false,
    isBound: false,
    boundAt: null,
    effectiveDate: null,
    expirationDate: null,
  };
}

function order(id: string, harperOrderId: number, deals: BookOrderDeal[]): BookOrder {
  return {
    id,
    accountId: "co-100",
    harperOrderId,
    createdAt: "2026-08-01T00:00:00Z",
    orderedAt: "2026-08-01",
    eventAt: "2026-08-01T00:00:00Z",
    bindStatus: "pending",
    revenueCents: null,
    revenueMicros: null,
    rich: { ...emptyBookOrderRich(), deals },
    policyNumbers: [],
    inconsistency: null,
    source: "broker",
    iqStageTag: null,
    brokerGate: null,
    brokerGateAt: null,
    producerId: null,
    producerName: null,
  };
}

const ACCOUNT: Account = {
  id: "co-100",
  name: "Carrier Sync Test Co",
  dba: null,
  industry: "Testing",
  addressLine1: null,
  city: null,
  state: "CA",
  zip: null,
  primaryUwId: "uw-unassigned",
  backupUwId: null,
  notes: "",
  status: "pre_bind",
  paymentReceivedAt: null,
};

function book(orders: BookOrder[]): SupabaseBook {
  return {
    fetchedAt: new Date().toISOString(),
    accounts: [ACCOUNT],
    policies: [],
    orders,
    contactKeys: [],
    stageFieldsPresent: true,
    serviceNotesPresent: true,
    searchFieldsPresent: true,
  };
}

function carrierRows(db: Database.Database) {
  return db
    .prepare(
      `SELECT order_id, carrier_key, carrier_name FROM book_order_carriers
       ORDER BY order_id, carrier_key`,
    )
    .all() as { order_id: string; carrier_key: string; carrier_name: string }[];
}

describe("book sync carrier read-model", () => {
  it("derives, replaces and sweeps carrier rows with the book", () => {
    const db = new Database(":memory:");
    migrate(db);

    setSupabaseBookCache(
      book([
        order("order-1001", 1001, [deal(1, "Hiscox Ins Co"), deal(2, "HISCOX  Ins Co")]),
        order("order-1002", 1002, [deal(3, "Coterie Insurance")]),
        order("order-1003", 1003, [deal(4, null)]),
      ]),
    );
    syncAccountsAndPolicies(db);
    expect(carrierRows(db)).toEqual([
      // Case/whitespace variants of one entity collapse to one row per order.
      { order_id: "order-1001", carrier_key: "hiscox ins co", carrier_name: "Hiscox Ins Co" },
      { order_id: "order-1002", carrier_key: "coterie insurance", carrier_name: "Coterie Insurance" },
      // order-1003 has no carrier identity: no row, never an invented one.
    ]);

    // Next tick: order-1001 changed carriers, order-1002 left the book.
    setSupabaseBookCache(
      book([
        order("order-1001", 1001, [deal(5, "NEXT Insurance US Inc")]),
        order("order-1003", 1003, [deal(4, null)]),
      ]),
    );
    syncAccountsAndPolicies(db);
    expect(carrierRows(db)).toEqual([
      { order_id: "order-1001", carrier_key: "next insurance us inc", carrier_name: "NEXT Insurance US Inc" },
    ]);
    expect(
      db.prepare(`SELECT count(*) AS c FROM book_orders`).get(),
    ).toEqual({ c: 2 });
  });

  it("backfills a database that predates the table, once", () => {
    const db = new Database(":memory:");
    migrate(db);
    db.prepare(
      `INSERT INTO underwriters (id, name, email, carrier) VALUES ('uw-x', 'X', 'x@example.com', 'X')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, name, industry, state, primary_uw_id)
       VALUES ('co-1', 'Backfill Co', 'Testing', 'CA', 'uw-x')`,
    ).run();
    db.prepare(
      `INSERT INTO book_orders (id, account_id, harper_order_id, rich_json, policy_numbers_json)
       VALUES ('order-1', 'co-1', 1, ?, '[]')`,
    ).run(JSON.stringify({ deals: [{ dealId: 1, carrierName: "Markel Insurance Company" }] }));

    backfillBookOrderCarriers(db);
    expect(carrierRows(db)).toEqual([
      { order_id: "order-1", carrier_key: "markel insurance company", carrier_name: "Markel Insurance Company" },
    ]);

    // Non-empty table → the backfill never runs again (the sync owns it).
    db.prepare(
      `DELETE FROM book_order_carriers WHERE order_id = 'order-1'`,
    ).run();
    db.prepare(
      `INSERT INTO book_order_carriers (order_id, carrier_key, carrier_name)
       VALUES ('order-x', 'sentinel', 'Sentinel')`,
    ).run();
    backfillBookOrderCarriers(db);
    expect(carrierRows(db).map((row) => row.carrier_key)).toEqual(["sentinel"]);
  });
});
