/**
 * Static rich-card anatomy check.
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/rich-order-render-check.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { RichOrderCard } from "../src/app/all-accounts/RichOrderCard";
import type { BookOrderListItem } from "../src/lib/db/queries/accounts";

const order: BookOrderListItem = {
  id: "order-13061",
  harperOrderId: 13061,
  label: "Order #13061",
  createdAt: "2026-08-14T22:47:55.000Z",
  orderedAt: "2026-08-14T22:47:55.000Z",
  eventAt: "2026-08-14T22:47:55.000Z",
  bindStatus: "pending",
  source: "iq",
  revenueCents: 85625,
  revenueMicros: 856250000,
  policyNumbers: [],
  inconsistency: null,
  iqStageTag: "bind_requested",
  brokerGate: null,
  brokerGateAt: null,
  rich: {
    paymentType: "financed",
    pfaQuoteNumber: null,
    initialPaymentAt: "2026-08-14T00:00:00.000Z",
    documentCount: 1,
    policyCount: 1,
    totalPremiumCents: 237500,
    taxesCents: 0,
    feesCents: 0,
    totalCostCents: 237500,
    commissionRevenueCents: 35625,
    harperServiceFeeCents: 50000,
    taxes: [],
    fees: [],
    producerNote: null,
    producerNoteUpdatedAt: null,
    producerNoteUpdatedByName: null,
    serviceNote: null,
    deals: [
      {
        dealId: 16098,
        dealStage: "sold",
        carrierName: "Evanston Insurance Company",
        wholesalerName: "R T Connector",
        premiumCents: 237500,
        policyNumber: null,
        isInstantQuote: true,
        isBound: false,
        boundAt: null,
        effectiveDate: null,
        expirationDate: null,
      },
    ],
  },
};

const html = renderToStaticMarkup(
  <RichOrderCard
    order={order}
    accountId="co-123"
    accountName="Example Account"
    canEditOrders={false}
    bigBrotherBaseUrl="https://bigbrother.harperinsure.com"
    todayDay="2026-08-16"
  />,
);

const expected = [
  "Order #13061",
  "Financed",
  "IQ",
  "Pending",
  "order-status-pending",
  // createdAt is 2026-08-14 15:47 PT, so two complete PT calendar days.
  "2 Days",
  "$856.25",
  "Revenue",
  "1 document",
  "1 policy",
  "Evanston Insurance Company",
  "R T Connector",
  "$2,375.00",
  "+$356.25",
  "Bind Policy",
  "order-bind-button",
  "Add note for service team",
];

let failed = 0;
for (const text of expected) {
  if (html.includes(text)) console.log(`PASS  rich card renders ${text}`);
  else {
    failed += 1;
    console.error(`FAIL  rich card missing ${text}`);
  }
}
if (!html.includes("payment_details") && !html.includes("last_four")) {
  console.log("PASS  raw payment instrument data is absent");
} else {
  failed += 1;
  console.error("FAIL  raw payment instrument data leaked");
}

process.exit(failed ? 1 : 0);
