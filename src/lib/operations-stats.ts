import type { BookRefreshStatus } from "@/lib/db/book-refresh-status";
import type {
  OperationsBindDay,
  OperationsWindow,
  OperationsZone,
} from "@/lib/db/operations-metrics";

/**
 * The one client-facing operations payload. The API selects both day windows
 * and every metric from one published server snapshot before returning it.
 */
export interface OperationsStatsResponse {
  selectedBusinessDate: string;
  /** Zone the activity counters resolve in — the viewer's own business day. */
  businessTimezone: OperationsZone;
  /** Bind Sent alone resolves on the Eastern business day, per BigBrother. */
  bindSentTimezone: OperationsZone;
  /** Exact server revision that produced the metric values and day windows. */
  metricsCalculatedAt: string;
  lastSuccessfulSyncAt: string | null;
  /** Selectable business dates in the matched zone, newest (today) first. */
  availableDates: string[];
  businessWindow: OperationsWindow;
  bindSentWindow: OperationsWindow;
  metrics: {
    bindSent: Pick<OperationsBindDay, "total" | "sameDay" | "backlog">;
    newOrders: number;
    bound: number;
    coisSent: number;
  };
  refresh: BookRefreshStatus;
}

export type DailyOperationsStats = Readonly<{
  selectedBusinessDate: string;
  isCurrentBusinessDate: boolean;
  businessTimezone: OperationsZone;
  bindSentTimezone: OperationsZone;
  availableDates: readonly string[];
  businessWindow: Readonly<OperationsWindow>;
  bindSentWindow: Readonly<OperationsWindow>;
  dataRevision: Readonly<{
    metricsCalculatedAt: string;
    lastSuccessfulSyncAt: string | null;
  }>;
  metrics: Readonly<{
    bindSent: Readonly<{
      total: number;
      sameDay: number;
      backlog: number;
    }>;
    newOrders: number;
    bound: number;
    coisSent: number;
  }>;
  refresh: Readonly<BookRefreshStatus>;
}>;

/**
 * Copies and freezes the response once. The navbar and every export action
 * consume this exact object rather than independently reshaping live fields.
 */
export function createDailyOperationsStats(
  response: OperationsStatsResponse,
): DailyOperationsStats {
  const availableDates = Object.freeze([...response.availableDates]);
  const bindSent = Object.freeze({ ...response.metrics.bindSent });
  const metrics = Object.freeze({
    bindSent,
    newOrders: response.metrics.newOrders,
    bound: response.metrics.bound,
    coisSent: response.metrics.coisSent,
  });

  return Object.freeze({
    selectedBusinessDate: response.selectedBusinessDate,
    isCurrentBusinessDate:
      response.selectedBusinessDate === availableDates[0],
    businessTimezone: response.businessTimezone,
    bindSentTimezone: response.bindSentTimezone,
    availableDates,
    businessWindow: Object.freeze({ ...response.businessWindow }),
    bindSentWindow: Object.freeze({ ...response.bindSentWindow }),
    dataRevision: Object.freeze({
      metricsCalculatedAt: response.metricsCalculatedAt,
      lastSuccessfulSyncAt: response.lastSuccessfulSyncAt,
    }),
    metrics,
    refresh: Object.freeze({ ...response.refresh }),
  });
}
