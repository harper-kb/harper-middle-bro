import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AccountRowSummary,
  summarizeAccountOrders,
} from "@/app/all-accounts/AccountRowSummary";
import { AccountRow } from "@/app/all-accounts/AllAccountsList";
import type { BookOrderListItem } from "@/lib/db";

function order(
  patch: Partial<BookOrderListItem> & {
    carrierNames?: (string | null)[];
  } = {},
): BookOrderListItem {
  const { carrierNames = ["Evanston Insurance Company"], ...rest } = patch;
  return {
    id: "order-1",
    harperOrderId: 1,
    label: "Order #1",
    createdAt: "2026-08-14T20:00:00.000Z",
    orderedAt: "2026-08-14T20:00:00.000Z",
    eventAt: "2026-08-14T20:00:00.000Z",
    bindStatus: "pending",
    revenueCents: 40060,
    revenueMicros: 400_600_000,
    policyNumbers: [],
    inconsistency: null,
    source: "iq",
    iqStageTag: null,
    brokerGate: null,
    brokerGateAt: null,
    rich: {
      deals: carrierNames.map((carrierName, index) => ({
        dealId: index + 1,
        dealStage: "sold",
        carrierName,
        wholesalerName: null,
        premiumCents: null,
        policyNumber: null,
        isInstantQuote: true,
        isBound: false,
        boundAt: null,
        effectiveDate: null,
        expirationDate: null,
      })),
      paymentType: null,
      pfaQuoteNumber: null,
      initialPaymentAt: null,
      documentCount: 0,
      policyCount: carrierNames.length,
      totalPremiumCents: null,
      taxesCents: null,
      feesCents: null,
      totalCostCents: null,
      commissionRevenueCents: null,
      harperServiceFeeCents: null,
      taxes: [],
      fees: [],
      producerNote: null,
      producerNoteUpdatedAt: null,
      producerNoteUpdatedByName: null,
      serviceNote: null,
    },
    ...rest,
  };
}

describe("summarizeAccountOrders", () => {
  it("sums revenue once at order grain and shows the oldest displayed age", () => {
    const summary = summarizeAccountOrders(
      [
        order(),
        order({
          id: "order-2",
          source: "iq",
          revenueMicros: 99_400_000,
          createdAt: "2026-08-09T20:00:00.000Z",
        }),
      ],
      "2026-08-15",
    );

    expect(summary.source).toBe("iq");
    expect(summary.revenueMicros).toBe(500_000_000);
    expect(summary.ageDays).toBe(6);
    expect(summary.orderCount).toBe(2);
  });

  it("deduplicates carriers and preserves distinct names", () => {
    const summary = summarizeAccountOrders(
      [
        order({
          carrierNames: [
            "Evanston Insurance Company",
            "Evanston Insurance Company",
          ],
        }),
        order({
          id: "order-2",
          carrierNames: ["CNA", null],
        }),
      ],
      "2026-08-15",
    );

    expect(summary.carrierNames).toEqual(["CNA", "Evanston Insurance Company"]);
  });

  it("reports Mixed when known order sources disagree", () => {
    const summary = summarizeAccountOrders(
      [order({ source: "iq" }), order({ id: "order-2", source: "broker" })],
      "2026-08-15",
    );
    expect(summary.source).toBe("mixed");
  });

  it("does not coerce an unavailable source into Broker or Mixed", () => {
    const summary = summarizeAccountOrders(
      [order({ source: "iq" }), order({ id: "order-2", source: null })],
      "2026-08-15",
    );
    expect(summary.source).toBeNull();
  });

  it("does not present partial revenue or age as complete", () => {
    const summary = summarizeAccountOrders(
      [
        order(),
        order({
          id: "order-2",
          revenueMicros: null,
          createdAt: null,
        }),
      ],
      "2026-08-15",
    );
    expect(summary.revenueMicros).toBeNull();
    expect(summary.ageDays).toBeNull();
  });
});

describe("AccountRowSummary", () => {
  it("renders source, age, carrier, and revenue with icons", () => {
    const html = renderToStaticMarkup(
      <AccountRowSummary orders={[order()]} todayDay="2026-08-15" />,
    );

    expect(html).toContain("IQ");
    expect(html).toContain("1 Day ago");
    expect(html).toContain("Evanston Insurance Company");
    expect(html).toContain("$400.60");
    expect(html).toContain("Revenue");
    expect(html.match(/account-summary-icon/g)).toHaveLength(4);
  });

  it("marks an old account summary with the attention treatment", () => {
    const html = renderToStaticMarkup(
      <AccountRowSummary
        orders={[order({ createdAt: "2026-08-09T20:00:00.000Z" })]}
        todayDay="2026-08-15"
      />,
    );
    expect(html).toContain("6 Days ago");
    expect(html).toContain("account-summary-item--attention");
  });

  it("makes each explanatory tooltip keyboard reachable", () => {
    const html = renderToStaticMarkup(
      <AccountRowSummary orders={[order()]} todayDay="2026-08-15" />,
    );
    const describedBy = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(describedBy).toHaveLength(4);
    expect(html.match(/tabindex="0"/g)).toHaveLength(4);
    for (const id of describedBy) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("open account row", () => {
  it("announces and visually identifies the account being viewed", () => {
    const html = renderToStaticMarkup(
      <ul>
        <AccountRow
          account={{
            id: "co-1",
            name: "Bright Adventures LLC",
            dba: null,
            state: "CA",
            orderCount: 1,
            orders: [order()],
          }}
          richCards={false}
          canEditOrders={false}
          bigBrotherBaseUrl=""
          todayDay="2026-08-15"
          initiallyOpen
        />
      </ul>,
    );

    expect(html).toContain("account-list-row--open");
    expect(html).toContain("account-list-row-header--open");
    expect(html).toContain("account-expand-button--open");
    expect(html).toContain("Viewing account");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Order #1");
    expect(html).toContain("No service or producer note");
  });
});
