import { NextResponse } from "next/server";
import { getSessionOperator } from "@/lib/session";

const EVENTS = new Set([
  "filter-transition",
  "records-to-company",
  "return-to-records",
  "unexpected-reset",
]);
const REASONS = new Set([
  "initial-load",
  "filter",
  "search",
  "sort",
  "page",
  "view-switch",
  "clear",
  "return-to-records",
  "url-normalized",
]);
const VIEWS = new Set(["all", "pending", "bound", "lost"]);
const SOURCES = new Set(["all", "iq", "broker"]);
const RANGES = new Set([
  "none",
  "all-time",
  "this-week",
  "last-week",
  "last-30-days",
]);
const DATE_SORTS = new Set(["oldest", "newest"]);
const REVENUE_SORTS = new Set(["none", "revenue-desc", "revenue-asc"]);

function appVersion(): string {
  return (
    process.env.NEXT_PUBLIC_APP_VERSION ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    "unknown"
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000
    ? Number(value)
    : null;
}

function code(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9:_-]{1,64}$/i.test(value)
    ? value
    : null;
}

/**
 * Rebuild the redacted state from an exact schema. Unknown keys are never
 * spread into logs, so a caller cannot smuggle a company name, URL, carrier
 * label or raw search string through this diagnostics endpoint.
 */
function safeState(value: unknown): Record<string, unknown> | null {
  const input = record(value);
  if (!input) return null;
  const view = code(input.view);
  const source = code(input.source);
  const range = code(input.range);
  const sortDate = code(input.sort_date);
  const sortRevenue = code(input.sort_revenue);
  const hash =
    typeof input.hash === "string" && /^[0-9a-f]{8}$/.test(input.hash)
      ? input.hash
      : null;
  const iqStageCount = count(input.iq_stage_count);
  const brokerGateCount = count(input.broker_gate_count);
  const carrierCount = count(input.carrier_count);
  const locationStateCount = count(input.location_state_count);
  const queryLength = count(input.query_length);
  const page = count(input.page);
  if (
    !view ||
    !VIEWS.has(view) ||
    !source ||
    !SOURCES.has(source) ||
    !range ||
    !RANGES.has(range) ||
    !sortDate ||
    !DATE_SORTS.has(sortDate) ||
    !sortRevenue ||
    !REVENUE_SORTS.has(sortRevenue) ||
    !hash ||
    iqStageCount === null ||
    brokerGateCount === null ||
    carrierCount === null ||
    locationStateCount === null ||
    queryLength === null ||
    page === null ||
    typeof input.filters_active !== "boolean"
  ) {
    return null;
  }
  return {
    view,
    source,
    iq_stage_count: iqStageCount,
    broker_gate_count: brokerGateCount,
    range,
    carrier_count: carrierCount,
    location_state_count: locationStateCount,
    sort_date: sortDate,
    sort_revenue: sortRevenue,
    query_length: queryLength,
    page,
    filters_active: input.filters_active,
    hash,
  };
}

function safeDetail(
  event: string,
  value: unknown,
): Record<string, unknown> | null {
  const input = record(value);
  if (!input) return null;
  const trigger = code(input.trigger);
  if (!trigger) return null;

  if (event === "records-to-company" || event === "return-to-records") {
    const state = safeState(input.state);
    return state ? { trigger, state } : null;
  }

  const reason = code(input.reason);
  const from = safeState(input.from);
  const to = safeState(input.to);
  return reason && REASONS.has(reason) && from && to
    ? { reason, trigger, from, to }
    : null;
}

export async function POST(request: Request) {
  if (!(await getSessionOperator())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  const { event, detail } = body as { event?: unknown; detail?: unknown };
  const safe =
    typeof event === "string" && EVENTS.has(event)
      ? safeDetail(event, detail)
      : null;
  if (!safe) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  console.info("records_navigation_state", {
    event,
    app_version: appVersion(),
    ...safe,
  });
  return new NextResponse(null, { status: 204 });
}
