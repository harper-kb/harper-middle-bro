import { describe, expect, it } from "vitest";
import {
  BROKER_GATE_FILTER_OPTIONS,
  BROKER_GATE_IDS,
  BROKER_GATE_LABELS,
  BROKER_GATE_NONE,
  BROKER_GATE_NONE_LABEL,
  coerceBrokerGateId,
  isBrokerGateFilterId,
  orderMatchesBrokerGates,
  parseBrokerGates,
  serializeBrokerGates,
} from "@/lib/broker-gate";

/**
 * Broker Gate filter axis. The vocabulary is the same normalized gate the
 * order-card rail displays (verified against
 * service_workbench_gate_overrides.current_gate: exactly G1–G6 or NULL), so
 * these tests pin the contract between the two surfaces: same ids, same
 * labels, same treatment of null/drifted values.
 */

describe("broker gate filter options", () => {
  it("lists the verified gates in numeric pipeline order", () => {
    const codes = BROKER_GATE_FILTER_OPTIONS.filter((o) => o.code).map(
      (o) => o.id,
    );
    expect(codes).toEqual([...BROKER_GATE_IDS]);
    // Numeric business order, not lexicographic accident: strictly ascending.
    const numbers = codes.map((id) => Number(String(id).slice(1)));
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1]);
    }
  });

  it("reuses the exact labels the order-card rail displays", () => {
    for (const option of BROKER_GATE_FILTER_OPTIONS) {
      if (option.code) {
        expect(option.label).toBe(
          BROKER_GATE_LABELS[option.id as keyof typeof BROKER_GATE_LABELS],
        );
      }
    }
  });

  it("offers Gate unavailable last, honestly labelled and without a code", () => {
    const last = BROKER_GATE_FILTER_OPTIONS[BROKER_GATE_FILTER_OPTIONS.length - 1];
    expect(last.id).toBe(BROKER_GATE_NONE);
    expect(last.code).toBeNull();
    expect(last.label).toBe(BROKER_GATE_NONE_LABEL);
    expect(last.label).toBe("Gate unavailable");
  });
});

describe("parseBrokerGates / serializeBrokerGates", () => {
  it("round-trips a selection through the URL param", () => {
    expect(parseBrokerGates("G3,G4")).toEqual(["G3", "G4"]);
    expect(serializeBrokerGates(["G3", "G4"])).toBe("G3,G4");
    expect(parseBrokerGates(serializeBrokerGates(["G1", BROKER_GATE_NONE]))).toEqual([
      "G1",
      BROKER_GATE_NONE,
    ]);
  });

  it("treats empty and missing as no filter", () => {
    expect(parseBrokerGates(undefined)).toEqual([]);
    expect(parseBrokerGates(null)).toEqual([]);
    expect(parseBrokerGates("")).toEqual([]);
    expect(parseBrokerGates("  ")).toEqual([]);
    expect(serializeBrokerGates([])).toBeUndefined();
  });

  it("drops unknown tokens and duplicates instead of inventing gates", () => {
    expect(parseBrokerGates("G4,G9,g4,bogus,G4,gate:none")).toEqual([
      "G4",
      BROKER_GATE_NONE,
    ]);
    expect(isBrokerGateFilterId("G7")).toBe(false);
    expect(isBrokerGateFilterId("gate:none")).toBe(true);
  });
});

describe("orderMatchesBrokerGates", () => {
  it("matches everything when nothing is selected", () => {
    expect(orderMatchesBrokerGates("G4", [])).toBe(true);
    expect(orderMatchesBrokerGates(null, [])).toBe(true);
  });

  it("matches the coerced current gate, including drifted spellings", () => {
    expect(orderMatchesBrokerGates("G4", ["G4"])).toBe(true);
    expect(orderMatchesBrokerGates("g4", ["G4"])).toBe(true);
    expect(orderMatchesBrokerGates("Gate 4", ["G4"])).toBe(true);
    expect(orderMatchesBrokerGates("G3", ["G4"])).toBe(false);
  });

  it("uses OR across a multi-gate selection", () => {
    expect(orderMatchesBrokerGates("G2", ["G2", "G4"])).toBe(true);
    expect(orderMatchesBrokerGates("G4", ["G2", "G4"])).toBe(true);
    expect(orderMatchesBrokerGates("G5", ["G2", "G4"])).toBe(false);
  });

  it("never treats a missing gate as G1", () => {
    expect(orderMatchesBrokerGates(null, ["G1"])).toBe(false);
    expect(orderMatchesBrokerGates("", ["G1"])).toBe(false);
  });

  it("folds null and non-coercible values into Gate unavailable, same as the rail", () => {
    for (const raw of [null, undefined, "", "G9", "weird"]) {
      expect(coerceBrokerGateId(raw)).toBeNull();
      expect(orderMatchesBrokerGates(raw, [BROKER_GATE_NONE])).toBe(true);
      expect(orderMatchesBrokerGates(raw, ["G1"])).toBe(false);
    }
    expect(orderMatchesBrokerGates("G4", [BROKER_GATE_NONE])).toBe(false);
  });
});
