import { NextResponse, type NextRequest } from "next/server";
import { readBookRefreshStatus } from "@/lib/db/book-refresh-status";
import {
  COMPANY_SEARCH_LIMIT,
  COMPANY_SEARCH_MIN_LENGTH,
  searchCompanies,
  type CompanySearchResult,
} from "@/lib/db/queries/company-search";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Live global company search for the operational bar. Matching runs in the
 * database against the synced Harper book, so the browser only ever receives
 * the handful of rows it renders — never the customer dataset.
 *
 * `lastSuccessfulSyncAt` is the same instant the metrics bar and the sidebar's
 * Latest Database Sync card report, so results and the freshness stamp beside
 * them always describe the same sync.
 */
export interface CompanySearchResponse {
  query: string;
  results: CompanySearchResult[];
  lastSuccessfulSyncAt: string | null;
}

export async function GET(request: NextRequest) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < COMPANY_SEARCH_MIN_LENGTH) {
    return NextResponse.json(
      { query, results: [], lastSuccessfulSyncAt: null },
      { headers: NO_STORE },
    );
  }

  try {
    const body: CompanySearchResponse = {
      query,
      results: searchCompanies(query, COMPANY_SEARCH_LIMIT),
      lastSuccessfulSyncAt: readBookRefreshStatus().lastSuccessfulAt,
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (cause) {
    console.warn("company_search_failed", {
      queryLength: query.length,
      errorCategory:
        cause instanceof Error ? cause.message : "unknown_company_search_error",
    });
    return NextResponse.json(
      { error: "Search is temporarily unavailable." },
      { status: 503, headers: NO_STORE },
    );
  }
}
