import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyOrders } from "@/app/accounts/[id]/CompanyOrders";
import { ContactsCard } from "@/app/accounts/[id]/ContactsCard";
import {
  PaymentHistory,
  showNoLoadedPaymentRecords,
} from "@/app/accounts/[id]/PaymentHistory";
import type { PaymentHistoryPage } from "@/lib/company-detail-types";
import { RichOrderCard } from "@/app/all-accounts/RichOrderCard";
import { CopyButton, copyText } from "@/components/CopyButton";
import { emptyBookOrderRich } from "@/lib/supabase-book.server";
import type { BookOrderListItem } from "@/lib/db/queries/accounts";

const testOrder: BookOrderListItem = {
  id: "order-12594",
  harperOrderId: 12594,
  label: "Order #12594",
  createdAt: "2026-08-09T12:00:00.000Z",
  orderedAt: "2026-08-09T12:00:00.000Z",
  eventAt: "2026-08-09T12:00:00.000Z",
  bindStatus: "pending",
  revenueCents: 41_685,
  revenueMicros: 416_850_000,
  rich: {
    ...emptyBookOrderRich(),
    paymentType: "full_pay",
    documentCount: 1,
    policyCount: 1,
    totalPremiumCents: 77_900,
    taxesCents: 0,
    feesCents: 0,
    totalCostCents: 77_900,
    commissionRevenueCents: 11_685,
    deals: [
      {
        dealId: 77,
        dealStage: "sold",
        carrierName: "Markel American Insurance Co",
        wholesalerName: null,
        premiumCents: 77_900,
        policyNumber: null,
        isInstantQuote: true,
        isBound: false,
        boundAt: null,
        effectiveDate: null,
        expirationDate: null,
      },
    ],
  },
  policyNumbers: [],
  inconsistency: null,
  source: "iq",
  iqStageTag: null,
  brokerGate: null,
  brokerGateAt: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("shared Step Bro order card", () => {
  it("renders the full Accounts presentation", () => {
    const html = renderToStaticMarkup(
      <ul>
        <RichOrderCard
          order={testOrder}
          accountId="co-925148"
          accountName="Charm City Kids Childcare LLC"
          canEditOrders={false}
          bigBrotherBaseUrl="https://example.test"
          todayDay="2026-08-15"
        />
      </ul>,
    );

    expect(html).toContain('data-component="step-bro-order-card"');
    expect(html).toContain("Paid in Full");
    expect(html).toContain("Commission Δ");
    expect(html).toContain("Producer Notes");
    expect(html).toContain("Service Notes");
  });

  it("uses that same component from Company Detail and defers heavy notes", () => {
    const html = renderToStaticMarkup(
      <CompanyOrders
        orders={[testOrder]}
        accountId="co-925148"
        accountName="Charm City Kids Childcare LLC"
        canEditOrders={false}
        bigBrotherBaseUrl="https://example.test"
        todayDay="2026-08-15"
      />,
    );

    expect(html).toContain('data-component="step-bro-order-card"');
    expect(html).toContain("Commission Δ");
    expect(html).toContain("Notes for Order #12594 load when visible");
  });
});

describe("copy controls", () => {
  it("copies exactly the requested value through Clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyText("+1 443 799 8259")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("+1 443 799 8259");
  });

  it("renders specific accessible labels for each contact value", () => {
    const html = renderToStaticMarkup(
      <>
        <CopyButton
          value={"6619 Birchwood Avenue\nBaltimore, Maryland 21214"}
          label="Copy company address"
          successMessage="Address copied"
        />
        <ContactsCard
          contacts={[
            {
              id: 1,
              name: "Philicia Alexander",
              role: null,
              email: "charmcitykidschildcare@gmail.com",
              phone: "+14437998259",
              isPrimary: false,
            },
          ]}
        />
      </>,
    );

    expect(html).toContain('aria-label="Copy company address"');
    expect(html).toContain(
      'aria-label="Copy Philicia Alexander&#x27;s name"',
    );
    expect(html).toContain(
      'aria-label="Copy Philicia Alexander&#x27;s email"',
    );
    expect(html).toContain(
      'aria-label="Copy Philicia Alexander&#x27;s phone"',
    );
  });
});

describe("priority payment summary", () => {
  it("shows the total settled amount instead of the latest event", () => {
    const html = renderToStaticMarkup(
      <PaymentHistory
        companyId={925148}
        initial={{
          companyId: 925148,
          total: 2,
          settledAmountCents: 56_507,
          settledCurrency: "USD",
          settledCount: 1,
          offset: 0,
          limit: 1,
          fetchedAt: "2026-08-16T20:00:00.000Z",
          stale: false,
          items: [
            {
              id: "link:payment_link_example",
              type: "payment_link",
              status: "link_sent",
              rawStatus: "pending",
              amountCents: 107_900,
              currency: "USD",
              occurredAt: "2026-08-10T14:39:00.000Z",
              createdAt: "2026-08-10T14:39:00.000Z",
              orderId: 12594,
              createdBy: "producer@example.com",
              safeReference: "••••fTmCxS",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Total settled");
    expect(html).toContain("$565.07");
    expect(html).toContain("1 successful settlement");
    expect(html).toContain("View payment history (2)");
    expect(html).not.toContain("Link Sent");
    expect(html).not.toContain("Order #12594");
  });

  it("offers Retry instead of a dead card when the server preview failed", () => {
    const html = renderToStaticMarkup(
      <PaymentHistory companyId={925148} initial={null} />,
    );
    expect(html).toContain("Payment history is temporarily unavailable.");
    expect(html).toContain("Retry");
  });

  it("embeds a neutral stale-data status in the payment summary", () => {
    const page: PaymentHistoryPage = {
      companyId: 925148,
      total: 1,
      settledAmountCents: 56_507,
      settledCurrency: "USD",
      settledCount: 1,
      offset: 0,
      limit: 20,
      fetchedAt: "2026-08-16T20:00:00.000Z",
      stale: true,
      items: [
        {
          id: "payment:9",
          type: "payment",
          status: "settled",
          rawStatus: "settled",
          amountCents: 56_507,
          currency: "USD",
          occurredAt: "2026-08-14T20:10:00.000Z",
          createdAt: "2026-08-14T20:00:00.000Z",
          orderId: 11368,
          createdBy: null,
          safeReference: "••••CLGj6B",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <PaymentHistory companyId={925148} initial={page} />,
    );
    expect(html).toContain("Showing the last available payment data.");
    expect(html).toContain("company-payment-data-state");
    expect(html.indexOf("company-payment-data-state")).toBeGreaterThan(
      html.indexOf("company-payment-summary"),
    );
    expect(html).not.toContain("amber");
    expect(html).toContain("$565.07");
  });

  it("never claims there are no loaded records while an error is showing", () => {
    expect(showNoLoadedPaymentRecords(0, null)).toBe(true);
    expect(
      showNoLoadedPaymentRecords(
        0,
        "Payment history is temporarily unavailable.",
      ),
    ).toBe(false);
    expect(showNoLoadedPaymentRecords(3, null)).toBe(false);
  });
});
