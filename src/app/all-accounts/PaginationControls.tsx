"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useOptionalRecordsFilters } from "./RecordsFilterProvider";
import {
  recordsFilterHref,
  recordsFilterHrefFromParams,
  updateRecordsFilters,
} from "./records-filter-state";

const FOCUS_MARKER = "all-accounts-pagination-focus";

export function PaginationControls({
  currentPage,
  totalPages,
  currentParams = {},
  basePath = "/all-accounts",
  placement,
}: {
  currentPage: number;
  totalPages: number;
  currentParams?: Record<string, string | undefined>;
  basePath?: string;
  placement: "top" | "bottom";
}) {
  const records = useOptionalRecordsFilters();
  const hrefForPage = (page: number) =>
    records
      ? recordsFilterHref(
          updateRecordsFilters(records.state, { page }),
          { hash: "account-results" },
        )
      : recordsFilterHrefFromParams(
          basePath,
          currentParams,
          { page },
          { hash: "account-results" },
        );

  function navigateToPage(
    event: React.MouseEvent<HTMLAnchorElement>,
    page: number,
    trigger: string,
  ) {
    if (
      !records ||
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    records.update(
      { page },
      { reason: "page", trigger, hash: "account-results" },
    );
  }

  useEffect(() => {
    if (placement !== "top") return;
    if (window.sessionStorage.getItem(FOCUS_MARKER) !== "true") return;

    window.sessionStorage.removeItem(FOCUS_MARKER);
    window.requestAnimationFrame(() => {
      document.getElementById("account-results")?.focus();
    });
  }, [currentPage, placement]);

  const previousDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;
  const buttonClass =
    placement === "top"
      ? "btn-ghost account-pagination-button"
      : "btn-ghost px-3 py-1.5 text-xs";
  const disabledClass = `${buttonClass} cursor-default opacity-40`;

  function markBottomNavigation() {
    if (placement === "bottom") {
      window.sessionStorage.setItem(FOCUS_MARKER, "true");
    }
  }

  return (
    <nav
      aria-label={`${placement === "top" ? "Top" : "Bottom"} account results pagination`}
      className={`account-pagination account-pagination--${placement} flex items-center gap-2 text-sm text-[var(--muted)]${
        placement === "bottom" ? " flex-wrap" : ""
      }`}
    >
      {previousDisabled ? (
        <span className={disabledClass} aria-disabled="true">
          <span aria-hidden="true">←</span>
          <span className="account-pagination-word">Previous</span>
        </span>
      ) : (
        <Link
          href={hrefForPage(currentPage - 1)}
          className={buttonClass}
          aria-label={`Go to page ${currentPage - 1}`}
          onClick={(event) => {
            markBottomNavigation();
            navigateToPage(
              event,
              currentPage - 1,
              `${placement}-pagination-previous`,
            );
          }}
        >
          <span aria-hidden="true">←</span>
          <span className="account-pagination-word">Previous</span>
        </Link>
      )}

      <span
        className="account-pagination-page whitespace-nowrap tabular-nums"
        aria-current="page"
        aria-label={`Page ${currentPage} of ${totalPages}`}
      >
        <span aria-hidden="true">
          <span className="account-pagination-page-word">Page </span>
          {currentPage} / {totalPages}
        </span>
      </span>

      {nextDisabled ? (
        <span className={disabledClass} aria-disabled="true">
          <span className="account-pagination-word">Next</span>
          <span aria-hidden="true">→</span>
        </span>
      ) : (
        <Link
          href={hrefForPage(currentPage + 1)}
          className={buttonClass}
          aria-label={`Go to page ${currentPage + 1}`}
          onClick={(event) => {
            markBottomNavigation();
            navigateToPage(
              event,
              currentPage + 1,
              `${placement}-pagination-next`,
            );
          }}
        >
          <span className="account-pagination-word">Next</span>
          <span aria-hidden="true">→</span>
        </Link>
      )}
    </nav>
  );
}
