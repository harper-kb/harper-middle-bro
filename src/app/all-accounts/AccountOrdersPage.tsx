import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import {
  listBookAccountCarrierFacet,
  listBookAccountLocationStateFacet,
  listBookAccountsPage,
  type BookOrdersViewMode,
} from "@/lib/db";
import { loadSupabaseBook } from "@/lib/supabase-book.server";
import { harperCalendarDay } from "@/lib/order-age";
import {
  ACCOUNT_SOURCE_LABELS,
  type AccountSourceId,
} from "@/lib/account-source";
import {
  bigBrotherBaseUrl,
  canEditOrders,
} from "@/lib/order-action-gates";
import { getSessionOperator } from "@/lib/session";
import { AccountFilterToolbar } from "./AccountFilterToolbar";
import { AccountSearchField } from "./AccountSearchField";
import { AccountViewTitle } from "./AccountViewTitle";
import { CarrierMultiSelect } from "./CarrierMultiSelect";
import { StateSortSelect } from "./StateSortSelect";
import { AccountResultsPanel } from "./AccountResultsPanel";
import { RecordsFilterProvider } from "./RecordsFilterProvider";
import { RecordsLiveRefresh } from "./RecordsLiveRefresh";
import { RecordsScrollRestoration } from "./RecordsScrollRestoration";
import { KpiStrip, type KpiStat } from "./KpiStrip";
import { PaginationControls } from "./PaginationControls";
import {
  getAccountOrdersView,
  supportsSourcePipelineFilters,
} from "./view-config";
import {
  clampRecordsPage,
  isCanonicalRecordsQuery,
  parseRecordsFilterState,
  readRecordsParam,
  recordsFilterHref,
  RECORDS_FILTER_PARAM_ORDER,
  serializeRecordsFilterState,
  withRecordsView,
  type RecordsFilterState,
  type RecordsSearchParams,
} from "./records-filter-state";
import {
  reportRecordsInitialized,
  reportRecordsPageClamped,
  reportRecordsUrlNormalized,
} from "./records-telemetry";

const PAGE_SIZE = 100;

type SearchParams = RecordsSearchParams;

/** Which owned params the request spelled in a way the state could not keep. */
function droppedRecordsParams(
  state: RecordsFilterState,
  params: RecordsSearchParams,
): string[] {
  const canonical = serializeRecordsFilterState(state);
  return RECORDS_FILTER_PARAM_ORDER.filter((key) => {
    const raw = readRecordsParam(params, key);
    return raw !== undefined && raw !== canonical.get(key);
  });
}

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
  state,
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
  /** Canonical state, so a drill-down keeps every compatible filter. */
  state: RecordsFilterState;
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
      href: recordsFilterHref(withRecordsView(state, "bound")),
      recordsView: "bound",
    },
    {
      label: "Pending Deals",
      value: pendingOrderCount,
      tone: "pending",
      tooltipAccountCount: withPendingOrders,
      href: recordsFilterHref(withRecordsView(state, "pending")),
      recordsView: "pending",
    },
    {
      label: "Lost Deals",
      value: lostOrderCount,
      tone: "lost",
      tooltipAccountCount: withLostOrders,
      href: recordsFilterHref(withRecordsView(state, "lost")),
      recordsView: "lost",
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
  /** Active carrier + location-state selections, combined. */
  facetCount: number,
): string {
  const sourceLabel =
    source === "all" ? "" : ` ${ACCOUNT_SOURCE_LABELS[source]}`;
  if (facetCount > 0) {
    return "No accounts in this view match the selected carrier and location filters.";
  }
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
  return "No accounts in the book yet — the two-minute refresh will fill this in.";
}

export async function AccountOrdersPage({
  mode,
  searchParams,
}: {
  mode: BookOrdersViewMode;
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const view = getAccountOrdersView(mode);
  // One parse for the whole page: rows, metrics, facets, controls, the sticky
  // summary and every outbound link all read this one state.
  const requested = parseRecordsFilterState(mode, params);
  reportRecordsInitialized(requested);
  if (!isCanonicalRecordsQuery(requested, params)) {
    // The request spelled its own state some other way — a stale param, a
    // repeated key, an incompatible dependent filter, a value this view
    // cannot apply. Each of those was already dropped on its own field, so
    // this only rewrites the URL to match the state that survived.
    reportRecordsUrlNormalized({
      state: requested,
      droppedParams: droppedRecordsParams(requested, params),
    });
    redirect(recordsFilterHref(requested));
  }

  const {
    source,
    iqStages,
    brokerGates,
    range,
    carriers,
    locationStates,
    sort,
    query: q,
  } = requested;
  const requestedPage = requested.page;
  const iqStageSupported =
    source === "iq" && supportsSourcePipelineFilters(mode);
  const brokerGateSupported =
    source === "broker" && supportsSourcePipelineFilters(mode);
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

  const result = listBookAccountsPage({
    query: q,
    mode,
    range,
    source,
    iqStages,
    brokerGates,
    carriers,
    locationStates,
    sort,
    offset: (requestedPage - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  // Live data can shrink the book under a page the operator is holding. Only
  // the page moves: every filter that produced this count is preserved, and
  // the list stays where they left it rather than resetting to All Accounts.
  const state = clampRecordsPage(requested, pageCount);
  const page = state.page;
  if (page !== requestedPage) {
    reportRecordsPageClamped({ state, requestedPage, pageCount });
    redirect(recordsFilterHref(state));
  }
  // Contextual options under every active filter except each facet's own
  // selection (facet self-exclusion) — same request, same data revision as
  // the rows above. Sort never reaches a facet: it orders, never filters.
  const carrierFacet = listBookAccountCarrierFacet({
    query: q,
    mode,
    range,
    source,
    iqStages,
    brokerGates,
    locationStates,
    selectedCarriers: carriers,
  });
  const locationStateFacet = listBookAccountLocationStateFacet({
    query: q,
    mode,
    range,
    source,
    iqStages,
    brokerGates,
    carriers,
    selectedStates: locationStates,
  });
  const carrierLabelByKey = new Map<string, string>();
  for (const option of carrierFacet.options) {
    carrierLabelByKey.set(option.key, option.label);
  }
  for (const option of carrierFacet.unavailableSelected) {
    carrierLabelByKey.set(option.key, option.label);
  }
  const selectedCarrierSummaries = carriers.map((key) => ({
    key,
    label: carrierLabelByKey.get(key) ?? key,
  }));

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
    <RecordsFilterProvider state={state}>
      {/* One store for the whole route: sidebar, title, controls and pagination
          all merge into the same latest canonical state. */}
      <Nav active={view.href} operator={operator} />
      <RecordsLiveRefresh />
      <RecordsScrollRestoration state={state} />
        <main className="mx-auto max-w-6xl px-4 py-8">
          <div className="mb-6">
            <p className="eyebrow">Records</p>
            <AccountViewTitle mode={mode} />
            <div className="mt-3">
              <AccountFilterToolbar
                source={source}
                range={range}
                rangeWindowLabel={boundaryLabel}
                showIqStage={iqStageSupported}
                iqStages={iqStages}
                showBrokerGate={brokerGateSupported}
                brokerGates={brokerGates}
                carriers={carriers}
                locationStates={locationStates}
                sort={sort}
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
                  state,
                })}
              />
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Expand an account to view its orders.
            </p>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <AccountSearchField committedQuery={q} resultCount={total} />
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <CarrierMultiSelect
                selected={carriers}
                options={carrierFacet.options}
                unavailableSelected={carrierFacet.unavailableSelected}
                resultTotal={total}
              />
              <StateSortSelect
                selectedStates={locationStates}
                sort={sort}
                options={locationStateFacet.options}
                unavailableSelected={locationStateFacet.unavailableSelected}
                resultTotal={total}
              />
            </div>
          </div>

          <AccountResultsPanel
            rows={rows}
            emptyMessage={emptyMessage(
              mode,
              q,
              source,
              carriers.length + locationStates.length,
            )}
            canEditOrders={canEditOrders(operator)}
            bigBrotherBaseUrl={bigBrotherBaseUrl()}
            todayDay={todayDay}
            total={total}
            view={{ id: view.id, title: view.title }}
            filterState={{
              source,
              iqStages,
              brokerGates,
              range,
              carriers: selectedCarrierSummaries,
              locationStates,
              sort,
              search: q,
            }}
            pagination={{ currentPage: page, totalPages: pageCount }}
            // The clamped state, so an account opened from the last page
            // returns to a page that still exists.
            recordsHref={recordsFilterHref(state)}
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]">
            <span>
              Showing {from.toLocaleString()}–{to.toLocaleString()} of{" "}
              {total.toLocaleString()}
            </span>
            <PaginationControls
              currentPage={page}
              totalPages={pageCount}
              placement="bottom"
            />
          </div>
        </main>
    </RecordsFilterProvider>
  );
}
