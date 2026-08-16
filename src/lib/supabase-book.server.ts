import fs from "fs";
import path from "path";
import type { PolicyFormSet } from "./forms";
import type { Account, Policy, Underwriter } from "./types";
import {
  classifyOrderSource,
  parseOrderSource,
  type OrderSource,
} from "./account-source";
import {
  parseBookOrderServiceNote,
  type BookOrderServiceNote,
} from "./service-note";

export type { BookOrderServiceNote } from "./service-note";

/**
 * Loader for the real-book overlay: a curated slice of actual Harper
 * companies/policies/orders exported from Supabase by the five-minute
 * refresher (`src/lib/db/book-refresh.ts`) into
 * `data/supabase-book.local.json` (gitignored).
 *
 * When the file exists, `syncAccountsAndPolicies` in db.ts upserts these
 * rows on boot instead of the fictional SEED_ACCOUNTS / SEED_POLICIES.
 * A clone without the file behaves exactly as before.
 */

/**
 * Order lifecycle derived from linked non-deleted `deals_v2` rows:
 * - `bound`: at least one deal with `deal_stage = 'bound'`.
 * - `pending`: no bound deal, but at least one actionable deal still moving
 *   toward bind (`deal_stage` in sold / confirmed / paid) — this matches
 *   BigBrother's "actively awaiting bind" pending-orders definition.
 * - `lost`: no bound or actionable deal, but at least one lost deal.
 * Orders with no deal in a recognized stage never enter the Step Bro book,
 * so every book order is exactly one of these three.
 */
export type BookOrderBindStatus = "bound" | "pending" | "lost";

export const BOOK_ORDER_BIND_STATUSES: readonly BookOrderBindStatus[] = [
  "bound",
  "pending",
  "lost",
];

export interface BookMoneyLine {
  name: string;
  amountCents: number | null;
}

export interface BookOrderDeal {
  dealId: number;
  dealStage: string | null;
  carrierName: string | null;
  wholesalerName: string | null;
  premiumCents: number | null;
  policyNumber: string | null;
  isInstantQuote: boolean;
  isBound: boolean;
  boundAt: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
}

/** Card-safe order data only. Raw payment instruments never enter the snapshot. */
export interface BookOrderRichData {
  paymentType: string | null;
  pfaQuoteNumber: string | null;
  initialPaymentAt: string | null;
  documentCount: number;
  policyCount: number;
  totalPremiumCents: number | null;
  taxesCents: number | null;
  feesCents: number | null;
  totalCostCents: number | null;
  commissionRevenueCents: number | null;
  harperServiceFeeCents: number | null;
  taxes: BookMoneyLine[];
  fees: BookMoneyLine[];
  producerNote: string | null;
  producerNoteUpdatedAt: string | null;
  /**
   * Author of the producer note, resolved from
   * `orders_temp.producer_notes_updated_by` → `internal_agents` by stable id.
   * Null when the directory cannot name them.
   */
  producerNoteUpdatedByName: string | null;
  /**
   * Latest visible Workbench Service Note on this order
   * (`public.service_note_entries`, `deleted_at IS NULL`). Distinct from
   * Producer Notes. Null when the order has no visible entry.
   */
  serviceNote: BookOrderServiceNote | null;
  deals: BookOrderDeal[];
}

export type BookReportingRangeId =
  | "this-week"
  | "last-week"
  | "last-30-days";

export function emptyBookOrderRich(
  policyCount = 0,
): BookOrderRichData {
  return {
    paymentType: null,
    pfaQuoteNumber: null,
    initialPaymentAt: null,
    documentCount: 0,
    policyCount,
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
    deals: [],
  };
}

/** Fill fields older snapshots omit so the card never reads undefined. */
export function normalizeBookOrderRich(
  rich: Partial<BookOrderRichData> | null | undefined,
  policyCount = 0,
): BookOrderRichData {
  const base = emptyBookOrderRich(policyCount);
  if (!rich || typeof rich !== "object") return base;
  return {
    ...base,
    ...rich,
    taxes: Array.isArray(rich.taxes) ? rich.taxes : base.taxes,
    fees: Array.isArray(rich.fees) ? rich.fees : base.fees,
    deals: Array.isArray(rich.deals) ? rich.deals : base.deals,
    producerNote:
      typeof rich.producerNote === "string" ? rich.producerNote : null,
    producerNoteUpdatedAt:
      typeof rich.producerNoteUpdatedAt === "string"
        ? rich.producerNoteUpdatedAt
        : null,
    producerNoteUpdatedByName:
      typeof rich.producerNoteUpdatedByName === "string"
        ? rich.producerNoteUpdatedByName.trim() || null
        : null,
    serviceNote: parseBookOrderServiceNote(rich.serviceNote),
  };
}

export interface BookReportingWindow {
  startsAt: string;
  endsAt: string;
  startsOn: string;
  endsOn: string;
}

export interface BookReportingWindows {
  timeZone: "America/Los_Angeles";
  ranges: Record<BookReportingRangeId, BookReportingWindow>;
}

/** One Harper `orders_temp` row, bind status derived from linked `deals_v2`. */
export interface BookOrder {
  id: string;
  accountId: string;
  /** Numeric `orders_temp.id` from Harper. */
  harperOrderId: number;
  /**
   * Authoritative `orders_temp.created_at` — the row-creation moment, and the
   * only timestamp deal age is measured from. Distinct from `orderedAt`, which
   * is producer-entered and carries data-entry outliers.
   */
  createdAt: string | null;
  orderedAt: string | null;
  /** Pending: ordered_at. Bound: first authoritative linked deal bind event. */
  eventAt: string | null;
  bindStatus: BookOrderBindStatus;
  /** Authoritative orders_temp.total_revenue in integer USD cents. Null stays unknown. */
  revenueCents: number | null;
  /** Six-decimal fixed-point copy used for exact aggregate-then-round revenue. */
  revenueMicros: number | null;
  rich: BookOrderRichData;
  /**
   * Issued policy numbers from bound deals. Placeholders like PENDING /
   * Unknown are excluded — never fabricate a number here.
   */
  policyNumbers: string[];
  /**
   * Visible data-quality flag when the order is bound but no real policy
   * number is on the linked deal(s).
   */
  inconsistency: string | null;
  /**
   * IQ/Broker classification from `deals_v2.is_instant_quote` across the
   * order's deals. Null when the order carries no deals to judge by.
   */
  source: OrderSource | null;
  /**
   * Authoritative `orders_temp.tag` (IQ Stage / BB Step). Null or blank means
   * No status — never invent a stage from display text.
   */
  iqStageTag: string | null;
  /**
   * Newest `service_workbench_gate_overrides.current_gate` for this order.
   * Display-only Broker Gate; null means Gate unavailable.
   */
  brokerGate: string | null;
  /** ISO timestamp of that override row when known. */
  brokerGateAt: string | null;
}

export interface SupabaseBook {
  fetchedAt: string;
  /** Provenance stamp written into the snapshot, e.g. "supabase deals_v2/companies". */
  source?: string;
  accounts: Account[];
  policies: Policy[];
  /** Legacy/runtime Harper sync compatibility for policy schedules of record. */
  schedules?: Record<string, PolicyFormSet>;
  /** Order grain for All Accounts — empty on older snapshots until refresh. */
  orders: BookOrder[];
  reportingWindows?: BookReportingWindows;
  /**
   * False when the snapshot on disk predates the IQ Stage / Broker Gate order
   * fields. Those orders would otherwise read as "No status" / "Gate
   * unavailable" across the whole book, so the boot path refreshes instead of
   * serving them.
   */
  stageFieldsPresent?: boolean;
  /**
   * False when the snapshot predates Workbench Service Note fields on order
   * rich payloads. Without them every collapsed row would show "No service
   * note" until the next tick.
   */
  serviceNotesPresent?: boolean;
}

const BOOK_PATH = path.join(process.cwd(), "data", "supabase-book.local.json");

/**
 * Imported accounts whose carrier has no seeded market desk hang off this
 * placeholder. The `.example` address fails the deliverability gate by
 * design — nothing can be sent until a real desk is set on the account.
 */
export const UNASSIGNED_UNDERWRITER: Underwriter = {
  id: "uw-unassigned",
  name: "Unassigned Market Desk",
  email: "unassigned@middle-bro.example",
  phone: null,
  portal: null,
  carrier: "Unassigned",
  notes:
    "Placeholder for imported accounts — no verified market contact on file. Assign a real desk before sending.",
  channelPrimary: "email",
  serviceEmail: null,
  channelNote:
    "No verified contact on file — set one on the account before requesting anything.",
};

let cache: SupabaseBook | null | undefined;

export function loadSupabaseBook(): SupabaseBook | null {
  if (cache !== undefined) return cache;
  cache = readBook();
  return cache;
}

export type BookSource = "overlay" | "seed";

/** Compatibility answer for deployment health routes after the book refactor. */
export function bookSource(): BookSource {
  return loadSupabaseBook() ? "overlay" : "seed";
}

/**
 * The five-minute refresher (src/lib/db/book-refresh.ts) hands its freshly
 * fetched book straight to the loader cache so the re-sync sees it without a
 * process restart or a disk round-trip.
 */
export function setSupabaseBookCache(book: SupabaseBook) {
  cache = book;
}

/**
 * Validate one snapshot order. Accepts the legacy `isBound` shape (older
 * snapshots) and normalizes it so a boot before the next refresh never wipes
 * the book — legacy statuses are corrected by the next five-minute refresh.
 */
function toBookOrder(value: unknown): BookOrder | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const baseOk =
    typeof o.id === "string" &&
    typeof o.accountId === "string" &&
    typeof o.harperOrderId === "number" &&
    (o.orderedAt === null || typeof o.orderedAt === "string") &&
    Array.isArray(o.policyNumbers) &&
    o.policyNumbers.every((n) => typeof n === "string") &&
    (o.inconsistency === null || typeof o.inconsistency === "string");
  if (!baseOk) return null;

  let bindStatus: BookOrderBindStatus;
  if (
    typeof o.bindStatus === "string" &&
    (BOOK_ORDER_BIND_STATUSES as readonly string[]).includes(o.bindStatus)
  ) {
    bindStatus = o.bindStatus as BookOrderBindStatus;
  } else if (typeof o.isBound === "boolean") {
    bindStatus = o.isBound ? "bound" : "pending";
  } else {
    return null;
  }

  const rich = normalizeBookOrderRich(
    o.rich && typeof o.rich === "object"
      ? (o.rich as BookOrderRichData)
      : null,
    (o.policyNumbers as string[]).length,
  );

  return {
    id: o.id as string,
    accountId: o.accountId as string,
    harperOrderId: o.harperOrderId as number,
    // Snapshots written before deal age shipped have no createdAt; it stays
    // null (preview shows "Age unavailable") until the next refresh fills it.
    createdAt:
      typeof o.createdAt === "string" ? o.createdAt : null,
    orderedAt: (o.orderedAt as string | null) ?? null,
    eventAt:
      o.eventAt === null || typeof o.eventAt === "string"
        ? (o.eventAt as string | null)
        : null,
    bindStatus,
    revenueCents:
      o.revenueCents === null || Number.isSafeInteger(o.revenueCents)
        ? (o.revenueCents as number | null)
        : null,
    revenueMicros:
      o.revenueMicros === null || Number.isSafeInteger(o.revenueMicros)
        ? (o.revenueMicros as number | null)
        : o.revenueCents === null || Number.isSafeInteger(o.revenueCents)
          ? (o.revenueCents as number | null) === null
            ? null
            : (o.revenueCents as number) * 10_000
          : null,
    rich,
    policyNumbers: o.policyNumbers as string[],
    inconsistency: (o.inconsistency as string | null) ?? null,
    // Older snapshots predate the field — reclassify from the deals we have so
    // a boot before the next refresh still filters correctly.
    source: parseOrderSource(o.source) ?? classifyOrderSource(rich.deals),
    iqStageTag:
      typeof o.iqStageTag === "string" && o.iqStageTag.trim()
        ? o.iqStageTag.trim()
        : null,
    brokerGate:
      typeof o.brokerGate === "string" && o.brokerGate.trim()
        ? o.brokerGate.trim()
        : null,
    brokerGateAt:
      typeof o.brokerGateAt === "string" && o.brokerGateAt.trim()
        ? o.brokerGateAt
        : null,
  };
}

function readBook(): SupabaseBook | null {
  try {
    if (!fs.existsSync(BOOK_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(BOOK_PATH, "utf-8")) as {
      fetchedAt?: unknown;
      source?: unknown;
      accounts?: unknown;
      policies?: unknown;
      orders?: unknown;
      reportingWindows?: unknown;
    };
    const accounts = Array.isArray(parsed.accounts)
      ? (parsed.accounts as Account[])
      : null;
    const policies = Array.isArray(parsed.policies)
      ? (parsed.policies as Policy[])
      : null;
    if (!accounts || !policies || accounts.length === 0) return null;

    const accountsOk = accounts.every(
      (a) =>
        a &&
        typeof a.id === "string" &&
        typeof a.name === "string" &&
        typeof a.primaryUwId === "string" &&
        (a.status === "pre_bind" ||
          a.status === "active" ||
          a.status === "cancelled"),
    );
    const policiesOk = policies.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.accountId === "string" &&
        typeof p.policyNumber === "string" &&
        typeof p.effectiveDate === "string" &&
        typeof p.expirationDate === "string" &&
        Number.isFinite(p.premiumCents) &&
        Array.isArray(p.coverages),
    );
    if (!accountsOk || !policiesOk) return null;

    // Older snapshots predate the orders array — treat as empty until refresh.
    const ordersRaw = Array.isArray(parsed.orders) ? parsed.orders : [];
    const orders = ordersRaw
      .map(toBookOrder)
      .filter((o): o is BookOrder => o !== null);
    // Key presence, not value: a snapshot written before the stage/gate query
    // has no `iqStageTag` at all, while a current one carries it as null when
    // the operator never set a Step.
    const stageFieldsPresent = ordersRaw.some(
      (o) => typeof o === "object" && o !== null && "iqStageTag" in o,
    );
    const serviceNotesPresent = ordersRaw.some((o) => {
      if (!o || typeof o !== "object") return false;
      const rich = (o as { rich?: unknown }).rich;
      return (
        typeof rich === "object" &&
        rich !== null &&
        "serviceNote" in rich
      );
    });

    return {
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : "",
      source: typeof parsed.source === "string" ? parsed.source : undefined,
      accounts,
      policies,
      orders,
      stageFieldsPresent,
      serviceNotesPresent,
      reportingWindows:
        parsed.reportingWindows &&
        typeof parsed.reportingWindows === "object"
          ? (parsed.reportingWindows as BookReportingWindows)
          : undefined,
    };
  } catch {
    // Unreadable/invalid book → behave like a clean clone: fictional seed.
    return null;
  }
}
