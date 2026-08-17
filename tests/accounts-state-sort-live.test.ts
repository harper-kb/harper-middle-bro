import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  listBookAccountLocationStateFacet,
  listBookAccountsPage,
} from "@/lib/db/queries/accounts";
import {
  accountMatchesLocationStates,
  isUsStateCode,
  LOCATION_STATE_NONE,
} from "@/lib/location-state";
import { pickRepresentativeOrder } from "@/lib/account-row-model";

/**
 * Location State filtering and sorting against the synced Harper book — the
 * facet partitions the real account set exactly, the SQL sort agrees with
 * the shared representative-order rule the rows display, revenue ordering
 * matches the displayed aggregate semantic, and pagination stays stable
 * under every sort. Skips (with a note) when the book has not synced.
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

/** The row's displayed revenue: aggregate, null when any order lacks one. */
function displayedRevenue(
  orders: readonly { revenueMicros: number | null }[],
): number | null {
  let sum = 0;
  for (const order of orders) {
    if (order.revenueMicros === null) return null;
    sum += order.revenueMicros;
  }
  return sum;
}

function assertOrdered(
  values: (string | number | null)[],
  direction: "asc" | "desc",
) {
  let seenNull = false;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null) {
      seenNull = true;
      continue;
    }
    // Null keys must never precede valid keys.
    expect(seenNull).toBe(false);
    if (i > 0 && values[i - 1] !== null) {
      const prev = values[i - 1]!;
      if (direction === "desc") {
        expect(prev >= value).toBe(true);
      } else {
        expect(prev <= value).toBe(true);
      }
    }
  }
}

withBook("location state and sorting against the live book", () => {
  const facet = listBookAccountLocationStateFacet({ mode: "all" });
  const unfiltered = listBookAccountsPage({
    mode: "all",
    offset: 0,
    limit: 1,
  });

  it("offers only real USPS codes plus one explicit Unknown bucket", () => {
    expect(facet.options.length).toBeGreaterThan(1);
    for (const option of facet.options) {
      if (option.id === LOCATION_STATE_NONE) {
        expect(option.code).toBeNull();
        expect(option.label).toBe("Unknown / Not set");
      } else {
        expect(isUsStateCode(option.id)).toBe(true);
        expect(option.accountCount).toBeGreaterThan(0);
      }
    }
    // State is an account attribute, so the buckets partition the account
    // set exactly: every account has exactly one state value.
    const sum = facet.options.reduce(
      (total, option) => total + option.accountCount,
      0,
    );
    expect(sum).toBe(unfiltered.total);
  });

  it("filters rows to the selected states and agrees with the JS helper", { timeout: 30_000 }, () => {
    const top = [...facet.options]
      .filter((option) => option.id !== LOCATION_STATE_NONE)
      .sort((a, b) => b.accountCount - a.accountCount)[0]!;
    const result = listBookAccountsPage({
      mode: "all",
      locationStates: [top.id],
      offset: 0,
      limit: 5000,
    });
    expect(result.total).toBe(top.accountCount);
    expect(result.rows.length).toBe(result.total);
    for (const row of result.rows) {
      expect(accountMatchesLocationStates(row.state, [top.id])).toBe(true);
    }
    // The Unknown bucket matches exactly the rows a code never can.
    const unknown = listBookAccountsPage({
      mode: "all",
      locationStates: [LOCATION_STATE_NONE],
      offset: 0,
      limit: 5000,
    });
    for (const row of unknown.rows) {
      expect(
        accountMatchesLocationStates(row.state, [LOCATION_STATE_NONE]),
      ).toBe(true);
    }
  });

  // Generous timeouts: the whole test run shares one SQLite book, and a
  // parallel worker mid-sync can slow (never corrupt) these reads.
  it("sorts All Accounts by the shared representative-order rule", { timeout: 30_000 }, () => {
    const result = listBookAccountsPage({
      mode: "all",
      sort: { date: "newest", revenue: "none" },
      offset: 0,
      limit: 150,
    });
    const keys = result.rows.map(
      (row) => pickRepresentativeOrder(row.orders)?.createdAt ?? null,
    );
    assertOrdered(keys, "desc");
    // The default ordering is the same rule, oldest first.
    const byDefault = listBookAccountsPage({
      mode: "all",
      offset: 0,
      limit: 150,
    });
    assertOrdered(
      byDefault.rows.map(
        (row) => pickRepresentativeOrder(row.orders)?.createdAt ?? null,
      ),
      "asc",
    );
  });

  it("sorts the Bound view by the verified bind event", { timeout: 30_000 }, () => {
    const result = listBookAccountsPage({
      mode: "bound",
      sort: { date: "newest", revenue: "none" },
      offset: 0,
      limit: 150,
    });
    const keys = result.rows.map((row) => {
      const events = row.orders
        .map((order) => order.eventAt)
        .filter((value): value is string => value !== null);
      return events.length > 0 ? events.sort().at(-1)! : null;
    });
    assertOrdered(keys, "desc");
  });

  it("sorts revenue by the displayed aggregate with unavailable last", { timeout: 30_000 }, () => {
    for (const [revenue, direction] of [
      ["revenue-desc", "desc"],
      ["revenue-asc", "asc"],
    ] as const) {
      const result = listBookAccountsPage({
        mode: "all",
        sort: { date: "oldest", revenue },
        offset: 0,
        limit: 150,
      });
      assertOrdered(
        result.rows.map((row) => displayedRevenue(row.orders)),
        direction,
      );
    }
  });

  it("lets the date order arrange equal-revenue runs under a revenue sort", { timeout: 30_000 }, () => {
    const result = listBookAccountsPage({
      mode: "all",
      sort: { date: "newest", revenue: "revenue-desc" },
      offset: 0,
      limit: 150,
    });
    assertOrdered(
      result.rows.map((row) => displayedRevenue(row.orders)),
      "desc",
    );
    // Within each run of equal revenue, representative dates are newest-first.
    for (let i = 1; i < result.rows.length; i++) {
      const prev = result.rows[i - 1]!;
      const row = result.rows[i]!;
      const prevRevenue = displayedRevenue(prev.orders);
      const revenue = displayedRevenue(row.orders);
      if (prevRevenue === null || prevRevenue !== revenue) continue;
      const prevDate = pickRepresentativeOrder(prev.orders)?.createdAt ?? null;
      const date = pickRepresentativeOrder(row.orders)?.createdAt ?? null;
      if (prevDate === null || date === null) continue;
      expect(prevDate >= date).toBe(true);
    }
  });

  it("paginates stably under sort — no duplicates, no gaps", { timeout: 30_000 }, () => {
    const sort = { date: "newest", revenue: "revenue-desc" } as const;
    const whole = listBookAccountsPage({
      mode: "all",
      sort,
      offset: 0,
      limit: 200,
    }).rows.map((row) => row.id);
    const paged = [
      ...listBookAccountsPage({ mode: "all", sort, offset: 0, limit: 100 }).rows,
      ...listBookAccountsPage({ mode: "all", sort, offset: 100, limit: 100 }).rows,
    ].map((row) => row.id);
    expect(paged).toEqual(whole);
    expect(new Set(paged).size).toBe(paged.length);
  });

  it("changes nothing but the order: metrics and totals match the default", () => {
    const sorted = listBookAccountsPage({
      mode: "all",
      sort: { date: "oldest", revenue: "revenue-desc" },
      offset: 0,
      limit: 1,
    });
    expect(sorted.total).toBe(unfiltered.total);
    expect(sorted.revenueMicros).toBe(unfiltered.revenueMicros);
    expect(sorted.boundOrderCount).toBe(unfiltered.boundOrderCount);
  });

  it("keeps selected states visible when the view removes them", { timeout: 30_000 }, () => {
    const allIds = new Set(facet.options.map((option) => option.id));
    for (const mode of ["pending", "bound", "lost"] as const) {
      const scoped = listBookAccountLocationStateFacet({ mode });
      for (const option of scoped.options) {
        expect(allIds.has(option.id)).toBe(true);
      }
      const missing = [...allIds].find(
        (id) => !scoped.options.some((option) => option.id === id),
      );
      if (!missing) continue;
      const reFacet = listBookAccountLocationStateFacet({
        mode,
        selectedStates: [missing],
      });
      expect(
        reFacet.unavailableSelected.map((entry) => entry.id),
      ).toContain(missing);
    }
  });
});

if (!bookIsSynced()) {
  console.warn(
    "[accounts-state-sort-live.test] no synced book in data/underwriter-desk.db — skipped",
  );
}
