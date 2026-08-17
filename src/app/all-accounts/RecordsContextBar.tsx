"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import type { BookOrdersViewMode } from "@/lib/db";
import { PaginationControls } from "./PaginationControls";
import {
  buildRecordsFilterSummary,
  type RecordsFilterSummaryItem,
  type RecordsFilterSummaryState,
} from "./records-filter-summary";

function CollapseAllIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="close-all-icon"
    >
      <path
        d="M2.5 5.75 6 2.25l3.5 3.5M2.5 9.75 6 6.25l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterChip({
  item,
  index,
}: {
  item: RecordsFilterSummaryItem;
  index: number;
}) {
  return (
    <li
      className={`records-filter-chip records-filter-chip--${item.tone}`}
      title={item.detail}
      data-filter-kind={item.id}
      data-filter-rank={index + 1}
    >
      <span aria-hidden="true" className="records-filter-chip-label">
        {item.label}
      </span>
      <span className="sr-only">{item.accessibleLabel}</span>
    </li>
  );
}

function OverflowButton({
  items,
  visibleCount,
  variant,
  open,
  controls,
  onToggle,
}: {
  items: readonly RecordsFilterSummaryItem[];
  visibleCount: number;
  variant: "wide" | "medium" | "narrow";
  open: boolean;
  controls: string;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const hiddenCount = items.length - visibleCount;
  if (hiddenCount <= 0) return null;
  return (
    <button
      type="button"
      className={`records-filter-overflow records-filter-overflow--${variant}`}
      data-overflow-limit={visibleCount}
      aria-label={`${hiddenCount} additional active ${
        hiddenCount === 1 ? "filter" : "filters"
      }, show all active filters`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      +{hiddenCount} {hiddenCount === 1 ? "filter" : "filters"}
    </button>
  );
}

function ActiveFilterSummaryContent({
  items,
  summaryRef,
}: {
  items: readonly RecordsFilterSummaryItem[];
  summaryRef: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!summaryRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      lastTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, summaryRef]);

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    lastTriggerRef.current = event.currentTarget;
    setOpen((current) => !current);
  };

  return (
    <>
      <ul className="records-filter-chips" aria-label="Active filters">
        {items.slice(0, 5).map((item, index) => (
          <FilterChip key={item.id} item={item} index={index} />
        ))}
      </ul>

      <OverflowButton
        items={items}
        visibleCount={5}
        variant="wide"
        open={open}
        controls={popoverId}
        onToggle={toggle}
      />
      <OverflowButton
        items={items}
        visibleCount={3}
        variant="medium"
        open={open}
        controls={popoverId}
        onToggle={toggle}
      />
      <OverflowButton
        items={items}
        visibleCount={1}
        variant="narrow"
        open={open}
        controls={popoverId}
        onToggle={toggle}
      />

      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-labelledby={titleId}
          className="records-filter-popover"
        >
          <div className="records-filter-popover-head">
            <span id={titleId}>Active filters</span>
            <span className="tabular-nums text-[var(--muted)]">
              {items.length}
            </span>
          </div>
          <ul className="records-filter-popover-list">
            {items.map((item) => (
              <li key={item.id}>
                <span
                  className={`records-filter-popover-mark records-filter-popover-mark--${item.tone}`}
                  aria-hidden="true"
                />
                <span>
                  <span className="records-filter-popover-category">
                    {item.category}
                  </span>
                  <span className="records-filter-popover-detail">
                    {item.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function ActiveFilterSummary({
  items,
  visible,
}: {
  items: readonly RecordsFilterSummaryItem[];
  visible: boolean;
}) {
  const summaryRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) {
    return (
      <div
        className="records-filter-summary records-filter-summary--empty"
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      ref={summaryRef}
      className="records-filter-summary"
      aria-hidden={visible ? undefined : true}
      inert={!visible}
      aria-label={`${items.length} active ${
        items.length === 1 ? "filter" : "filters"
      }`}
    >
      <ActiveFilterSummaryContent
        key={visible ? "pinned" : "resting"}
        items={items}
        summaryRef={summaryRef}
      />
    </div>
  );
}

export type RecordsContextPagination = {
  currentPage: number;
  totalPages: number;
  currentParams: Record<string, string | undefined>;
  basePath: string;
};

export function RecordsContextBar({
  headerRef,
  pinned,
  viewMode,
  viewTitle,
  total,
  filterState,
  openCount,
  onCloseAll,
  pagination,
}: {
  headerRef?: RefObject<HTMLDivElement | null>;
  pinned: boolean;
  viewMode: BookOrdersViewMode;
  viewTitle: string;
  total: number;
  filterState: RecordsFilterSummaryState;
  openCount: number;
  onCloseAll: () => void;
  pagination: RecordsContextPagination;
}) {
  const activeFilters = useMemo(
    () => buildRecordsFilterSummary(filterState),
    [filterState],
  );

  return (
    <div
      ref={headerRef}
      className={`account-results-header${
        pinned ? " account-results-header--pinned" : ""
      }`}
      data-pinned={pinned ? "true" : "false"}
      role="region"
      aria-label="Records controls and active filters"
    >
      <div className="records-context-layout">
        <div
          className="records-context-identity"
          role="group"
          aria-label={`${viewTitle}, ${total.toLocaleString("en-US")} matching ${
            total === 1 ? "account" : "accounts"
          }`}
        >
          <span
            className={`records-view-indicator records-view-indicator--${viewMode}`}
            aria-hidden="true"
          />
          <span className="records-view-title">{viewTitle}</span>
          <span className="records-context-separator" aria-hidden="true">
            ·
          </span>
          <span className="records-context-count">
            <strong>{total.toLocaleString("en-US")}</strong>{" "}
            <span className="records-context-count-noun">
              {total === 1 ? "account" : "accounts"}
            </span>
          </span>
        </div>

        <ActiveFilterSummary
          key={activeFilters
            .map((item) => `${item.id}:${item.detail}`)
            .join("|")}
          items={activeFilters}
          visible={pinned}
        />

        <div className="records-close-slot">
          {openCount > 0 ? (
            <button
              type="button"
              className="close-all-button"
              onClick={onCloseAll}
              title="Close all accounts"
              aria-label={`Close all accounts, ${openCount} ${
                openCount === 1 ? "account" : "accounts"
              } open`}
            >
              <CollapseAllIcon />
              <span className="close-all-label">Close all accounts</span>
              {openCount > 1 ? (
                <span className="close-all-count" aria-hidden="true">
                  ({openCount})
                </span>
              ) : null}
            </button>
          ) : null}
        </div>

        <PaginationControls {...pagination} placement="top" />
      </div>
    </div>
  );
}
