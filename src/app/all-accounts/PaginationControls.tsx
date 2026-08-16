"use client";

import Link from "next/link";
import { useEffect } from "react";

const FOCUS_MARKER = "all-accounts-pagination-focus";

function pageHref(
  basePath: string,
  currentParams: Record<string, string | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    if (value !== undefined && key !== "page") params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `${basePath}${query ? `?${query}` : ""}#account-results`;
}

export function PaginationControls({
  currentPage,
  totalPages,
  currentParams,
  basePath,
  placement,
}: {
  currentPage: number;
  totalPages: number;
  currentParams: Record<string, string | undefined>;
  basePath: string;
  placement: "top" | "bottom";
}) {
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
  const buttonClass = "btn-ghost px-3 py-1.5 text-xs";
  const disabledClass = `${buttonClass} cursor-default opacity-40`;

  function markBottomNavigation() {
    if (placement === "bottom") {
      window.sessionStorage.setItem(FOCUS_MARKER, "true");
    }
  }

  return (
    <nav
      aria-label={`${placement === "top" ? "Top" : "Bottom"} account results pagination`}
      className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]"
    >
      {previousDisabled ? (
        <span className={disabledClass} aria-disabled="true">
          ← Previous
        </span>
      ) : (
        <Link
          href={pageHref(basePath, currentParams, currentPage - 1)}
          className={buttonClass}
          aria-label={`Go to page ${currentPage - 1}`}
          onClick={markBottomNavigation}
        >
          ← Previous
        </Link>
      )}

      <span className="whitespace-nowrap tabular-nums" aria-current="page">
        Page {currentPage} / {totalPages}
      </span>

      {nextDisabled ? (
        <span className={disabledClass} aria-disabled="true">
          Next →
        </span>
      ) : (
        <Link
          href={pageHref(basePath, currentParams, currentPage + 1)}
          className={buttonClass}
          aria-label={`Go to page ${currentPage + 1}`}
          onClick={markBottomNavigation}
        >
          Next →
        </Link>
      )}
    </nav>
  );
}
