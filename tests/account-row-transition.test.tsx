import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountRow } from "@/app/all-accounts/AllAccountsList";
import {
  ACCOUNT_ROW_COLLAPSE_MS,
  ACCOUNT_ROW_EXPAND_MS,
  accountRowPanelActive,
  accountRowPanelMounted,
  accountRowPhaseDurationMs,
  accountRowPreviewsActive,
  accountRowPreviewsMounted,
  isAccountRowOpen,
  nextAccountRowPhase,
  settledAccountRowPhase,
  type AccountRowPhase,
} from "@/app/all-accounts/use-account-row-transition";
import type { BookAccountListItem, BookOrderListItem } from "@/lib/db";

const PHASES: AccountRowPhase[] = [
  "collapsed",
  "expanding",
  "expanded",
  "collapsing",
];

function order(
  patch: Partial<BookOrderListItem> & {
    note?: BookOrderListItem["rich"]["serviceNote"];
    producerNote?: string | null;
    producerNoteUpdatedAt?: string | null;
    producerNoteUpdatedByName?: string | null;
  } = {},
): BookOrderListItem {
  const {
    note = {
      id: "4658",
      body: "Out for signature",
      author: "Ether Hammemi",
      createdAt: "2026-08-15T04:00:49.170Z",
      noteCount: 1,
    },
    producerNote = "Client wants monthly pay plan",
    producerNoteUpdatedAt = "2026-08-14T04:00:00.000Z",
    producerNoteUpdatedByName = "Robert Kijak",
    ...rest
  } = patch;
  return {
    id: "order-1",
    harperOrderId: 12909,
    label: "Order #12909",
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

function account(
  patch: Partial<BookAccountListItem> = {},
): BookAccountListItem {
  return {
    id: "co-1",
    name: "Bright Adventures LLC",
    dba: null,
    state: "CA",
    orderCount: 1,
    orders: [order()],
    hasServiceNotes: true,
    ...patch,
  };
}

function renderRow(open: boolean, patch: Partial<BookAccountListItem> = {}) {
  return renderToStaticMarkup(
    <ul>
      <AccountRow
        account={account(patch)}
        canEditOrders={false}
        bigBrotherBaseUrl=""
        todayDay="2026-08-15"
        expanded={open}
      />
    </ul>,
  );
}

describe("account row phase machine", () => {
  it("routes every toggle through a single transitional phase", () => {
    expect(nextAccountRowPhase("collapsed", true, true)).toBe("expanding");
    expect(nextAccountRowPhase("expanding", false, true)).toBe("collapsing");
    expect(nextAccountRowPhase("expanded", false, true)).toBe("collapsing");
    expect(nextAccountRowPhase("collapsing", true, true)).toBe("expanding");
  });

  it("stays put rather than replaying a transition already at its target", () => {
    expect(nextAccountRowPhase("expanded", true, true)).toBe("expanded");
    expect(nextAccountRowPhase("collapsed", false, true)).toBe("collapsed");
    expect(nextAccountRowPhase("expanding", true, true)).toBe("expanding");
    expect(nextAccountRowPhase("collapsing", false, true)).toBe("collapsing");
  });

  it("jumps straight to the resting phase for reduced motion", () => {
    for (const phase of PHASES) {
      expect(nextAccountRowPhase(phase, true, false)).toBe("expanded");
      expect(nextAccountRowPhase(phase, false, false)).toBe("collapsed");
    }
  });

  it("settles each transitional phase onto its resting phase", () => {
    expect(settledAccountRowPhase("expanding")).toBe("expanded");
    expect(settledAccountRowPhase("collapsing")).toBe("collapsed");
    expect(settledAccountRowPhase("expanded")).toBe("expanded");
    expect(settledAccountRowPhase("collapsed")).toBe("collapsed");
  });

  it("only holds a timer for phases that are actually animating", () => {
    expect(accountRowPhaseDurationMs("expanding")).toBe(ACCOUNT_ROW_EXPAND_MS);
    expect(accountRowPhaseDurationMs("collapsing")).toBe(
      ACCOUNT_ROW_COLLAPSE_MS,
    );
    expect(accountRowPhaseDurationMs("expanded")).toBe(0);
    expect(accountRowPhaseDurationMs("collapsed")).toBe(0);
  });

  it("never exposes the outside previews and the inside cards at once", () => {
    for (const phase of PHASES) {
      expect(
        accountRowPreviewsActive(phase) && accountRowPanelActive(phase),
      ).toBe(false);
    }
  });

  it("unmounts whichever note surface does not belong to a resting phase", () => {
    expect(accountRowPreviewsMounted("collapsed")).toBe(true);
    expect(accountRowPanelMounted("collapsed")).toBe(false);
    expect(accountRowPreviewsMounted("expanded")).toBe(false);
    expect(accountRowPanelMounted("expanded")).toBe(true);
  });

  it("keeps exiting content mounted so it can animate out", () => {
    expect(accountRowPreviewsMounted("expanding")).toBe(true);
    expect(accountRowPreviewsActive("expanding")).toBe(false);
    expect(accountRowPanelMounted("collapsing")).toBe(true);
    expect(accountRowPanelActive("collapsing")).toBe(false);
  });

  it("reports the chevron state from the same phase the content uses", () => {
    expect(isAccountRowOpen("expanding")).toBe(true);
    expect(isAccountRowOpen("expanded")).toBe(true);
    expect(isAccountRowOpen("collapsing")).toBe(false);
    expect(isAccountRowOpen("collapsed")).toBe(false);
  });
});

describe("account row note surfaces", () => {
  it("shows only the compact outside previews while collapsed", () => {
    const html = renderRow(false);

    expect(html).toContain("Out for signature");
    expect(html).toContain("Client wants monthly pay plan");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("account-list-row--collapsed");
    expect(html).not.toContain("Order note threads");
    expect(html).not.toContain("account-orders-panel");
  });

  it("shows only the internal overview cards once expanded", () => {
    const html = renderRow(true);

    expect(html).toContain("account-list-row--expanded");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Producer Notes");
    expect(html).toContain("Service Notes");
    // The compact outside previews are gone once expanded…
    expect(html).not.toContain("note-preview");
    // …the account-scoped Service thread still needs its live fetch…
    expect(html).not.toContain("Out for signature");
    // …but the Producer card renders its snapshot-seeded note immediately
    // inside the note-thread card instead of a loading skeleton, so what the
    // collapsed preview showed never disappears on expand.
    expect(html).toContain("note-thread-card");
    expect(html).toContain("Client wants monthly pay plan");
  });

  it("keeps the emptied preview slot out of the accessibility tree", () => {
    const expanded = renderRow(true);
    expect(expanded).toMatch(
      /class="account-note-slot-inner"[^>]*aria-hidden="true"[^>]*inert/,
    );

    const collapsed = renderRow(false);
    expect(collapsed).not.toMatch(
      /class="account-note-slot-inner"[^>]*aria-hidden/,
    );
    expect(collapsed).not.toMatch(/class="account-note-slot-inner"[^>]*inert/);
  });

  it("points the toggle at a region that exists in both states", () => {
    for (const html of [renderRow(false), renderRow(true)]) {
      const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
      expect(controls).toBeTruthy();
      expect(html).toContain(`id="${controls}" class="account-orders-shell"`);
    }
  });

  it("reserves no preview space for an account with no notes", () => {
    const html = renderRow(false, {
      orders: [
        order({
          note: null,
          producerNote: null,
          producerNoteUpdatedAt: null,
          producerNoteUpdatedByName: null,
        }),
      ],
    });

    expect(html).toContain("No service or producer note");
    expect(html.match(/note-preview--empty/g)).toHaveLength(1);
    expect(html).not.toContain("note-preview--service");
    expect(html).not.toContain("note-preview--producer");
  });

  it("animates only the book an account actually has", () => {
    const serviceOnly = renderRow(false, {
      orders: [
        order({
          producerNote: null,
          producerNoteUpdatedAt: null,
          producerNoteUpdatedByName: null,
        }),
      ],
    });
    expect(serviceOnly).toContain("note-preview--service");
    expect(serviceOnly).not.toContain("note-preview--producer");

    const producerOnly = renderRow(false, { orders: [order({ note: null })] });
    expect(producerOnly).toContain("note-preview--producer");
    expect(producerOnly).not.toContain("note-preview--service");
  });

  it("gives an account with no orders no toggle target at all", () => {
    const html = renderRow(false, { orderCount: 0, orders: [] });

    expect(html).toContain("disabled");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("aria-controls");
    expect(html).not.toContain("account-orders-shell");
  });
});
