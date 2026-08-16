import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountNotePreviews } from "@/app/all-accounts/AccountNotePreviews";
import type { BookOrderListItem } from "@/lib/db";
import {
  pickLatestServiceNote,
  serviceNotePreviewBody,
} from "@/lib/service-note";
import {
  pickLatestProducerNote,
  producerNotePreviewBody,
} from "@/lib/producer-note";

function order(
  patch: Partial<BookOrderListItem> & {
    note?: BookOrderListItem["rich"]["serviceNote"];
    producerNote?: string | null;
    producerNoteUpdatedAt?: string | null;
    producerNoteUpdatedByName?: string | null;
  } = {},
): BookOrderListItem {
  const {
    note = null,
    producerNote = null,
    producerNoteUpdatedAt = null,
    producerNoteUpdatedByName = null,
    ...rest
  } = patch;
  return {
    id: "order-1",
    harperOrderId: 1,
    label: "Order #1",
    createdAt: "2026-08-14T20:00:00.000Z",
    orderedAt: "2026-08-14T20:00:00.000Z",
    eventAt: "2026-08-14T20:00:00.000Z",
    bindStatus: "pending",
    revenueCents: 68000,
    revenueMicros: 680_000_000,
    policyNumbers: [],
    inconsistency: null,
    source: "iq",
    iqStageTag: null,
    brokerGate: null,
    brokerGateAt: null,
    rich: {
      deals: [],
      paymentType: null,
      pfaQuoteNumber: null,
      initialPaymentAt: null,
      documentCount: 0,
      policyCount: 0,
      totalPremiumCents: null,
      taxesCents: null,
      feesCents: null,
      totalCostCents: null,
      commissionRevenueCents: null,
      harperServiceFeeCents: null,
      taxes: [],
      fees: [],
      producerNote,
      producerNoteUpdatedAt,
      producerNoteUpdatedByName,
      serviceNote: note,
    },
    ...rest,
  };
}

describe("pickLatestServiceNote", () => {
  it("returns null when no displayed order has a visible note", () => {
    expect(pickLatestServiceNote([order(), order({ id: "order-2", harperOrderId: 2 })])).toBeNull();
  });

  it("picks the newest note across orders and counts earlier entries", () => {
    const latest = pickLatestServiceNote([
      order({
        id: "order-old",
        harperOrderId: 100,
        note: {
          id: "10",
          body: "Older note",
          author: "Ada",
          createdAt: "2026-08-14T12:00:00.000Z",
          noteCount: 2,
        },
      }),
      order({
        id: "order-new",
        harperOrderId: 12909,
        note: {
          id: "4658",
          body: "Out for signature",
          author: "Ether Hammemi",
          createdAt: "2026-08-15T04:00:49.170Z",
          noteCount: 1,
        },
      }),
    ]);
    expect(latest).toEqual({
      id: "4658",
      body: "Out for signature",
      author: "Ether Hammemi",
      createdAt: "2026-08-15T04:00:49.170Z",
      orderId: 12909,
      earlierCount: 2,
    });
  });

  it("breaks timestamp ties with the higher note id", () => {
    const latest = pickLatestServiceNote([
      order({
        harperOrderId: 1,
        note: {
          id: "100",
          body: "First",
          author: "A",
          createdAt: "2026-08-15T04:00:00.000Z",
          noteCount: 1,
        },
      }),
      order({
        id: "order-2",
        harperOrderId: 2,
        note: {
          id: "101",
          body: "Second",
          author: "B",
          createdAt: "2026-08-15T04:00:00.000Z",
          noteCount: 1,
        },
      }),
    ]);
    expect(latest?.id).toBe("101");
    expect(latest?.orderId).toBe(2);
  });
});

describe("pickLatestProducerNote", () => {
  it("returns null when no displayed order carries a producer note", () => {
    expect(pickLatestProducerNote([order(), order({ producerNote: "   " })])).toBeNull();
  });

  it("picks the newest stamped note and counts the other orders", () => {
    const latest = pickLatestProducerNote([
      order({
        harperOrderId: 11311,
        producerNote: "Endorsement -",
        producerNoteUpdatedAt: "2026-08-10T18:00:00.000Z",
        producerNoteUpdatedByName: "Robert Kijak",
      }),
      order({
        id: "order-2",
        harperOrderId: 11312,
        producerNote: "Waiting on payroll figures",
        producerNoteUpdatedAt: "2026-08-13T18:00:00.000Z",
        producerNoteUpdatedByName: "Dana K.",
      }),
    ]);
    expect(latest).toEqual({
      body: "Waiting on payroll figures",
      author: "Dana K.",
      updatedAt: "2026-08-13T18:00:00.000Z",
      orderId: 11312,
      earlierCount: 1,
    });
  });

  it("never ranks an unstamped note ahead of a dated one", () => {
    const latest = pickLatestProducerNote([
      order({ harperOrderId: 9, producerNote: "No timestamp" }),
      order({
        id: "order-2",
        harperOrderId: 2,
        producerNote: "Dated",
        producerNoteUpdatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ]);
    expect(latest?.body).toBe("Dated");
    expect(latest?.author).toBeNull();
  });
});

describe("note preview bodies", () => {
  it("collapses whitespace and labels empty bodies per book", () => {
    expect(serviceNotePreviewBody("  Out   for\nsignature  ")).toBe(
      "Out for signature",
    );
    expect(serviceNotePreviewBody("   ")).toBe("Empty service note");
    expect(producerNotePreviewBody(" Endorsement  - ")).toBe("Endorsement -");
    expect(producerNotePreviewBody("\n")).toBe("Empty producer note");
  });
});

describe("AccountNotePreviews", () => {
  it("renders Habibi-shaped service note metadata without fabricating content", () => {
    const html = renderToStaticMarkup(
      <AccountNotePreviews
        orders={[
          order({
            harperOrderId: 12909,
            note: {
              id: "4658",
              body: "Out for signature",
              author: "Ether Hammemi",
              createdAt: "2026-08-15T04:00:49.170Z",
              noteCount: 1,
            },
          }),
        ]}
      />,
    );
    expect(html).toContain("Service Note");
    expect(html).toContain("Out for signature");
    expect(html).toContain("Ether Hammemi");
    expect(html).toContain("Order #12909");
    expect(html).not.toContain("Producer Note");
  });

  it("shows both books side by side and compacts each body", () => {
    const html = renderToStaticMarkup(
      <AccountNotePreviews
        orders={[
          order({
            harperOrderId: 11311,
            note: {
              id: "500",
              body: "Followed up with the Docusign team",
              author: "Ether Hammemi",
              createdAt: "2026-08-05T04:00:00.000Z",
              noteCount: 3,
            },
            producerNote: "Endorsement -",
            producerNoteUpdatedAt: "2026-08-12T04:00:00.000Z",
            producerNoteUpdatedByName: "Robert Kijak",
          }),
        ]}
      />,
    );
    expect(html).toContain("Service Note");
    expect(html).toContain("Producer Note");
    expect(html).toContain("Followed up with the Docusign team");
    expect(html).toContain("Endorsement -");
    expect(html).toContain("Robert Kijak");
    expect(html).toContain("+2 earlier");
    expect(html.match(/note-preview--compact/g)).toHaveLength(2);
  });

  it("shows a producer note even when the account has no service note", () => {
    const html = renderToStaticMarkup(
      <AccountNotePreviews
        orders={[
          order({
            harperOrderId: 777,
            producerNote: "Client wants monthly pay plan",
            producerNoteUpdatedAt: "2026-08-14T04:00:00.000Z",
            producerNoteUpdatedByName: "Robert Kijak",
          }),
        ]}
      />,
    );
    expect(html).toContain("Producer Note");
    expect(html).toContain("Client wants monthly pay plan");
    expect(html).toContain("Order #777");
    expect(html).not.toContain("note-preview--compact");
  });

  it("shows one quiet empty state when neither book has a note", () => {
    const html = renderToStaticMarkup(
      <AccountNotePreviews orders={[order()]} />,
    );
    expect(html).toContain("No service or producer note");
    expect(html.match(/note-preview--empty/g)).toHaveLength(1);
  });
});
