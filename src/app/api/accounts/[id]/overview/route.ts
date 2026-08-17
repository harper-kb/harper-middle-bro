import { NextResponse } from "next/server";
import { loadCompanyOverview } from "@/lib/company-detail.server";
import { getAccountDetail } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function positiveInteger(value: string | undefined): number | null {
  const raw = value?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  _request: Request,
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
  if (!getAccountDetail(`co-${companyId}`)) {
    return NextResponse.json(
      { error: "Company not found." },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const overview = await loadCompanyOverview(companyId);
    return NextResponse.json(overview, { headers: NO_STORE });
  } catch (cause) {
    console.warn("company_overview_refresh_failed", {
      companyId,
      errorCategory:
        cause instanceof Error ? cause.message : "unknown_company_overview_error",
    });
    return NextResponse.json(
      { error: "Company details are temporarily unavailable." },
      { status: 502, headers: NO_STORE },
    );
  }
}
