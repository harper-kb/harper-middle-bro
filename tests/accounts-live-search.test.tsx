/**
 * The Accounts search filters the list underneath it, live, and nothing else:
 * no preview surface, and no filter left behind. The URL it writes is the
 * contract with the server query, so these cases pin the two ways it can go
 * wrong — dropping an active filter, or keeping a page number that belongs to
 * the previous result set.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecordsTestProvider } from "./records-filter-test-utils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {} }),
}));

const { AccountSearchField, accountsHref } = await import(
  "@/app/all-accounts/AccountSearchField"
);

const GLOBALS = readFileSync("src/app/globals.css", "utf8");

describe("accountsHref", () => {
  it("keeps every active filter", () => {
    expect(
      accountsHref(
        "/pending-orders",
        "range=this-week&source=iq&iqStage=bind_requested",
        "acme",
      ),
    ).toBe(
      "/pending-orders?source=iq&iqStage=bind_requested&range=this-week&q=acme",
    );
  });

  it("drops the query rather than writing an empty one", () => {
    expect(accountsHref("/all-accounts", "source=broker", "")).toBe(
      "/all-accounts?source=broker",
    );
    expect(accountsHref("/all-accounts", "", "")).toBe("/all-accounts");
  });
});

describe("AccountSearchField", () => {
  const markup = renderToStaticMarkup(
    <RecordsTestProvider
      params={{
        q: "acme",
        page: "4",
        range: "this-week",
        source: "iq",
      }}
    >
      <AccountSearchField committedQuery="acme" resultCount={12} />
    </RecordsTestProvider>,
  );

  it("shows the committed query in the field", () => {
    expect(markup).toContain('value="acme"');
  });

  it("carries the active filters, but never the stale page", () => {
    expect(markup).toContain('name="range" value="this-week"');
    expect(markup).toContain('name="source" value="iq"');
    expect(markup).not.toContain('name="page"');
  });

  it("is a field, not a search surface", () => {
    // No submit button and no results list: the list below the field is the
    // result, and typing is what applies it.
    expect(markup).not.toContain('type="submit"');
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
  });

  it("announces the match count for anyone not watching rows reflow", () => {
    expect(markup).toContain("12 accounts match acme");
  });

  it("suppresses the desk input ring, since the shell carries the focus state", () => {
    expect(markup).toContain("account-search-field");
    expect(GLOBALS).toContain(".account-search-field:focus-visible");
    expect(GLOBALS).toMatch(
      /:not\(\.account-search-field\)(:not\([^)]+\))*:focus-visible/,
    );
  });
});
