import { type NextRequest, NextResponse } from "next/server";
import { isVisibleBookOrder } from "@/lib/order-access.server";
import { mintOrderQuoteUrl } from "@/lib/order-detail.server";
import { getSessionOperator } from "@/lib/session";
import { supabaseManagementRetryAfterSeconds } from "@/lib/supabase-management.server";

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function quoteRetryPage(
  request: NextRequest,
  retryAfter: number,
): Response {
  const alreadyRetried =
    request.nextUrl.searchParams.get("quoteRetry") === "1";
  const retryUrl = new URL(request.url);
  retryUrl.searchParams.set("quoteRetry", "1");
  const retryMeta = alreadyRetried
    ? ""
    : `<meta http-equiv="refresh" content="${retryAfter};url=${escapeHtml(`${retryUrl.pathname}${retryUrl.search}`)}">`;
  const message = alreadyRetried
    ? "Quote access is still busy. Close this tab and try again shortly."
    : `Quote access is busy. This tab will retry automatically in ${retryAfter} seconds.`;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${retryMeta}<title>Preparing quote</title><style>html{color-scheme:light dark;font-family:system-ui,sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center;background:#10171b;color:#edf2f4}.card{max-width:30rem;margin:1.5rem;padding:1.25rem 1.4rem;border:1px solid #34434b;border-radius:1rem;background:#182126}h1{margin:0 0 .5rem;font-size:1rem}p{margin:0;color:#b7c2c8;line-height:1.5}</style></head><body><main class="card"><h1>Preparing secure quote</h1><p>${message}</p></main></body></html>`,
    {
      status: 503,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": String(retryAfter),
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
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
    const signedUrl = await mintOrderQuoteUrl({
      companyId,
      orderId,
      signal: request.signal,
    });
    return new Response(null, {
      status: 302,
      headers: {
        ...NO_STORE,
        Location: signedUrl,
      },
    });
  } catch (cause) {
    const retryAfter = supabaseManagementRetryAfterSeconds(cause);
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
    if (
      retryAfter !== null &&
      request.headers.get("accept")?.includes("text/html")
    ) {
      return quoteRetryPage(request, retryAfter);
    }
    return NextResponse.json(
      {
        error: unavailable
          ? "No securely viewable quote is available for this order."
          : "Quote access is temporarily unavailable.",
      },
      {
        status: unavailable ? 404 : 503,
        headers:
          retryAfter === null
            ? NO_STORE
            : { ...NO_STORE, "Retry-After": String(retryAfter) },
      },
    );
  }
}
