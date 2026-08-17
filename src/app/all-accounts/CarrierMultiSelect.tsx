"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import {
  CARRIER_FILTER_PARAM,
  serializeCarrierFilter,
} from "@/lib/carrier-filter";
import type { BookCarrierFacetOption } from "@/lib/db";
import { RecordsFilterFocusBackdrop } from "./RecordsFilterFocusBackdrop";

/**
 * The Accounts carrier filter — a compact multi-select popover shared by all
 * four record views (All / Pending / Bound / Lost), sitting at the far right
 * of the search row.
 *
 * Selection is applied immediately (the established Accounts filter UX —
 * IQ Stage and Broker Gate batch nothing), lands in the `carrier` URL param,
 * and re-runs the view's own server query, so rows, KPIs, pagination and the
 * option counts all describe the same filtered order set. The popover stays
 * open across those round-trips: options and counts refresh in place, and
 * the search box inside filters the already-derived option list client-side —
 * it never touches the Accounts search query.
 */

export function carrierFilterHref(
  basePath: string,
  currentParams: Record<string, string | undefined>,
  keys: readonly string[],
): string {
  const params = new URLSearchParams();
  // Every active param except the carrier selection and the page — a new
  // selection is a new result set, so it always starts at page 1.
  for (const [key, value] of Object.entries(currentParams)) {
    if (value !== undefined && key !== CARRIER_FILTER_PARAM && key !== "page") {
      params.set(key, value);
    }
  }
  const serialized = serializeCarrierFilter(keys);
  if (serialized) params.set(CARRIER_FILTER_PARAM, serialized);
  const query = params.toString();
  return `${basePath}${query ? `?${query}` : ""}`;
}

/** Collapsed-trigger wording per the selection size. */
export function carrierTriggerText(labels: readonly string[]): string {
  if (labels.length === 0) return "All carriers";
  const sorted = [...labels].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 1) return sorted[0]!;
  if (sorted.length === 2) return `${sorted[0]} +1`;
  return `${sorted.length} carriers selected`;
}

function CarrierIcon() {
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
        d="M6 1.3 10.1 3v2.9c0 2.5-1.7 4.1-4.1 4.8C3.6 9.99 1.9 8.4 1.9 5.9V3L6 1.3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
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

interface CarrierEntry {
  key: string;
  label: string;
  /** Matching orders under the current non-carrier filters; null = none. */
  orderCount: number | null;
  selected: boolean;
}

export function CarrierMultiSelect({
  basePath,
  currentParams,
  selected,
  options,
  unavailableSelected,
  resultTotal,
}: {
  basePath: string;
  /** Every active URL param, so a selection never drops the view's filters. */
  currentParams: Record<string, string | undefined>;
  /** Canonical selected carrier keys (page-parsed, sorted). */
  selected: readonly string[];
  /** Available options under every current non-carrier filter. */
  options: readonly BookCarrierFacetOption[];
  /** Selected keys with no match under the current non-carrier filters. */
  unavailableSelected: readonly { key: string; label: string }[];
  /** Accounts matching all filters including carriers, for the announcement. */
  resultTotal: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The Selected group is frozen per popover session: entries do not jump
  // between groups mid-interaction, only their checkboxes change.
  const [pinnedKeys, setPinnedKeys] = useState<readonly string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const popoverId = useId();
  const labelId = useId();

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const countByKey = useMemo(
    () => new Map(options.map((option) => [option.key, option.orderCount])),
    [options],
  );
  const labelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of options) map.set(option.key, option.label);
    for (const entry of unavailableSelected) map.set(entry.key, entry.label);
    return map;
  }, [options, unavailableSelected]);
  const labelFor = (key: string) => labelByKey.get(key) ?? key;

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

  const focusSearchOnOpen = useRef(false);
  useEffect(() => {
    if (open && focusSearchOnOpen.current) {
      focusSearchOnOpen.current = false;
      searchRef.current?.focus();
    }
  }, [open]);

  function openPopover(focusSearch = true) {
    setPinnedKeys(selected);
    setQuery("");
    focusSearchOnOpen.current = focusSearch;
    setOpen(true);
  }

  function apply(nextKeys: readonly string[]) {
    startTransition(() => {
      router.push(carrierFilterHref(basePath, currentParams, nextKeys), {
        scroll: false,
      });
    });
  }

  function toggle(key: string) {
    apply(
      selectedSet.has(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key],
    );
  }

  const search = query.trim().toLowerCase();
  const matchesSearch = (label: string, key: string) =>
    !search || label.toLowerCase().includes(search) || key.includes(search);

  const pinnedSet = new Set(pinnedKeys);
  const pinnedEntries: CarrierEntry[] = pinnedKeys
    .map((key) => ({
      key,
      label: labelFor(key),
      orderCount: countByKey.get(key) ?? null,
      selected: selectedSet.has(key),
    }))
    .filter((entry) => matchesSearch(entry.label, entry.key))
    .sort((a, b) => a.label.localeCompare(b.label));
  const listEntries: CarrierEntry[] = options
    .filter((option) => !pinnedSet.has(option.key))
    .filter((option) => matchesSearch(option.label, option.key))
    .map((option) => ({
      key: option.key,
      label: option.label,
      orderCount: option.orderCount,
      selected: selectedSet.has(option.key),
    }));
  const visibleCount = pinnedEntries.length + listEntries.length;

  /** Arrow-key traversal across the search box and every visible checkbox. */
  function handlePopoverKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" &&
        event.key !== "Home" && event.key !== "End") {
      return;
    }
    const stops: HTMLElement[] = [
      searchRef.current,
      ...(listRef.current
        ? [...listRef.current.querySelectorAll<HTMLElement>("input[type=checkbox]")]
        : []),
    ].filter((el): el is HTMLElement => Boolean(el));
    if (stops.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? stops.indexOf(active) : -1;
    // Home/End inside the search box keep their native caret behavior.
    if ((event.key === "Home" || event.key === "End") && index <= 0) return;
    event.preventDefault();
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = stops.length - 1;
    else if (event.key === "ArrowDown") next = Math.min(index + 1, stops.length - 1);
    else next = Math.max(index - 1, 0);
    stops[next]?.focus();
  }

  const selectedLabels = selected.map(labelFor);
  const triggerText = carrierTriggerText(selectedLabels);
  const active = selected.length > 0;

  function renderEntry(entry: CarrierEntry) {
    const unavailable = entry.orderCount === null;
    return (
      <li key={entry.key}>
        <label
          className={`pipeline-option carrier-option${
            unavailable ? " carrier-option--unavailable" : ""
          }`}
          title={entry.label}
        >
          <input
            type="checkbox"
            checked={entry.selected}
            onChange={() => toggle(entry.key)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                toggle(entry.key);
              }
            }}
            aria-label={`${entry.label}${
              unavailable
                ? ", unavailable with current filters"
                : `, ${entry.orderCount!.toLocaleString()} matching ${
                    entry.orderCount === 1 ? "order" : "orders"
                  }`
            }`}
          />
          <span className="carrier-option-name">{entry.label}</span>
          {unavailable ? (
            <span className="carrier-option-note">Unavailable</span>
          ) : (
            <span className="carrier-option-count" aria-hidden="true">
              {entry.orderCount!.toLocaleString()}
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
        className={`pipeline-select pipeline-select--carrier carrier-filter${
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
        aria-label={`Filter by carrier${
          active
            ? `: ${selected.length} ${
                selected.length === 1 ? "carrier" : "carriers"
              } selected`
            : ""
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={
          active
            ? [...selectedLabels].sort((a, b) => a.localeCompare(b)).join(", ")
            : undefined
        }
        onClick={() => (open ? setOpen(false) : openPopover(false))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          if (open) searchRef.current?.focus();
          else openPopover();
        }}
      >
        <CarrierIcon />
        <span className="pipeline-trigger-label">{triggerText}</span>
        {pending ? (
          <span aria-hidden="true" className="carrier-trigger-spinner" />
        ) : null}
        <svg
          viewBox="0 0 12 12"
          width={12}
          height={12}
          fill="none"
          aria-hidden="true"
          className="pipeline-chevron"
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
          id={popoverId}
          className="pipeline-popover carrier-popover"
          role="dialog"
          aria-labelledby={labelId}
          aria-busy={pending}
          onKeyDown={handlePopoverKeyDown}
        >
          <div className="carrier-popover-head">
            <span id={labelId} className="carrier-popover-label">
              Carriers
            </span>
            <button
              type="button"
              className="filter-clear"
              disabled={!active}
              onClick={() => apply([])}
            >
              Clear
            </button>
          </div>
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
              placeholder="Search carriers…"
              aria-label="Search carrier options"
              className="carrier-search-input"
            />
          </div>
          <ul
            ref={listRef}
            className="pipeline-popover-list carrier-popover-list"
            role="group"
            aria-labelledby={labelId}
          >
            {visibleCount === 0 ? (
              <li className="carrier-popover-empty">
                {options.length === 0 && unavailableSelected.length === 0
                  ? "No carriers in this view."
                  : `No carriers match “${query.trim()}”.`}
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
                      <li className="carrier-group-label" aria-hidden="true">
                        All carriers
                      </li>
                    ) : null}
                  </>
                ) : null}
                {listEntries.map(renderEntry)}
              </>
            )}
          </ul>
          {/* Same restrained live-region pattern as the Accounts search:
              only a real narrowing announces, never every keystroke. */}
          <p role="status" className="sr-only">
            {search
              ? `${visibleCount.toLocaleString()} ${
                  visibleCount === 1 ? "carrier" : "carriers"
                } shown`
              : ""}
          </p>
        </div>
      ) : null}

      <p role="status" className="sr-only">
        {active && !pending
          ? `${resultTotal.toLocaleString()} ${
              resultTotal === 1 ? "account matches" : "accounts match"
            } ${selected.length} selected ${
              selected.length === 1 ? "carrier" : "carriers"
            }`
          : ""}
      </p>
      </div>
    </>
  );
}
