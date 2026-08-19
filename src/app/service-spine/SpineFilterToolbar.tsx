"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FilterFocusBackdrop } from "@/components/FilterFocusBackdrop";
import { TOP_NAV_METRICS_EVENT } from "@/components/TopNavHeightSync";
import {
  issueTypeLabel,
  spineQueuePersonOf,
  SPINE_COHORT_LABELS,
  SPINE_QUEUE_ALL,
  SPINE_QUEUE_MODES,
  SPINE_QUEUE_PERSON_PREFIX,
  type SpineCohort,
  type SpineFilterOptions,
} from "@/lib/service-spine/domain";
import { useSpineFilters } from "./SpineFilterProvider";
import { type SpineView } from "./spine-filter-state";

const SEARCH_DEBOUNCE_MS = 200;
const COHORT_VALUES: readonly SpineCohort[] = ["pending", "active", "others"];

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className="h-4 w-4 shrink-0"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.2 10.2 3 3" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M2.5 3.25h11L9.25 8v3.25l-2.5 1.5V8z" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className="h-3.5 w-3.5"
    >
      <rect x="2.25" y="2.5" width="3.25" height="11" rx="1" />
      <rect x="6.5" y="2.5" width="3.25" height="8" rx="1" />
      <rect x="10.5" y="2.5" width="3.25" height="9.5" rx="1" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      className="h-3.5 w-3.5"
    >
      <rect x="2.25" y="3" width="11.5" height="10" rx="1.25" />
      <path d="M2.75 6.25h10.5M2.75 9.5h10.5M6.25 3.5v9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="h-3 w-3"
    >
      <path d="m3 3 6 6M9 3 3 9" />
    </svg>
  );
}

function SpineSearchField() {
  const { state, latest, update, isPending } = useSpineFilters();
  const committed = state.q;
  const [draft, setDraft] = useState(committed);
  const requested = useRef(committed);

  useEffect(() => {
    if (committed === requested.current) return;
    if (latest().q === requested.current) return;
    requested.current = committed;
    setDraft(committed);
  }, [committed, latest]);

  useEffect(() => {
    const next = draft.trim();
    if (next === requested.current) return;
    const timer = window.setTimeout(() => {
      requested.current = next;
      update({ q: next }, { history: "replace" });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, update]);

  const clear = () => {
    requested.current = "";
    setDraft("");
    update({ q: "" }, { history: "replace" });
  };

  return (
    <div className="spine-search">
      <SearchIcon />
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !draft) return;
          event.preventDefault();
          clear();
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search issues…"
        aria-label="Search issues by company, id, goal, type, status, priority or correlation key"
        className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none"
      />
      {draft ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear issue search"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <CloseIcon />
        </button>
      ) : isPending ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--rule)] border-t-[var(--accent)] motion-reduce:hidden"
        />
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <label className="grid gap-1.5">
      <span
        id={id}
        className="spine-filter-copy text-[10px] font-semibold uppercase tracking-[0.1em]"
      >
        {label}
      </span>
      <select
        className="filter-select min-h-10 w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-labelledby={id}
      >
        {children}
      </select>
    </label>
  );
}

type FilterChip = {
  id: string;
  label: string;
  remove: () => void;
};

function useStickyState() {
  const markerRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    const observe = () => {
      observer?.disconnect();
      const raw = getComputedStyle(document.documentElement).getPropertyValue(
        "--top-nav-bottom",
      );
      const top = Number.parseFloat(raw) || 0;
      observer = new IntersectionObserver(
        ([entry]) => setStuck(!entry?.isIntersecting),
        { rootMargin: `${-(top + 1)}px 0px 0px 0px`, threshold: 1 },
      );
      if (markerRef.current) observer.observe(markerRef.current);
    };
    observe();
    window.addEventListener(TOP_NAV_METRICS_EVENT, observe);
    window.addEventListener("resize", observe);
    return () => {
      observer?.disconnect();
      window.removeEventListener(TOP_NAV_METRICS_EVENT, observe);
      window.removeEventListener("resize", observe);
    };
  }, []);

  return { markerRef, stuck };
}

function SpineFilterMenu({
  options,
  activeCount,
  open,
  onOpenChange,
  disabled,
}: {
  options: SpineFilterOptions;
  activeCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
}) {
  const { state, update, clear } = useSpineFilters();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const queuePerson = spineQueuePersonOf(state.queue);
  const personListed = options.people.some(
    (person) => `${SPINE_QUEUE_PERSON_PREFIX}${person.label}` === state.queue,
  );

  const close = useCallback(
    (restoreFocus = false) => {
      onOpenChange(false);
      if (restoreFocus) {
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  return (
    <>
      {open ? (
        <FilterFocusBackdrop onDismiss={() => close(true)} />
      ) : null}
      <div
        ref={rootRef}
        className={`relative ${open ? "records-filter-control--open" : ""}`}
      >
      <button
        ref={triggerRef}
        type="button"
        aria-label={activeCount ? `Filters (${activeCount})` : "Filters"}
        aria-expanded={open}
        aria-controls={`${titleId}-panel`}
        disabled={disabled}
        title={disabled ? "Close issue detail before opening filters" : undefined}
        onClick={() => onOpenChange(!open)}
        className={`spine-toolbar-button ${activeCount ? "spine-toolbar-button--active" : ""}`}
      >
        <FilterIcon />
        Filters
        {activeCount ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--navy)]">
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={`${titleId}-panel`}
          role="dialog"
          aria-labelledby={titleId}
          className="spine-filter-popover"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] px-4 py-3">
            <div>
              <h3 id={titleId} className="text-sm font-semibold text-[var(--ink)]">
                Filters
              </h3>
              <p className="spine-filter-copy mt-0.5 text-[11px]">
                Changes apply immediately and stay in the URL.
              </p>
            </div>
            <button
              type="button"
              onClick={() => close(true)}
              aria-label="Close filters"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <FilterSelect
              label="Priority"
              value={state.priority ?? ""}
              onChange={(value) => update({ priority: value || null })}
            >
              <option value="">All priorities</option>
              {options.priorities.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </FilterSelect>

            <FilterSelect
              label="Issue type"
              value={state.type ?? ""}
              onChange={(value) => update({ type: value || null })}
            >
              <option value="">All issue types</option>
              {options.issueTypes.map((issueType) => (
                <option key={issueType} value={issueType}>
                  {issueTypeLabel(issueType)}
                </option>
              ))}
            </FilterSelect>

            <FilterSelect
              label="Wave"
              value={state.wave ?? ""}
              onChange={(value) => update({ wave: value || null })}
            >
              <option value="">All waves</option>
              {options.waves.map((wave) => (
                <option key={wave} value={wave}>
                  Wave {wave}
                </option>
              ))}
            </FilterSelect>

            <FilterSelect
              label="Service work"
              value={state.cohort ?? ""}
              onChange={(value) =>
                update({ cohort: (value || null) as SpineCohort | null })
              }
            >
              <option value="">All service work</option>
              {COHORT_VALUES.map((cohort) => (
                <option key={cohort} value={cohort}>
                  {SPINE_COHORT_LABELS[cohort]}
                </option>
              ))}
            </FilterSelect>

            <div className="sm:col-span-2">
              <FilterSelect
                label="Queue"
                value={state.queue}
                onChange={(value) => update({ queue: value })}
              >
                {SPINE_QUEUE_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
                {queuePerson && !personListed ? (
                  <option value={state.queue}>{queuePerson}</option>
                ) : null}
                {options.people.length > 0 ? (
                  <optgroup label="People">
                    {options.people.map((person) => (
                      <option
                        key={person.label}
                        value={`${SPINE_QUEUE_PERSON_PREFIX}${person.label}`}
                      >
                        {person.label} ({person.n.toLocaleString("en-US")})
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </FilterSelect>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--rule)] bg-[var(--surface-subtle)] px-4 py-3">
            <button
              type="button"
              onClick={clear}
              disabled={activeCount === 0}
              className="filter-clear min-h-10 disabled:cursor-default disabled:opacity-40"
            >
              Clear filters
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              className="btn-ghost min-h-10 px-4"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </>
  );
}

export function SpineFilterToolbar({
  options,
  filteredTotal,
  mirrorTotal,
  loadedTotal,
}: {
  options: SpineFilterOptions;
  filteredTotal: number;
  mirrorTotal: number;
  loadedTotal: number;
}) {
  const { state, requested, update, isPending } = useSpineFilters();
  const { markerRef, stuck } = useStickyState();
  const [filterOpen, setFilterOpen] = useState(false);
  const person = spineQueuePersonOf(state.queue);

  const chips: FilterChip[] = [
    ...(state.priority
      ? [
          {
            id: "priority",
            label: state.priority,
            remove: () => update({ priority: null }),
          },
        ]
      : []),
    ...(state.type
      ? [
          {
            id: "type",
            label: issueTypeLabel(state.type),
            remove: () => update({ type: null }),
          },
        ]
      : []),
    ...(state.wave
      ? [
          {
            id: "wave",
            label: `Wave ${state.wave}`,
            remove: () => update({ wave: null }),
          },
        ]
      : []),
    ...(state.cohort
      ? [
          {
            id: "cohort",
            label: SPINE_COHORT_LABELS[state.cohort],
            remove: () => update({ cohort: null }),
          },
        ]
      : []),
    ...(state.queue !== SPINE_QUEUE_ALL
      ? [
          {
            id: "queue",
            label: person ? `Queue: ${person}` : `Queue: ${state.queue}`,
            remove: () => update({ queue: SPINE_QUEUE_ALL }),
          },
        ]
      : []),
  ];

  const resultCopy =
    filteredTotal !== mirrorTotal
      ? `${filteredTotal.toLocaleString("en-US")} matching`
      : `${filteredTotal.toLocaleString("en-US")} ${
          filteredTotal === 1 ? "issue" : "issues"
        }`;
  const loadedCopy =
    loadedTotal < filteredTotal
      ? ` · ${loadedTotal.toLocaleString("en-US")} loaded`
      : "";

  const switchView = (view: SpineView) =>
    update({ view }, { history: "push" });

  return (
    <>
      <div ref={markerRef} className="h-px" aria-hidden="true" />
      <section
        className={`spine-workspace-toolbar ${
          filterOpen ? "records-filter-control--open" : ""
        }`}
        data-stuck={stuck || undefined}
        aria-label="Service Spine workspace controls"
        aria-busy={isPending || undefined}
      >
        <div className="spine-toolbar-layout">
          <SpineSearchField />
          <SpineFilterMenu
            options={options}
            activeCount={chips.length}
            open={filterOpen}
            onOpenChange={setFilterOpen}
            disabled={requested.issue !== null}
          />

          <div
            className="spine-active-chips"
            role="group"
            aria-label="Active filters"
          >
            {chips.map((chip) => (
              <button
                type="button"
                key={chip.id}
                onClick={chip.remove}
                className="spine-active-chip"
                aria-label={`Remove ${chip.label} filter`}
              >
                <span className="max-w-36 truncate">{chip.label}</span>
                <CloseIcon />
              </button>
            ))}
          </div>

          <div className="spine-toolbar-actions">
            <div
              role="radiogroup"
              aria-label="Board or table view"
              className="seg inline-flex shrink-0"
            >
              <button
                type="button"
                role="radio"
                aria-checked={state.view === "board"}
                className="seg-option min-h-9"
                onClick={() => switchView("board")}
              >
                <BoardIcon />
                Board
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={state.view === "table"}
                className="seg-option min-h-9"
                onClick={() => switchView("table")}
              >
                <TableIcon />
                Table
              </button>
            </div>

            <label className="flex min-h-9 items-center gap-2 rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-2.5">
              <span className="sr-only">Sort issues</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                Sort
              </span>
              <select
                value={state.sort}
                onChange={(event) =>
                  update({
                    sort:
                      event.target.value === "priority"
                        ? "priority"
                        : "recency",
                  })
                }
                className="bg-transparent text-xs font-semibold text-[var(--ink)] focus:outline-none"
                aria-label="Sort issues"
              >
                <option value="recency">Recent</option>
                <option value="priority">Priority</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-2 flex min-h-4 items-center justify-between gap-3">
          <p
            aria-live="polite"
            className="text-[11px] tabular-nums text-[var(--muted)]"
          >
            {resultCopy}
            {loadedCopy}
          </p>
          {isPending ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--muted)]">
              <span
                aria-hidden="true"
                className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-[var(--rule)] border-t-[var(--accent)] motion-reduce:hidden"
              />
              Updating
            </span>
          ) : null}
        </div>
      </section>
    </>
  );
}
