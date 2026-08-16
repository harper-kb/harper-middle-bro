import { NextResponse, type NextRequest } from "next/server";
import {
  readBookRefreshStatus,
  type BookRefreshStatus,
} from "@/lib/db/book-refresh-status";
import {
  BIND_SENT_TIME_ZONE,
  readOperationsMetricsSnapshot,
  type OperationsBindDay,
  type OperationsMetricsSnapshot,
  type OperationsZone,
} from "@/lib/db/operations-metrics";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * One consistent stats-bar payload: the selected business day's metrics plus
 * the same `lastSuccessfulSyncAt` instant the sidebar's Latest Database Sync
 * card shows — both read the timestamp recorded by the book refresh cycle
 * that also published this metrics snapshot.
 */
export interface OperationsStatsResponse {
  selectedBusinessDate: string;
  /** Zone the activity counters resolve in — the viewer's own business day. */
  businessTimezone: OperationsZone;
  /** Bind Sent alone resolves on the Eastern business day, per BigBrother. */
  bindSentTimezone: typeof BIND_SENT_TIME_ZONE;
  lastSuccessfulSyncAt: string | null;
  /** Selectable business dates in the matched zone, newest (today) first. */
  availableDates: string[];
  metrics: {
    bindSent: Pick<OperationsBindDay, "total" | "sameDay" | "backlog">;
    newOrders: number;
    bound: number;
    coisSent: number;
  };
  refresh: BookRefreshStatus;
}

/**
 * BigBrother resolves the activity counters on the viewer's local day, so the
 * browser reports its current UTC offset and we serve the matching
 * precomputed zone, falling back to the Eastern book day.
 */
function zoneForViewer(
  snapshot: OperationsMetricsSnapshot,
  tzOffset: string | null,
) {
  const offset = tzOffset != null ? Number(tzOffset) : Number.NaN;
  return (
    snapshot.zones.find((zone) => zone.utcOffsetMinutes === offset) ??
    snapshot.zones.find((zone) => zone.timeZone === BIND_SENT_TIME_ZONE) ??
    snapshot.zones[0]
  );
}

export async function GET(request: NextRequest) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const refresh = readBookRefreshStatus();
  const snapshot = readOperationsMetricsSnapshot();
  if (!snapshot) {
    return NextResponse.json(
      { error: "Operations metrics unavailable", refresh },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const zone = zoneForViewer(
    snapshot,
    request.nextUrl.searchParams.get("tzOffset"),
  );
  const requested = request.nextUrl.searchParams.get("statsDate");
  // Out-of-window or malformed dates (e.g. an old shared link, or a link from
  // a viewer whose zone is a day ahead) clamp to the newest available day.
  const day =
    zone.days.find((candidate) => candidate.businessDate === requested) ??
    zone.days[0];
  const bind = snapshot.bindDays.find(
    (candidate) => candidate.businessDate === day.businessDate,
  );
  if (!bind) {
    // The parser guarantees coverage; treat a gap as an unusable snapshot.
    return NextResponse.json(
      { error: "Operations metrics unavailable", refresh },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body: OperationsStatsResponse = {
    selectedBusinessDate: day.businessDate,
    businessTimezone: zone.timeZone,
    bindSentTimezone: BIND_SENT_TIME_ZONE,
    lastSuccessfulSyncAt: refresh.lastSuccessfulAt,
    availableDates: zone.days.map((candidate) => candidate.businessDate),
    metrics: {
      bindSent: {
        total: bind.total,
        sameDay: bind.sameDay,
        backlog: bind.backlog,
      },
      newOrders: day.newOrders,
      bound: day.bound,
      coisSent: day.coisSent,
    },
    refresh,
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
