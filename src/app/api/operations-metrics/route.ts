import { NextResponse, type NextRequest } from "next/server";
import {
  readBookRefreshStatus,
} from "@/lib/db/book-refresh-status";
import {
  BIND_SENT_TIME_ZONE,
  readOperationsMetricsSnapshot,
  type OperationsMetricsSnapshot,
} from "@/lib/db/operations-metrics";
import type { OperationsStatsResponse } from "@/lib/operations-stats";
import { getSessionOperator } from "@/lib/session";

export type { OperationsStatsResponse } from "@/lib/operations-stats";

export const dynamic = "force-dynamic";

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
    metricsCalculatedAt: snapshot.calculatedAt,
    lastSuccessfulSyncAt: refresh.lastSuccessfulAt,
    availableDates: zone.days.map((candidate) => candidate.businessDate),
    businessWindow: day.window,
    bindSentWindow: bind.window,
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
