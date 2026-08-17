import { NextResponse } from "next/server";
import {
  getBookOrderNavigationCounts,
  type BookOrderNavigationCounts,
} from "@/lib/db/queries/accounts";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export type RecordsNavigationCountsResponse = BookOrderNavigationCounts;

export async function GET() {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  try {
    return NextResponse.json(getBookOrderNavigationCounts(), {
      headers: NO_STORE,
    });
  } catch (cause) {
    console.warn("navigation_account_counts_failed", {
      errorCategory:
        cause instanceof Error ? cause.message : "unknown_navigation_count_error",
    });
    return NextResponse.json(
      { error: "Navigation counts are temporarily unavailable." },
      { status: 503, headers: NO_STORE },
    );
  }
}
