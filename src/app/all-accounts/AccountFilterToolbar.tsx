"use client";

import { useRouter } from "next/navigation";
import {
  useId,
  useRef,
  useTransition,
  type KeyboardEvent,
} from "react";
import {
  ACCOUNT_SOURCE_IDS,
  ACCOUNT_SOURCE_LABELS,
  type AccountSourceId,
} from "@/lib/account-source";
import { SourceIcon } from "@/components/SourceIdentity";
import {
  IQ_STAGE_FILTER_OPTIONS,
  serializeIqStages,
  type IqStageFilterId,
} from "@/lib/iq-stage";
import {
  BROKER_GATE_FILTER_OPTIONS,
  serializeBrokerGates,
  type BrokerGateFilterId,
} from "@/lib/broker-gate";
import {
  ORDER_REPORTING_RANGE_IDS,
  ORDER_REPORTING_RANGE_LABELS,
  type OrderReportingRangeId,
} from "@/lib/order-reporting";
import {
  CARRIER_FILTER_PARAM,
  serializeCarrierFilter,
} from "@/lib/carrier-filter";
import {
  LOCATION_STATE_FILTER_PARAM,
  serializeLocationStates,
  type LocationStateFilterId,
} from "@/lib/location-state";
import {
  ACCOUNT_SORT_PARAM,
  DEFAULT_ACCOUNT_SORT,
  isDefaultAccountSort,
  serializeAccountSort,
  type AccountSort,
} from "@/lib/account-sort";
import { SOURCE_PIPELINE_FILTER_PARAMS } from "./view-config";
import { PipelineMultiSelect } from "./PipelineMultiSelect";

const SOURCE_TOOLTIP =
  "Instant-quote flag on the order's deals. An account with both IQ and broker orders in this view appears only under All.";

const SOURCE_VARIANTS: Record<AccountSourceId, string> = {
  all: "",
  iq: "seg-option--iq",
  broker: "seg-option--broker",
};

/**
 * Same URL contract the previous two controls had: every other param survives,
 * `page` resets, `source=all` drops out, and `range` is always written on the
 * views that have a reporting window (matching the page's normalizing redirect).
 * The source-scoped pipeline params are the single cleanup point: `iqStage` is
 * written only when source is IQ, `brokerGate` only when source is Broker, and
 * both fall out of the URL under any other source. The carrier, location
 * state and sort selections are source-free and are carried through
 * explicitly (so Clear filters can drop them); callers that are not changing
 * them pass the current values.
 */
export function accountFilterHref({
  basePath,
  currentParams,
  source,
  range,
  iqStages = [],
  brokerGates = [],
  carriers = [],
  locationStates = [],
  sort = DEFAULT_ACCOUNT_SORT,
}: {
  basePath: string;
  currentParams: Record<string, string | undefined>;
  source: AccountSourceId;
  range: OrderReportingRangeId | undefined;
  iqStages?: readonly IqStageFilterId[];
  brokerGates?: readonly BrokerGateFilterId[];
  carriers?: readonly string[];
  locationStates?: readonly LocationStateFilterId[];
  sort?: AccountSort;
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    if (
      value !== undefined &&
      key !== "page" &&
      key !== "source" &&
      key !== "range" &&
      key !== CARRIER_FILTER_PARAM &&
      key !== LOCATION_STATE_FILTER_PARAM &&
      key !== ACCOUNT_SORT_PARAM &&
      !SOURCE_PIPELINE_FILTER_PARAMS.includes(key)
    ) {
      params.set(key, value);
    }
  }
  if (source !== "all") params.set("source", source);
  if (range) params.set("range", range);
  const stageParam =
    source === "iq" ? serializeIqStages(iqStages) : undefined;
  if (stageParam) params.set("iqStage", stageParam);
  const gateParam =
    source === "broker" ? serializeBrokerGates(brokerGates) : undefined;
  if (gateParam) params.set("brokerGate", gateParam);
  const carrierParam = serializeCarrierFilter(carriers);
  if (carrierParam) params.set(CARRIER_FILTER_PARAM, carrierParam);
  const stateParam = serializeLocationStates(locationStates);
  if (stateParam) params.set(LOCATION_STATE_FILTER_PARAM, stateParam);
  const sortParam = serializeAccountSort(sort);
  if (sortParam) params.set(ACCOUNT_SORT_PARAM, sortParam);
  const query = params.toString();
  return `${basePath}${query ? `?${query}` : ""}`;
}

function CheckIcon() {
  return (
    <span className="seg-check" aria-hidden="true">
      <svg viewBox="0 0 12 12" fill="none">
        <path
          d="M2.25 6.5 4.75 9l5-6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * Segmented radiogroup: one option is always selected, so it carries roving
 * tabindex and arrow-key traversal rather than a tab stop per option. The
 * checkmark keeps the selected state legible without leaning on the tint.
 */
function SegmentedControl<Id extends string>({
  options,
  selected,
  onSelect,
  labelledBy,
  display,
  variantFor,
  iconFor,
  title,
}: {
  options: readonly { id: Id; label: string }[];
  selected: Id;
  onSelect: (id: Id) => void;
  labelledBy: string;
  display: string;
  variantFor?: (id: Id) => string;
  /** Decorative — the option's own text is what names it. */
  iconFor?: (id: Id) => React.ReactNode;
  title?: string;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
    onSelect(options[nextIndex].id);
  }

  return (
    <div
      className={`seg ${display}`}
      role="radiogroup"
      aria-labelledby={labelledBy}
      title={title}
    >
      {options.map((option, index) => {
        const active = option.id === selected;
        return (
          <button
            key={option.id}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={`seg-option ${variantFor?.(option.id) ?? ""}`}
            onClick={() => onSelect(option.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <CheckIcon />
            {iconFor?.(option.id)}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Shared Accounts filter toolbar for All Accounts, Pending, Bound and Lost
 * Orders. `range` is omitted on the views that have no reporting window, which
 * is what keeps All Accounts and Lost Orders free of a date filter.
 * IQ Stage appears only when `showIqStage` is true (IQ + All/Pending);
 * Broker Gate only when `showBrokerGate` is true (Broker + All/Pending).
 */
export function AccountFilterToolbar({
  basePath,
  currentParams,
  source,
  range,
  rangeWindowLabel,
  showIqStage = false,
  iqStages = [],
  showBrokerGate = false,
  brokerGates = [],
  carriers = [],
  locationStates = [],
  sort = DEFAULT_ACCOUNT_SORT,
}: {
  basePath: string;
  currentParams: Record<string, string | undefined>;
  source: AccountSourceId;
  range?: OrderReportingRangeId;
  rangeWindowLabel?: string;
  showIqStage?: boolean;
  iqStages?: readonly IqStageFilterId[];
  showBrokerGate?: boolean;
  brokerGates?: readonly BrokerGateFilterId[];
  /** Selected carrier keys — owned by the search-row control, cleared here. */
  carriers?: readonly string[];
  /** Selected location states — owned by State & Sort, cleared here. */
  locationStates?: readonly LocationStateFilterId[];
  /** Applied sort — owned by State & Sort, restored to default here. */
  sort?: AccountSort;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const sourceLabelId = useId();
  const rangeLabelId = useId();
  const stageLabelId = useId();
  const gateLabelId = useId();
  const filtersActive =
    source !== "all" ||
    (range !== undefined && range !== "all-time") ||
    (showIqStage && iqStages.length > 0) ||
    (showBrokerGate && brokerGates.length > 0) ||
    carriers.length > 0 ||
    locationStates.length > 0 ||
    !isDefaultAccountSort(sort);

  function push(
    nextSource: AccountSourceId,
    nextRange: OrderReportingRangeId | undefined,
    nextStages: readonly IqStageFilterId[],
    nextGates: readonly BrokerGateFilterId[],
    nextCarriers: readonly string[] = carriers,
    nextLocationStates: readonly LocationStateFilterId[] = locationStates,
    nextSort: AccountSort = sort,
  ) {
    if (
      nextSource === source &&
      nextRange === range &&
      serializeIqStages(nextStages) === serializeIqStages(iqStages) &&
      serializeBrokerGates(nextGates) === serializeBrokerGates(brokerGates) &&
      serializeCarrierFilter(nextCarriers) ===
        serializeCarrierFilter(carriers) &&
      serializeLocationStates(nextLocationStates) ===
        serializeLocationStates(locationStates) &&
      serializeAccountSort(nextSort) === serializeAccountSort(sort)
    ) {
      return;
    }
    const href = accountFilterHref({
      basePath,
      currentParams,
      source: nextSource,
      range: nextRange,
      iqStages: nextSource === "iq" ? nextStages : [],
      brokerGates: nextSource === "broker" ? nextGates : [],
      carriers: nextCarriers,
      locationStates: nextLocationStates,
      sort: nextSort,
    });
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  }

  return (
    <div className="filter-toolbar" aria-busy={pending}>
      <div className="min-w-0">
        <span className="filter-group-label">
          <span id={sourceLabelId}>Account Source</span>
        </span>
        <SegmentedControl
          options={ACCOUNT_SOURCE_IDS.map((id) => ({
            id,
            label: ACCOUNT_SOURCE_LABELS[id],
          }))}
          selected={source}
          onSelect={(next) =>
            push(
              next,
              range,
              next === "iq" ? iqStages : [],
              next === "broker" ? brokerGates : [],
            )
          }
          labelledBy={sourceLabelId}
          display="inline-flex"
          variantFor={(id) => SOURCE_VARIANTS[id]}
          iconFor={(id) =>
            id === "all" ? null : (
              <SourceIcon source={id} className="seg-option-icon" />
            )
          }
          title={SOURCE_TOOLTIP}
        />
      </div>

      {showIqStage ? (
        <div className="min-w-0">
          <span className="filter-group-label">
            <span id={stageLabelId}>IQ Stage</span>
          </span>
          <PipelineMultiSelect
            options={IQ_STAGE_FILTER_OPTIONS}
            selected={iqStages}
            onChange={(next) => push(source, range, next, brokerGates)}
            labelledBy={stageLabelId}
            accent="iq"
            noun="stage"
          />
        </div>
      ) : null}

      {showBrokerGate ? (
        <div className="min-w-0">
          <span className="filter-group-label">
            <span id={gateLabelId}>Broker Gate</span>
          </span>
          <PipelineMultiSelect
            options={BROKER_GATE_FILTER_OPTIONS}
            selected={brokerGates}
            onChange={(next) => push(source, range, iqStages, next)}
            labelledBy={gateLabelId}
            accent="broker"
            noun="gate"
            triggerIcon={
              <SourceIcon source="broker" className="pipeline-trigger-icon" />
            }
          />
        </div>
      ) : null}

      {range ? (
        <div className="min-w-0">
          <span className="filter-group-label">
            <span id={rangeLabelId}>Date Range</span>
            {range !== "all-time" && rangeWindowLabel ? (
              <span className="filter-group-note">{rangeWindowLabel}</span>
            ) : null}
          </span>
          <SegmentedControl
            options={ORDER_REPORTING_RANGE_IDS.map((id) => ({
              id,
              label: ORDER_REPORTING_RANGE_LABELS[id],
            }))}
            selected={range}
            onSelect={(next) => push(source, next, iqStages, brokerGates)}
            labelledBy={rangeLabelId}
            display="hidden sm:inline-flex"
            variantFor={() => "seg-option--accent"}
          />
          <select
            className="filter-select sm:hidden"
            aria-labelledby={rangeLabelId}
            value={range}
            onChange={(event) =>
              push(
                source,
                event.target.value as OrderReportingRangeId,
                iqStages,
                brokerGates,
              )
            }
          >
            {ORDER_REPORTING_RANGE_IDS.map((id) => (
              <option key={id} value={id}>
                {ORDER_REPORTING_RANGE_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {pending || filtersActive ? (
        <div className="flex items-center gap-2">
          {pending ? (
            <span className="filter-group-note" role="status">
              Updating…
            </span>
          ) : null}
          {filtersActive ? (
            <button
              type="button"
              className="filter-clear"
              onClick={() =>
                push(
                  "all",
                  range ? "all-time" : undefined,
                  [],
                  [],
                  [],
                  [],
                  DEFAULT_ACCOUNT_SORT,
                )
              }
            >
              <svg
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
                className="size-2.5"
              >
                <path
                  d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
