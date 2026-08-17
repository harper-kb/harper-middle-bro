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
  parseBookServiceNoteEntry,
  type BookOrderServiceNote,
  type BookServiceNoteEntry,
} from "./service-note";

export type {
  BookOrderServiceNote,
  BookServiceNoteEntry,
} from "./service-note";

/**
 * Loader for the real-book overlay: a curated slice of actual Harper
 * companies/policies/orders exported from Supabase by the two-minute
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
  /**
   * Stable `orders_temp.producer` → `producers.id`. Deduplication key for the
   * account-level producer summary; two producers may share a display name.
   */
  producerId: number | null;
  /** `producers.first_name`/`last_name` for that id. Null = unnamed in the directory. */
  producerName: string | null;
}

/**
 * One normalized customer identifier for global company search. Values are
 * search keys only — lowercased emails and digit-only phones — so a match can
 * be found without the search path carrying a formatted customer email or
 * phone number.
 */
export interface BookContactKey {
  accountId: string;
  kind: "email" | "phone";
  value: string;
}

/** One display contact on the company page's Contacts card. */
export interface BookCompanyContact {
  /** Stable `companies_contacts.id`. */
  id: number;
  /** Resolved display name; "Unnamed contact" when the row carries none. */
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Company-page overview fields mirrored locally so `/accounts/[id]` renders
 * without a live Management API round-trip: location, stored timezone, the
 * company-level producer (resolved from `producer_assigned` by slug), and the
 * display contacts. The company digest covers all of it, so a change lands
 * with the next refresh tick.
 */
export interface BookCompanyDetail {
  accountId: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  /** Raw `companies.company_state` as displayed. */
  state: string | null;
  /** Two-letter abbreviation resolved through `public.states`. */
  stateCode: string | null;
  postalCode: string | null;
  /** Raw `companies.company_timezone`; resolution happens at read time. */
  timeZone: string | null;
  producerId: number | null;
  producerName: string | null;
  contacts: BookCompanyContact[];
}

export function parseBookCompanyDetail(
  value: unknown,
): BookCompanyDetail | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const accountId =
    typeof row.accountId === "string" ? row.accountId.trim() : "";
  if (!accountId) return null;
  const text = (input: unknown): string | null => {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    return trimmed || null;
  };
  const contacts = (Array.isArray(row.contacts) ? row.contacts : []).flatMap(
    (entry): BookCompanyContact[] => {
      if (!entry || typeof entry !== "object") return [];
      const contact = entry as Record<string, unknown>;
      const id = Number(contact.id);
      if (!Number.isSafeInteger(id) || id <= 0) return [];
      return [
        {
          id,
          name: text(contact.name) ?? "Unnamed contact",
          email: text(contact.email),
          phone: text(contact.phone),
        },
      ];
    },
  );
  const producerId = Number(row.producerId);
  return {
    accountId,
    address1: text(row.address1),
    address2: text(row.address2),
    city: text(row.city),
    state: text(row.state),
    stateCode: text(row.stateCode),
    postalCode: text(row.postalCode),
    timeZone: text(row.timeZone),
    producerId:
      Number.isSafeInteger(producerId) && producerId > 0 ? producerId : null,
    producerName: text(row.producerName),
    contacts,
  };
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
  /** Search keys for global company search — empty on older snapshots. */
  contactKeys: BookContactKey[];
  /**
   * Every visible Service Note entry across the book (~4.6k rows / ~0.4 MB
   * measured live) — the local mirror the expanded note threads read instead
   * of a live Management API query per interaction. Absent on snapshots
   * written before note threads were mirrored.
   */
  serviceNoteEntries?: BookServiceNoteEntry[];
  /**
   * Company-page overview mirror (location / timezone / producer / display
   * contacts) — absent on snapshots written before it shipped.
   */
  companyDetails?: BookCompanyDetail[];
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
  /**
   * False when the snapshot predates the search keys and order producer. Global
   * search would find nothing by email or phone, and every result would read
   * "Producer unavailable", so the boot path refreshes instead of serving them.
   */
  searchFieldsPresent?: boolean;
  /**
   * False when the snapshot predates the mirrored Service Note threads. Note
   * threads then fall back to the legacy live read until the boot refresh
   * publishes a snapshot that carries them.
   */
  noteThreadsPresent?: boolean;
  /**
   * False when the snapshot predates the company-page overview mirror. The
   * overview then falls back to the legacy live read until the boot refresh
   * publishes a snapshot that carries it.
   */
  companyDetailsPresent?: boolean;
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
 * The two-minute refresher (src/lib/db/book-refresh.ts) hands its freshly
 * fetched book straight to the loader cache so the re-sync sees it without a
 * process restart or a disk round-trip.
 */
export function setSupabaseBookCache(book: SupabaseBook) {
  cache = book;
}

/**
 * Validate one snapshot order. Accepts the legacy `isBound` shape (older
 * snapshots) and normalizes it so a boot before the next refresh never wipes
 * the book — legacy statuses are corrected by the next refresh tick.
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
    producerId: Number.isSafeInteger(o.producerId)
      ? (o.producerId as number)
      : null,
    producerName:
      typeof o.producerName === "string" && o.producerName.trim()
        ? o.producerName.trim()
        : null,
  };
}

function toContactKey(value: unknown): BookContactKey | null {
  if (!value || typeof value !== "object") return null;
  const k = value as Record<string, unknown>;
  if (k.kind !== "email" && k.kind !== "phone") return null;
  if (typeof k.accountId !== "string" || !k.accountId) return null;
  if (typeof k.value !== "string" || !k.value.trim()) return null;
  return { accountId: k.accountId, kind: k.kind, value: k.value.trim() };
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
      contactKeys?: unknown;
      serviceNoteEntries?: unknown;
      companyDetails?: unknown;
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
    const contactKeys = (
      Array.isArray(parsed.contactKeys) ? parsed.contactKeys : []
    )
      .map(toContactKey)
      .filter((k): k is BookContactKey => k !== null);
    // Key presence again, not value: only a snapshot written by the query that
    // carries producers has the field at all.
    const searchFieldsPresent =
      Array.isArray(parsed.contactKeys) &&
      ordersRaw.some(
        (o) => typeof o === "object" && o !== null && "producerId" in o,
      );
    // Key presence: a book with zero notes still writes the (empty) array, so
    // only a snapshot from before the mirror shipped lacks the key entirely.
    const noteThreadsPresent = Array.isArray(parsed.serviceNoteEntries);
    const serviceNoteEntries = (
      noteThreadsPresent ? (parsed.serviceNoteEntries as unknown[]) : []
    )
      .map(parseBookServiceNoteEntry)
      .filter((entry): entry is BookServiceNoteEntry => entry !== null);
    const companyDetailsPresent = Array.isArray(parsed.companyDetails);
    const companyDetails = (
      companyDetailsPresent ? (parsed.companyDetails as unknown[]) : []
    )
      .map(parseBookCompanyDetail)
      .filter((detail): detail is BookCompanyDetail => detail !== null);

    return {
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : "",
      source: typeof parsed.source === "string" ? parsed.source : undefined,
      accounts,
      policies,
      orders,
      contactKeys,
      serviceNoteEntries,
      companyDetails,
      stageFieldsPresent,
      serviceNotesPresent,
      searchFieldsPresent,
      noteThreadsPresent,
      companyDetailsPresent,
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
