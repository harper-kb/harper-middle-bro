/**
 * The collapsed account row as an operator reads it: name and state, then the
 * stage it is sitting on, then the metadata line.
 *
 * These assert the rendered contract. The rules behind the values live in
 * tests/account-row-model.test.ts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountRow } from "@/app/all-accounts/AllAccountsList";
import type { BookAccountListItem, BookOrderListItem } from "@/lib/db";

const TODAY = "2026-08-15";

function order(
  patch: Partial<BookOrderListItem> & { carrierNames?: (string | null)[] } = {},
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
    revenueCents: 125000,
    revenueMicros: 1_250_000_000,
    policyNumbers: [],
    inconsistency: null,
    source: "iq",
    iqStageTag: "bind_requested",
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

function row(
  orders: BookOrderListItem[],
  patch: Partial<BookAccountListItem> = {},
) {
  const account: BookAccountListItem = {
    id: "co-1",
    name: "Acme Services LLC",
    dba: null,
    state: "CA",
    orderCount: orders.length,
    orders,
    hasServiceNotes: false,
    ...patch,
  };
  return renderToStaticMarkup(
    <ul>
      <AccountRow
        account={account}
        canEditOrders={false}
        bigBrotherBaseUrl=""
        todayDay={TODAY}
      />
    </ul>,
  );
}

describe("primary line", () => {
  it("carries the name, the state badge and the place", () => {
    const html = row([order()]);
    expect(html).toContain("Acme Services LLC");
    expect(html).toContain("account-state-badge--pending");
    expect(html).toContain(">Pending<");
    expect(html).toContain("CA");
  });

  it("no longer repeats the order count beside the name", () => {
    const html = row([order(), order({ id: "o2", harperOrderId: 2 })]);
    // Scope to the primary line; "2 orders" still appears in metadata tooltips.
    const primary = html.slice(
      html.indexOf("account-list-row-main"),
      html.indexOf("account-stage-line"),
    );
    expect(primary).not.toMatch(/\d+ orders?</);
    // The count now lives on the stage line instead.
    expect(html).toContain("2 Pending orders");
  });

  it("keeps a DBA visible without crowding the state", () => {
    const html = row([order()], { dba: "Fenix Lounge" });
    expect(html).toContain("DBA Fenix Lounge");
    expect(html).toContain('title="Fenix Lounge"');
  });
});

/** Just the stage/count line, so prefix assertions cannot match elsewhere. */
function stageLine(html: string): string {
  const start = html.indexOf('class="account-stage-line"');
  return html.slice(start, html.indexOf("</p>", start));
}

describe("stage line", () => {
  it("shows the IQ stage and the matching count", () => {
    const html = row([order()]);
    // The prefix does not repeat the source; the metadata line names it.
    expect(stageLine(html)).toContain("Stage:");
    expect(stageLine(html)).not.toContain("Gate");
    expect(html).toContain("Bind requested");
    expect(html).toContain("1 Pending order");
  });

  it("shows the Broker Gate and never an IQ stage", () => {
    const html = row([
      order({ source: "broker", iqStageTag: null, brokerGate: "G4" }),
    ]);
    expect(stageLine(html)).toContain("Gate:");
    expect(stageLine(html)).not.toContain("Stage");
    expect(html).toContain("account-stage-code");
    expect(html).toContain(">G4<");
    expect(html).toContain("Awaiting Binder");
  });

  it("marks a missing stage plainly instead of inventing one", () => {
    const html = row([order({ iqStageTag: null })]);
    expect(stageLine(html)).toContain("Stage:");
    expect(html).toContain("Not set");
    expect(html).toContain("account-stage-value--unset");
  });
});

describe("source identity", () => {
  it("keeps IQ blue and Broker purple on the metadata line", () => {
    expect(row([order()])).toContain("account-summary-item--iq");
    const broker = row([
      order({ source: "broker", iqStageTag: null, brokerGate: "G4" }),
    ]);
    expect(broker).toContain("account-summary-item--broker");
    expect(broker).toContain(">Broker<");
  });
});

describe("pending age", () => {
  it("shows the age and carrier and revenue on a pending row", () => {
    const html = row([order()]);
    expect(html).toContain("1 Day ago");
    expect(html).toContain("Evanston Insurance Company");
    expect(html).toContain("$1,250.00");
  });

  it("escalates a pending row past five days", () => {
    const html = row([order({ createdAt: "2026-08-09T20:00:00.000Z" })]);
    expect(html).toContain("6 Days ago");
    expect(html).toContain("account-summary-item--attention");
  });

  it("renders no age element at all on a bound row", () => {
    const html = row([order({ bindStatus: "bound" })]);
    expect(html).toContain("account-state-badge--bound");
    expect(html).not.toMatch(/\d+ Days? ago/);
    expect(html).not.toContain("Age unavailable");
    // Three metadata items remain: source, carrier, revenue — no orphan slot.
    expect(html.match(/class="account-summary-item/g)).toHaveLength(3);
  });

  it("renders no age element at all on a lost row", () => {
    const html = row([order({ bindStatus: "lost" })]);
    expect(html).toContain("account-state-badge--lost");
    expect(html).not.toMatch(/\d+ Days? ago/);
    expect(html.match(/class="account-summary-item/g)).toHaveLength(3);
  });
});

describe("mixed-status account", () => {
  const mixed = () =>
    row([
      order({
        id: "b1",
        harperOrderId: 11,
        bindStatus: "bound",
        iqStageTag: "binder_received",
        carrierNames: ["CNA"],
      }),
      order({
        id: "b2",
        harperOrderId: 12,
        bindStatus: "bound",
        carrierNames: ["CNA"],
      }),
      order({
        id: "p1",
        harperOrderId: 13,
        bindStatus: "pending",
        iqStageTag: "awaiting_binder",
        createdAt: "2026-08-13T20:00:00.000Z",
        carrierNames: ["Kinsale Insurance Company"],
      }),
    ]);

  it("refuses to collapse several states into one", () => {
    const html = mixed();
    expect(html).toContain("account-state-badge--mixed");
    expect(html).toContain(">Mixed<");
    expect(html).not.toContain("account-state-badge--bound");
  });

  it("summarises the counts on the stage line", () => {
    expect(mixed()).toContain("3 orders · 2 Bound · 1 Pending");
  });

  it("takes stage, age and carrier from the one representative order", () => {
    const html = mixed();
    expect(html).toContain("Awaiting binder");
    expect(html).toContain("2 Days ago");
    expect(html).toContain("Kinsale Insurance Company");
    expect(html).not.toContain("Binder received");
    expect(html).not.toContain(">CNA<");
  });
});

describe("row still works as a row", () => {
  it("keeps the note preview, the toggle and its ARIA intact", () => {
    const html = row([order()]);
    expect(html).toContain("note-preview");
    expect(html).toContain("account-expand-button");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("account-list-row--collapsed");
  });

  it("keeps the account name a link to the company", () => {
    expect(row([order()])).toContain('href="/accounts/co-1"');
  });
});
