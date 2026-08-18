import { NextResponse } from "next/server";
import { loadPaymentHistory } from "@/lib/company-detail.server";
import { getAccountDetail } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";
import { supabaseManagementRetryAfterSeconds } from "@/lib/supabase-management.server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function positiveInteger(value: string | undefined): number | null {
  const raw = value?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: string | null, fallback: number): number {
  const raw = value?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const { id } = await params;
  const companyId = positiveInteger(id);
  if (!companyId) {
    return NextResponse.json(
      { error: "A valid company is required." },
      { status: 400, headers: NO_STORE },
    );
  }

  const accountId = `co-${companyId}`;
  const account = getAccountDetail(accountId);
  if (!account) {
    return NextResponse.json(
      { error: "Company not found." },
      { status: 404, headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  const offset = nonNegativeInteger(url.searchParams.get("offset"), 0);
  const limit = nonNegativeInteger(url.searchParams.get("limit"), 20);

  try {
    const history = await loadPaymentHistory({
      companyId,
      offset,
      limit,
      signal: request.signal,
    });
    return NextResponse.json(history, { headers: NO_STORE });
  } catch (cause) {
    const retryAfter = supabaseManagementRetryAfterSeconds(cause);
    console.warn("company_payment_history_failed", {
      companyId,
      errorCategory:
        cause instanceof Error ? cause.message : "unknown_payment_history_error",
    });
    return NextResponse.json(
      { error: "Payment history is temporarily unavailable." },
      {
        status: retryAfter === null ? 502 : 503,
        headers:
          retryAfter === null
            ? NO_STORE
            : { ...NO_STORE, "Retry-After": String(retryAfter) },
      },
    );
  }
}
