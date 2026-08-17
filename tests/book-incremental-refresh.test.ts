import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  diffBookDigests,
  isEmptyDelta,
  readBookDigests,
  writeBookDigests,
  type BookDigestRow,
} from "@/lib/db/book-digest";
import { mergeBook } from "@/lib/db/book-refresh";
import {
  emptyBookOrderRich,
  type BookOrder,
  type SupabaseBook,
} from "@/lib/supabase-book.server";
import type { Account, Policy } from "@/lib/types";

/**
 * The incremental refresh decides what to fetch from digests alone — Harper
 * exposes no `updated_at` on orders_temp / deals_v2 to fall back on — and then
 * splices the result into the book already in hand. Both halves are pure, and
 * both are load-bearing: a missed change serves a stale order indefinitely, and
 * a bad merge silently drops accounts out of the book.
 */

function digest(kind: "order" | "company", id: string, value: string): BookDigestRow {
  return { kind, id, digest: value };
}

function localDigests(rows: readonly BookDigestRow[]): Map<string, string> {
  return new Map(rows.map((row) => [`${row.kind}:${row.id}`, row.digest]));
}

function account(id: number, name = `Account ${id}`): Account {
  return {
    id: `co-${id}`,
    name,
    dba: null,
    industry: "Unclassified",
    addressLine1: null,
    city: null,
    state: "CA",
    zip: null,
    primaryUwId: "uw-unassigned",
    backupUwId: null,
    notes: "Harper ops import — stage: Servicing",
    status: "active",
    paymentReceivedAt: null,
  };
}

function policy(dealId: number, companyId: number): Policy {
  return {
    id: `deal-${dealId}`,
    accountId: `co-${companyId}`,
    policyNumber: `POL-${dealId}`,
    carrier: "Hiscox",
    coverages: ["GL"],
    effectiveDate: "2026-01-01",
    expirationDate: "2027-01-01",
    premiumCents: 120_000,
    quoteInsuredName: null,
    quoteCarrier: null,
    issuingCarrier: null,
  };
}

function order(orderId: number, companyId: number, bindStatus: BookOrder["bindStatus"] = "pending"): BookOrder {
  return {
    id: `order-${orderId}`,
    accountId: `co-${companyId}`,
    harperOrderId: orderId,
    createdAt: "2026-08-01T00:00:00.000Z",
    orderedAt: "2026-08-01",
    eventAt: "2026-08-01",
    bindStatus,
    revenueCents: 1000,
    revenueMicros: 10_000_000,
    rich: emptyBookOrderRich(),
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

function book(partial: Partial<SupabaseBook> = {}): SupabaseBook {
  return {
    fetchedAt: "2026-08-16T00:00:00.000Z",
    source: "supabase companies/deals_v2/orders_temp",
    accounts: [],
    policies: [],
    orders: [],
    contactKeys: [],
    stageFieldsPresent: true,
    serviceNotesPresent: true,
    searchFieldsPresent: true,
    ...partial,
  };
}

describe("diffBookDigests", () => {
  it("reports nothing when every digest matches", () => {
    const rows = [digest("order", "1", "aaa"), digest("company", "9", "bbb")];
    const delta = diffBookDigests(localDigests(rows), rows);
    expect(isEmptyDelta(delta)).toBe(true);
  });

  it("treats a row the local store has never seen as changed", () => {
    const delta = diffBookDigests(new Map(), [
      digest("order", "1", "aaa"),
      digest("company", "9", "bbb"),
    ]);
    expect(delta.changedOrderIds).toEqual([1]);
    expect(delta.changedCompanyIds).toEqual([9]);
    expect(delta.departedOrderIds).toEqual([]);
  });

  it("detects a changed row without any timestamp to compare", () => {
    const local = localDigests([digest("order", "1", "before")]);
    const delta = diffBookDigests(local, [digest("order", "1", "after")]);
    expect(delta.changedOrderIds).toEqual([1]);
  });

  it("reports a row missing from the sweep as departed", () => {
    const local = localDigests([
      digest("order", "1", "aaa"),
      digest("order", "2", "bbb"),
      digest("company", "9", "ccc"),
    ]);
    const delta = diffBookDigests(local, [digest("order", "1", "aaa")]);
    expect(delta.departedOrderIds).toEqual([2]);
    expect(delta.departedCompanyIds).toEqual([9]);
    expect(delta.changedOrderIds).toEqual([]);
  });

  it("keeps order and company ids apart when they collide numerically", () => {
    const local = localDigests([
      digest("order", "7", "same"),
      digest("company", "7", "same"),
    ]);
    const delta = diffBookDigests(local, [
      digest("order", "7", "moved"),
      digest("company", "7", "same"),
    ]);
    expect(delta.changedOrderIds).toEqual([7]);
    expect(delta.changedCompanyIds).toEqual([]);
  });

  it("ignores ids that are not usable Harper keys", () => {
    const delta = diffBookDigests(new Map(), [
      digest("order", "0", "aaa"),
      digest("order", "not-a-number", "bbb"),
      digest("order", "5", "ccc"),
    ]);
    expect(delta.changedOrderIds).toEqual([5]);
  });
});

describe("digest store", () => {
  function store() {
    const db = new Database(":memory:");
    db.exec(
      `CREATE TABLE book_sync_digests (
         kind TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL,
         PRIMARY KEY (kind, id)
       )`,
    );
    return db;
  }

  it("round-trips a sweep", () => {
    const db = store();
    writeBookDigests(db, [digest("order", "1", "aaa"), digest("company", "9", "bbb")]);
    const local = readBookDigests(db);
    expect(local.get("order:1")).toBe("aaa");
    expect(local.get("company:9")).toBe("bbb");
  });

  it("drops digests the newest sweep no longer reports", () => {
    const db = store();
    writeBookDigests(db, [digest("order", "1", "aaa"), digest("order", "2", "bbb")]);
    writeBookDigests(db, [digest("order", "1", "updated")]);
    const local = readBookDigests(db);
    expect(local.get("order:1")).toBe("updated");
    expect(local.has("order:2")).toBe(false);
  });
});

describe("mergeBook", () => {
  it("keeps rows outside the scope untouched", () => {
    const base = book({
      accounts: [account(1), account(2)],
      orders: [order(10, 1), order(20, 2)],
      policies: [policy(100, 1), policy(200, 2)],
      contactKeys: [
        { accountId: "co-1", kind: "email", value: "a@example.com" },
        { accountId: "co-2", kind: "email", value: "b@example.com" },
      ],
    });
    const patch = book({
      fetchedAt: "2026-08-17T00:00:00.000Z",
      accounts: [account(1, "Renamed")],
      orders: [order(10, 1, "bound")],
      policies: [policy(100, 1)],
      contactKeys: [{ accountId: "co-1", kind: "email", value: "new@example.com" }],
    });

    const merged = mergeBook(base, patch, {
      orderIds: [10],
      departedOrderIds: [],
      companyIds: [1],
      departedCompanyIds: [],
    });

    expect(merged.accounts.map((a) => a.name).sort()).toEqual([
      "Account 2",
      "Renamed",
    ]);
    expect(
      merged.orders.find((o) => o.id === "order-10")?.bindStatus,
    ).toBe("bound");
    expect(merged.orders.find((o) => o.id === "order-20")?.bindStatus).toBe(
      "pending",
    );
    expect(merged.contactKeys.map((k) => k.value).sort()).toEqual([
      "b@example.com",
      "new@example.com",
    ]);
    expect(merged.fetchedAt).toBe("2026-08-17T00:00:00.000Z");
  });

  it("removes a departed order without disturbing its siblings", () => {
    const base = book({
      accounts: [account(1)],
      orders: [order(10, 1), order(11, 1)],
    });
    const merged = mergeBook(base, book(), {
      orderIds: [],
      departedOrderIds: [11],
      companyIds: [],
      departedCompanyIds: [],
    });
    expect(merged.orders.map((o) => o.id)).toEqual(["order-10"]);
  });

  it("removes a departed company's account, policies and search keys", () => {
    const base = book({
      accounts: [account(1), account(2)],
      policies: [policy(100, 1), policy(200, 2)],
      orders: [order(10, 1), order(20, 2)],
      contactKeys: [{ accountId: "co-2", kind: "phone", value: "5551234567" }],
    });
    const merged = mergeBook(base, book(), {
      orderIds: [],
      departedOrderIds: [20],
      companyIds: [],
      departedCompanyIds: [2],
    });
    expect(merged.accounts.map((a) => a.id)).toEqual(["co-1"]);
    expect(merged.policies.map((p) => p.id)).toEqual(["deal-100"]);
    expect(merged.orders.map((o) => o.id)).toEqual(["order-10"]);
    expect(merged.contactKeys).toEqual([]);
  });

  it("drops an in-scope order the refetch did not return", () => {
    // The order was refetched because its digest moved, and came back
    // ineligible — soft-deleted between the sweep and the fetch. It must not
    // survive as its stale self.
    const base = book({ accounts: [account(1)], orders: [order(10, 1)] });
    const merged = mergeBook(base, book(), {
      orderIds: [10],
      departedOrderIds: [],
      companyIds: [],
      departedCompanyIds: [],
    });
    expect(merged.orders).toEqual([]);
  });

  it("adds an order that arrived on a company the book had never seen", () => {
    const base = book({ accounts: [account(1)], orders: [order(10, 1)] });
    const patch = book({
      accounts: [account(5, "Brand New LLC")],
      orders: [order(50, 5)],
      policies: [policy(500, 5)],
    });
    const merged = mergeBook(base, patch, {
      orderIds: [50],
      departedOrderIds: [],
      companyIds: [5],
      departedCompanyIds: [],
    });
    expect(merged.accounts.map((a) => a.id).sort()).toEqual(["co-1", "co-5"]);
    expect(merged.orders.map((o) => o.id).sort()).toEqual([
      "order-10",
      "order-50",
    ]);
    expect(merged.policies.map((p) => p.id)).toEqual(["deal-500"]);
  });

  it("keeps the cached reporting windows when the patch carries none", () => {
    const windows = {
      timeZone: "America/Los_Angeles" as const,
      ranges: {
        "this-week": {
          startsAt: "2026-08-10T07:00:00+00:00",
          endsAt: "2026-08-17T07:00:00+00:00",
          startsOn: "2026-08-10",
          endsOn: "2026-08-16",
        },
        "last-week": {
          startsAt: "2026-08-03T07:00:00+00:00",
          endsAt: "2026-08-10T07:00:00+00:00",
          startsOn: "2026-08-03",
          endsOn: "2026-08-09",
        },
        "last-30-days": {
          startsAt: "2026-07-18T07:00:00+00:00",
          endsAt: "2026-08-17T07:00:00+00:00",
          startsOn: "2026-07-18",
          endsOn: "2026-08-16",
        },
      },
    };
    const base = book({ accounts: [account(1)], reportingWindows: windows });
    const merged = mergeBook(base, book(), {
      orderIds: [],
      departedOrderIds: [],
      companyIds: [],
      departedCompanyIds: [],
    });
    expect(merged.reportingWindows).toEqual(windows);
  });

  it("marks the merged book as carrying every current field", () => {
    const base = book({
      accounts: [account(1)],
      stageFieldsPresent: false,
      serviceNotesPresent: false,
      searchFieldsPresent: false,
    });
    const merged = mergeBook(base, book(), {
      orderIds: [],
      departedOrderIds: [],
      companyIds: [],
      departedCompanyIds: [],
    });
    expect(merged.stageFieldsPresent).toBe(true);
    expect(merged.serviceNotesPresent).toBe(true);
    expect(merged.searchFieldsPresent).toBe(true);
    expect(merged.noteThreadsPresent).toBe(true);
  });

  it("splices note threads at company grain", () => {
    const noteEntry = (id: string, companyId: number, orderId: number) => ({
      id,
      accountId: `co-${companyId}`,
      orderId,
      body: `note ${id}`,
      author: "Ether Hammemi",
      createdAt: "2026-08-15T00:00:00.000Z",
    });
    const base = book({
      accounts: [account(1), account(2)],
      serviceNoteEntries: [
        noteEntry("10", 1, 100),
        noteEntry("11", 1, 101),
        noteEntry("20", 2, 200),
      ],
    });
    // Company 1 was refetched (one note deleted upstream); company 2 is out
    // of scope and keeps its thread even though the patch carries nothing
    // for it. A base from before the mirror (undefined entries) still merges.
    const patch = book({
      accounts: [account(1)],
      serviceNoteEntries: [noteEntry("11", 1, 101)],
    });
    const merged = mergeBook(base, patch, {
      orderIds: [],
      departedOrderIds: [],
      companyIds: [1],
      departedCompanyIds: [],
    });
    expect(
      (merged.serviceNoteEntries ?? []).map((entry) => entry.id).sort(),
    ).toEqual(["11", "20"]);

    const fromLegacyBase = mergeBook(
      { ...base, serviceNoteEntries: undefined },
      patch,
      {
        orderIds: [],
        departedOrderIds: [],
        companyIds: [1],
        departedCompanyIds: [],
      },
    );
    expect(
      (fromLegacyBase.serviceNoteEntries ?? []).map((entry) => entry.id),
    ).toEqual(["11"]);
  });
});
