import { describe, expect, it } from "vitest";
import {
  carrierKeyFromName,
  carrierKeysForDeals,
  MAX_SELECTED_CARRIERS,
  orderMatchesCarriers,
  parseCarrierFilter,
  serializeCarrierFilter,
} from "@/lib/carrier-filter";

/**
 * Carrier filter axis. The key is a carrier-entity identity derived from the
 * verified display name (insurance_carriers.name via deals_v2.carrier =
 * insurance_carriers.code): case and whitespace variations of one name fold
 * to one key, while any real textual difference — punctuation included —
 * keeps two carriers apart. These tests pin that contract plus the URL
 * round-trip the normalizing redirect depends on.
 */

describe("carrierKeyFromName", () => {
  it("folds case and collapses whitespace into one deterministic key", () => {
    expect(carrierKeyFromName("Hiscox Ins Co")).toBe("hiscox ins co");
    expect(carrierKeyFromName("HISCOX INS CO")).toBe("hiscox ins co");
    expect(carrierKeyFromName("  Hiscox   Ins\tCo  ")).toBe("hiscox ins co");
  });

  it("preserves punctuation so similar names never merge", () => {
    expect(carrierKeyFromName("Lloyds c/o CRC")).toBe("lloyds c/o crc");
    expect(carrierKeyFromName("Lloyd's c/o CRC")).toBe("lloyd's c/o crc");
    expect(carrierKeyFromName("Lloyds c/o CRC")).not.toBe(
      carrierKeyFromName("Lloyd's c/o CRC"),
    );
    // Abbreviated vs full names are different carriers until proven equal.
    expect(carrierKeyFromName("USLI")).not.toBe(
      carrierKeyFromName("United States Liability Ins Co"),
    );
  });

  it("returns null when there is no name to key", () => {
    expect(carrierKeyFromName(null)).toBeNull();
    expect(carrierKeyFromName(undefined)).toBeNull();
    expect(carrierKeyFromName("")).toBeNull();
    expect(carrierKeyFromName("   ")).toBeNull();
  });
});

describe("carrierKeysForDeals", () => {
  it("returns the distinct sorted entity keys across an order's deals", () => {
    expect(
      carrierKeysForDeals([
        { carrierName: "NEXT Insurance US Inc" },
        { carrierName: "Hiscox Ins Co" },
        { carrierName: "HISCOX INS CO" },
        { carrierName: null },
        { carrierName: "  " },
      ]),
    ).toEqual(["hiscox ins co", "next insurance us inc"]);
  });

  it("returns nothing for an order whose deals carry no carrier", () => {
    expect(carrierKeysForDeals([{ carrierName: null }])).toEqual([]);
    expect(carrierKeysForDeals([])).toEqual([]);
  });
});

describe("parseCarrierFilter / serializeCarrierFilter", () => {
  it("round-trips a selection through the URL param", () => {
    const keys = ["hiscox ins co", "next insurance us inc"];
    const serialized = serializeCarrierFilter(keys);
    expect(serialized).toBe("hiscox ins co,next insurance us inc");
    expect(parseCarrierFilter(serialized)).toEqual(keys);
  });

  it("canonicalizes order, case, whitespace and duplicates", () => {
    expect(parseCarrierFilter("Next Insurance US Inc,HISCOX  Ins Co,hiscox ins co")).toEqual([
      "hiscox ins co",
      "next insurance us inc",
    ]);
    expect(serializeCarrierFilter(["b carrier", "a carrier"])).toBe(
      "a carrier,b carrier",
    );
  });

  it("escapes the list separator inside data-derived keys", () => {
    const awkward = ["acme, managers llc", "100% surety co"];
    const serialized = serializeCarrierFilter(awkward)!;
    expect(serialized).not.toContain("acme, managers");
    expect(parseCarrierFilter(serialized)).toEqual(
      [...awkward].sort(),
    );
  });

  it("treats empty and missing params as no filter", () => {
    expect(parseCarrierFilter(undefined)).toEqual([]);
    expect(parseCarrierFilter(null)).toEqual([]);
    expect(parseCarrierFilter("")).toEqual([]);
    expect(parseCarrierFilter(" , ,")).toEqual([]);
    expect(serializeCarrierFilter([])).toBeUndefined();
  });

  it("keeps unknown keys (data questions are answered by the facet, not the parser)", () => {
    expect(parseCarrierFilter("no such carrier ever")).toEqual([
      "no such carrier ever",
    ]);
  });

  it("caps degenerate URLs without reordering legitimate ones", () => {
    const many = Array.from({ length: MAX_SELECTED_CARRIERS + 50 }, (_, i) =>
      `carrier ${String(i).padStart(4, "0")}`,
    );
    const parsed = parseCarrierFilter(many.join(","));
    expect(parsed).toHaveLength(MAX_SELECTED_CARRIERS);
  });
});

describe("orderMatchesCarriers", () => {
  const deals = [
    { carrierName: "Hiscox Ins Co" },
    { carrierName: "Coterie Insurance" },
  ];

  it("matches with OR semantics across the selection", () => {
    expect(orderMatchesCarriers(deals, ["hiscox ins co"])).toBe(true);
    expect(orderMatchesCarriers(deals, ["markel ins co", "coterie insurance"])).toBe(
      true,
    );
    expect(orderMatchesCarriers(deals, ["markel ins co"])).toBe(false);
  });

  it("treats an empty selection as no filter", () => {
    expect(orderMatchesCarriers(deals, [])).toBe(true);
    expect(orderMatchesCarriers([{ carrierName: null }], [])).toBe(true);
  });

  it("never matches an order with no carrier identity", () => {
    expect(
      orderMatchesCarriers([{ carrierName: null }], ["hiscox ins co"]),
    ).toBe(false);
  });

  it("matches display variants of the same entity", () => {
    expect(
      orderMatchesCarriers([{ carrierName: "HISCOX  INS CO" }], [
        "hiscox ins co",
      ]),
    ).toBe(true);
  });
});
