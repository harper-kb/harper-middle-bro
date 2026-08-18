/**
 * The canonical Records filter state.
 *
 * Every Records surface — the server query, the KPI strip, the filter
 * controls, the sticky summary, pagination, the account-detail round trip and
 * browser history — reads and writes this one shape. The URL is the durable
 * representation: `parseRecordsFilterState` is the only thing that turns a
 * request into state, `serializeRecordsFilterState` is the only thing that
 * turns state back into a URL, and `normalizeRecordsFilterState` is the only
 * place that decides which filters may coexist.
 *
 * The invariant that keeps a filtered list from collapsing to All Accounts:
 * an unrecognised value is dropped on its own field, never by resetting the
 * model. A stale carrier key, a repeated `?iqStage=` param, a hand-typed sort
 * token and a page past the end each cost exactly the field they touch.
 */

import {
  parseAccountSource,
  type AccountSourceId,
} from "@/lib/account-source";
import {
  ACCOUNT_SORT_PARAM,
  DEFAULT_ACCOUNT_SORT,
  parseAccountSort,
  serializeAccountSort,
  type AccountSort,
} from "@/lib/account-sort";
import {
  parseBrokerGates,
  serializeBrokerGates,
  type BrokerGateFilterId,
} from "@/lib/broker-gate";
import {
  CARRIER_FILTER_PARAM,
  parseCarrierFilter,
  serializeCarrierFilter,
} from "@/lib/carrier-filter";
import type { BookOrdersViewMode } from "@/lib/db";
import {
  parseIqStages,
  serializeIqStages,
  type IqStageFilterId,
} from "@/lib/iq-stage";
import {
  LOCATION_STATE_FILTER_PARAM,
  parseLocationStates,
  serializeLocationStates,
  type LocationStateFilterId,
} from "@/lib/location-state";
import {
  parseOrderReportingRange,
  type OrderReportingRangeId,
} from "@/lib/order-reporting";
import {
  DATE_RANGE_FILTER_PARAM,
  getAccountOrdersView,
  supportsDateRange,
  supportsSourcePipelineFilters,
} from "./view-config";

export type RecordsView = BookOrdersViewMode;

export const ACCOUNT_SOURCE_PARAM = "source";
export const IQ_STAGE_FILTER_PARAM = "iqStage";
export const BROKER_GATE_FILTER_PARAM = "brokerGate";
export const ACCOUNT_QUERY_PARAM = "q";
export const ACCOUNT_PAGE_PARAM = "page";

/**
 * Canonical parameter order. Fixed so one filter state has exactly one URL:
 * the toolbar's own reading order (source, its dependent stage/gate, date),
 * then the facet row, then sort, then free text, then the page.
 */
export const RECORDS_FILTER_PARAM_ORDER = [
  ACCOUNT_SOURCE_PARAM,
  IQ_STAGE_FILTER_PARAM,
  BROKER_GATE_FILTER_PARAM,
  DATE_RANGE_FILTER_PARAM,
  CARRIER_FILTER_PARAM,
  LOCATION_STATE_FILTER_PARAM,
  ACCOUNT_SORT_PARAM,
  ACCOUNT_QUERY_PARAM,
  ACCOUNT_PAGE_PARAM,
] as const;

const OWNED_PARAMS: ReadonlySet<string> = new Set(RECORDS_FILTER_PARAM_ORDER);

/** The shape Next.js actually hands a page, repeated params included. */
export type RecordsSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type RecordsFilterState = {
  view: RecordsView;
  source: AccountSourceId;
  iqStages: readonly IqStageFilterId[];
  brokerGates: readonly BrokerGateFilterId[];
  /** Undefined on the views without a reporting window. */
  range: OrderReportingRangeId | undefined;
  carriers: readonly string[];
  locationStates: readonly LocationStateFilterId[];
  sort: AccountSort;
  query: string;
  page: number;
  /** Params Records does not own, carried through every transition. */
  passthrough: Readonly<Record<string, string>>;
};

/** Fields a caller may change; `passthrough` and `view` have their own helpers. */
export type RecordsFilterPatch = Partial<
  Omit<RecordsFilterState, "passthrough">
>;

/**
 * Collapse the runtime param shape to the single string the field parsers
 * expect. A repeated `?carrier=a&carrier=b` is a malformed request for a
 * comma-list param, not a reason to throw or to discard the other filters.
 */
export function readRecordsParam(
  params: RecordsSearchParams,
  key: string,
): string | undefined {
  const value = params[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((entry) => entry !== undefined);
  return undefined;
}

/** Repeated list params are equivalent to one comma-list param. */
export function readRecordsListParam(
  params: RecordsSearchParams,
  key: string,
): string | undefined {
  const value = params[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(",");
  return undefined;
}

function parsePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

/**
 * Apply the dependent-filter rules. Each incompatible field is cleared on its
 * own; everything still valid survives untouched.
 */
export function normalizeRecordsFilterState(
  state: RecordsFilterState,
): RecordsFilterState {
  const pipelineSupported = supportsSourcePipelineFilters(state.view);
  const rangeSupported = supportsDateRange(state.view);
  const passthrough: Record<string, string> = {};
  for (const [key, value] of Object.entries(state.passthrough)) {
    if (!OWNED_PARAMS.has(key) && value !== undefined) passthrough[key] = value;
  }

  return {
    view: state.view,
    source: state.source,
    // IQ Stage lives under IQ, Broker Gate under Broker, and neither exists on
    // the views without a pipeline. Switching source clears only the other
    // source's selection.
    iqStages:
      state.source === "iq" && pipelineSupported
        ? parseIqStages(serializeIqStages(state.iqStages))
        : [],
    brokerGates:
      state.source === "broker" && pipelineSupported
        ? parseBrokerGates(serializeBrokerGates(state.brokerGates))
        : [],
    range: rangeSupported ? (state.range ?? "all-time") : undefined,
    // Round-tripping through the field's own codec is what deduplicates,
    // sorts and caps each list identically everywhere.
    carriers: parseCarrierFilter(serializeCarrierFilter(state.carriers)),
    locationStates: parseLocationStates(
      serializeLocationStates(state.locationStates),
    ),
    sort: parseAccountSort(serializeAccountSort(state.sort)),
    query: state.query.trim(),
    page: Number.isFinite(state.page) && state.page > 1 ? state.page : 1,
    passthrough,
  };
}

/** The state a view shows when the URL carries nothing valid. */
export function defaultRecordsFilterState(
  view: RecordsView,
): RecordsFilterState {
  return normalizeRecordsFilterState({
    view,
    source: "all",
    iqStages: [],
    brokerGates: [],
    range: undefined,
    carriers: [],
    locationStates: [],
    sort: { ...DEFAULT_ACCOUNT_SORT },
    query: "",
    page: 1,
    passthrough: {},
  });
}

export function isDefaultRecordsFilterState(
  state: RecordsFilterState,
): boolean {
  // "Full reset" means the product-wide default, not merely an unfiltered
  // Pending/Bound/Lost view. The view itself is durable user intent.
  return recordsFilterHref(state) === "/all-accounts";
}

/** The one place a request becomes Records state. */
export function parseRecordsFilterState(
  view: RecordsView,
  params: RecordsSearchParams,
): RecordsFilterState {
  const passthrough: Record<string, string> = {};
  for (const key of Object.keys(params)) {
    if (OWNED_PARAMS.has(key)) continue;
    const single = readRecordsParam(params, key);
    if (single !== undefined) passthrough[key] = single;
  }

  return normalizeRecordsFilterState({
    view,
    source: parseAccountSource(readRecordsParam(params, ACCOUNT_SOURCE_PARAM)),
    iqStages: parseIqStages(
      readRecordsListParam(params, IQ_STAGE_FILTER_PARAM),
    ),
    brokerGates: parseBrokerGates(
      readRecordsListParam(params, BROKER_GATE_FILTER_PARAM),
    ),
    range: parseOrderReportingRange(
      readRecordsParam(params, DATE_RANGE_FILTER_PARAM),
    ),
    carriers: parseCarrierFilter(
      readRecordsListParam(params, CARRIER_FILTER_PARAM),
    ),
    locationStates: parseLocationStates(
      readRecordsListParam(params, LOCATION_STATE_FILTER_PARAM),
    ),
    sort: parseAccountSort(
      readRecordsListParam(params, ACCOUNT_SORT_PARAM),
    ),
    query: readRecordsParam(params, ACCOUNT_QUERY_PARAM) ?? "",
    page: parsePage(readRecordsParam(params, ACCOUNT_PAGE_PARAM)),
    passthrough,
  });
}

/**
 * The one place Records state becomes a URL. Defaults are omitted, so a view
 * with no filters is its bare path and needs no normalizing redirect.
 */
export function serializeRecordsFilterState(
  state: RecordsFilterState,
): URLSearchParams {
  const normalized = normalizeRecordsFilterState(state);
  const params = new URLSearchParams();

  if (normalized.source !== "all") {
    params.set(ACCOUNT_SOURCE_PARAM, normalized.source);
  }
  const stages = serializeIqStages(normalized.iqStages);
  if (stages) params.set(IQ_STAGE_FILTER_PARAM, stages);
  const gates = serializeBrokerGates(normalized.brokerGates);
  if (gates) params.set(BROKER_GATE_FILTER_PARAM, gates);
  if (normalized.range && normalized.range !== "all-time") {
    params.set(DATE_RANGE_FILTER_PARAM, normalized.range);
  }
  const carriers = serializeCarrierFilter(normalized.carriers);
  if (carriers) params.set(CARRIER_FILTER_PARAM, carriers);
  const states = serializeLocationStates(normalized.locationStates);
  if (states) params.set(LOCATION_STATE_FILTER_PARAM, states);
  const sort = serializeAccountSort(normalized.sort);
  if (sort) params.set(ACCOUNT_SORT_PARAM, sort);
  if (normalized.query) params.set(ACCOUNT_QUERY_PARAM, normalized.query);
  if (normalized.page > 1) {
    params.set(ACCOUNT_PAGE_PARAM, String(normalized.page));
  }
  // Foreign params keep working, in a stable position and order.
  for (const key of Object.keys(normalized.passthrough).sort()) {
    params.set(key, normalized.passthrough[key]);
  }

  return params;
}

/** The canonical URL for a state — path plus canonical query. */
export function recordsFilterHref(
  state: RecordsFilterState,
  options?: { hash?: string },
): string {
  const query = serializeRecordsFilterState(state).toString();
  const hash = options?.hash ? `#${options.hash}` : "";
  return `${getAccountOrdersView(state.view).href}${query ? `?${query}` : ""}${hash}`;
}

/** Canonical adapter for small pure href tests and non-React call sites. */
export function recordsFilterHrefFromParams(
  basePath: string,
  params: RecordsSearchParams,
  patch: RecordsFilterPatch,
  options?: { hash?: string },
): string {
  const view = getAccountOrdersViewFromPath(basePath);
  return recordsFilterHref(
    updateRecordsFilters(parseRecordsFilterState(view, params), patch),
    options,
  );
}

export function getAccountOrdersViewFromPath(path: string): RecordsView {
  const view = [
    getAccountOrdersView("all"),
    getAccountOrdersView("pending"),
    getAccountOrdersView("bound"),
    getAccountOrdersView("lost"),
  ].find((entry) => entry.href === path);
  if (!view) throw new Error(`Not a Records path: ${path}`);
  return view.id;
}

/** Stable identity for a state — equal keys mean the same URL. */
export function recordsFilterKey(state: RecordsFilterState): string {
  return recordsFilterHref(state);
}

/**
 * Exactly the query string the request carried, repeated params included, so
 * the page can tell a canonical URL from one that needs normalizing.
 */
export function rawRecordsQuery(params: RecordsSearchParams): string {
  const raw = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) raw.append(key, entry);
    } else {
      raw.append(key, value);
    }
  }
  return raw.toString();
}

/**
 * True when the request already spells this state canonically. Parsing is
 * idempotent, so redirecting on false always settles in one hop.
 */
export function isCanonicalRecordsQuery(
  state: RecordsFilterState,
  params: RecordsSearchParams,
): boolean {
  return (
    rawRecordsQuery(params) === serializeRecordsFilterState(state).toString()
  );
}

/** Everything except the page — the fields that change which rows match. */
function resultSetKey(state: RecordsFilterState): string {
  return recordsFilterHref({ ...state, page: 1 });
}

/**
 * Merge a partial change into a complete state. Callers pass only what they
 * own; every other active filter survives, and the page returns to 1 whenever
 * the result set itself changed.
 */
export function updateRecordsFilters(
  current: RecordsFilterState,
  patch: RecordsFilterPatch | ((state: RecordsFilterState) => RecordsFilterPatch),
): RecordsFilterState {
  const resolved = typeof patch === "function" ? patch(current) : patch;
  const next = normalizeRecordsFilterState({ ...current, ...resolved });
  if (resolved.page === undefined && resultSetKey(next) !== resultSetKey(current)) {
    return { ...next, page: 1 };
  }
  return next;
}

/**
 * Switch Records view, keeping every filter the destination can still apply.
 * Source, carriers, Location States, sort and search always survive; IQ Stage
 * and Broker Gate survive where the destination has a pipeline; the date range
 * survives where the destination has a reporting window. Page restarts because
 * the destination is a different result set.
 */
export function withRecordsView(
  state: RecordsFilterState,
  view: RecordsView,
): RecordsFilterState {
  return normalizeRecordsFilterState({ ...state, view, page: 1 });
}

/**
 * Clamp a page that live data has invalidated. Only the page moves — every
 * filter that produced the count is preserved.
 */
export function clampRecordsPage(
  state: RecordsFilterState,
  pageCount: number,
): RecordsFilterState {
  const highest = Math.max(1, pageCount);
  return state.page > highest ? { ...state, page: highest } : state;
}

/** The intentional reset: this view, no filters. */
export function clearRecordsFilters(
  state: RecordsFilterState,
): RecordsFilterState {
  return {
    ...defaultRecordsFilterState(state.view),
    passthrough: state.passthrough,
  };
}

export function hasActiveRecordsFilters(state: RecordsFilterState): boolean {
  return (
    state.source !== "all" ||
    state.iqStages.length > 0 ||
    state.brokerGates.length > 0 ||
    (state.range !== undefined && state.range !== "all-time") ||
    state.carriers.length > 0 ||
    state.locationStates.length > 0 ||
    serializeAccountSort(state.sort) !== undefined
  );
}
