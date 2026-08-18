import { describe, expect, it } from "vitest";
import {
  clampRecordsPage,
  clearRecordsFilters,
  defaultRecordsFilterState,
  isCanonicalRecordsQuery,
  parseRecordsFilterState,
  recordsFilterHref,
  serializeRecordsFilterState,
  updateRecordsFilters,
  withRecordsView,
} from "@/app/all-accounts/records-filter-state";

describe("canonical Records filter state", () => {
  it("round-trips every shipped filter through one deterministic URL", () => {
    const state = parseRecordsFilterState("pending", {
      source: "iq",
      iqStage: "awaiting_binder,bind_requested,awaiting_binder",
      range: "this-week",
      carrier: "next insurance us inc,hiscox ins co",
      state: "NY,CA,NY",
      sort: "newest,revenue-desc",
      q: "  acme & sons  ",
      page: "4",
    });

    expect(recordsFilterHref(state)).toBe(
      "/pending-orders?source=iq&iqStage=bind_requested%2Cawaiting_binder&range=this-week&carrier=hiscox+ins+co%2Cnext+insurance+us+inc&state=CA%2CNY&sort=revenue-desc%2Cnewest&q=acme+%26+sons&page=4",
    );
    expect(
      parseRecordsFilterState(
        "pending",
        Object.fromEntries(serializeRecordsFilterState(state)),
      ),
    ).toEqual(state);
  });

  it("combines repeated list params instead of throwing or resetting siblings", () => {
    const state = parseRecordsFilterState("pending", {
      source: "broker",
      brokerGate: ["G4", "G2,unknown", "G4"],
      carrier: ["Markel Insurance Company", "Hiscox Ins Co"],
      state: ["NY", "bogus,CA"],
      sort: ["newest", "revenue-asc"],
      q: "roofing",
      page: "3",
    });

    expect(state).toMatchObject({
      source: "broker",
      brokerGates: ["G2", "G4"],
      carriers: ["hiscox ins co", "markel insurance company"],
      locationStates: ["CA", "NY"],
      sort: { date: "newest", revenue: "revenue-asc" },
      query: "roofing",
      page: 3,
    });
  });

  it("drops unknown values field by field, never the complete model", () => {
    const state = parseRecordsFilterState("pending", {
      source: "iq",
      iqStage: "unknown,bind_requested,also-unknown",
      range: "not-a-range",
      carrier: "known carrier",
      state: "XX,CA",
      sort: "nonsense,revenue-desc",
      q: "acme",
      page: "2",
    });

    expect(state).toMatchObject({
      source: "iq",
      iqStages: ["bind_requested"],
      range: "all-time",
      carriers: ["known carrier"],
      locationStates: ["CA"],
      sort: { date: "oldest", revenue: "revenue-desc" },
      query: "acme",
      page: 2,
    });
  });

  it("normalizes source-dependent filters without touching unrelated fields", () => {
    const iq = parseRecordsFilterState("pending", {
      source: "iq",
      iqStage: "bind_requested",
      brokerGate: "G4",
      carrier: "hiscox ins co",
      state: "CA",
      q: "acme",
      page: "5",
    });
    expect(iq.iqStages).toEqual(["bind_requested"]);
    expect(iq.brokerGates).toEqual([]);

    const broker = updateRecordsFilters(iq, { source: "broker" });
    expect(broker).toMatchObject({
      source: "broker",
      iqStages: [],
      brokerGates: [],
      carriers: ["hiscox ins co"],
      locationStates: ["CA"],
      query: "acme",
      page: 1,
    });
  });

  it("applies one view-compatibility table and resets only page", () => {
    const pending = parseRecordsFilterState("pending", {
      source: "iq",
      iqStage: "bind_requested",
      range: "this-week",
      carrier: "hiscox ins co",
      state: "CA",
      sort: "newest",
      q: "acme",
      page: "7",
    });

    expect(withRecordsView(pending, "bound")).toMatchObject({
      view: "bound",
      source: "iq",
      iqStages: [],
      range: "this-week",
      carriers: ["hiscox ins co"],
      locationStates: ["CA"],
      sort: { date: "newest", revenue: "none" },
      query: "acme",
      page: 1,
    });
    expect(withRecordsView(pending, "all")).toMatchObject({
      view: "all",
      source: "iq",
      iqStages: ["bind_requested"],
      range: undefined,
      carriers: ["hiscox ins co"],
      page: 1,
    });
    expect(withRecordsView(pending, "lost")).toMatchObject({
      view: "lost",
      source: "iq",
      iqStages: [],
      range: undefined,
      carriers: ["hiscox ins co"],
      page: 1,
    });
  });

  it("merges partial changes into the complete state and resets page once", () => {
    const current = parseRecordsFilterState("pending", {
      source: "broker",
      brokerGate: "G3,G4",
      range: "last-week",
      carrier: "hiscox ins co",
      state: "CA",
      sort: "revenue-desc,newest",
      q: "acme",
      page: "6",
    });
    const next = updateRecordsFilters(current, {
      carriers: ["markel insurance company"],
    });

    expect(next).toMatchObject({
      source: "broker",
      brokerGates: ["G3", "G4"],
      range: "last-week",
      carriers: ["markel insurance company"],
      locationStates: ["CA"],
      sort: { date: "newest", revenue: "revenue-desc" },
      query: "acme",
      page: 1,
    });
  });

  it("preserves an explicit page change and clamps only page after live data", () => {
    const current = parseRecordsFilterState("pending", {
      source: "broker",
      brokerGate: "G4",
      carrier: "hiscox ins co",
      q: "acme",
      page: "9",
    });
    const pageThree = updateRecordsFilters(current, { page: 3 });
    expect(pageThree.page).toBe(3);

    const clamped = clampRecordsPage(current, 4);
    expect(clamped).toEqual({ ...current, page: 4 });
  });

  it("omits defaults and recognizes the canonical query spelling", () => {
    const defaults = defaultRecordsFilterState("pending");
    expect(recordsFilterHref(defaults)).toBe("/pending-orders");
    expect(isCanonicalRecordsQuery(defaults, {})).toBe(true);
    expect(isCanonicalRecordsQuery(defaults, { range: "all-time" })).toBe(
      false,
    );
  });

  it("clears only through the explicit reset helper", () => {
    const current = parseRecordsFilterState("bound", {
      source: "broker",
      range: "last-30-days",
      carrier: "hiscox ins co",
      state: "CA",
      q: "acme",
      page: "3",
    });
    expect(clearRecordsFilters(current)).toEqual(
      defaultRecordsFilterState("bound"),
    );
  });
});
