/**
 * Accounts filter toolbar: markup contract and URL contract.
 *
 * The URL half matters most — the toolbar replaced two separate controls, and
 * the page's normalizing redirect only tolerates one exact spelling of
 * `source`/`range`, so any drift here loops the router.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

const { AccountFilterToolbar, accountFilterHref } = await import(
  "@/app/all-accounts/AccountFilterToolbar"
);

function render(props: Parameters<typeof AccountFilterToolbar>[0]) {
  return renderToStaticMarkup(<AccountFilterToolbar {...props} />);
}

const pendingDefaults = {
  basePath: "/pending-orders",
  currentParams: { range: "all-time" },
  source: "all",
  range: "all-time",
  rangeWindowLabel: "All available order history",
} as const;

describe("accountFilterHref", () => {
  it("drops the default source and resets pagination", () => {
    expect(
      accountFilterHref({
        basePath: "/pending-orders",
        currentParams: { source: "iq", range: "this-week", page: "4" },
        source: "all",
        range: "this-week",
      }),
    ).toBe("/pending-orders?range=this-week");
  });

  it("always writes range on the views that have a reporting window", () => {
    expect(
      accountFilterHref({
        basePath: "/bound-orders",
        currentParams: {},
        source: "broker",
        range: "all-time",
      }),
    ).toBe("/bound-orders?source=broker&range=all-time");
  });

  it("omits range entirely for the views without one", () => {
    expect(
      accountFilterHref({
        basePath: "/all-accounts",
        currentParams: { range: "this-week" },
        source: "iq",
        range: undefined,
      }),
    ).toBe("/all-accounts?source=iq");
  });

  it("preserves unrelated params such as search", () => {
    expect(
      accountFilterHref({
        basePath: "/lost-orders",
        currentParams: { q: "acme co" },
        source: "broker",
        range: undefined,
      }),
    ).toBe("/lost-orders?q=acme+co&source=broker");
  });

  it("returns a bare path once every filter is cleared", () => {
    expect(
      accountFilterHref({
        basePath: "/all-accounts",
        currentParams: { source: "iq", page: "2" },
        source: "all",
        range: undefined,
      }),
    ).toBe("/all-accounts");
  });

  it("writes iqStage only for IQ source and clears it otherwise", () => {
    expect(
      accountFilterHref({
        basePath: "/pending-orders",
        currentParams: { range: "all-time" },
        source: "iq",
        range: "all-time",
        iqStages: ["bind_requested", "step:none"],
      }),
    ).toBe(
      "/pending-orders?source=iq&range=all-time&iqStage=bind_requested%2Cstep%3Anone",
    );
    expect(
      accountFilterHref({
        basePath: "/pending-orders",
        currentParams: {
          source: "iq",
          range: "all-time",
          iqStage: "bind_requested",
        },
        source: "broker",
        range: "all-time",
        iqStages: ["bind_requested"],
      }),
    ).toBe("/pending-orders?source=broker&range=all-time");
  });
});

describe("AccountFilterToolbar markup", () => {
  it("puts each group label before its control", () => {
    const html = render(pendingDefaults);
    for (const label of ["Account Source", "Date Range"]) {
      expect(html.indexOf(label)).toBeGreaterThan(-1);
      expect(html.indexOf(label)).toBeLessThan(
        html.indexOf('role="radiogroup"', html.indexOf(label) - 200),
      );
    }
    expect(html.indexOf("Account Source")).toBeLessThan(
      html.indexOf("Date Range"),
    );
  });

  it("uses radiogroup semantics with a labelled group and roving tab stop", () => {
    const html = render(pendingDefaults);
    expect(html.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(html.match(/role="radio"/g)).toHaveLength(7);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html.match(/tabindex="0"/g)).toHaveLength(2);
    const labelIds = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(labelIds.length).toBeGreaterThan(0);
    for (const id of labelIds) expect(html).toContain(`id="${id}"`);
  });

  it("marks the selected option without relying on color", () => {
    const html = render({ ...pendingDefaults, source: "iq" });
    // One reserved checkmark slot per option, so selection never reflows.
    expect(html.match(/seg-check/g)).toHaveLength(7);
    const checked = html
      .split("<button")
      .filter((segment) => segment.includes('aria-checked="true"'));
    expect(checked).toHaveLength(2);
    for (const segment of checked) expect(segment).toContain("seg-check");
    expect(checked[0]).toContain("IQ");
    expect(checked[1]).toContain("All Time");
  });

  it("hides Clear filters while the defaults are selected", () => {
    expect(render(pendingDefaults)).not.toContain("Clear filters");
  });

  it("shows Clear filters for a non-default source or range", () => {
    expect(render({ ...pendingDefaults, source: "broker" })).toContain(
      "Clear filters",
    );
    expect(
      render({
        ...pendingDefaults,
        range: "last-week",
        currentParams: { range: "last-week" },
      }),
    ).toContain("Clear filters");
  });

  it("keeps All Accounts and Lost Orders free of a date filter", () => {
    const html = render({
      basePath: "/all-accounts",
      currentParams: {},
      source: "all",
    });
    expect(html).toContain("Account Source");
    expect(html).not.toContain("Date Range");
    expect(html).not.toContain("<select");
    expect(html.match(/role="radiogroup"/g)).toHaveLength(1);
  });

  it("shows IQ Stage only when requested for the IQ source", () => {
    const without = render({ ...pendingDefaults, source: "iq" });
    expect(without).not.toContain("IQ Stage");
    const withStage = render({
      ...pendingDefaults,
      source: "iq",
      showIqStage: true,
      iqStages: [],
    });
    expect(withStage).toContain("IQ Stage");
    expect(withStage).toContain("All stages");
    expect(withStage.indexOf("Account Source")).toBeLessThan(
      withStage.indexOf("IQ Stage"),
    );
    expect(withStage.indexOf("IQ Stage")).toBeLessThan(
      withStage.indexOf("Date Range"),
    );
  });

  it("swaps the date segments for a dropdown at narrow widths", () => {
    const html = render(pendingDefaults);
    expect(html).toContain("hidden sm:inline-flex");
    expect(html).toContain("filter-select sm:hidden");
    // The source control stays segmented on every width.
    expect(html).toContain('class="seg inline-flex"');
  });

  it("keeps the reporting window visible only when a window applies", () => {
    expect(render(pendingDefaults)).not.toContain(
      "All available order history",
    );
    expect(
      render({
        ...pendingDefaults,
        range: "this-week",
        currentParams: { range: "this-week" },
        rangeWindowLabel: "Aug 10 – Aug 16, 2026 PT",
      }),
    ).toContain("Aug 10 – Aug 16, 2026 PT");
  });
});
