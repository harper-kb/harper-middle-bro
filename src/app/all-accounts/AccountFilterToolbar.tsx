"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import {
  ACCOUNT_SOURCE_IDS,
  ACCOUNT_SOURCE_LABELS,
  type AccountSourceId,
} from "@/lib/account-source";
import {
  IQ_STAGE_FILTER_OPTIONS,
  serializeIqStages,
  type IqStageFilterId,
} from "@/lib/iq-stage";
import {
  ORDER_REPORTING_RANGE_IDS,
  ORDER_REPORTING_RANGE_LABELS,
  type OrderReportingRangeId,
} from "@/lib/order-reporting";

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
 * `iqStage` is written only when source is IQ and stages are selected.
 */
export function accountFilterHref({
  basePath,
  currentParams,
  source,
  range,
  iqStages = [],
}: {
  basePath: string;
  currentParams: Record<string, string | undefined>;
  source: AccountSourceId;
  range: OrderReportingRangeId | undefined;
  iqStages?: readonly IqStageFilterId[];
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    if (
      value !== undefined &&
      key !== "page" &&
      key !== "source" &&
      key !== "range" &&
      key !== "iqStage"
    ) {
      params.set(key, value);
    }
  }
  if (source !== "all") params.set("source", source);
  if (range) params.set("range", range);
  const stageParam =
    source === "iq" ? serializeIqStages(iqStages) : undefined;
  if (stageParam) params.set("iqStage", stageParam);
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
  title,
}: {
  options: readonly { id: Id; label: string }[];
  selected: Id;
  onSelect: (id: Id) => void;
  labelledBy: string;
  display: string;
  variantFor?: (id: Id) => string;
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
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function stageTriggerLabel(selected: readonly IqStageFilterId[]): string {
  if (selected.length === 0) return "All stages";
  if (selected.length === 1) return "1 stage selected";
  return `${selected.length} stages selected`;
}

/**
 * Compact multi-select for IQ Stage. Empty selection means all stages (no URL
 * param). Does not look like Account Source's segmented filter.
 */
function IqStageMultiSelect({
  selected,
  onChange,
  labelledBy,
}: {
  selected: readonly IqStageFilterId[];
  onChange: (next: IqStageFilterId[]) => void;
  labelledBy: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selectedSet = new Set(selected);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(id: IqStageFilterId) {
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <div className="iq-stage-select" ref={rootRef}>
      <button
        type="button"
        className="filter-select iq-stage-trigger"
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="iq-stage-trigger-label">{stageTriggerLabel(selected)}</span>
        <svg
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className="iq-stage-chevron"
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          id={listId}
          className="iq-stage-popover"
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={labelledBy}
        >
          <div className="iq-stage-popover-actions">
            <button
              type="button"
              className="filter-clear"
              onClick={() =>
                onChange(IQ_STAGE_FILTER_OPTIONS.map((o) => o.id))
              }
            >
              Select all
            </button>
            <button
              type="button"
              className="filter-clear"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
          <ul className="iq-stage-popover-list">
            {IQ_STAGE_FILTER_OPTIONS.map((option) => {
              const checked = selectedSet.has(option.id);
              return (
                <li key={option.id}>
                  <label className="iq-stage-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(option.id)}
                    />
                    <span>{option.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shared Accounts filter toolbar for All Accounts, Pending, Bound and Lost
 * Orders. `range` is omitted on the views that have no reporting window, which
 * is what keeps All Accounts and Lost Orders free of a date filter.
 * IQ Stage appears only when `showIqStage` is true (IQ + All/Pending).
 */
export function AccountFilterToolbar({
  basePath,
  currentParams,
  source,
  range,
  rangeWindowLabel,
  showIqStage = false,
  iqStages = [],
}: {
  basePath: string;
  currentParams: Record<string, string | undefined>;
  source: AccountSourceId;
  range?: OrderReportingRangeId;
  rangeWindowLabel?: string;
  showIqStage?: boolean;
  iqStages?: readonly IqStageFilterId[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const sourceLabelId = useId();
  const rangeLabelId = useId();
  const stageLabelId = useId();
  const filtersActive =
    source !== "all" ||
    (range !== undefined && range !== "all-time") ||
    (showIqStage && iqStages.length > 0);

  function push(
    nextSource: AccountSourceId,
    nextRange: OrderReportingRangeId | undefined,
    nextStages: readonly IqStageFilterId[],
  ) {
    if (
      nextSource === source &&
      nextRange === range &&
      serializeIqStages(nextStages) === serializeIqStages(iqStages)
    ) {
      return;
    }
    const href = accountFilterHref({
      basePath,
      currentParams,
      source: nextSource,
      range: nextRange,
      iqStages: nextSource === "iq" ? nextStages : [],
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
            push(next, range, next === "iq" ? iqStages : [])
          }
          labelledBy={sourceLabelId}
          display="inline-flex"
          variantFor={(id) => SOURCE_VARIANTS[id]}
          title={SOURCE_TOOLTIP}
        />
      </div>

      {showIqStage ? (
        <div className="min-w-0">
          <span className="filter-group-label">
            <span id={stageLabelId}>IQ Stage</span>
          </span>
          <IqStageMultiSelect
            selected={iqStages}
            onChange={(next) => push(source, range, next)}
            labelledBy={stageLabelId}
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
            onSelect={(next) => push(source, next, iqStages)}
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
              onClick={() => push("all", range ? "all-time" : undefined, [])}
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
