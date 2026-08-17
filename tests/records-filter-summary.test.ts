import { describe, expect, it } from "vitest";
import {
  buildRecordsFilterSummary,
  truncateRecordsFilterText,
  type RecordsFilterSummaryState,
} from "@/app/all-accounts/records-filter-summary";

const DEFAULT_STATE: RecordsFilterSummaryState = {
  source: "all",
  iqStages: [],
  brokerGates: [],
  carriers: [],
  locationStates: [],
  sort: { date: "oldest", revenue: "none" },
  search: "",
};

function summary(patch: Partial<RecordsFilterSummaryState> = {}) {
  return buildRecordsFilterSummary({ ...DEFAULT_STATE, ...patch });
}

describe("Records active-filter summary model", () => {
  it("omits every inactive/default condition", () => {
    expect(summary()).toEqual([]);
    expect(summary({ range: "all-time" })).toEqual([]);
  });

  it.each([
    ["iq", "IQ", "iq"],
    ["broker", "Broker", "broker"],
  ] as const)("summarizes the %s source with its identity tone", (source, label, tone) => {
    expect(summary({ source })).toEqual([
      expect.objectContaining({
        id: "source",
        label,
        tone,
        accessibleLabel: `Account source: ${label}`,
      }),
    ]);
  });

  it("uses one IQ Stage label directly and counts several", () => {
    expect(
      summary({ source: "iq", iqStages: ["bind_requested"] })[1],
    ).toEqual(
      expect.objectContaining({
        id: "pipeline",
        label: "Bind requested",
        tone: "iq",
      }),
    );
    expect(
      summary({
        source: "iq",
        iqStages: ["bind_requested", "awaiting_binder"],
      })[1],
    ).toEqual(
      expect.objectContaining({
        label: "2 IQ stages",
        accessibleLabel: "2 IQ stages selected",
      }),
    );
  });

  it("uses one Broker Gate code directly and counts several", () => {
    expect(summary({ source: "broker", brokerGates: ["G3"] })[1]).toEqual(
      expect.objectContaining({
        id: "pipeline",
        label: "G3",
        tone: "broker",
      }),
    );
    expect(
      summary({ source: "broker", brokerGates: ["G3", "G4"] })[1],
    ).toEqual(
      expect.objectContaining({
        label: "2 Gates",
        accessibleLabel: "2 Broker Gates selected",
      }),
    );
  });

  it("does not surface a stale source-scoped selection", () => {
    expect(summary({ source: "all", iqStages: ["bind_requested"] })).toEqual([]);
    expect(summary({ source: "iq", brokerGates: ["G4"] }).map((item) => item.id))
      .toEqual(["source"]);
  });

  it("uses the approved active date-range label", () => {
    expect(summary({ range: "this-week" })).toEqual([
      expect.objectContaining({
        id: "date",
        label: "This Week",
        detail: "Date range: This Week",
      }),
    ]);
  });

  it("shows one safely truncated carrier name and counts several", () => {
    const longName =
      "Lloyds c/o Maximum Insurance Brokerage International Holdings";
    const one = summary({
      carriers: [{ key: "lloyds", label: longName }],
    })[0];
    expect(one.label).toBe("Lloyds c/o Maximum Insu…");
    expect(one.detail).toContain(longName);

    expect(
      summary({
        carriers: [
          { key: "hiscox", label: "Hiscox" },
          { key: "next", label: "NEXT" },
          { key: "markel", label: "Markel" },
        ],
      })[0],
    ).toEqual(
      expect.objectContaining({
        label: "3 carriers",
        accessibleLabel: "3 carriers selected",
      }),
    );
  });

  it("shows one normalized state code and a concise multi-state summary", () => {
    expect(summary({ locationStates: ["CA"] })[0]).toEqual(
      expect.objectContaining({
        id: "location",
        label: "CA",
        detail: "Location State: CA — California",
      }),
    );
    expect(summary({ locationStates: ["CA", "NY", "state:none"] })[0]).toEqual(
      expect.objectContaining({
        label: "CA +2",
        accessibleLabel: "3 Location States selected",
      }),
    );
  });

  it.each([
    [{ date: "newest", revenue: "none" }, "Newest"],
    [{ date: "oldest", revenue: "revenue-desc" }, "Revenue high"],
    [{ date: "oldest", revenue: "revenue-asc" }, "Revenue low"],
    [
      { date: "newest", revenue: "revenue-desc" },
      "Revenue high · Newest",
    ],
  ] as const)("summarizes explicit sort %j", (sort, label) => {
    expect(summary({ sort })[0]).toEqual(
      expect.objectContaining({ id: "sort", label }),
    );
  });

  it("truncates search text without splitting Unicode and retains full detail", () => {
    const search = "Loyalty 🧭 Partners and International Holdings";
    const item = summary({ search })[0];
    expect(item.label).toBe('Search: “Loyalty 🧭 Partners and In…”');
    expect(item.detail).toBe(`Account search: “${search}”`);
    expect(truncateRecordsFilterText("12345678🧭90", 10)).toBe(
      "12345678🧭…",
    );
  });

  it("orders simultaneous filters by responsive importance", () => {
    expect(
      summary({
        source: "iq",
        iqStages: ["bind_requested", "awaiting_binder"],
        range: "last-30-days",
        carriers: [
          { key: "hiscox", label: "Hiscox" },
          { key: "next", label: "NEXT" },
        ],
        locationStates: ["CA", "NY"],
        sort: { date: "newest", revenue: "revenue-desc" },
        search: "Loyalty",
      }).map((item) => item.id),
    ).toEqual([
      "source",
      "pipeline",
      "carrier",
      "location",
      "date",
      "sort",
      "search",
    ]);
  });
});
