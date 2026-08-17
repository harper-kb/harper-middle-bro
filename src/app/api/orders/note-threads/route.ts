import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadNoteThreads } from "@/lib/note-threads.server";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function numeric(value: string | null): number | null {
  const trimmed = (value ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isVisibleBookOrder(companyId: number, orderId: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM book_orders
       WHERE account_id = ? AND harper_order_id = ?`,
    )
    .get(`co-${companyId}`, orderId);
  return Boolean(row);
}

export async function GET(request: Request) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  const companyId = numeric(url.searchParams.get("companyId"));
  const orderId = numeric(url.searchParams.get("orderId"));
  if (!companyId || !orderId || !isVisibleBookOrder(companyId, orderId)) {
    return NextResponse.json(
      { error: "A valid account order is required." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const threads = await loadNoteThreads({
      companyId,
      orderId,
      visibilityScope: `operator:${operator.id}`,
    });
    return NextResponse.json(threads, { headers: NO_STORE });
  } catch (cause) {
    console.warn("note_threads_load_failed", {
      companyId,
      orderId,
      errorCategory:
        cause instanceof Error ? cause.message : "note_threads_unknown_error",
    });
    return NextResponse.json(
      { error: "Note threads are temporarily unavailable." },
      { status: 502, headers: NO_STORE },
    );
  }
}
