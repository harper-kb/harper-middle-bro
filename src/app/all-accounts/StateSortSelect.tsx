"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  locationStateLabel,
  sortLocationStates,
  type LocationStateFilterId,
} from "@/lib/location-state";
import {
  ACCOUNT_DATE_ORDER_IDS,
  ACCOUNT_DATE_ORDER_LABELS,
  ACCOUNT_REVENUE_ORDER_IDS,
  ACCOUNT_REVENUE_ORDER_LABELS,
  accountSortSummary,
  DEFAULT_ACCOUNT_SORT,
  isDefaultAccountSort,
  type AccountSort,
} from "@/lib/account-sort";
import type { BookLocationStateFacetOption } from "@/lib/db";
import { RecordsFilterFocusBackdrop } from "./RecordsFilterFocusBackdrop";
import { useRecordsFilters } from "./RecordsFilterProvider";
import { recordsFilterHrefFromParams } from "./records-filter-state";

/** Pure adapter retained for component-level URL contract tests. */
export function stateSortHref(
  basePath: string,
  currentParams: Record<string, string | undefined>,
  states: readonly LocationStateFilterId[],
  sort: AccountSort,
): string {
  return recordsFilterHrefFromParams(basePath, currentParams, {
    locationStates: states,
    sort,
  });
}

/** Summary of the state selection alone ("All states", "CA", "3 states"). */
export function stateSelectionSummary(
  states: readonly LocationStateFilterId[],
): string {
  if (states.length === 0) return "All states";
  if (states.length === 1) {
    return states[0] === "state:none" ? "Unknown" : states[0]!;
  }
  return `${states.length} states`;
}

/** Collapsed-trigger wording: "State & Sort", "CA · Newest", "3 states"… */
export function stateSortTriggerText(
  states: readonly LocationStateFilterId[],
  sort: AccountSort,
): string {
  const statesActive = states.length > 0;
  const sortSummary = accountSortSummary(sort);
  if (!statesActive && sortSummary === null) return "State & Sort";
  const statesSummary = stateSelectionSummary(states);
  if (sortSummary === null) return statesSummary;
  return `${statesSummary} · ${sortSummary}`;
}

function SlidersIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      width={11}
      height={11}
      fill="none"
      aria-hidden="true"
      className="pipeline-trigger-icon"
    >
      <path
        d="M1.5 3.25h9M1.5 8.75h9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="7.75" cy="3.25" r="1.45" stroke="currentColor" strokeWidth="1.2" fill="var(--surface-raised)" />
      <circle cx="4.25" cy="8.75" r="1.45" stroke="currentColor" strokeWidth="1.2" fill="var(--surface-raised)" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className="h-3 w-3 shrink-0 text-[var(--muted)]"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.2 10.2 3 3" />
    </svg>
  );
}

function Chevron({ open }: { open?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={12}
      height={12}
      fill="none"
      aria-hidden="true"
      className={`pipeline-chevron${open ? " state-dropdown-chevron--open" : ""}`}
    >
      <path
        d="M3 4.5 6 7.5 9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface StateEntry {
  id: LocationStateFilterId;
  code: string | null;
  label: string;
  /** Matching accounts under the current non-state filters; null = none. */
  accountCount: number | null;
  selected: boolean;
}

export function StateSortSelect({
  selectedStates,
  sort,
  options,
  unavailableSelected,
  resultTotal,
}: {
  /** @deprecated URL ownership lives in RecordsFilterProvider. */
  basePath?: string;
  /** @deprecated URL ownership lives in RecordsFilterProvider. */
  currentParams?: Record<string, string | undefined>;
  /** Canonical selected location-state ids (page-parsed, sorted). */
  selectedStates: readonly LocationStateFilterId[];
  /** Applied list ordering. */
  sort: AccountSort;
  /** Available options under every current non-state filter. */
  options: readonly BookLocationStateFacetOption[];
  /** Selected ids with no match under the current non-state filters. */
  unavailableSelected: readonly {
    id: LocationStateFilterId;
    label: string;
  }[];
  /** Accounts matching all filters, for the polite announcement. */
  resultTotal: number;
}) {
  const { latest, update, isPending: pending } = useRecordsFilters();
  const [open, setOpen] = useState(false);
  // The state picker is a dropdown inside the popover — collapsed by
  // default so the sort groups below always start in view.
  const [statesOpen, setStatesOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The Selected group is frozen per popover session, like the Carrier menu:
  // entries never jump between groups mid-interaction.
  const [pinnedIds, setPinnedIds] = useState<readonly LocationStateFilterId[]>(
    [],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const statesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const popoverId = useId();
  const labelId = useId();
  const statesLabelId = useId();
  const statesValueId = useId();
  const statesPanelId = useId();
  const dateLabelId = useId();
  const revenueLabelId = useId();
  const dateName = useId();
  const revenueName = useId();

  const selectedSet = useMemo(() => new Set(selectedStates), [selectedStates]);
  const countById = useMemo(
    () => new Map(options.map((option) => [option.id, option.accountCount])),
    [options],
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onFocusIn(event: FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const focusStatesOnOpen = useRef(false);
  useEffect(() => {
    if (open && focusStatesOnOpen.current) {
      focusStatesOnOpen.current = false;
      statesTriggerRef.current?.focus();
    }
  }, [open]);

  const focusSearchOnExpand = useRef(false);
  useEffect(() => {
    if (statesOpen && focusSearchOnExpand.current) {
      focusSearchOnExpand.current = false;
      searchRef.current?.focus();
    }
  }, [statesOpen]);

  function openPopover(focusStates = true) {
    setPinnedIds(selectedStates);
    setQuery("");
    setStatesOpen(false);
    focusStatesOnOpen.current = focusStates;
    setOpen(true);
  }

  function toggleStatesDropdown(focusSearch = true) {
    if (statesOpen) {
      setStatesOpen(false);
      return;
    }
    setQuery("");
    focusSearchOnExpand.current = focusSearch;
    setStatesOpen(true);
  }

  function apply(
    nextStates: readonly LocationStateFilterId[],
    nextSort: AccountSort,
    trigger: string,
  ) {
    update(
      { locationStates: nextStates, sort: nextSort },
      {
        reason: trigger.startsWith("sort-") ? "sort" : "filter",
        trigger,
      },
    );
  }

  function toggleState(id: LocationStateFilterId) {
    const current = latest();
    const currentSet = new Set(current.locationStates);
    apply(
      currentSet.has(id)
        ? current.locationStates.filter((stateId) => stateId !== id)
        : [...current.locationStates, id],
      current.sort,
      "location-state",
    );
  }

  const search = query.trim().toLowerCase();
  const matchesSearch = (entry: { code: string | null; label: string }) =>
    !search ||
    entry.label.toLowerCase().includes(search) ||
    (entry.code ?? "").toLowerCase().startsWith(search);

  const pinnedSet = new Set(pinnedIds);
  const pinnedEntries: StateEntry[] = sortLocationStates(pinnedIds)
    .map((id) => ({
      id,
      code: id === "state:none" ? null : id,
      label: locationStateLabel(id),
      accountCount: countById.get(id) ?? null,
      selected: selectedSet.has(id),
    }))
    .filter(matchesSearch);
  const listEntries: StateEntry[] = options
    .filter((option) => !pinnedSet.has(option.id))
    .filter(matchesSearch)
    .map((option) => ({
      id: option.id,
      code: option.code,
      label: option.label,
      accountCount: option.accountCount,
      selected: selectedSet.has(option.id),
    }));
  const visibleCount = pinnedEntries.length + listEntries.length;

  /**
   * Arrow-key traversal across the state dropdown field, its search box and
   * the state checkboxes. Radios are deliberately left out: a radio group
   * owns its own arrow-key behavior (move + select within the group).
   */
  function handlePopoverKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    if (active instanceof HTMLInputElement && active.type === "radio") return;
    const stops: HTMLElement[] = [
      statesTriggerRef.current,
      searchRef.current,
      ...(listRef.current
        ? [
            ...listRef.current.querySelectorAll<HTMLElement>(
              "input[type=checkbox]",
            ),
          ]
        : []),
    ].filter((el): el is HTMLElement => Boolean(el));
    if (stops.length === 0) return;
    const index = active ? stops.indexOf(active) : -1;
    // Home/End inside the search box keep their native caret behavior.
    if ((event.key === "Home" || event.key === "End") && active === searchRef.current) {
      return;
    }
    if (index === -1 && event.key !== "Home") return;
    event.preventDefault();
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = stops.length - 1;
    else if (event.key === "ArrowDown")
      next = Math.min(index + 1, stops.length - 1);
    else next = Math.max(index - 1, 0);
    stops[next]?.focus();
  }

  const statesActive = selectedStates.length > 0;
  const sortActive = !isDefaultAccountSort(sort);
  const active = statesActive || sortActive;
  const triggerText = stateSortTriggerText(selectedStates, sort);
  const selectedLabels = sortLocationStates(selectedStates).map(
    locationStateLabel,
  );
  const sortSummary = accountSortSummary(sort);

  function renderEntry(entry: StateEntry) {
    const unavailable = entry.accountCount === null;
    return (
      <li key={entry.id}>
        <label
          className={`pipeline-option carrier-option${
            unavailable ? " carrier-option--unavailable" : ""
          }`}
          title={entry.label}
        >
          <input
            type="checkbox"
            checked={entry.selected}
            onChange={() => toggleState(entry.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                toggleState(entry.id);
              }
            }}
            aria-label={`${entry.label}${
              unavailable
                ? ", unavailable with current filters"
                : `, ${entry.accountCount!.toLocaleString()} matching ${
                    entry.accountCount === 1 ? "account" : "accounts"
                  }`
            }`}
          />
          {entry.code ? (
            <span className="pipeline-option-code">{entry.code}</span>
          ) : null}
          <span className="carrier-option-name">{entry.label}</span>
          {unavailable ? (
            <span className="carrier-option-note">Unavailable</span>
          ) : (
            <span className="carrier-option-count" aria-hidden="true">
              {entry.accountCount!.toLocaleString()}
            </span>
          )}
        </label>
      </li>
    );
  }

  return (
    <>
      {open ? (
        <RecordsFilterFocusBackdrop onDismiss={() => setOpen(false)} />
      ) : null}
      <div
        className={`pipeline-select pipeline-select--carrier state-sort-select${
          open ? " records-filter-control--open" : ""
        }`}
        ref={rootRef}
      >
      <button
        ref={triggerRef}
        type="button"
        className={`filter-select pipeline-trigger carrier-trigger${
          active ? " carrier-trigger--active" : ""
        }`}
        aria-label={`Filter by location state and sort accounts${
          active ? `: ${triggerText}` : ""
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={
          active
            ? [
                statesActive ? selectedLabels.join(", ") : null,
                sortSummary,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        onClick={() => (open ? setOpen(false) : openPopover(false))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          if (open) statesTriggerRef.current?.focus();
          else openPopover();
        }}
      >
        <SlidersIcon />
        <span className="pipeline-trigger-label">{triggerText}</span>
        {pending ? (
          <span aria-hidden="true" className="carrier-trigger-spinner" />
        ) : null}
        <Chevron />
      </button>

      {open ? (
        <div
          id={popoverId}
          className="pipeline-popover carrier-popover state-sort-popover"
          role="dialog"
          aria-labelledby={labelId}
          aria-busy={pending}
          onKeyDown={handlePopoverKeyDown}
        >
          <span id={labelId} className="sr-only">
            Location state and sort
          </span>
          <div className="carrier-popover-head">
            <span id={statesLabelId} className="carrier-popover-label">
              Location State
            </span>
            <button
              type="button"
              className="filter-clear"
              disabled={!active}
              onClick={() => apply([], DEFAULT_ACCOUNT_SORT, "state-sort-clear")}
            >
              Clear
            </button>
          </div>

          {/* The state picker: a dropdown selection inside the popover. */}
          <button
            ref={statesTriggerRef}
            type="button"
            className="filter-select pipeline-trigger state-dropdown-trigger"
            aria-labelledby={`${statesLabelId} ${statesValueId}`}
            aria-expanded={statesOpen}
            aria-controls={statesOpen ? statesPanelId : undefined}
            onClick={() => toggleStatesDropdown(false)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !statesOpen) {
                event.preventDefault();
                event.stopPropagation();
                toggleStatesDropdown();
              }
            }}
          >
            <span className="pipeline-trigger-label" id={statesValueId}>
              {stateSelectionSummary(selectedStates)}
            </span>
            <Chevron open={statesOpen} />
          </button>

          {statesOpen ? (
            <div id={statesPanelId} className="state-dropdown-panel">
              <div className="carrier-search">
                <SearchIcon />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && query) {
                      event.preventDefault();
                      event.stopPropagation();
                      setQuery("");
                    }
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Search states…"
                  aria-label="Search location states"
                  className="carrier-search-input"
                />
              </div>
              <ul
                ref={listRef}
                className="pipeline-popover-list carrier-popover-list state-sort-state-list"
                role="group"
                aria-labelledby={statesLabelId}
              >
                {visibleCount === 0 ? (
                  <li className="carrier-popover-empty">
                    {options.length === 0 && unavailableSelected.length === 0
                      ? "No location states in this view."
                      : `No states match “${query.trim()}”.`}
                  </li>
                ) : (
                  <>
                    {pinnedEntries.length > 0 ? (
                      <>
                        <li className="carrier-group-label" aria-hidden="true">
                          Selected
                        </li>
                        {pinnedEntries.map(renderEntry)}
                        {listEntries.length > 0 ? (
                          <li
                            className="carrier-group-label"
                            aria-hidden="true"
                          >
                            All states
                          </li>
                        ) : null}
                      </>
                    ) : null}
                    {listEntries.map(renderEntry)}
                  </>
                )}
              </ul>
            </div>
          ) : null}

          <div className="state-sort-sort">
            <span id={dateLabelId} className="carrier-popover-label">
              Sort · Date
            </span>
            <div
              role="radiogroup"
              aria-labelledby={dateLabelId}
              className="state-sort-radios"
            >
              {ACCOUNT_DATE_ORDER_IDS.map((id) => (
                <label key={id} className="pipeline-option state-sort-radio">
                  <input
                    type="radio"
                    name={dateName}
                    checked={sort.date === id}
                    onChange={() => {
                      const current = latest();
                      apply(
                        current.locationStates,
                        { ...current.sort, date: id },
                        "sort-date",
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const current = latest();
                        apply(
                          current.locationStates,
                          { ...current.sort, date: id },
                          "sort-date-keyboard",
                        );
                      }
                    }}
                  />
                  <span>{ACCOUNT_DATE_ORDER_LABELS[id]}</span>
                </label>
              ))}
            </div>
            <span id={revenueLabelId} className="carrier-popover-label">
              Sort · Revenue
            </span>
            <div
              role="radiogroup"
              aria-labelledby={revenueLabelId}
              className="state-sort-radios"
            >
              {ACCOUNT_REVENUE_ORDER_IDS.map((id) => (
                <label key={id} className="pipeline-option state-sort-radio">
                  <input
                    type="radio"
                    name={revenueName}
                    checked={sort.revenue === id}
                    onChange={() => {
                      const current = latest();
                      apply(
                        current.locationStates,
                        { ...current.sort, revenue: id },
                        "sort-revenue",
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const current = latest();
                        apply(
                          current.locationStates,
                          { ...current.sort, revenue: id },
                          "sort-revenue-keyboard",
                        );
                      }
                    }}
                  />
                  <span>{ACCOUNT_REVENUE_ORDER_LABELS[id]}</span>
                </label>
              ))}
            </div>
          </div>
          <p role="status" className="sr-only">
            {statesOpen && search
              ? `${visibleCount.toLocaleString()} ${
                  visibleCount === 1 ? "state" : "states"
                } shown`
              : ""}
          </p>
        </div>
      ) : null}

      <p role="status" className="sr-only">
        {active && !pending
          ? `${resultTotal.toLocaleString()} ${
              resultTotal === 1 ? "account" : "accounts"
            }${
              statesActive
                ? ` in ${selectedStates.length} selected ${
                    selectedStates.length === 1 ? "state" : "states"
                  }`
                : ""
            }${sortSummary ? `, sorted ${sortSummary}` : ""}`
          : ""}
      </p>
      </div>
    </>
  );
}
