// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompanySearchResults,
  type CompanySearchVariant,
} from "@/components/company-search/CompanySearchResults";
import {
  calculateSearchPreviewGeometry,
  inlineSearchPreviewOpen,
} from "@/components/CompanySearch";
import { openCompanySearchResultInNewTab } from "@/components/company-search/use-company-search";
import type {
  CompanySearchController,
  CompanySearchView,
} from "@/components/company-search/use-company-search";
import type { CompanySearchResult } from "@/lib/db/queries/company-search";

/**
 * The inline bar dropdown and the centered palette are two presentations of
 * one search. These assert the part that must never diverge: given the same
 * controller they render the same accounts, previews and destinations, and
 * only their chrome differs.
 */

const RESULTS: CompanySearchResult[] = [
  {
    id: "co-13204",
    name: "Azure International, LLC",
    dba: null,
    state: "NJ",
    orderCount: 2,
    producerNames: ["Corey Harper", "Garrett Gargan"],
    source: "broker",
    carrierNames: ["Kinsale Ins Co"],
    statuses: ["bound", "pending"],
  },
  {
    id: "co-900319",
    name: "Casa Azul Group LLC",
    dba: "Bistro Casa Azul",
    state: "NY",
    orderCount: 1,
    producerNames: [],
    source: null,
    carrierNames: ["Evanston Insurance Company", "NEXT Insurance"],
    statuses: ["lost"],
  },
];

function controllerFor(view: CompanySearchView): CompanySearchController {
  const results = view.status === "ready" ? view.results : [];
  return {
    query: "azu",
    setQuery: () => {},
    clear: () => {},
    view,
    results,
    activeIndex: results.length > 0 ? 0 : -1,
    highlight: () => {},
    listboxId: "search-listbox",
    optionId: (index) => `search-option-${index}`,
    activeDescendant: results.length > 0 ? "search-option-0" : undefined,
    handleKeyDown: () => {},
    handleResultClick: () => {},
    lastSuccessfulSyncAt: "2026-08-16T23:05:00.000Z",
  };
}

const readyView: CompanySearchView = {
  status: "ready",
  query: "azu",
  results: RESULTS,
  lastSuccessfulSyncAt: "2026-08-16T23:05:00.000Z",
};

afterEach(cleanup);

function render(view: CompanySearchView, variant: CompanySearchVariant) {
  return renderToStaticMarkup(
    <CompanySearchResults controller={controllerFor(view)} variant={variant} />,
  );
}

describe("company search presentations", () => {
  const inline = render(readyView, "inline");
  const modal = render(readyView, "modal");

  it("renders the same accounts in both presentations", () => {
    for (const markup of [inline, modal]) {
      expect(markup).toContain("Azure International, LLC");
      expect(markup).toContain("Casa Azul Group LLC");
      expect(markup).not.toContain("DBA Bistro Casa Azul");
    }
  });

  it("opens the same stable account ids in secure new tabs from both", () => {
    for (const markup of [inline, modal]) {
      expect(markup).toContain('href="/accounts/co-13204"');
      expect(markup).toContain('href="/accounts/co-900319"');
      expect(markup).toContain('target="_blank"');
      expect(markup).toContain('rel="noopener noreferrer"');
      expect(markup).toContain(
        'aria-label="Open Azure International, LLC in a new tab"',
      );
    }
  });

  it("opens keyboard results in a new tab and dismisses search", () => {
    const child = { opener: {} } as unknown as Window;
    const openWindow = vi.fn(() => child);
    const onDismiss = vi.fn();

    openCompanySearchResultInNewTab(
      "co-13204",
      onDismiss,
      openWindow,
    );

    expect(openWindow).toHaveBeenCalledWith(
      "/accounts/co-13204",
      "_blank",
      "noopener,noreferrer",
    );
    expect(child.opener).toBeNull();
    expect(onDismiss).toHaveBeenCalledWith("navigate");
  });

  it("closes the current search surface after a pointer result click", () => {
    const controller = controllerFor(readyView);
    controller.handleResultClick = vi.fn();
    renderDom(
      <CompanySearchResults controller={controller} variant="modal" />,
    );

    fireEvent.click(
      screen.getByRole("link", {
        name: "Open Azure International, LLC in a new tab",
      }),
    );
    expect(controller.handleResultClick).toHaveBeenCalledOnce();
  });

  it("summarizes producer, channel, carrier and status identically", () => {
    for (const markup of [inline, modal]) {
      // Several producers and carriers are counted, never silently reduced to
      // one; a single carrier is named outright.
      expect(markup).toContain("2 producers");
      expect(markup).toContain("Kinsale Ins Co");
      expect(markup).toContain("2 carriers");
      expect(markup).toContain("Broker");
      // Missing values are omitted rather than leaving empty divider slots.
      expect(markup).not.toContain("Producer unavailable");
      expect(markup).not.toContain("Source unavailable");
    }
  });

  it("shows every lifecycle state on a multi-order account", () => {
    for (const markup of [inline, modal]) {
      expect(markup).toContain(">Bound<");
      expect(markup).toContain(">Pending<");
      expect(markup).toContain(">Lost<");
      expect(markup).toMatch(
        /data-search-company-heading[\s\S]*?data-search-statuses/,
      );
      expect(markup).toContain("bg-orange-100/75");
    }
  });

  it("keeps combobox listbox and option semantics in both", () => {
    for (const markup of [inline, modal]) {
      expect(markup).toContain('role="listbox"');
      expect(markup).toContain('role="option"');
      expect(markup).toContain('aria-selected="true"');
      expect(markup).toContain('id="search-option-0"');
    }
  });

  it("renders only decorative, theme-aware dividers between visible values", () => {
    for (const markup of [inline, modal]) {
      // Result one: source | producers | carrier = 2.
      // Result two only has carrier metadata, so it needs no separator.
      expect(markup.match(/data-search-metadata-divider="true"/g)).toHaveLength(
        2,
      );
      expect(
        markup.match(
          /aria-hidden="true" data-search-metadata-divider="true"/g,
        ),
      ).toHaveLength(2);
      expect(markup).not.toContain("|");
    }
  });

  it("keeps full carrier values available to native tooltips", () => {
    for (const markup of [inline, modal]) {
      expect(markup).toContain(
        'title="Carriers: Evanston Insurance Company, NEXT Insurance"',
      );
    }
  });

  it("spells out field labels only in the roomier palette", () => {
    expect(modal).toContain("Producer");
    expect(modal).toContain("Carrier");
    expect(modal).toContain("Channel");
    expect(inline).not.toContain(">Channel<");
  });

  it("shares the loading, empty and error states", () => {
    const states: [CompanySearchView, string][] = [
      [{ status: "idle" }, "Type at least 2 characters."],
      [{ status: "loading" }, "Searching…"],
      [{ status: "error", query: "azu" }, "temporarily unavailable"],
      [
        { status: "ready", query: "azu", results: [], lastSuccessfulSyncAt: null },
        "No companies match",
      ],
    ];
    for (const [view, expected] of states) {
      expect(render(view, "inline")).toContain(expected);
      expect(render(view, "modal")).toContain(expected);
    }
  });

  it("never renders a customer email or phone number", () => {
    for (const markup of [inline, modal]) {
      expect(markup).not.toContain("@");
    }
  });
});

describe("inline search preview geometry", () => {
  it("uses the measured desktop sidebar and header edges", () => {
    expect(
      calculateSearchPreviewGeometry({
        shell: { left: 280, right: 552, bottom: 42, width: 272 },
        sidebar: { left: 0, right: 264, bottom: 900, width: 264 },
        header: { left: 264, right: 1440, bottom: 42, width: 1176 },
        viewportWidth: 1440,
      }),
    ).toEqual({
      dropdownLeft: 280,
      dropdownTop: 48,
      dropdownWidth: 384,
      contentLeft: 264,
      contentTop: 42,
    });
  });

  it("reserves no sidebar strip on mobile and fits safe viewport margins", () => {
    expect(
      calculateSearchPreviewGeometry({
        shell: { left: 8, right: 224, bottom: 92, width: 216 },
        sidebar: null,
        header: { left: 0, right: 375, bottom: 86, width: 375 },
        viewportWidth: 375,
      }),
    ).toEqual({
      dropdownLeft: 8,
      dropdownTop: 98,
      dropdownWidth: 359,
      contentLeft: 0,
      contentTop: 86,
    });
  });

  it("tracks the measured collapsed-sidebar edge instead of desktop width", () => {
    const geometry = calculateSearchPreviewGeometry({
      shell: { left: 88, right: 360, bottom: 42, width: 272 },
      sidebar: { left: 0, right: 72, bottom: 900, width: 72 },
      header: { left: 72, right: 1200, bottom: 42, width: 1128 },
      viewportWidth: 1200,
    });

    expect(geometry.contentLeft).toBe(72);
  });

  it("uses one visibility decision for loading, results, empty and errors", () => {
    for (const viewStatus of ["loading", "ready", "error"] as const) {
      expect(
        inlineSearchPreviewOpen({
          expanded: true,
          hasGeometry: true,
          viewStatus,
        }),
      ).toBe(true);
    }
    expect(
      inlineSearchPreviewOpen({
        expanded: true,
        hasGeometry: true,
        viewStatus: "idle",
      }),
    ).toBe(false);
    expect(
      inlineSearchPreviewOpen({
        expanded: false,
        hasGeometry: true,
        viewStatus: "ready",
      }),
    ).toBe(false);
  });

  it("defines one restrained backdrop with reduced-motion and transparency fallbacks", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(css).toContain(".company-search-page-backdrop");
    expect(css).toContain("backdrop-filter: blur(3px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
  });
});
