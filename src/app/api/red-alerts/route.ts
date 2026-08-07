import { NextResponse } from "next/server";
import { listActiveRedAlerts, RED_ALERT_DIRECTIVE } from "@/lib/red-alerts";

export const dynamic = "force-dynamic";

/** Active stand-down orders — the banner on every page polls this. */
export function GET() {
  const alerts = listActiveRedAlerts().map((a) => ({
    id: a.id,
    accountId: a.accountId,
    accountName: a.accountName,
    noLossRef: a.noLossRef,
    claimsRef: a.claimsRef,
    raisedBy: a.raisedBy,
    raisedAt: a.raisedAt,
  }));
  return NextResponse.json({
    count: alerts.length,
    directive: RED_ALERT_DIRECTIVE,
    alerts,
    fetchedAt: new Date().toISOString(),
  });
}
