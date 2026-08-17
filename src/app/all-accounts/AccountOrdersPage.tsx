import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import {
  listBookAccountCarrierFacet,
  listBookAccountLocationStateFacet,
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
  parseBrokerGates,
  serializeBrokerGates,
} from "@/lib/broker-gate";
import {
  CARRIER_FILTER_PARAM,
  parseCarrierFilter,
  serializeCarrierFilter,
} from "@/lib/carrier-filter";
import {
  LOCATION_STATE_FILTER_PARAM,
  parseLocationStates,
  serializeLocationStates,
} from "@/lib/location-state";
import {
  ACCOUNT_SORT_PARAM,
  parseAccountSort,
  serializeAccountSort,
} from "@/lib/account-sort";
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
import { RecordsLiveRefresh } from "./RecordsLiveRefresh";
import { KpiStrip, type KpiStat } from "./KpiStrip";
import { PaginationControls } from "./PaginationControls";
import {
  getAccountOrdersView,
  SOURCE_PIPELINE_FILTER_PARAMS,
  supportsSourcePipelineFilters,
} from "./view-config";

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
  const q = (params.q ?? "").trim();
  const source = parseAccountSource(params.source);
  const requestedPage = Math.max(
    1,
    Number.parseInt(params.page ?? "1", 10) || 1,
  );
  const view = getAccountOrdersView(mode);
  const range = parseOrderReportingRange(params.range);
  // Source-scoped pipeline filters, both gated to All Accounts / Pending
  // Orders by the shared view config: IQ Stage under IQ, Broker Gate under
  // Broker. An unsupported param never reaches the query — the normalizing
  // redirect below strips it first.
  const pipelineModeSupported = supportsSourcePipelineFilters(mode);
  const iqStageSupported = source === "iq" && pipelineModeSupported;
  const iqStages = iqStageSupported ? parseIqStages(params.iqStage) : [];
  const serializedStages = serializeIqStages(iqStages);
  const brokerGateSupported = source === "broker" && pipelineModeSupported;
  const brokerGates = brokerGateSupported
    ? parseBrokerGates(params.brokerGate)
    : [];
  const serializedGates = serializeBrokerGates(brokerGates);
  // Carrier, Location State and Sort — apply to every record view and source.
  const carriers = parseCarrierFilter(params[CARRIER_FILTER_PARAM]);
  const serializedCarriers = serializeCarrierFilter(carriers);
  const locationStates = parseLocationStates(
    params[LOCATION_STATE_FILTER_PARAM],
  );
  const serializedLocationStates = serializeLocationStates(locationStates);
  const sort = parseAccountSort(params[ACCOUNT_SORT_PARAM]);
  const serializedSort = serializeAccountSort(sort);
  if (
    (range && params.range !== range) ||
    (!range && params.range !== undefined) ||
    (source === "all" && params.source !== undefined) ||
    (source !== "all" && params.source !== source) ||
    (!iqStageSupported && params.iqStage !== undefined) ||
    (iqStageSupported && (params.iqStage ?? undefined) !== serializedStages) ||
    (!brokerGateSupported && params.brokerGate !== undefined) ||
    (brokerGateSupported &&
      (params.brokerGate ?? undefined) !== serializedGates) ||
    (params[CARRIER_FILTER_PARAM] ?? undefined) !== serializedCarriers ||
    (params[LOCATION_STATE_FILTER_PARAM] ?? undefined) !==
      serializedLocationStates ||
    (params[ACCOUNT_SORT_PARAM] ?? undefined) !== serializedSort
  ) {
    const normalized = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (
        value !== undefined &&
        key !== "range" &&
        key !== "source" &&
        key !== CARRIER_FILTER_PARAM &&
        key !== LOCATION_STATE_FILTER_PARAM &&
        key !== ACCOUNT_SORT_PARAM &&
        !SOURCE_PIPELINE_FILTER_PARAMS.includes(key)
      ) {
        normalized.set(key, value);
      }
    }
    if (range) normalized.set("range", range);
    if (source !== "all") normalized.set("source", source);
    if (serializedStages) normalized.set("iqStage", serializedStages);
    if (serializedGates) normalized.set("brokerGate", serializedGates);
    if (serializedCarriers)
      normalized.set(CARRIER_FILTER_PARAM, serializedCarriers);
    if (serializedLocationStates)
      normalized.set(LOCATION_STATE_FILTER_PARAM, serializedLocationStates);
    if (serializedSort) normalized.set(ACCOUNT_SORT_PARAM, serializedSort);
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
    brokerGates,
    carriers,
    locationStates,
    sort,
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
      brokerGates,
      carriers,
      locationStates,
      sort,
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
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
    <>
      <Nav active={view.href} operator={operator} />
      <RecordsLiveRefresh />
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
              })}
            />
          </div>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Expand an account to view its orders.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <AccountSearchField
            basePath={view.href}
            currentParams={params}
            committedQuery={q}
            resultCount={total}
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <CarrierMultiSelect
              basePath={view.href}
              currentParams={params}
              selected={carriers}
              options={carrierFacet.options}
              unavailableSelected={carrierFacet.unavailableSelected}
              resultTotal={total}
            />
            <StateSortSelect
              basePath={view.href}
              currentParams={params}
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
          pagination={{
            currentPage: page,
            totalPages: pageCount,
            currentParams: params,
            basePath: view.href,
          }}
        />

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
