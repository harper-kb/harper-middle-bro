import { type NextRequest, NextResponse } from "next/server";
import { isVisibleBookOrder } from "@/lib/order-access.server";
import { mintOrderQuoteUrl } from "@/lib/order-detail.server";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

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
    const signedUrl = await mintOrderQuoteUrl({ companyId, orderId });
    return new Response(null, {
      status: 302,
      headers: {
        ...NO_STORE,
        Location: signedUrl,
      },
    });
  } catch (cause) {
    const category =
      cause instanceof Error ? cause.message : "order_quote_unknown_error";
    console.warn("order_quote_access_failed", {
      companyId,
      orderId,
      errorCategory: category,
    });
    const unavailable =
      category === "order_quote_unavailable" ||
      category === "order_detail_not_found";
    return NextResponse.json(
      {
        error: unavailable
          ? "No securely viewable quote is available for this order."
          : "Quote access is temporarily unavailable.",
      },
      {
        status: unavailable ? 404 : 503,
        headers: NO_STORE,
      },
    );
  }
}
