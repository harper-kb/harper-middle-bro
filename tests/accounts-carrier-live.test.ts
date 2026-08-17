import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  listBookAccountCarrierFacet,
  listBookAccountsPage,
} from "@/lib/db/queries/accounts";
import { orderMatchesCarriers } from "@/lib/carrier-filter";

/**
 * Carrier filtering and the carrier facet against the synced Harper book —
 * option derivation from the full filtered set, facet self-exclusion, OR
 * union semantics, agreement between facet counts and the page query, and
 * the availability handoff when another filter removes a selected carrier.
 * Real order shapes only; skips (with a note) when the book has not synced.
 */

const DB_PATH = path.join(process.cwd(), "data", "underwriter-desk.db");

function bookIsSynced(): boolean {
  if (!fs.existsSync(DB_PATH)) return false;
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const hasOrders = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'book_orders'`,
      )
      .get();
    if (!hasOrders) return false;
    const orderCount = (
      db.prepare(`SELECT count(*) AS c FROM book_orders`).get() as {
        c: number;
      }
    ).c;
    return orderCount > 100;
  } finally {
    db.close();
  }
}

const withBook = bookIsSynced() ? describe : describe.skip;

function countOrders(page: ReturnType<typeof listBookAccountsPage>): number {
  return page.boundOrderCount + page.pendingOrderCount + page.lostOrderCount;
}

withBook("carrier facet and filtering against the live book", () => {
  const facet = listBookAccountCarrierFacet({ mode: "all" });

  it("offers a real, deduplicated, alphabetized option set", () => {
    expect(facet.options.length).toBeGreaterThan(1);
    const keys = facet.options.map((option) => option.key);
    expect(new Set(keys).size).toBe(keys.length);
    const labels = facet.options.map((option) => option.label.toLowerCase());
    expect([...labels].sort()).toEqual(labels);
    for (const option of facet.options) {
      expect(option.orderCount).toBeGreaterThan(0);
      expect(option.label.trim()).not.toBe("");
    }
  });

  // Generous timeout: the run shares one SQLite book with parallel workers.
  it("filters rows, orders and KPIs to the selected carrier only", { timeout: 30_000 }, () => {
    const top = [...facet.options].sort(
      (a, b) => b.orderCount - a.orderCount,
    )[0]!;
    const result = listBookAccountsPage({
      mode: "all",
      carriers: [top.key],
      offset: 0,
      limit: 5000,
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.length).toBe(result.total);

    const accountIds = result.rows.map((row) => row.id);
    expect(new Set(accountIds).size).toBe(accountIds.length);

    const orderIds: string[] = [];
    for (const row of result.rows) {
      expect(row.orders.length).toBeGreaterThan(0);
      for (const order of row.orders) {
        orderIds.push(order.id);
        // The SQL predicate and the JS helper agree order by order.
        expect(orderMatchesCarriers(order.rich.deals, [top.key])).toBe(true);
      }
    }
    expect(new Set(orderIds).size).toBe(orderIds.length);
    // Facet count and page query agree about what the carrier matches.
    expect(countOrders(result)).toBe(top.orderCount);

    const orders = result.rows.flatMap((row) => row.orders);
    const knownRevenue = orders
      .filter((order) => order.revenueMicros !== null)
      .reduce((sum, order) => sum + order.revenueMicros!, 0);
    if (orders.some((order) => order.revenueMicros !== null)) {
      expect(result.revenueMicros).toBe(knownRevenue);
    } else {
      expect(result.revenueMicros).toBeNull();
    }
  });

  it("uses OR (union) semantics across two carriers", () => {
    const [a, b] = [...facet.options].sort(
      (x, y) => y.orderCount - x.orderCount,
    );
    if (!a || !b) return;
    const single = {
      a: listBookAccountsPage({ mode: "all", carriers: [a.key], offset: 0, limit: 1 }),
      b: listBookAccountsPage({ mode: "all", carriers: [b.key], offset: 0, limit: 1 }),
    };
    const both = listBookAccountsPage({
      mode: "all",
      carriers: [a.key, b.key],
      offset: 0,
      limit: 1,
    });
    // Orders can quote several carriers at once, so the union is bounded by
    // the sum and by the larger side — never additive by assumption.
    expect(countOrders(both)).toBeLessThanOrEqual(
      countOrders(single.a) + countOrders(single.b),
    );
    expect(countOrders(both)).toBeGreaterThanOrEqual(
      Math.max(countOrders(single.a), countOrders(single.b)),
    );
    expect(both.total).toBeGreaterThanOrEqual(
      Math.max(single.a.total, single.b.total),
    );
    expect(both.total).toBeLessThanOrEqual(single.a.total + single.b.total);
  });

  it("excludes the selection itself from option derivation", () => {
    const top = facet.options[0]!;
    const reFacet = listBookAccountCarrierFacet({
      mode: "all",
      selectedCarriers: [top.key],
    });
    expect(reFacet.options).toEqual(facet.options);
    expect(reFacet.unavailableSelected).toEqual([]);
  });

  it("scopes options to the records state as a subset of All", () => {
    const allKeys = new Set(facet.options.map((option) => option.key));
    for (const mode of ["pending", "bound", "lost"] as const) {
      const scoped = listBookAccountCarrierFacet({ mode });
      for (const option of scoped.options) {
        expect(allKeys.has(option.key)).toBe(true);
      }
    }
  });

  it("scopes options to the source partition", () => {
    const iq = listBookAccountCarrierFacet({ mode: "all", source: "iq" });
    const broker = listBookAccountCarrierFacet({ mode: "all", source: "broker" });
    const allKeys = new Set(facet.options.map((option) => option.key));
    for (const option of [...iq.options, ...broker.options]) {
      expect(allKeys.has(option.key)).toBe(true);
    }
    // The partition is strict, so a source view never grows the option set.
    expect(iq.options.length).toBeLessThanOrEqual(facet.options.length);
    expect(broker.options.length).toBeLessThanOrEqual(facet.options.length);
  });

  it("constrains options by the accounts search and keeps AND semantics", { timeout: 30_000 }, () => {
    const top = [...facet.options].sort(
      (a, b) => b.orderCount - a.orderCount,
    )[0]!;
    const filtered = listBookAccountsPage({
      mode: "all",
      carriers: [top.key],
      offset: 0,
      limit: 5000,
    });
    const target = filtered.rows.find((row) => row.name.length >= 6);
    if (!target) return;
    const searchedFacet = listBookAccountCarrierFacet({
      mode: "all",
      query: target.name,
    });
    expect(
      searchedFacet.options.map((option) => option.key),
    ).toContain(top.key);
    expect(searchedFacet.options.length).toBeLessThanOrEqual(
      facet.options.length,
    );
    const searched = listBookAccountsPage({
      mode: "all",
      query: target.name,
      carriers: [top.key],
      offset: 0,
      limit: 5000,
    });
    expect(searched.total).toBeGreaterThan(0);
    expect(searched.rows.map((row) => row.id)).toContain(target.id);
  });

  it("hands a selection over to unavailableSelected when the state filter removes it", () => {
    const pendingKeys = new Set(
      listBookAccountCarrierFacet({ mode: "pending" }).options.map(
        (option) => option.key,
      ),
    );
    const boundOnly = listBookAccountCarrierFacet({ mode: "bound" }).options.find(
      (option) => !pendingKeys.has(option.key),
    );
    if (!boundOnly) return; // every bound carrier also pends right now
    const facetUnderPending = listBookAccountCarrierFacet({
      mode: "pending",
      selectedCarriers: [boundOnly.key],
    });
    expect(facetUnderPending.unavailableSelected).toEqual([
      { key: boundOnly.key, label: boundOnly.label },
    ]);
    const page = listBookAccountsPage({
      mode: "pending",
      carriers: [boundOnly.key],
      offset: 0,
      limit: 10,
    });
    expect(page.total).toBe(0);
    expect(page.rows).toHaveLength(0);
  });
});

if (!bookIsSynced()) {
  console.warn(
    "[accounts-carrier-live.test] no synced book in data/underwriter-desk.db — skipped",
  );
}
