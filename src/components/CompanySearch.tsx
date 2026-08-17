"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { CompanySearchModal } from "./company-search/CompanySearchModal";
import {
  CompanySearchFooter,
  CompanySearchIcon,
  CompanySearchResults,
} from "./company-search/CompanySearchResults";
import {
  useCompanySearch,
  type CompanySearchDismissal,
} from "./company-search/use-company-search";

const PANEL_MIN_WIDTH = 384;
const VIEWPORT_MARGIN = 8;

type LayoutRect = Pick<DOMRect, "left" | "right" | "bottom" | "width">;

export interface SearchPreviewGeometry {
  dropdownLeft: number;
  dropdownTop: number;
  dropdownWidth: number;
  contentLeft: number;
  contentTop: number;
}

export function calculateSearchPreviewGeometry({
  shell,
  sidebar,
  header,
  viewportWidth,
}: {
  shell: LayoutRect;
  sidebar: LayoutRect | null;
  header: LayoutRect | null;
  viewportWidth: number;
}): SearchPreviewGeometry {
  const available = Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2);
  const dropdownWidth = Math.min(
    Math.max(shell.width, PANEL_MIN_WIDTH),
    available,
  );
  const dropdownLeft = Math.min(
    Math.max(VIEWPORT_MARGIN, shell.left),
    viewportWidth - dropdownWidth - VIEWPORT_MARGIN,
  );
  return {
    dropdownLeft,
    dropdownTop: shell.bottom + 6,
    dropdownWidth,
    // These come from the live fixed/sticky elements. A hidden responsive
    // sidebar has no rect, and therefore reserves no phantom desktop strip.
    contentLeft: Math.max(0, Math.min(viewportWidth, sidebar?.right ?? 0)),
    contentTop: Math.max(0, header?.bottom ?? 0),
  };
}

export function inlineSearchPreviewOpen({
  expanded,
  hasGeometry,
  viewStatus,
}: {
  expanded: boolean;
  hasGeometry: boolean;
  viewStatus: "idle" | "loading" | "ready" | "error";
}): boolean {
  return expanded && hasGeometry && viewStatus !== "idle";
}

/** `navigator` is unavailable while rendering on the server. */
function subscribeToPlatform() {
  return () => {};
}

function readIsMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function assumeMac() {
  return true;
}

/**
 * The nav mounts the stats bar twice — a desktop copy and a mobile copy — and
 * hides one with CSS rather than unmounting it. Both copies therefore run this
 * component, so each one only answers the shortcut and anchors a dropdown
 * while its own control is the one actually on screen. Without this the hidden
 * copy would portal a second surface to the body, where nothing hides it.
 */
function isOnScreen(element: HTMLElement | null): element is HTMLElement {
  return element !== null && element.getClientRects().length > 0;
}

function visibleLayoutRect(selector: string): DOMRect | null {
  const element = Array.from(
    document.querySelectorAll<HTMLElement>(selector),
  ).find(isOnScreen);
  return element?.getBoundingClientRect() ?? null;
}

function ClearIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className="h-2.5 w-2.5"
    >
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

/**
 * Global company search in the operational bar, in two deliberate shapes.
 *
 * Inline: the compact control in the bar expands in place into the editable
 * field — the operator types where the label was, and results drop beneath
 * that same field. There is never a second input.
 *
 * Palette: Cmd/Ctrl + S opens a centered modal instead of touching the bar.
 *
 * Both drive the same `useCompanySearch` controller and render the same result
 * list, so only their chrome differs.
 */
export function CompanySearch() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [geometry, setGeometry] = useState<SearchPreviewGeometry | null>(null);

  const shellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Set when a collapse should hand focus back to the compact trigger, which
  // only exists in the DOM after that collapse has rendered.
  const restoreTriggerRef = useRef(false);

  const isMac = useSyncExternalStore(
    subscribeToPlatform,
    readIsMac,
    assumeMac,
  );
  const shortcutHint = isMac ? "⌘S" : "Ctrl S";

  const collapse = useCallback(
    (focusTrigger: boolean) => {
      restoreTriggerRef.current = focusTrigger;
      setExpanded(false);
    },
    [],
  );

  const controller = useCompanySearch({
    onDismiss: useCallback(
      (reason: CompanySearchDismissal) => collapse(reason === "escape"),
      [collapse],
    ),
  });
  const { clear } = controller;

  // Collapsing always empties the box, so reopening never shows the last
  // search's results before the first keystroke.
  useEffect(() => {
    if (expanded) {
      inputRef.current?.focus();
      return;
    }
    clear();
    if (restoreTriggerRef.current) {
      restoreTriggerRef.current = false;
      triggerRef.current?.focus();
    }
  }, [expanded, clear]);

  // Route changes tear the inline surface down without an effect.
  const [renderedPath, setRenderedPath] = useState(pathname);
  if (renderedPath !== pathname) {
    setRenderedPath(pathname);
    setExpanded(false);
  }

  // Cmd/Ctrl + S is the desk's palette chord: preventDefault stops the browser
  // Save dialog, and it stays live while another field has focus. Cmd + H is
  // registered opportunistically — macOS claims it for Hide Application, so it
  // is never advertised and must not be relied on.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "s" && key !== "h") return;
      if (!isOnScreen(shellRef.current)) return;
      event.preventDefault();
      // One search surface at a time: the palette takes over from the bar.
      setExpanded(false);
      setModalOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const position = useCallback(() => {
    const shell = shellRef.current;
    // Crossing the breakpoint hands the bar to the other copy; drop the anchor
    // so this one's dropdown unmounts instead of floating over a hidden field.
    if (!isOnScreen(shell)) {
      setGeometry(null);
      return;
    }
    setGeometry(
      calculateSearchPreviewGeometry({
        shell: shell.getBoundingClientRect(),
        sidebar: visibleLayoutRect(".desk-sidebar"),
        header: visibleLayoutRect(".desk-sticky-header"),
        viewportWidth: window.innerWidth,
      }),
    );
  }, []);

  useLayoutEffect(() => {
    if (!expanded) return;
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [expanded, position]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (shellRef.current?.contains(target)) return;
      if (backdropRef.current?.contains(target)) return;
      collapse(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (shellRef.current?.contains(target)) return;
      collapse(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [expanded, collapse]);

  // The bar dropdown appears only once there is something to report. An empty
  // surface hanging under the metrics before the first keystroke is noise, and
  // clearing the field takes it away again on the same keystroke.
  const isSearchPreviewOpen = inlineSearchPreviewOpen({
    expanded,
    hasGeometry: geometry !== null,
    viewStatus: controller.view.status,
  });

  const previewLayer =
    isSearchPreviewOpen && geometry
      ? createPortal(
          <>
            <div
              ref={backdropRef}
              aria-hidden="true"
              style={{
                left: geometry.contentLeft,
                top: geometry.contentTop,
              }}
              className="company-search-page-backdrop fixed right-0 bottom-0 z-[25]"
              onPointerDown={(event) => {
                // The dedicated layer owns this pointer sequence, so the page
                // control beneath it can never receive the closing click.
                event.preventDefault();
                event.stopPropagation();
                collapse(true);
              }}
            />
            <div
              ref={dropdownRef}
              style={{
                left: geometry.dropdownLeft,
                top: geometry.dropdownTop,
                width: geometry.dropdownWidth,
                maxHeight: `calc(100vh - ${
                  geometry.dropdownTop + VIEWPORT_MARGIN
                }px)`,
              }}
              className="company-search-dropdown fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] shadow-[0_16px_40px_color-mix(in_srgb,var(--shadow-color)_40%,transparent)]"
            >
              <div className="min-h-0 flex-1 overflow-y-auto">
                <CompanySearchResults
                  controller={controller}
                  variant="inline"
                />
              </div>
              <CompanySearchFooter controller={controller} variant="inline" />
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        ref={shellRef}
        className={`company-search-shell relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-[var(--surface-raised)] px-2 ${
          // 17rem expanded keeps the metrics group inside its track even at
          // the xl breakpoint, where it stops scrolling and would otherwise
          // spill under the date picker.
          expanded
            ? "w-[13.5rem] border-[color-mix(in_srgb,var(--accent)_38%,var(--rule))] shadow-[0_0_0_3px_var(--accent-soft)] sm:w-[17rem]"
            : "w-8 border-[var(--rule)] hover:border-[var(--border-strong)] sm:w-[11.5rem]"
        }`}
      >
        <CompanySearchIcon className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />

        {expanded ? (
          <>
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={isSearchPreviewOpen}
              aria-controls={controller.listboxId}
              aria-autocomplete="list"
              aria-label="Search companies by name, email, or phone"
              aria-activedescendant={controller.activeDescendant}
              autoComplete="off"
              spellCheck={false}
              placeholder="Company, email, or phone…"
              value={controller.query}
              onChange={(event) => controller.setQuery(event.target.value)}
              onKeyDown={controller.handleKeyDown}
              className="company-search-field min-w-0 flex-1 bg-transparent text-[11px] text-[var(--ink)] placeholder:text-[color-mix(in_srgb,var(--muted)_85%,transparent)]"
            />
            {controller.query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  controller.clear();
                  inputRef.current?.focus();
                }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <ClearIcon />
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="hidden min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--muted)] sm:inline"
            >
              Search companies
            </span>
            <kbd
              aria-hidden="true"
              className="hidden shrink-0 whitespace-nowrap rounded border border-[var(--rule)] bg-[var(--surface-subtle)] px-1 py-px text-[10px] font-semibold text-[var(--muted)] sm:inline"
            >
              {shortcutHint}
            </kbd>
            {/* Overlays the whole control, padding included, so the hit target
                is the full field on desktop and the full icon square once the
                label is dropped on narrow screens. */}
            <button
              ref={triggerRef}
              type="button"
              aria-label={`Search companies (${shortcutHint})`}
              title={`Search companies by name, customer email, or phone (${shortcutHint})`}
              onClick={() => setExpanded(true)}
              className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
          </>
        )}
      </div>

      {previewLayer}
      {modalOpen ? (
        <CompanySearchModal onClose={() => setModalOpen(false)} />
      ) : null}
    </>
  );
}
