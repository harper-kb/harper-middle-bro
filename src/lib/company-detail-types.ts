import type { OrderSource } from "./account-source";
import type {
  CompanyTimeZoneSource,
  CompanyTimeZoneUnavailableReason,
} from "./company-time-zone";
import type { BookOrderListItem } from "./db";
import type { BookOrderBindStatus } from "./supabase-book.server";

export interface CompanyProducer {
  id: number;
  name: string;
}

export interface CompanyLocation {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  postalCode: string | null;
  country: null;
}

export interface CompanyTimeZone {
  id: string | null;
  source: CompanyTimeZoneSource | null;
  unavailableReason: CompanyTimeZoneUnavailableReason | null;
}

export interface CompanyContact {
  id: number;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface CompanyOverview {
  companyId: number;
  name: string;
  dba: string | null;
  producer: CompanyProducer | null;
  location: CompanyLocation;
  timeZone: CompanyTimeZone;
  contacts: CompanyContact[];
  fetchedAt: string;
  stale: boolean;
}

/**
 * One page size for the SSR preview and the client's pagination. Sharing it
 * means the server render warms the exact `offset 0` cache key the first
 * expand reads, so expanding is a cache hit with a stale fallback instead of
 * a cold, failable query.
 */
export const PAYMENT_PAGE_SIZE = 20;

export type PaymentHistoryStatus =
  | "link_sent"
  | "processing"
  | "settled"
  | "failed"
  | "returned"
  | "voided"
  | "refund_pending"
  | "refunded"
  | "refund_failed"
  | "unknown";

export interface PaymentHistoryItem {
  id: string;
  type: "payment_link" | "payment" | "refund";
  status: PaymentHistoryStatus;
  rawStatus: string;
  amountCents: number | null;
  currency: string | null;
  occurredAt: string;
  createdAt: string;
  orderId: number | null;
  createdBy: string | null;
  safeReference: string;
}

export interface PaymentHistoryPage {
  companyId: number;
  items: PaymentHistoryItem[];
  total: number;
  settledAmountCents: number | null;
  settledCurrency: string | null;
  settledCount: number;
  offset: number;
  limit: number;
  fetchedAt: string;
  stale: boolean;
}

export interface CompanyOrderSummary {
  orders: BookOrderListItem[];
  source: OrderSource | null;
  totalPremiumCents: number | null;
  totalRevenueMicros: number | null;
  totalCommissionCents: number | null;
  totalHarperFeeCents: number | null;
  statusCounts: Record<BookOrderBindStatus, number>;
}
