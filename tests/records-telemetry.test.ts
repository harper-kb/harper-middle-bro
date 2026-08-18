import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultRecordsFilterState,
  parseRecordsFilterState,
} from "@/app/all-accounts/records-filter-state";
import {
  reportRecordsTransition,
  recordsStateHash,
  recordsStateShape,
} from "@/app/all-accounts/records-telemetry";

afterEach(() => vi.restoreAllMocks());

describe("Records diagnostics", () => {
  it("records structure and a stable hash without sensitive filter values", () => {
    const state = parseRecordsFilterState("pending", {
      source: "broker",
      brokerGate: "G4",
      carrier: "sensitive carrier name",
      state: "CA",
      q: "private account search",
      page: "3",
    });

    const shape = recordsStateShape(state);
    const serialized = JSON.stringify(shape);
    expect(shape).toMatchObject({
      view: "pending",
      source: "broker",
      broker_gate_count: 1,
      carrier_count: 1,
      location_state_count: 1,
      query_length: 22,
      page: 3,
      hash: recordsStateHash(state),
    });
    expect(serialized).not.toContain("sensitive carrier");
    expect(serialized).not.toContain("private account");
    expect(recordsStateHash(state)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("fails in test when one control resets unrelated valid intent", () => {
    const from = parseRecordsFilterState("all", {
      source: "iq",
      q: "acme",
    });
    const to = defaultRecordsFilterState("all");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() =>
      reportRecordsTransition({
        reason: "search",
        trigger: "stale-search",
        changedFields: ["query"],
        from,
        to,
      }),
    ).toThrow(/without an explicit reset/);
  });

  it("allows a control to explicitly clear the only field it owns", () => {
    const from = parseRecordsFilterState("all", { q: "acme" });
    const to = defaultRecordsFilterState("all");
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(() =>
      reportRecordsTransition({
        reason: "search",
        trigger: "search-clear",
        changedFields: ["query"],
        from,
        to,
      }),
    ).not.toThrow();
  });
});
