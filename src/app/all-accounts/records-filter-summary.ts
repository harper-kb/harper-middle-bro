import {
  ACCOUNT_SOURCE_LABELS,
  type AccountSourceId,
} from "@/lib/account-source";
import {
  accountSortSummary,
  type AccountSort,
} from "@/lib/account-sort";
import {
  BROKER_GATE_FILTER_OPTIONS,
  BROKER_GATE_NONE,
  type BrokerGateFilterId,
} from "@/lib/broker-gate";
import {
  IQ_STAGE_FILTER_OPTIONS,
  IQ_STAGE_UNRECOGNIZED,
  IQ_STAGE_UNRECOGNIZED_LABEL,
  type IqStageFilterId,
} from "@/lib/iq-stage";
import {
  LOCATION_STATE_NONE,
  locationStateLabel,
  type LocationStateFilterId,
} from "@/lib/location-state";
import {
  ORDER_REPORTING_RANGE_LABELS,
  type OrderReportingRangeId,
} from "@/lib/order-reporting";

export type RecordsFilterSummaryTone = "neutral" | "iq" | "broker";

export type RecordsFilterSummaryItem = {
  id:
    | "source"
    | "pipeline"
    | "carrier"
    | "location"
    | "date"
    | "sort"
    | "search";
  category: string;
  /** Short, visual wording used by the compact chip. */
  label: string;
  /** Complete wording used by the overflow disclosure. */
  detail: string;
  /** Explicit control name; never relies on color or neighboring text. */
  accessibleLabel: string;
  tone: RecordsFilterSummaryTone;
};

export type SelectedCarrierSummary = {
  key: string;
  label: string;
};

export type RecordsFilterSummaryState = {
  source: AccountSourceId;
  iqStages: readonly IqStageFilterId[];
  brokerGates: readonly BrokerGateFilterId[];
  range?: OrderReportingRangeId;
  carriers: readonly SelectedCarrierSummary[];
  locationStates: readonly LocationStateFilterId[];
  sort: AccountSort;
  search: string;
};

const CHIP_TEXT_LIMIT = 24;
const SEARCH_TEXT_LIMIT = 26;

/**
 * Truncate by Unicode code point rather than UTF-16 code unit so an emoji or
 * accented character can never be cut in half. CSS still provides the final
 * width guard for unusually wide glyphs.
 */
export function truncateRecordsFilterText(
  value: string,
  limit = CHIP_TEXT_LIMIT,
): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  const points = Array.from(normalized);
  if (points.length <= limit) return normalized;
  return `${points.slice(0, Math.max(1, limit - 1)).join("")}…`;
}

const IQ_STAGE_LABELS = new Map<IqStageFilterId, string>([
  ...IQ_STAGE_FILTER_OPTIONS.map(
    (option) => [option.id, option.label] as const,
  ),
  [IQ_STAGE_UNRECOGNIZED, IQ_STAGE_UNRECOGNIZED_LABEL],
]);

const BROKER_GATE_LABELS = new Map<BrokerGateFilterId, string>(
  BROKER_GATE_FILTER_OPTIONS.map((option) => [
    option.id,
    option.code ? `${option.code} — ${option.label}` : option.label,
  ]),
);

function stageLabel(id: IqStageFilterId): string {
  return IQ_STAGE_LABELS.get(id) ?? id;
}

function gateLabel(id: BrokerGateFilterId): string {
  return BROKER_GATE_LABELS.get(id) ?? id;
}

/**
 * One pure summary model for the query state shared by every Records view.
 * Its order is also the responsive priority order: source, source-scoped
 * pipeline, carrier, location, date, sort, then search.
 */
export function buildRecordsFilterSummary(
  state: RecordsFilterSummaryState,
): RecordsFilterSummaryItem[] {
  const items: RecordsFilterSummaryItem[] = [];

  if (state.source !== "all") {
    const label = ACCOUNT_SOURCE_LABELS[state.source];
    items.push({
      id: "source",
      category: "Account source",
      label,
      detail: `Account source: ${label}`,
      accessibleLabel: `Account source: ${label}`,
      tone: state.source,
    });
  }

  if (state.source === "iq" && state.iqStages.length > 0) {
    const labels = state.iqStages.map(stageLabel);
    const label =
      labels.length === 1
        ? truncateRecordsFilterText(labels[0])
        : `${labels.length} IQ stages`;
    items.push({
      id: "pipeline",
      category: "IQ Stage",
      label,
      detail: `IQ Stage: ${labels.join(", ")}`,
      accessibleLabel:
        labels.length === 1
          ? `IQ Stage selected: ${labels[0]}`
          : `${labels.length} IQ stages selected`,
      tone: "iq",
    });
  }

  if (state.source === "broker" && state.brokerGates.length > 0) {
    const labels = state.brokerGates.map(gateLabel);
    const shortGate =
      state.brokerGates.length === 1
        ? state.brokerGates[0] === BROKER_GATE_NONE
          ? "Gate unavailable"
          : state.brokerGates[0]
        : `${state.brokerGates.length} Gates`;
    items.push({
      id: "pipeline",
      category: "Broker Gate",
      label: shortGate,
      detail: `Broker Gate: ${labels.join(", ")}`,
      accessibleLabel:
        labels.length === 1
          ? `Broker Gate selected: ${labels[0]}`
          : `${labels.length} Broker Gates selected`,
      tone: "broker",
    });
  }

  if (state.carriers.length > 0) {
    const labels = state.carriers.map(
      (carrier) => carrier.label.trim() || carrier.key,
    );
    const label =
      labels.length === 1
        ? truncateRecordsFilterText(labels[0])
        : `${labels.length} carriers`;
    items.push({
      id: "carrier",
      category: "Carrier",
      label,
      detail: `${labels.length === 1 ? "Carrier" : "Carriers"}: ${labels.join(
        ", ",
      )}`,
      accessibleLabel:
        labels.length === 1
          ? `Carrier selected: ${labels[0]}`
          : `${labels.length} carriers selected`,
      tone: "neutral",
    });
  }

  if (state.locationStates.length > 0) {
    const shortLabels = state.locationStates.map((id) =>
      id === LOCATION_STATE_NONE ? "Unknown" : id,
    );
    const detailLabels = state.locationStates.map((id) =>
      id === LOCATION_STATE_NONE
        ? locationStateLabel(id)
        : `${id} — ${locationStateLabel(id)}`,
    );
    const label =
      shortLabels.length === 1
        ? shortLabels[0]
        : `${shortLabels[0]} +${shortLabels.length - 1}`;
    items.push({
      id: "location",
      category: "Location State",
      label,
      detail: `Location State${
        detailLabels.length === 1 ? "" : "s"
      }: ${detailLabels.join(", ")}`,
      accessibleLabel:
        detailLabels.length === 1
          ? `Location State selected: ${detailLabels[0]}`
          : `${detailLabels.length} Location States selected`,
      tone: "neutral",
    });
  }

  if (state.range && state.range !== "all-time") {
    const label = ORDER_REPORTING_RANGE_LABELS[state.range];
    items.push({
      id: "date",
      category: "Date range",
      label,
      detail: `Date range: ${label}`,
      accessibleLabel: `Date range: ${label}`,
      tone: "neutral",
    });
  }

  const sortLabel = accountSortSummary(state.sort);
  if (sortLabel) {
    items.push({
      id: "sort",
      category: "Sort order",
      label: sortLabel,
      detail: `Sort order: ${sortLabel}`,
      accessibleLabel: `Sort order: ${sortLabel}`,
      tone: "neutral",
    });
  }

  const search = state.search.trim().replace(/\s+/g, " ");
  if (search) {
    items.push({
      id: "search",
      category: "Account search",
      label: `Search: “${truncateRecordsFilterText(
        search,
        SEARCH_TEXT_LIMIT,
      )}”`,
      detail: `Account search: “${search}”`,
      accessibleLabel: `Account search: ${search}`,
      tone: "neutral",
    });
  }

  return items;
}
