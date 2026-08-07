import { listThreads } from "@/lib/db";
import { getRequestType } from "@/lib/catalog";
import { formatMoney } from "@/lib/format";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const threads = listThreads({ status: "needs_human" });
  const items = threads.map((t) => ({
    id: t.id,
    ticketId: t.ticketId,
    accountName: t.account.name,
    carrier: t.policy.carrier,
    requestLabel: getRequestType(t.requestType).label,
    premiumCents: t.offeredPremiumCents,
    premiumLabel: formatMoney(t.offeredPremiumCents),
    underwriterName: t.underwriter.name,
    updatedAt: t.updatedAt,
    preview: `Needs your OK — ${t.underwriter.name} quoted ${formatMoney(t.offeredPremiumCents)} on ${t.account.name}.`,
  }));

  return NextResponse.json({
    count: items.length,
    items,
    fetchedAt: new Date().toISOString(),
  });
}
