import { NextResponse } from "next/server";
import { readBookRefreshStatus } from "@/lib/db/book-refresh-status";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(readBookRefreshStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
