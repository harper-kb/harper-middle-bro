// @vitest-environment jsdom

import fs from "node:fs";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { RecordsContextBar } from "@/app/all-accounts/RecordsContextBar";
import type { RecordsFilterSummaryState } from "@/app/all-accounts/records-filter-summary";

const DEFAULT_FILTERS: RecordsFilterSummaryState = {
  source: "all",
  iqStages: [],
  brokerGates: [],
  carriers: [],
  locationStates: [],
  sort: { date: "oldest", revenue: "none" },
  search: "",
};

const DEFAULT_PROPS = {
  pinned: false,
  viewMode: "all" as const,
  viewTitle: "All Accounts",
  total: 15,
  filterState: DEFAULT_FILTERS,
  openCount: 0,
  onCloseAll: () => {},
  pagination: {
    currentPage: 1,
    totalPages: 3,
    currentParams: {},
    basePath: "/all-accounts",
  },
};

afterEach(cleanup);

describe("Records context identity", () => {
  it.each([
    ["all", "All Accounts"],
    ["pending", "Pending Orders"],
    ["bound", "Bound Orders"],
    ["lost", "Lost Orders"],
  ] as const)("renders the %s view label and matching count", (viewMode, viewTitle) => {
    render(
      <RecordsContextBar
        {...DEFAULT_PROPS}
        viewMode={viewMode}
        viewTitle={viewTitle}
      />,
    );
    expect(screen.getByText(viewTitle)).toBeTruthy();
    expect(
      screen.getByRole("group", {
        name: `${viewTitle}, 15 matching accounts`,
      }),
    ).toBeTruthy();
    expect(
      document.querySelector(`.records-view-indicator--${viewMode}`),
    ).toBeTruthy();
  });

  it("uses singular account grammar", () => {
    render(<RecordsContextBar {...DEFAULT_PROPS} total={1} />);
    expect(
      screen.getByRole("group", {
        name: "All Accounts, 1 matching account",
      }),
    ).toBeTruthy();
  });

  it("exposes one meaningful controls region", () => {
    render(<RecordsContextBar {...DEFAULT_PROPS} />);
    expect(
      screen.getByRole("region", {
        name: "Records controls and active filters",
      }),
    ).toBeTruthy();
  });
});

describe("active-filter chips and overflow", () => {
  it("renders no noisy default chips", () => {
    render(<RecordsContextBar {...DEFAULT_PROPS} />);
    expect(screen.queryByLabelText("Active filters")).toBeNull();
    expect(document.querySelector(".records-filter-overflow")).toBeNull();
  });

  function manyFilters(): RecordsFilterSummaryState {
    return {
      source: "iq",
      iqStages: ["bind_requested", "awaiting_binder"],
      range: "this-week",
      carriers: [
        { key: "hiscox", label: "Hiscox" },
        { key: "next", label: "NEXT" },
      ],
      locationStates: ["CA", "NY", "TX"],
      sort: { date: "newest", revenue: "revenue-desc" },
      search: "Loyalty",
      brokerGates: [],
    };
  }

  it("keeps the five highest-priority chips and summarizes the remainder", () => {
    render(
      <RecordsContextBar {...DEFAULT_PROPS} filterState={manyFilters()} />,
    );
    const chips = document.querySelectorAll(".records-filter-chip");
    expect(chips).toHaveLength(5);
    expect([...chips].map((chip) => chip.getAttribute("data-filter-kind"))).toEqual([
      "source",
      "pipeline",
      "carrier",
      "location",
      "date",
    ]);
    expect(
      document.querySelector('[data-overflow-limit="5"]')?.textContent,
    ).toContain("+2 filters");
  });

  it("keeps duplicate filter context hidden until the bar is pinned", () => {
    const view = render(
      <RecordsContextBar {...DEFAULT_PROPS} filterState={manyFilters()} />,
    );
    let summary = document.querySelector<HTMLElement>(
      ".records-filter-summary",
    )!;
    expect(summary.getAttribute("aria-hidden")).toBe("true");
    expect(summary.hasAttribute("inert")).toBe(true);

    view.rerender(
      <RecordsContextBar
        {...DEFAULT_PROPS}
        pinned
        filterState={manyFilters()}
      />,
    );
    summary = document.querySelector<HTMLElement>(".records-filter-summary")!;
    expect(summary.hasAttribute("aria-hidden")).toBe(false);
    expect(summary.hasAttribute("inert")).toBe(false);
  });

  it("discloses the complete list by mouse and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <RecordsContextBar
        {...DEFAULT_PROPS}
        pinned
        filterState={manyFilters()}
      />,
    );
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-overflow-limit="5"]',
    )!;
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Active filters" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(7);
    expect(dialog.textContent).toContain("Account search: “Loyalty”");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens by keyboard and by a touch-generated click", async () => {
    const user = userEvent.setup();
    render(
      <RecordsContextBar
        {...DEFAULT_PROPS}
        pinned
        filterState={manyFilters()}
      />,
    );
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-overflow-limit="5"]',
    )!;

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Active filters" })).toBeTruthy();
    await user.keyboard("{Escape}");

    fireEvent.click(trigger, { pointerType: "touch" });
    expect(screen.getByRole("dialog", { name: "Active filters" })).toBeTruthy();
  });

  it("updates from new route/URL state without retaining stale labels", () => {
    const view = render(
      <RecordsContextBar
        {...DEFAULT_PROPS}
        filterState={{ ...DEFAULT_FILTERS, source: "iq" }}
      />,
    );
    expect(screen.getByText("IQ")).toBeTruthy();

    view.rerender(
      <RecordsContextBar
        {...DEFAULT_PROPS}
        filterState={{
          ...DEFAULT_FILTERS,
          source: "broker",
          brokerGates: ["G4"],
          search: "Acme",
        }}
      />,
    );
    expect(screen.queryByText("IQ")).toBeNull();
    expect(screen.getByText("Broker")).toBeTruthy();
    expect(screen.getByText("G4")).toBeTruthy();
    expect(screen.getByText("Search: “Acme”")).toBeTruthy();
  });
});

describe("Records context actions", () => {
  function CloseHarness() {
    const [openCount, setOpenCount] = useState(2);
    return (
      <RecordsContextBar
        {...DEFAULT_PROPS}
        openCount={openCount}
        onCloseAll={() => setOpenCount(0)}
      />
    );
  }

  it("adds and removes Close all without replacing the outer bar", async () => {
    const user = userEvent.setup();
    render(<CloseHarness />);
    const header = screen.getByRole("region", {
      name: "Records controls and active filters",
    });
    await user.click(
      screen.getByRole("button", {
        name: "Close all accounts, 2 accounts open",
      }),
    );
    expect(
      screen.queryByRole("button", { name: /Close all accounts/ }),
    ).toBeNull();
    expect(
      screen.getByRole("region", {
        name: "Records controls and active filters",
      }),
    ).toBe(header);
  });

  it("keeps pagination synchronized and exposes disabled states", () => {
    render(<RecordsContextBar {...DEFAULT_PROPS} />);
    const pagination = screen.getByRole("navigation", {
      name: "Top account results pagination",
    });
    expect(
      pagination.querySelector('[aria-disabled="true"]')?.textContent,
    ).toContain("Previous");
    expect(
      within(pagination).getByRole("link", { name: "Go to page 2" }),
    ).toBeTruthy();
    expect(
      within(pagination).getByLabelText("Page 1 of 3"),
    ).toBeTruthy();
  });

  it("changes only pinned styling, never component structure", () => {
    const view = render(<RecordsContextBar {...DEFAULT_PROPS} />);
    const header = screen.getByRole("region", {
      name: "Records controls and active filters",
    });
    view.rerender(<RecordsContextBar {...DEFAULT_PROPS} pinned />);
    expect(header.getAttribute("data-pinned")).toBe("true");
    expect(header.className).toContain("account-results-header--pinned");
  });
});

describe("Records context CSS safeguards", () => {
  const css = fs.readFileSync("src/app/globals.css", "utf8");

  it("uses the shared top-nav token with CSS sticky and no negative offset fix", () => {
    const headerRule =
      css.match(/\.account-results-header\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(headerRule).toContain("position: sticky");
    expect(headerRule).toContain(
      "--top-nav-bottom",
    );
    expect(headerRule).toContain(
      "calc(var(--top-nav-offset) + var(--top-nav-height))",
    );
    expect(headerRule).not.toMatch(/margin-top:\s*-/);
    expect(headerRule).not.toMatch(/translateY\(-/);
  });

  it("includes responsive safe-area height and an explicit layer order", () => {
    expect(css).toMatch(
      /\.desk-mobile-topbar\s*\{[\s\S]*?padding-top:\s*env\(safe-area-inset-top\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 1023px\)[\s\S]*?--top-nav-height:\s*calc\([\s\S]*?var\(--desk-mobile-topbar-h\)[\s\S]*?env\(safe-area-inset-top\)/,
    );
    expect(css).toContain("--desk-mobile-topbar-h: 6.4rem");
    expect(css).toContain("--z-records-context: 45");
    expect(css).toContain("--z-desk-top-nav: 46");
  });

  it("reserves stable bar heights and honors reduced motion", () => {
    expect(css).toMatch(
      /\.records-context-layout\s*\{[\s\S]*?min-height:\s*3\.25rem/,
    );
    expect(css).toMatch(
      /@container records-context \(max-width: 54rem\)[\s\S]*?min-height:\s*5\.35rem/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.records-filter-summary[\s\S]*?transition:\s*none/,
    );
    const pinnedRule =
      css.match(/\.account-results-header--pinned\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(pinnedRule).not.toMatch(/\b(?:height|width|padding|margin)\s*:/);
  });

  it("defines responsive overflow variants and intentional dark surfaces", () => {
    expect(css).toContain(".records-filter-overflow--medium");
    expect(css).toContain(".records-filter-overflow--narrow");
    expect(css).toMatch(
      /:root\[data-theme="dark"\]\s*\.account-results\s*\{[\s\S]*?--account-header-surface:/,
    );
  });
});
