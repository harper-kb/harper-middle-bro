"use client";

import {
  useId,
  useRef,
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
  type IqStageFilterId,
} from "@/lib/iq-stage";
import {
  BROKER_GATE_FILTER_OPTIONS,
  type BrokerGateFilterId,
} from "@/lib/broker-gate";
import {
  ORDER_REPORTING_RANGE_IDS,
  ORDER_REPORTING_RANGE_LABELS,
  type OrderReportingRangeId,
} from "@/lib/order-reporting";
import type { LocationStateFilterId } from "@/lib/location-state";
import {
  DEFAULT_ACCOUNT_SORT,
  isDefaultAccountSort,
  type AccountSort,
} from "@/lib/account-sort";
import { PipelineMultiSelect } from "./PipelineMultiSelect";
import { useRecordsFilters } from "./RecordsFilterProvider";
import {
  recordsFilterHrefFromParams,
  type RecordsFilterPatch,
} from "./records-filter-state";

const SOURCE_TOOLTIP =
  "Instant-quote flag on the order's deals. An account with both IQ and broker orders in this view appears only under All.";

const SOURCE_VARIANTS: Record<AccountSourceId, string> = {
  all: "",
  iq: "seg-option--iq",
  broker: "seg-option--broker",
};

/** Pure adapter retained for component-level URL contract tests. */
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
  return recordsFilterHrefFromParams(basePath, currentParams, {
    source,
    range,
    iqStages,
    brokerGates,
    carriers,
    locationStates,
    sort,
  });
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
  /** @deprecated URL ownership lives in RecordsFilterProvider. */
  basePath?: string;
  /** @deprecated URL ownership lives in RecordsFilterProvider. */
  currentParams?: Record<string, string | undefined>;
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
  const { update, clear, isPending: pending } = useRecordsFilters();
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

  /**
   * Every change is a partial merged into the newest requested state, so this
   * control can never spell a URL that drops the search box, the carrier
   * selection or the page a sibling control has just set. Normalization sorts
   * out which dependent filter the new source can keep.
   */
  function push(patch: RecordsFilterPatch, trigger: string) {
    update(patch, { reason: "filter", trigger });
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
          onSelect={(next) => push({ source: next }, "account-source")}
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
            onChange={(next) => push({ iqStages: next }, "iq-stage")}
            onToggle={(id) =>
              update(
                (current) => ({
                  iqStages: current.iqStages.includes(id)
                    ? current.iqStages.filter((stage) => stage !== id)
                    : [...current.iqStages, id],
                }),
                { reason: "filter", trigger: "iq-stage-toggle" },
              )
            }
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
            onChange={(next) => push({ brokerGates: next }, "broker-gate")}
            onToggle={(id) =>
              update(
                (current) => ({
                  brokerGates: current.brokerGates.includes(id)
                    ? current.brokerGates.filter((gate) => gate !== id)
                    : [...current.brokerGates, id],
                }),
                { reason: "filter", trigger: "broker-gate-toggle" },
              )
            }
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
            onSelect={(next) => push({ range: next }, "date-range")}
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
                { range: event.target.value as OrderReportingRangeId },
                "date-range-mobile",
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
              onClick={() => clear("clear-filters")}
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
