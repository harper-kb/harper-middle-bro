import { describe, expect, it } from "vitest";
import { summarizeCompanyOrders } from "@/lib/company-detail";
import { emptyBookOrderRich } from "@/lib/supabase-book.server";
import type { BookOrderListItem } from "@/lib/db/queries/accounts";

function order(
  id: number,
  {
    premiumCents,
    revenueMicros,
    source,
    commissionCents = null,
    harperFeeCents = null,
  }: Pick<BookOrderListItem, "revenueMicros" | "source"> & {
    premiumCents: number | null;
    commissionCents?: number | null;
    harperFeeCents?: number | null;
  },
): BookOrderListItem {
  return {
    id: `order-${id}`,
    harperOrderId: id,
    label: `Order #${id}`,
    createdAt: "2026-08-01T00:00:00.000Z",
    orderedAt: null,
    eventAt: null,
    bindStatus: "pending",
    revenueCents:
      revenueMicros === null ? null : Math.round(revenueMicros / 10_000),
    revenueMicros,
    rich: {
      ...emptyBookOrderRich(),
      totalPremiumCents: premiumCents,
      commissionRevenueCents: commissionCents,
      harperServiceFeeCents: harperFeeCents,
    },
    policyNumbers: [],
    inconsistency: null,
    source,
    iqStageTag: null,
    brokerGate: null,
    brokerGateAt: null,
  };
}

describe("summarizeCompanyOrders", () => {
  it("aggregates exact order-grain premium and revenue once", () => {
    const result = summarizeCompanyOrders([
      order(10, {
        premiumCents: 78_200,
        revenueMicros: 578_200_000,
        source: "broker",
        commissionCents: 7_820,
        harperFeeCents: 50_000,
      }),
      order(11, {
        premiumCents: 12_300,
        revenueMicros: 120_000_000,
        source: "iq",
        commissionCents: 2_000,
        harperFeeCents: 10_000,
      }),
    ]);

    expect(result.totalPremiumCents).toBe(90_500);
    expect(result.totalRevenueMicros).toBe(698_200_000);
    expect(result.totalCommissionCents).toBe(9_820);
    expect(result.totalHarperFeeCents).toBe(60_000);
    expect(result.source).toBe("mixed");
    expect(result.statusCounts).toEqual({ bound: 0, pending: 2, lost: 0 });
  });

  it("preserves true zero but rejects incomplete totals", () => {
    expect(
      summarizeCompanyOrders([
        order(10, {
          premiumCents: 0,
          revenueMicros: 0,
          source: "broker",
        }),
      ]),
    ).toMatchObject({
      totalPremiumCents: 0,
      totalRevenueMicros: 0,
      source: "broker",
    });

    expect(
      summarizeCompanyOrders([
        order(10, {
          premiumCents: 100,
          revenueMicros: 100_000,
          source: "broker",
        }),
        order(11, {
          premiumCents: null,
          revenueMicros: null,
          source: "broker",
        }),
      ]),
    ).toMatchObject({
      totalPremiumCents: null,
      totalRevenueMicros: null,
    });
  });
});
