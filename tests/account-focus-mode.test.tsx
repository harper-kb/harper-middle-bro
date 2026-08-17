/**
 * Focus mode: which accounts are open, which rows soften, and whether the
 * toolbar agrees with both.
 *
 * The failure this guards against is divergence — a row that looks open while
 * the set says otherwise, or a stale id from the previous page keeping a fresh
 * result set softened.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountResultsPanel } from "@/app/all-accounts/AccountResultsPanel";
import { AllAccountsList } from "@/app/all-accounts/AllAccountsList";
import {
  isAccountDeemphasized,
  isFocusModeActive,
  NO_EXPANDED_ACCOUNTS,
  pruneExpandedAccounts,
  toggleExpandedAccount,
} from "@/app/all-accounts/use-account-expansion";
import type { BookAccountListItem, BookOrderListItem } from "@/lib/db";

function order(patch: Partial<BookOrderListItem> = {}): BookOrderListItem {
  return {
    id: "order-1",
    harperOrderId: 1,
    label: "Order #1",
    createdAt: "2026-08-14T20:00:00.000Z",
    orderedAt: "2026-08-14T20:00:00.000Z",
    eventAt: "2026-08-14T20:00:00.000Z",
    bindStatus: "pending",
    revenueCents: 40060,
    revenueMicros: 400_600_000,
    policyNumbers: [],
    inconsistency: null,
    source: "broker",
    iqStageTag: null,
    brokerGate: null,
    brokerGateAt: null,
    rich: {
      deals: [],
      paymentType: null,
      pfaQuoteNumber: null,
      initialPaymentAt: null,
      documentCount: 0,
      policyCount: 0,
      totalPremiumCents: null,
      taxesCents: null,
      feesCents: null,
      totalCostCents: null,
      commissionRevenueCents: null,
      harperServiceFeeCents: null,
      taxes: [],
      fees: [],
      producerNote: null,
      producerNoteUpdatedAt: null,
      producerNoteUpdatedByName: null,
      serviceNote: null,
    },
    ...patch,
  };
}

function account(id: string, name: string): BookAccountListItem {
  return {
    id,
    name,
    dba: null,
    state: "CA",
    orderCount: 1,
    orders: [order({ id: `${id}-order` })],
    hasServiceNotes: false,
  };
}

const ROWS = [
  account("co-1", "Abigail Jensen"),
  account("co-2", "Above And Beyond Home Care LLC"),
  account("co-3", "Acer Entertainment Services, LLC"),
];

function list(expanded: string[]) {
  return renderToStaticMarkup(
    <AllAccountsList
      rows={ROWS}
      emptyMessage="No accounts"
      canEditOrders={false}
      bigBrotherBaseUrl=""
      todayDay="2026-08-15"
      expanded={new Set(expanded)}
    />,
  );
}

function panel(initialExpandedIds: string[]) {
  return renderToStaticMarkup(
    <AccountResultsPanel
      rows={ROWS}
      emptyMessage="No accounts"
      canEditOrders={false}
      bigBrotherBaseUrl=""
      todayDay="2026-08-15"
      total={3}
      view={{ id: "all", title: "All Accounts" }}
      filterState={{
        source: "all",
        iqStages: [],
        brokerGates: [],
        carriers: [],
        locationStates: [],
        sort: { date: "oldest", revenue: "none" },
        search: "",
      }}
      pagination={{
        currentPage: 1,
        totalPages: 3,
        currentParams: {},
        basePath: "/all-accounts",
      }}
      initialExpandedIds={initialExpandedIds}
    />,
  );
}

/** Rows in document order, tagged with whether each carries the soft focus. */
function deemphasisPattern(html: string): boolean[] {
  return [...html.matchAll(/class="account-list-row [^"]*"/g)].map((match) =>
    match[0].includes("account-list-row--deemphasized"),
  );
}

describe("expanded-account set", () => {
  it("opens and closes by stable id", () => {
    const one = toggleExpandedAccount(NO_EXPANDED_ACCOUNTS, "co-2");
    expect([...one]).toEqual(["co-2"]);
    expect([...toggleExpandedAccount(one, "co-2")]).toEqual([]);
  });

  it("holds several accounts open at once", () => {
    let set = toggleExpandedAccount(NO_EXPANDED_ACCOUNTS, "co-1");
    set = toggleExpandedAccount(set, "co-3");
    expect(set.has("co-1")).toBe(true);
    expect(set.has("co-3")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("closing one leaves the others open", () => {
    let set = toggleExpandedAccount(NO_EXPANDED_ACCOUNTS, "co-1");
    set = toggleExpandedAccount(set, "co-3");
    set = toggleExpandedAccount(set, "co-1");
    expect([...set]).toEqual(["co-3"]);
    expect(isFocusModeActive(set)).toBe(true);
  });

  it("never mutates the set it was handed", () => {
    const before = toggleExpandedAccount(NO_EXPANDED_ACCOUNTS, "co-1");
    toggleExpandedAccount(before, "co-2");
    expect([...before]).toEqual(["co-1"]);
  });
});

describe("stale ids across result-set changes", () => {
  it("drops ids the new page does not contain", () => {
    const carried = new Set(["co-1", "co-9"]);
    const pruned = pruneExpandedAccounts(carried, new Set(["co-1", "co-2"]));
    expect([...pruned]).toEqual(["co-1"]);
  });

  it("leaves no focus mode when nothing survives the change", () => {
    const pruned = pruneExpandedAccounts(
      new Set(["co-9"]),
      new Set(["co-1", "co-2"]),
    );
    expect(isFocusModeActive(pruned)).toBe(false);
  });

  it("returns the same set when every id still exists, so no re-render", () => {
    const carried = new Set(["co-1"]);
    expect(pruneExpandedAccounts(carried, new Set(["co-1", "co-2"]))).toBe(
      carried,
    );
    expect(pruneExpandedAccounts(NO_EXPANDED_ACCOUNTS, new Set())).toBe(
      NO_EXPANDED_ACCOUNTS,
    );
  });
});

describe("focus-mode derivation", () => {
  it("softens nothing while every account is closed", () => {
    expect(isFocusModeActive(NO_EXPANDED_ACCOUNTS)).toBe(false);
    expect(isAccountDeemphasized(NO_EXPANDED_ACCOUNTS, "co-1")).toBe(false);
  });

  it("softens only the accounts that are not open", () => {
    const set = new Set(["co-2"]);
    expect(isAccountDeemphasized(set, "co-2")).toBe(false);
    expect(isAccountDeemphasized(set, "co-1")).toBe(true);
  });

  it("keeps every open account sharp when several are open", () => {
    const set = new Set(["co-1", "co-3"]);
    expect(isAccountDeemphasized(set, "co-1")).toBe(false);
    expect(isAccountDeemphasized(set, "co-3")).toBe(false);
    expect(isAccountDeemphasized(set, "co-2")).toBe(true);
  });
});

describe("rendered rows", () => {
  it("leaves every row sharp when nothing is open", () => {
    expect(deemphasisPattern(list([]))).toEqual([false, false, false]);
  });

  it("softens the siblings of the open account", () => {
    expect(deemphasisPattern(list(["co-2"]))).toEqual([true, false, true]);
  });

  it("keeps both open accounts sharp", () => {
    expect(deemphasisPattern(list(["co-1", "co-3"]))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("reports each toggle's state accurately", () => {
    const html = list(["co-2"]);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
  });

  it("leaves softened rows enabled and in the accessibility tree", () => {
    const html = list(["co-2"]);
    // Softening is emphasis only: no row is hidden, and every expand toggle
    // stays operable.
    expect(html).not.toMatch(/class="account-list-row [^"]*"[^>]*aria-hidden/);
    expect(html).not.toMatch(/class="account-expand-button[^"]*"[^>]*disabled/);
    expect(html).toContain("Abigail Jensen");
    expect(html).toContain("Acer Entertainment Services, LLC");
    // Their names stay real links, not inert text.
    expect(html).toContain('href="/accounts/co-1"');
    expect(html).toContain('href="/accounts/co-3"');
  });
});

describe("Close all accounts", () => {
  it("stays hidden while nothing is open", () => {
    const html = panel([]);
    expect(html).not.toContain("close-all-button");
    expect(html).not.toContain("Close all accounts");
    expect(html).not.toContain("account-results--focus-mode");
  });

  it("appears as soon as one account is open", () => {
    const html = panel(["co-2"]);
    expect(html).toContain("close-all-button");
    expect(html).toContain("Close all accounts");
    expect(html).toContain("account-results--focus-mode");
  });

  it("names itself with a singular count for one open account", () => {
    expect(panel(["co-2"])).toContain(
      'aria-label="Close all accounts, 1 account open"',
    );
  });

  it("shows and pluralises the count past one open account", () => {
    const html = panel(["co-1", "co-3"]);
    expect(html).toContain('aria-label="Close all accounts, 2 accounts open"');
    expect(html).toContain("(2)");
  });

  it("sits in the results header beside pagination, not over the rows", () => {
    const html = panel(["co-2"]);
    const header = html.slice(
      html.indexOf("account-results-header"),
      html.indexOf("account-list-row"),
    );
    expect(header).toContain("close-all-button");
    expect(header).toContain("Top account results pagination");
    expect(header).toContain('aria-label="Page 1 of 3"');
  });

  it("renders the account total from data, not a pre-built slot", () => {
    // Elements built in the server page and handed down as children tripped
    // React's list key check; the header owns this markup now.
    const html = panel([]);
    expect(html).toContain("All Accounts");
    expect(html).toContain(
      'aria-label="All Accounts, 3 matching accounts"',
    );
    expect(html).toContain(">3<");
  });

  it("ignores an initial id that is not on the page", () => {
    const html = panel(["co-404"]);
    expect(html).not.toContain("close-all-button");
    expect(deemphasisPattern(html)).toEqual([false, false, false]);
  });

  it("carries a polite live region for the collapse announcement", () => {
    expect(panel(["co-2"])).toContain('aria-live="polite"');
  });
});

describe("pinned results header", () => {
  const html = panel([]);

  it("clips rather than hides, so the header can stick", () => {
    // `overflow: hidden` would make the panel its own scrollport and the
    // sticky header would scroll away with it; `clip` still rounds the corners.
    expect(html).toContain("overflow-clip");
    expect(html).not.toContain("overflow-hidden");
  });

  it("puts the crossing probe directly above the header", () => {
    const sentinel = html.indexOf("account-results-sentinel");
    const header = html.indexOf("account-results-header");
    const firstRow = html.indexOf("account-list-row");
    expect(sentinel).toBeGreaterThan(-1);
    expect(sentinel).toBeLessThan(header);
    expect(header).toBeLessThan(firstRow);
  });

  it("keeps the probe out of the accessibility tree", () => {
    expect(html).toMatch(
      /class="account-results-sentinel"[^>]*aria-hidden="true"/,
    );
  });

  it("starts unpinned before the observer has anything to report", () => {
    expect(html).not.toContain("account-results-header--pinned");
  });

  it("leaves the filters and search outside the pinned region", () => {
    // Only the results header may stick; everything above it is page content.
    const header = html.indexOf("account-results-header");
    expect(html.slice(0, header)).not.toContain("close-all-button");
  });
});

describe("header surface", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const ruleBody = (selector: string) =>
    css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  it("paints the bar on its own surface, never the row surface", () => {
    // The regression this guards: pinning resolved to var(--surface-raised),
    // which is exactly what the rows sit on, so the bar vanished into the list.
    for (const selector of [
      "\\.account-results-header",
      "\\.account-results-header--pinned",
    ]) {
      const body = ruleBody(selector);
      expect(body).toMatch(/background:\s*var\(--account-header-surface/);
      expect(body).not.toMatch(/background:\s*var\(--surface-raised\)/);
    }
  });

  it("defines both surfaces for light and dark", () => {
    expect(ruleBody("\\.account-results")).toContain(
      "--account-header-surface:",
    );
    expect(ruleBody("\\.account-results")).toContain(
      "--account-header-surface-pinned:",
    );
    expect(css).toMatch(
      /\[data-theme="dark"\]\s*\.account-results\s*\{[^}]*--account-header-surface:/,
    );
  });

  it("keeps the pinned bar opaque so rows cannot tint it", () => {
    expect(ruleBody("\\.account-results-header--pinned")).not.toContain(
      "backdrop-filter",
    );
  });
});
