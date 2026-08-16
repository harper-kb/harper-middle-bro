import Link from "next/link";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import {
  listBookAccountsPage,
  type BookOrdersViewMode,
} from "@/lib/db";
import { loadSupabaseBook } from "@/lib/supabase-book.server";
import { parseOrderReportingRange } from "@/lib/order-reporting";
import { harperCalendarDay } from "@/lib/order-age";
import {
  ACCOUNT_SOURCE_LABELS,
  parseAccountSource,
  type AccountSourceId,
} from "@/lib/account-source";
import {
  parseIqStages,
  serializeIqStages,
} from "@/lib/iq-stage";
import {
  bigBrotherBaseUrl,
  canEditOrders,
} from "@/lib/order-action-gates";
import { getSessionOperator } from "@/lib/session";
import { AccountFilterToolbar } from "./AccountFilterToolbar";
import { AccountViewTitle } from "./AccountViewTitle";
import { AllAccountsList } from "./AllAccountsList";
import { KpiStrip, type KpiStat } from "./KpiStrip";
import { PaginationControls } from "./PaginationControls";
import { getAccountOrdersView } from "./view-config";

const PAGE_SIZE = 100;

type SearchParams = Record<string, string | undefined>;

/**
 * Mode-scoped stats. All Accounts gets the full strip with "Deals" labels and
 * distinct-account tooltips; filtered views keep their focused pair with no
 * tooltip behavior.
 */
function kpiStats({
  mode,
  total,
  withBoundOrders,
  withPendingOrders,
  withLostOrders,
  boundOrderCount,
  pendingOrderCount,
  lostOrderCount,
  revenueMicros,
  missingRevenueOrderCount,
}: {
  mode: BookOrdersViewMode;
  total: number;
  withBoundOrders: number;
  withPendingOrders: number;
  withLostOrders: number;
  boundOrderCount: number;
  pendingOrderCount: number;
  lostOrderCount: number;
  revenueMicros: number | null;
  missingRevenueOrderCount: number;
}): KpiStat[] {
  const revenueStat: KpiStat = {
    label: "Revenue",
    value:
      revenueMicros === null
        ? "—"
        : new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(revenueMicros / 1_000_000),
    tooltip: `Authoritative USD orders_temp.total_revenue at unique order grain. ${
      missingRevenueOrderCount === 0
        ? "All matching orders have a value."
        : `${missingRevenueOrderCount.toLocaleString()} matching order${
            missingRevenueOrderCount === 1 ? "" : "s"
          } excluded because revenue is missing.`
    }`,
  };
  if (mode === "pending") {
    return [
      { label: "Accounts", value: total },
      { label: "Pending Orders", value: pendingOrderCount, tone: "pending" },
      revenueStat,
    ];
  }
  if (mode === "bound") {
    return [
      { label: "Accounts", value: total },
      { label: "Bound Orders", value: boundOrderCount, tone: "bound" },
      revenueStat,
    ];
  }
  if (mode === "lost") {
    return [
      { label: "Accounts", value: total },
      { label: "Lost Orders", value: lostOrderCount, tone: "lost" },
      { ...revenueStat, tooltip: `All-time Lost Orders. ${revenueStat.tooltip}` },
    ];
  }
  return [
    { label: "Accounts", value: total },
    {
      label: "Total Orders",
      value: boundOrderCount + pendingOrderCount + lostOrderCount,
    },
    {
      label: "Bound Deals",
      value: boundOrderCount,
      tone: "bound",
      tooltipAccountCount: withBoundOrders,
      href: "/bound-orders",
    },
    {
      label: "Pending Deals",
      value: pendingOrderCount,
      tone: "pending",
      tooltipAccountCount: withPendingOrders,
      href: "/pending-orders",
    },
    {
      label: "Lost Deals",
      value: lostOrderCount,
      tone: "lost",
      tooltipAccountCount: withLostOrders,
      href: "/lost-orders",
    },
  ];
}

function formatRangeDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

function emptyMessage(
  mode: BookOrdersViewMode,
  query: string,
  source: AccountSourceId,
): string {
  const sourceLabel =
    source === "all" ? "" : ` ${ACCOUNT_SOURCE_LABELS[source]}`;
  if (query) {
    return `No${sourceLabel} ${mode === "all" ? "accounts" : `${mode} order accounts`} match this search.`;
  }
  if (source !== "all") {
    if (mode === "pending") {
      return `No ${ACCOUNT_SOURCE_LABELS[source]} accounts currently have Pending orders.`;
    }
    if (mode === "bound") {
      return `No ${ACCOUNT_SOURCE_LABELS[source]} accounts currently have Bound orders.`;
    }
    if (mode === "lost") {
      return `No ${ACCOUNT_SOURCE_LABELS[source]} accounts currently have Lost orders.`;
    }
    return `No ${ACCOUNT_SOURCE_LABELS[source]} accounts in the book.`;
  }
  if (mode === "pending") {
    return "No accounts currently have Pending orders.";
  }
  if (mode === "bound") {
    return "No accounts currently have Bound orders.";
  }
  if (mode === "lost") {
    return "No accounts currently have Lost orders.";
  }
  return "No accounts in the book yet — the five-minute refresh will fill this in.";
}

function hrefWithParams(
  basePath: string,
  params: SearchParams,
  patch: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...patch })) {
    if (value !== undefined && value !== "") next.set(key, value);
  }
  const query = next.toString();
  return `${basePath}${query ? `?${query}` : ""}`;
}

export async function AccountOrdersPage({
  mode,
  searchParams,
}: {
  mode: BookOrdersViewMode;
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const source = parseAccountSource(params.source);
  const requestedPage = Math.max(
    1,
    Number.parseInt(params.page ?? "1", 10) || 1,
  );
  const view = getAccountOrdersView(mode);
  const range =
    mode === "pending" || mode === "bound"
      ? parseOrderReportingRange(params.range)
      : undefined;
  // IQ Stage only on IQ + All Accounts / Pending Orders.
  const iqStageSupported = source === "iq" && (mode === "all" || mode === "pending");
  const iqStages = iqStageSupported ? parseIqStages(params.iqStage) : [];
  const serializedStages = serializeIqStages(iqStages);
  if (
    (range && params.range !== range) ||
    (!range && params.range !== undefined) ||
    (source === "all" && params.source !== undefined) ||
    (source !== "all" && params.source !== source) ||
    (!iqStageSupported && params.iqStage !== undefined) ||
    (iqStageSupported && (params.iqStage ?? undefined) !== serializedStages)
  ) {
    const normalized = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (
        value !== undefined &&
        key !== "range" &&
        key !== "source" &&
        key !== "iqStage"
      ) {
        normalized.set(key, value);
      }
    }
    if (range) normalized.set("range", range);
    if (source !== "all") normalized.set("source", source);
    if (serializedStages) normalized.set("iqStage", serializedStages);
    const query = normalized.toString();
    redirect(`${view.href}${query ? `?${query}` : ""}`);
  }
  const reportingWindow = range && range !== "all-time"
    ? loadSupabaseBook()?.reportingWindows?.ranges[range]
    : undefined;
  const boundaryLabel =
    range === "all-time"
      ? "All available order history"
      : reportingWindow
        ? `${formatRangeDay(reportingWindow.startsOn)} – ${formatRangeDay(
            reportingWindow.endsOn,
          )} PT`
        : "Reporting window refreshing";

  let result = listBookAccountsPage({
    query: q,
    mode,
    range,
    source,
    iqStages,
    offset: (requestedPage - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  if (page !== requestedPage) {
    result = listBookAccountsPage({
      query: q,
      mode,
      range,
      source,
      iqStages,
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
  }

  const {
    total,
    withBoundOrders,
    withPendingOrders,
    withLostOrders,
    boundOrderCount,
    pendingOrderCount,
    lostOrderCount,
    revenueMicros,
    missingRevenueOrderCount,
    rows,
  } = result;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const operator = await getSessionOperator();
  // Resolved once here so every order preview on the page measures deal age
  // against the same Harper-timezone day, server render and hydration alike.
  const todayDay = harperCalendarDay(new Date())!;

  return (
    <>
      <Nav active={view.href} operator={operator} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <p className="eyebrow">Records</p>
          <AccountViewTitle mode={mode} currentParams={params} />
          <div className="mt-3">
            <AccountFilterToolbar
              basePath={view.href}
              currentParams={params}
              source={source}
              range={range}
              rangeWindowLabel={boundaryLabel}
              showIqStage={iqStageSupported}
              iqStages={iqStages}
            />
          </div>
          <div className="mt-4">
            <KpiStrip
              stats={kpiStats({
                mode,
                total,
                withBoundOrders,
                withPendingOrders,
                withLostOrders,
                boundOrderCount,
                pendingOrderCount,
                lostOrderCount,
                revenueMicros,
                missingRevenueOrderCount,
              })}
            />
          </div>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Expand an account to view its orders.
          </p>
        </div>

        <form
          action={view.href}
          method="get"
          className="mb-4 flex flex-wrap items-center gap-2"
        >
          {range ? <input type="hidden" name="range" value={range} /> : null}
          {source !== "all" ? (
            <input type="hidden" name="source" value={source} />
          ) : null}
          {serializedStages ? (
            <input type="hidden" name="iqStage" value={serializedStages} />
          ) : null}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by account name or DBA…"
            className="w-72 rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-3 py-1.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
          <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
            Search
          </button>
          {q ? (
            <Link
              href={hrefWithParams(view.href, params, {
                q: undefined,
                page: undefined,
              })}
              className="text-xs text-[var(--muted)] underline-offset-2 hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </form>

        <div
          id="account-results"
          tabIndex={-1}
          className="scroll-mt-4 overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] shadow-sm focus:outline-none"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--rule)] bg-[var(--sand)]/50 px-4 py-2 text-[var(--muted)]">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide">
                Account
              </span>
              <span
                className="h-4 w-px bg-[var(--rule)]"
                aria-hidden="true"
              />
              <span className="flex items-baseline gap-1 normal-case tracking-normal">
                <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">
                  {total.toLocaleString()}
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {total === 1 ? "total account" : "total accounts"}
                </span>
              </span>
            </div>
            <PaginationControls
              currentPage={page}
              totalPages={pageCount}
              currentParams={params}
              basePath={view.href}
              placement="top"
            />
          </div>
          <AllAccountsList
            rows={rows}
            emptyMessage={emptyMessage(mode, q, source)}
            richCards={mode !== "all"}
            canEditOrders={canEditOrders(operator)}
            bigBrotherBaseUrl={bigBrotherBaseUrl()}
            todayDay={todayDay}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]">
          <span>
            Showing {from.toLocaleString()}–{to.toLocaleString()} of{" "}
            {total.toLocaleString()}
          </span>
          <PaginationControls
            currentPage={page}
            totalPages={pageCount}
            currentParams={params}
            basePath={view.href}
            placement="bottom"
          />
        </div>
      </main>
    </>
  );
}
