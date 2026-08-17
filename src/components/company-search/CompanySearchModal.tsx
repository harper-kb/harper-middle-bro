"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  CompanySearchFooter,
  CompanySearchIcon,
  CompanySearchResults,
} from "./CompanySearchResults";
import { useCompanySearch } from "./use-company-search";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Centered command-palette presentation of global company search.
 *
 * Layout and chrome only — the query, the debounce, the ranking, the
 * highlighted row and the account navigation all come from the shared
 * controller, so this returns exactly what the bar's inline field returns.
 */
export function CompanySearchModal({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Escape and opening a result both simply close the palette.
  const controller = useCompanySearch({ onDismiss: onClose });

  // Focus moves in on open and back to whatever the operator left on close,
  // whether that was the bar trigger or something else entirely.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => restoreTo?.focus?.();
  }, []);

  // Lock background scrolling, compensating for the scrollbar so the page
  // underneath does not shift sideways as the palette opens.
  useEffect(() => {
    const { overflow, paddingRight } = document.body.style;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, []);

  // Tab is confined to the panel for as long as it is open. Escape is handled
  // here as well as on the input, so the palette still closes if focus ever
  // lands somewhere else inside it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!panel.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      // Slightly above centre: a palette anchored at the exact middle reads as
      // low once results push it taller.
      className="company-search-backdrop fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto px-4 pt-[10vh] pb-8 sm:pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search companies"
        className="company-search-panel flex w-full max-w-[36rem] flex-col overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] shadow-[0_24px_60px_color-mix(in_srgb,var(--shadow-color)_55%,transparent)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--rule)] px-4 py-3.5">
          <CompanySearchIcon className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={controller.results.length > 0}
            aria-controls={controller.listboxId}
            aria-autocomplete="list"
            aria-label="Search companies by name, email, or phone"
            aria-activedescendant={controller.activeDescendant}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search companies by name, email, or phone…"
            value={controller.query}
            onChange={(event) => controller.setQuery(event.target.value)}
            onKeyDown={controller.handleKeyDown}
            className="company-search-field min-w-0 flex-1 bg-transparent text-[15px] leading-6 text-[var(--ink)] placeholder:text-[color-mix(in_srgb,var(--muted)_85%,transparent)]"
          />
          {controller.query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                controller.clear();
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded px-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              Clear
            </button>
          ) : null}
          <kbd className="shrink-0 rounded border border-[var(--rule)] bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
            Esc
          </kbd>
        </div>

        {/* Only the results scroll. The reserved height kicks in once a search
            is under way, so loading, hits and no-match do not resize the
            palette between keystrokes — but an untouched palette stays
            compact instead of opening as a tall empty box. */}
        <div
          className={`max-h-[24rem] flex-1 overflow-y-auto ${
            controller.view.status === "idle" ? "" : "min-h-[13rem]"
          }`}
        >
          <CompanySearchResults controller={controller} variant="modal" />
        </div>

        <CompanySearchFooter controller={controller} variant="modal" />
      </div>
    </div>,
    document.body,
  );
}
