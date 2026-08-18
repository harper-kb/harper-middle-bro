"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ACCOUNT_ORDERS_VIEWS,
  getAccountOrdersView,
} from "./view-config";
import { useRecordsFilters } from "./RecordsFilterProvider";
import {
  recordsFilterHref,
  withRecordsView,
} from "./records-filter-state";
import type { BookOrdersViewMode } from "@/lib/db";

export function AccountViewTitle({ mode }: { mode: BookOrdersViewMode }) {
  const { state, switchView } = useRecordsFilters();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const currentView = getAccountOrdersView(mode);
  const currentIndex = ACCOUNT_ORDERS_VIEWS.findIndex(
    (view) => view.id === mode,
  );

  useEffect(() => {
    if (!open) return;

    function dismiss(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function openMenu(focusIndex = currentIndex) {
    setOpen(true);
    window.requestAnimationFrame(() => {
      itemRefs.current[focusIndex]?.focus();
    });
  }

  function closeMenu({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(currentIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(ACCOUNT_ORDERS_VIEWS.length - 1);
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const focusedIndex = itemRefs.current.findIndex(
      (item) => item === document.activeElement,
    );
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") {
      nextIndex = (focusedIndex + 1) % ACCOUNT_ORDERS_VIEWS.length;
    } else if (event.key === "ArrowUp") {
      nextIndex =
        (focusedIndex - 1 + ACCOUNT_ORDERS_VIEWS.length) %
        ACCOUNT_ORDERS_VIEWS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = ACCOUNT_ORDERS_VIEWS.length - 1;
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    } else if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      itemRefs.current[nextIndex]?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <h1 className="page-title mt-1 text-3xl text-[var(--ink)]">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          className="-ml-1 inline-flex items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => (open ? closeMenu({ restoreFocus: false }) : openMenu())}
          onKeyDown={handleButtonKeyDown}
        >
          {currentView.title}
          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={`mt-0.5 h-4 w-4 text-[var(--muted)] transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          >
            <path
              d="M5 7.5 10 12.5 15 7.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </h1>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Choose account order view"
          className="absolute left-0 z-40 mt-2 min-w-56 overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] p-1.5 shadow-xl"
          onKeyDown={handleMenuKeyDown}
        >
          {ACCOUNT_ORDERS_VIEWS.map((view, index) => {
            const selected = view.id === mode;
            return (
              <Link
                key={view.id}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                role="menuitem"
                tabIndex={-1}
                // Server-rendered href so prefetch, middle-click and copy all
                // see the real destination; a plain click re-derives it from
                // the newest requested filters instead.
                href={recordsFilterHref(withRecordsView(state, view.id))}
                aria-current={selected ? "page" : undefined}
                className={`flex items-center justify-between gap-4 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                  selected
                    ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                    : "text-[var(--muted)] hover:bg-[var(--sand)] hover:text-[var(--ink)]"
                }`}
                onClick={(event) => {
                  setOpen(false);
                  if (
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
                  switchView(view.id, { trigger: "title-dropdown" });
                }}
              >
                {view.title}
                <span
                  aria-hidden="true"
                  className={selected ? "text-[var(--accent)]" : "invisible"}
                >
                  ✓
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
