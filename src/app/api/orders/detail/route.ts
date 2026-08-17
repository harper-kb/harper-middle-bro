import { type NextRequest, NextResponse } from "next/server";
import { isVisibleBookOrder } from "@/lib/order-access.server";
import {
  loadOrderDetail,
  publicOrderDetail,
} from "@/lib/order-detail.server";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function positiveInteger(value: string | null): number | null {
  const raw = value?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const companyId = positiveInteger(request.nextUrl.searchParams.get("companyId"));
  const orderId = positiveInteger(request.nextUrl.searchParams.get("orderId"));
  if (!companyId || !orderId || !isVisibleBookOrder(companyId, orderId)) {
    return NextResponse.json(
      { error: "A valid account order is required." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const detail = await loadOrderDetail({ companyId, orderId });
    return NextResponse.json(publicOrderDetail(detail), {
      headers: NO_STORE,
    });
  } catch (cause) {
    const category =
      cause instanceof Error ? cause.message : "order_detail_unknown_error";
    console.warn("order_detail_load_failed", {
      companyId,
      orderId,
      errorCategory: category,
    });
    return NextResponse.json(
      {
        error:
          category === "order_detail_not_found"
            ? "Order detail was not found."
            : "Order detail is temporarily unavailable.",
      },
      {
        status: category === "order_detail_not_found" ? 404 : 502,
        headers: NO_STORE,
      },
    );
  }
}
