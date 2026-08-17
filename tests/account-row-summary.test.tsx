import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountRowSummary } from "@/app/all-accounts/AccountRowSummary";
import { buildAccountRowModel } from "@/lib/account-row-model";
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

const model = (orders: BookOrderListItem[]) =>
  buildAccountRowModel(orders, "2026-08-15");

describe("AccountRowSummary", () => {
  it("renders source, age, carrier, and revenue with icons", () => {
    const html = renderToStaticMarkup(
      <AccountRowSummary model={model([order()])} />,
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
        model={model([order({ createdAt: "2026-08-09T20:00:00.000Z" })])}
      />,
    );
    expect(html).toContain("6 Days ago");
    expect(html).toContain("account-summary-item--attention");
  });

  it("makes each explanatory tooltip keyboard reachable", () => {
    const html = renderToStaticMarkup(
      <AccountRowSummary model={model([order()])} />,
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
            hasServiceNotes: false,
          }}
          canEditOrders={false}
          bigBrotherBaseUrl=""
          todayDay="2026-08-15"
          expanded
        />
      </ul>,
    );

    expect(html).toContain("account-list-row--open");
    expect(html).toContain("account-list-row-header--open");
    expect(html).toContain("account-expand-button--open");
    expect(html).toContain("Viewing account");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Order #1");
    expect(html).toContain("Producer Notes");
    expect(html).toContain("Service Notes");
  });
});
