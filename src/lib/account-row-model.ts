import { brokerGateView } from "./broker-gate";
import { iqStageFromTag } from "./iq-stage";
import { dealAgeDays, dealAgeNeedsAttention } from "./order-age";
import type { OrderSource } from "./account-source";
import type { BookOrderBindStatus } from "./supabase-book.server";
import type { BookOrderListItem } from "./db";

/**
 * What a collapsed account row claims, derived in one place.
 *
 * The orders handed in are the ones the current view already resolved — the
 * account query attaches only the orders that survived the lifecycle mode,
 * range, source and IQ-Stage/Broker-Gate filters. So every count and every
 * metadata value here is scoped to what the operator is actually looking at,
 * and a Pending Orders row can never quote a bound order's carrier.
 */

export type AccountRowState = BookOrderBindStatus | "mixed";

export const ACCOUNT_STATE_LABELS: Record<AccountRowState, string> = {
  pending: "Pending",
  bound: "Bound",
  lost: "Lost",
  mixed: "Mixed",
};

/**
 * Which order speaks for the account.
 *
 * There is no product-level "primary order" in Harper, so this is the
 * documented fallback the brief calls for: newest pending, else newest bound,
 * else newest lost. Pending wins because it is the only actionable state, and
 * it is what makes the age on the metadata line meaningful.
 */
const STATE_PREFERENCE: readonly BookOrderBindStatus[] = [
  "pending",
  "bound",
  "lost",
];

/**
 * Newest by `orders_temp.created_at` — the same column the age is measured
 * from, so stage, age, carrier and the age tooltip all describe one order.
 * An undated order never outranks a dated one; order id breaks exact ties.
 */
function compareNewestFirst(
  a: BookOrderListItem,
  b: BookOrderListItem,
): number {
  const at = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
  const bt = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;
  const av = Number.isNaN(at) ? null : at;
  const bv = Number.isNaN(bt) ? null : bt;
  if (av !== null && bv !== null && av !== bv) return bv - av;
  if ((av === null) !== (bv === null)) return av === null ? 1 : -1;
  return b.harperOrderId - a.harperOrderId;
}

export function pickRepresentativeOrder(
  orders: readonly BookOrderListItem[],
): BookOrderListItem | null {
  for (const state of STATE_PREFERENCE) {
    const bucket = orders.filter((order) => order.bindStatus === state);
    if (bucket.length > 0) return [...bucket].sort(compareNewestFirst)[0]!;
  }
  return null;
}

export function countOrderStates(
  orders: readonly BookOrderListItem[],
): Record<BookOrderBindStatus, number> {
  const counts: Record<BookOrderBindStatus, number> = {
    pending: 0,
    bound: 0,
    lost: 0,
  };
  for (const order of orders) counts[order.bindStatus] += 1;
  return counts;
}

export function accountRowState(
  counts: Record<BookOrderBindStatus, number>,
): AccountRowState {
  const present = STATE_PREFERENCE.filter((state) => counts[state] > 0);
  if (present.length === 1) return present[0]!;
  return "mixed";
}

/**
 * "2 Pending orders" for a single state, or "3 orders · 2 Bound · 1 Pending"
 * for a mixed account — the total leads so the row answers "how much work"
 * before it answers "in what states".
 *
 * Breakdown segments run in descending count so the dominant state comes
 * first, with the canonical pending/bound/lost order breaking ties.
 */
export function accountCountLabel(
  counts: Record<BookOrderBindStatus, number>,
): string {
  const segments = STATE_PREFERENCE.filter((state) => counts[state] > 0)
    .sort((a, b) => counts[b] - counts[a])
    .map((state) => ({ state, n: counts[state] }));
  if (segments.length === 0) return "No orders";

  if (segments.length === 1) {
    const only = segments[0]!;
    return `${only.n.toLocaleString()} ${ACCOUNT_STATE_LABELS[only.state]} ${
      only.n === 1 ? "order" : "orders"
    }`;
  }

  const total = segments.reduce((sum, segment) => sum + segment.n, 0);
  return [
    `${total.toLocaleString()} ${total === 1 ? "order" : "orders"}`,
    ...segments.map(
      ({ state, n }) => `${n.toLocaleString()} ${ACCOUNT_STATE_LABELS[state]}`,
    ),
  ].join(" · ");
}

export interface AccountStageView {
  kind: "iq" | "broker";
  prefix: string;
  /** Gate code (`G4`) on Broker orders, so it can carry the Broker identity. */
  code: string | null;
  value: string;
  set: boolean;
}

/** Flat text of a stage, for tooltips and accessible names. */
export function stageText(stage: AccountStageView): string {
  return stage.code ? `${stage.code} — ${stage.value}` : stage.value;
}

/**
 * The stage the representative order is actually sitting on.
 *
 * Strictly source-scoped, matching how the filters partition the book: an IQ
 * order can only show an IQ Stage and a Broker order can only show a Gate. A
 * mixed-deal or unclassified order gets no stage line at all rather than a
 * guess — 78% of live orders carry no `orders_temp.tag`, so an invented stage
 * would be the most common value on the page.
 */
export function accountStageView(
  order: BookOrderListItem | null,
): AccountStageView | null {
  if (!order) return null;
  if (order.source === "iq") {
    const stage = iqStageFromTag(order.iqStageTag);
    return {
      kind: "iq",
      // The source is already named on the metadata line directly below, so the
      // prefix does not repeat it.
      prefix: "Stage",
      code: null,
      value: stage.declared ? stage.label : "Not set",
      set: stage.declared,
    };
  }
  if (order.source === "broker") {
    const gate = brokerGateView(order.brokerGate, order.brokerGateAt);
    return {
      kind: "broker",
      prefix: "Gate",
      code: gate?.gate ?? null,
      value: gate ? gate.label : "Not set",
      set: Boolean(gate),
    };
  }
  return null;
}

export interface AccountRowModel {
  state: AccountRowState;
  counts: Record<BookOrderBindStatus, number>;
  countLabel: string;
  representative: BookOrderListItem | null;
  stage: AccountStageView | null;
  /** Source of the representative order, which is what the stage describes. */
  source: OrderSource | null;
  /** Pending-work signal only; null on bound and lost rows by design. */
  ageDays: number | null;
  ageAttention: boolean;
  /** Carriers on the representative order, so they match its stage. */
  carrierNames: string[];
  /**
   * Sum across every displayed order, not the representative's alone. This is
   * the established meaning of the row's revenue figure and is deliberately
   * left aggregate; null when any displayed order is missing a value, so a
   * partial total is never presented as complete.
   */
  revenueMicros: number | null;
  orderCount: number;
}

export function buildAccountRowModel(
  orders: readonly BookOrderListItem[],
  todayDay: string,
): AccountRowModel {
  const counts = countOrderStates(orders);
  const representative = pickRepresentativeOrder(orders);

  let revenueMicros: number | null = 0;
  for (const order of orders) {
    if (order.revenueMicros === null) {
      revenueMicros = null;
      break;
    }
    revenueMicros += order.revenueMicros;
  }
  if (revenueMicros !== null && !Number.isSafeInteger(revenueMicros)) {
    revenueMicros = null;
  }

  // Age is a pending-work signal. A bound or lost row renders no age at all
  // rather than an empty slot, so nothing dangles between the dividers.
  const pending = representative?.bindStatus === "pending";
  const ageDays = pending
    ? dealAgeDays(representative?.createdAt ?? null, todayDay)
    : null;

  const carrierNames = [
    ...new Set(
      (representative?.rich.deals ?? [])
        .map((deal) => deal.carrierName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    state: accountRowState(counts),
    counts,
    countLabel: accountCountLabel(counts),
    representative,
    stage: accountStageView(representative),
    source: representative?.source ?? null,
    ageDays,
    ageAttention: ageDays !== null && dealAgeNeedsAttention(ageDays),
    carrierNames,
    revenueMicros,
    orderCount: orders.length,
  };
}
