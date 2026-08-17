import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DATE_ORDER_IDS,
  ACCOUNT_DATE_ORDER_LABELS,
  ACCOUNT_REVENUE_ORDER_IDS,
  ACCOUNT_REVENUE_ORDER_LABELS,
  accountSortSummary,
  DEFAULT_ACCOUNT_SORT,
  isDefaultAccountSort,
  parseAccountSort,
  serializeAccountSort,
} from "@/lib/account-sort";

/**
 * Accounts sort axis: two composable single-select choices — a date order
 * (Oldest first is the page default) and an optional revenue order that
 * leads when active. One shape shared by control, URL and query; unknown
 * URL tokens land safely back on the default.
 */

describe("account sort shape", () => {
  it("offers both date directions and the three revenue choices", () => {
    expect(ACCOUNT_DATE_ORDER_IDS).toEqual(["oldest", "newest"]);
    expect(ACCOUNT_REVENUE_ORDER_IDS).toEqual([
      "none",
      "revenue-desc",
      "revenue-asc",
    ]);
    for (const id of ACCOUNT_DATE_ORDER_IDS) {
      expect(ACCOUNT_DATE_ORDER_LABELS[id].trim()).not.toBe("");
    }
    for (const id of ACCOUNT_REVENUE_ORDER_IDS) {
      expect(ACCOUNT_REVENUE_ORDER_LABELS[id].trim()).not.toBe("");
    }
  });

  it("defaults to oldest first with no revenue order", () => {
    expect(DEFAULT_ACCOUNT_SORT).toEqual({ date: "oldest", revenue: "none" });
    expect(isDefaultAccountSort({ date: "oldest", revenue: "none" })).toBe(true);
    expect(isDefaultAccountSort({ date: "newest", revenue: "none" })).toBe(false);
    expect(
      isDefaultAccountSort({ date: "oldest", revenue: "revenue-desc" }),
    ).toBe(false);
  });
});

describe("parseAccountSort / serializeAccountSort", () => {
  it("round-trips every combination through the URL param", () => {
    const combos = [
      { date: "oldest", revenue: "none" },
      { date: "newest", revenue: "none" },
      { date: "oldest", revenue: "revenue-desc" },
      { date: "newest", revenue: "revenue-desc" },
      { date: "oldest", revenue: "revenue-asc" },
      { date: "newest", revenue: "revenue-asc" },
    ] as const;
    for (const combo of combos) {
      expect(parseAccountSort(serializeAccountSort(combo))).toEqual(combo);
    }
  });

  it("serializes primary-first with default components omitted", () => {
    expect(serializeAccountSort({ date: "oldest", revenue: "none" })).toBeUndefined();
    expect(serializeAccountSort({ date: "newest", revenue: "none" })).toBe(
      "newest",
    );
    expect(
      serializeAccountSort({ date: "oldest", revenue: "revenue-desc" }),
    ).toBe("revenue-desc");
    expect(
      serializeAccountSort({ date: "newest", revenue: "revenue-asc" }),
    ).toBe("revenue-asc,newest");
  });

  it("parses safely: unknown tokens ignored, any order accepted", () => {
    expect(parseAccountSort(undefined)).toEqual(DEFAULT_ACCOUNT_SORT);
    expect(parseAccountSort("")).toEqual(DEFAULT_ACCOUNT_SORT);
    expect(parseAccountSort("cheapest")).toEqual(DEFAULT_ACCOUNT_SORT);
    expect(parseAccountSort("NEWEST")).toEqual(DEFAULT_ACCOUNT_SORT);
    expect(parseAccountSort("newest,revenue-desc")).toEqual({
      date: "newest",
      revenue: "revenue-desc",
    });
    expect(parseAccountSort("revenue-asc,junk,oldest")).toEqual({
      date: "oldest",
      revenue: "revenue-asc",
    });
    // First token of each kind wins; extras are ignored.
    expect(parseAccountSort("newest,oldest,revenue-asc,revenue-desc")).toEqual({
      date: "newest",
      revenue: "revenue-asc",
    });
    // The old explicit default token still lands on the default.
    expect(parseAccountSort("oldest")).toEqual(DEFAULT_ACCOUNT_SORT);
    expect(serializeAccountSort(parseAccountSort("oldest"))).toBeUndefined();
  });

  it("summarizes compactly for the trigger, revenue first", () => {
    expect(accountSortSummary({ date: "oldest", revenue: "none" })).toBeNull();
    expect(accountSortSummary({ date: "newest", revenue: "none" })).toBe(
      "Newest",
    );
    expect(
      accountSortSummary({ date: "oldest", revenue: "revenue-desc" }),
    ).toBe("Revenue high");
    expect(
      accountSortSummary({ date: "newest", revenue: "revenue-asc" }),
    ).toBe("Revenue low · Newest");
  });
});
