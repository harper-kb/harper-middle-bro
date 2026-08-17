/**
 * What a collapsed account row is allowed to claim.
 *
 * The rules that matter are the honest ones: age is a pending-work signal and
 * must vanish on bound and lost rows; a stage may never cross the IQ/Broker
 * line; a mixed account may not be collapsed into a single state; and the
 * stage, age and carrier must all describe the same order.
 */
import { describe, expect, it } from "vitest";
import {
  accountCountLabel,
  accountRowState,
  accountStageView,
  buildAccountRowModel,
  countOrderStates,
  pickRepresentativeOrder,
  stageText,
} from "@/lib/account-row-model";
import type { BookOrderListItem } from "@/lib/db";
import type { BookOrderBindStatus } from "@/lib/supabase-book.server";

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
    revenueCents: 40060,
    revenueMicros: 400_600_000,
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

const broker = (patch: Partial<BookOrderListItem> = {}) =>
  order({
    source: "broker",
    iqStageTag: null,
    brokerGate: "G4",
    brokerGateAt: "2026-08-14T20:00:00.000Z",
    ...patch,
  });

function counts(
  pending: number,
  bound: number,
  lost: number,
): Record<BookOrderBindStatus, number> {
  return { pending, bound, lost };
}

describe("account state", () => {
  it("reports the single state when every displayed order agrees", () => {
    expect(accountRowState(counts(2, 0, 0))).toBe("pending");
    expect(accountRowState(counts(0, 3, 0))).toBe("bound");
    expect(accountRowState(counts(0, 0, 1))).toBe("lost");
  });

  it("never collapses several states into one", () => {
    expect(accountRowState(counts(1, 2, 0))).toBe("mixed");
    expect(accountRowState(counts(1, 1, 1))).toBe("mixed");
  });

  it("counts the displayed orders by state", () => {
    expect(
      countOrderStates([
        order({ bindStatus: "pending" }),
        order({ id: "b", harperOrderId: 2, bindStatus: "bound" }),
        order({ id: "c", harperOrderId: 3, bindStatus: "bound" }),
      ]),
    ).toEqual(counts(1, 2, 0));
  });
});

describe("order-count wording", () => {
  it("uses singular for one order and plural beyond", () => {
    expect(accountCountLabel(counts(1, 0, 0))).toBe("1 Pending order");
    expect(accountCountLabel(counts(2, 0, 0))).toBe("2 Pending orders");
    expect(accountCountLabel(counts(0, 1, 0))).toBe("1 Bound order");
    expect(accountCountLabel(counts(0, 0, 4))).toBe("4 Lost orders");
  });

  it("leads a mixed account with the total, then the dominant state", () => {
    expect(accountCountLabel(counts(1, 2, 0))).toBe(
      "3 orders · 2 Bound · 1 Pending",
    );
    expect(accountCountLabel(counts(2, 2, 0))).toBe(
      "4 orders · 2 Pending · 2 Bound",
    );
    expect(accountCountLabel(counts(1, 3, 2))).toBe(
      "6 orders · 3 Bound · 2 Lost · 1 Pending",
    );
  });
});

describe("representative order", () => {
  it("prefers pending, then bound, then lost", () => {
    const pending = order({ id: "p", harperOrderId: 9, bindStatus: "pending" });
    const bound = order({ id: "b", harperOrderId: 8, bindStatus: "bound" });
    const lost = order({ id: "l", harperOrderId: 7, bindStatus: "lost" });
    expect(pickRepresentativeOrder([lost, bound, pending])?.id).toBe("p");
    expect(pickRepresentativeOrder([lost, bound])?.id).toBe("b");
    expect(pickRepresentativeOrder([lost])?.id).toBe("l");
    expect(pickRepresentativeOrder([])).toBeNull();
  });

  it("takes the newest inside the preferred state", () => {
    const older = order({
      id: "old",
      harperOrderId: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const newer = order({
      id: "new",
      harperOrderId: 2,
      createdAt: "2026-08-12T00:00:00.000Z",
    });
    expect(pickRepresentativeOrder([older, newer])?.id).toBe("new");
  });

  it("never lets an undated order outrank a dated one", () => {
    const dated = order({ id: "dated", harperOrderId: 1 });
    const undated = order({ id: "undated", harperOrderId: 99, createdAt: null });
    expect(pickRepresentativeOrder([undated, dated])?.id).toBe("dated");
  });

  it("keeps stage, age and carrier describing that same order", () => {
    const model = buildAccountRowModel(
      [
        order({
          id: "bound-one",
          harperOrderId: 5,
          bindStatus: "bound",
          iqStageTag: "binder_received",
          carrierNames: ["CNA"],
        }),
        order({
          id: "pending-one",
          harperOrderId: 6,
          bindStatus: "pending",
          iqStageTag: "awaiting_binder",
          createdAt: "2026-08-13T20:00:00.000Z",
          carrierNames: ["Kinsale Insurance Company"],
        }),
      ],
      TODAY,
    );

    expect(model.representative?.id).toBe("pending-one");
    expect(model.stage?.value).toBe("Awaiting binder");
    expect(model.carrierNames).toEqual(["Kinsale Insurance Company"]);
    expect(model.ageDays).toBe(2);
  });
});

describe("stage line", () => {
  it("shows the IQ stage for an IQ order", () => {
    const stage = accountStageView(order({ iqStageTag: "bind_requested" }));
    expect(stage).toEqual({
      kind: "iq",
      prefix: "Stage",
      code: null,
      value: "Bind requested",
      set: true,
    });
  });

  it("shows the gate code and label for a Broker order", () => {
    const stage = accountStageView(broker());
    expect(stage?.kind).toBe("broker");
    expect(stage?.prefix).toBe("Gate");
    // Code is separate so it can carry the Broker purple.
    expect(stage?.code).toBe("G4");
    expect(stage?.value).toBe("Awaiting Binder");
    expect(stageText(stage!)).toBe("G4 — Awaiting Binder");
  });

  it("never shows a gate on an IQ order or a stage on a Broker order", () => {
    expect(accountStageView(order({ brokerGate: "G4" }))?.kind).toBe("iq");
    expect(accountStageView(broker({ iqStageTag: "bind_requested" }))?.kind).toBe(
      "broker",
    );
  });

  it("says Not set rather than inventing a stage", () => {
    // 78% of live orders carry no orders_temp.tag, so this is the common case.
    expect(accountStageView(order({ iqStageTag: null }))).toMatchObject({
      value: "Not set",
      set: false,
    });
    expect(accountStageView(broker({ brokerGate: null }))).toMatchObject({
      value: "Not set",
      set: false,
    });
    expect(
      accountStageView(order({ iqStageTag: "something_unmapped" })),
    ).toMatchObject({ value: "Not set", set: false });
  });

  it("offers no stage at all when the source cannot carry one", () => {
    expect(accountStageView(order({ source: "mixed" }))).toBeNull();
    expect(accountStageView(order({ source: null }))).toBeNull();
    expect(accountStageView(null)).toBeNull();
  });
});

describe("pending age", () => {
  it("counts calendar days from the order's creation, in Harper time", () => {
    const at = (createdAt: string) =>
      buildAccountRowModel([order({ createdAt })], TODAY).ageDays;
    // Day boundaries are Pacific, not UTC: 02:00Z on the 15th is still the
    // 14th on the desk, and counts as a day old.
    expect(at("2026-08-15T18:00:00.000Z")).toBe(0);
    expect(at("2026-08-15T02:00:00.000Z")).toBe(1);
    expect(at("2026-08-14T20:00:00.000Z")).toBe(1);
    expect(at("2026-08-10T20:00:00.000Z")).toBe(5);
    expect(at("2026-08-09T20:00:00.000Z")).toBe(6);
  });

  it("escalates only past five days", () => {
    const attention = (createdAt: string) =>
      buildAccountRowModel([order({ createdAt })], TODAY).ageAttention;
    expect(attention("2026-08-10T20:00:00.000Z")).toBe(false);
    expect(attention("2026-08-09T20:00:00.000Z")).toBe(true);
  });

  it("is withheld entirely on bound and lost rows", () => {
    for (const bindStatus of ["bound", "lost"] as const) {
      const model = buildAccountRowModel([order({ bindStatus })], TODAY);
      expect(model.ageDays).toBeNull();
      expect(model.ageAttention).toBe(false);
    }
  });

  it("is withheld when the representative order is not pending", () => {
    const model = buildAccountRowModel(
      [
        order({ id: "b1", harperOrderId: 1, bindStatus: "bound" }),
        order({ id: "l1", harperOrderId: 2, bindStatus: "lost" }),
      ],
      TODAY,
    );
    expect(model.state).toBe("mixed");
    expect(model.ageDays).toBeNull();
  });
});

describe("revenue", () => {
  it("stays an aggregate across every displayed order", () => {
    // Deliberately not the representative order's revenue alone — this is the
    // row's established meaning and is preserved.
    const model = buildAccountRowModel(
      [
        order({ id: "a", harperOrderId: 1, revenueMicros: 400_600_000 }),
        order({ id: "b", harperOrderId: 2, revenueMicros: 99_400_000 }),
      ],
      TODAY,
    );
    expect(model.revenueMicros).toBe(500_000_000);
  });

  it("never presents a partial total as complete", () => {
    const model = buildAccountRowModel(
      [
        order({ id: "a", harperOrderId: 1, revenueMicros: 400_600_000 }),
        order({ id: "b", harperOrderId: 2, revenueMicros: null }),
      ],
      TODAY,
    );
    expect(model.revenueMicros).toBeNull();
  });
});

describe("whole-row model", () => {
  it("describes a pending IQ account end to end", () => {
    const model = buildAccountRowModel([order()], TODAY);
    expect(model.state).toBe("pending");
    expect(model.countLabel).toBe("1 Pending order");
    expect(model.stage?.value).toBe("Bind requested");
    expect(model.source).toBe("iq");
    expect(model.ageDays).toBe(1);
    expect(model.carrierNames).toEqual(["Evanston Insurance Company"]);
    expect(model.revenueMicros).toBe(400_600_000);
  });

  it("describes a bound Broker account end to end", () => {
    const model = buildAccountRowModel(
      [broker({ bindStatus: "bound", brokerGate: "G6" })],
      TODAY,
    );
    expect(model.state).toBe("bound");
    expect(model.countLabel).toBe("1 Bound order");
    expect(stageText(model.stage!)).toBe("G6 — Policy issued");
    expect(model.source).toBe("broker");
    expect(model.ageDays).toBeNull();
  });

  it("survives an account with no displayed orders", () => {
    const model = buildAccountRowModel([], TODAY);
    expect(model.state).toBe("mixed");
    expect(model.representative).toBeNull();
    expect(model.stage).toBeNull();
    expect(model.ageDays).toBeNull();
    expect(model.carrierNames).toEqual([]);
    expect(model.countLabel).toBe("No orders");
  });
});
