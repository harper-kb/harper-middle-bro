"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrderDetailDrawerProvider } from "@/components/orders/OrderDetailDrawer";
import { TOP_NAV_METRICS_EVENT } from "@/components/TopNavHeightSync";
import type { BookAccountListItem } from "@/lib/db";
import { AllAccountsList } from "./AllAccountsList";
import {
  RecordsContextBar,
  type RecordsContextPagination,
} from "./RecordsContextBar";
import type { RecordsFilterSummaryState } from "./records-filter-summary";
import { useAccountExpansion } from "./use-account-expansion";

/**
 * Report when the results header has reached its CSS sticky position.
 *
 * Position remains entirely CSS-owned. The observer only adds visual elevation,
 * and the nav's resize event rebuilds its root margin when the responsive top
 * bar changes height. A target below the viewport is deliberately not "pinned":
 * `!isIntersecting` alone would style the header as pinned before it approached.
 */
function useStickyResultsHeader(
  headerRef: React.RefObject<HTMLDivElement | null>,
  sentinelRef: React.RefObject<HTMLDivElement | null>,
): boolean {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    const sentinel = sentinelRef.current;
    if (!header || !sentinel || typeof IntersectionObserver === "undefined") {
      return;
    }
    let crossing: IntersectionObserver | null = null;

    const observe = () => {
      const stickyTop =
        Number.parseFloat(getComputedStyle(header).top) || 0;
      crossing?.disconnect();
      crossing = new IntersectionObserver(
        ([entry]) => {
          const nextPinned =
            !entry.isIntersecting &&
            entry.boundingClientRect.top <= stickyTop;
          setPinned((current) =>
            current === nextPinned ? current : nextPinned,
          );
        },
        {
          threshold: 0,
          rootMargin: `-${Math.max(0, stickyTop)}px 0px 0px 0px`,
        },
      );
      crossing.observe(sentinel);
    };

    observe();
    window.addEventListener(TOP_NAV_METRICS_EVENT, observe);
    return () => {
      crossing?.disconnect();
      window.removeEventListener(TOP_NAV_METRICS_EVENT, observe);
    };
  }, [headerRef, sentinelRef]);

  return pinned;
}

/**
 * The results card: header actions plus the account list, sharing one
 * expanded-id set.
 *
 * The header takes plain data rather than pre-rendered slots. Passing elements
 * built in the server page made them children of this component's header row
 * under a different owner, which React key-checks as a list; and since
 * PaginationControls is already a client component there was nothing to gain
 * from serialising it across the boundary.
 */
export function AccountResultsPanel({
  rows,
  emptyMessage,
  canEditOrders = false,
  bigBrotherBaseUrl = "",
  todayDay,
  total,
  view,
  filterState,
  pagination,
  recordsHref,
  initialExpandedIds,
}: {
  rows: BookAccountListItem[];
  emptyMessage: string;
  canEditOrders?: boolean;
  bigBrotherBaseUrl?: string;
  todayDay: string;
  /** Total accounts matching the current filters, across all pages. */
  total: number;
  view: {
    id: "all" | "pending" | "bound" | "lost";
    title: string;
  };
  filterState: RecordsFilterSummaryState;
  pagination: RecordsContextPagination;
  /** Exact URL to restore after visiting one of these account details. */
  recordsHref?: string;
  /** Preview/test seam; production lists always start fully collapsed. */
  initialExpandedIds?: readonly string[];
}) {
  const visibleIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const { expanded, focusMode, toggle, closeAll, registerToggle } =
    useAccountExpansion(visibleIds, initialExpandedIds);

  // Announced from the events themselves rather than an effect: only the
  // Close all action is worth a word, and softened rows are never announced.
  const [announcement, setAnnouncement] = useState("");

  const handleToggle = useCallback(
    (id: string) => {
      setAnnouncement("");
      toggle(id);
    },
    [toggle],
  );

  const handleCloseAll = useCallback(() => {
    closeAll();
    setAnnouncement("All accounts collapsed");
  }, [closeAll]);

  const openCount = expanded.size;
  const headerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pinned = useStickyResultsHeader(headerRef, sentinelRef);

  return (
    <OrderDetailDrawerProvider>
      <div
        id="account-results"
        tabIndex={-1}
        className={`account-results scroll-mt-4 overflow-clip rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] shadow-sm focus:outline-none${
          focusMode ? " account-results--focus-mode" : ""
        }`}
      >
        <div ref={sentinelRef} className="account-results-sentinel" aria-hidden="true" />
        <RecordsContextBar
          headerRef={headerRef}
          pinned={pinned}
          viewMode={view.id}
          viewTitle={view.title}
          total={total}
          filterState={filterState}
          openCount={openCount}
          onCloseAll={handleCloseAll}
          pagination={pagination}
        />

        <AllAccountsList
          rows={rows}
          emptyMessage={emptyMessage}
          canEditOrders={canEditOrders}
          bigBrotherBaseUrl={bigBrotherBaseUrl}
          todayDay={todayDay}
          expanded={expanded}
          onToggle={handleToggle}
          registerToggle={registerToggle}
          recordsHref={recordsHref}
        />

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </OrderDetailDrawerProvider>
  );
}
