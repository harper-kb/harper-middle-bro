"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { DailyStatsSnapshotButton } from "@/components/daily-stats-snapshot/DailyStatsSnapshotButton";
import {
  createDailyOperationsStats,
  type OperationsStatsResponse,
} from "@/lib/operations-stats";
import { CompanySearch } from "./CompanySearch";

const POLL_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = 10 * 60_000;
const HARPER_UNIVERSITY_URL = "https://coaching.bigbrother.harperinsure.com/";

type Tone = "ok" | "warn" | "bad" | "idle";

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-[var(--success)]",
  warn: "bg-[var(--warning)]",
  bad: "bg-[var(--danger)]",
  idle: "bg-[var(--muted)]",
};

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-[var(--muted)]",
  warn: "text-[var(--warning)]",
  bad: "text-[var(--danger)]",
  idle: "text-[var(--muted)]",
};

/** "Aug 15" from a YYYY-MM-DD business date, immune to viewer-midnight shifts. */
function shortDate(businessDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${businessDate}T00:00:00Z`));
}

/** "Fri, Aug 15" for the unambiguous popover rows. */
function fullDate(businessDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${businessDate}T00:00:00Z`));
}

/** Relative name by position in the newest-first available-dates list. */
function relativeName(index: number, businessDate: string): string {
  if (index === 0) return "Today";
  if (index === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${businessDate}T00:00:00Z`));
}

function updatedLabel(iso: string | null): string {
  if (!iso) return "never";
  // Viewer's display timezone; the underlying value stays an absolute ISO
  // instant shared with the sidebar's Latest Database Sync card.
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function syncTooltip(iso: string | null): string {
  if (!iso) return "No successful database sync has been recorded.";
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "long",
    timeZone,
  }).format(new Date(iso));
  return `Last successful database sync: ${formatted} (${timeZone}).`;
}

function Metric({
  label,
  value,
  breakdown,
  title,
  loading,
  tone = "neutral",
}: {
  label: string;
  value: number | null;
  breakdown?: { sameDay: number; backlog: number } | null;
  title: string;
  loading: boolean;
  tone?: "neutral" | "bound";
}) {
  return (
    <div title={title} className="flex min-w-max items-baseline gap-1.5">
      <span
        className={`min-w-[1.25ch] text-right text-[15px] font-semibold leading-none tabular-nums ${
          tone === "bound" ? "text-[var(--success)]" : "text-[var(--ink)]"
        }`}
      >
        {loading ? (
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded bg-[var(--surface-hover)] align-middle motion-safe:animate-pulse"
          />
        ) : (
          (value ?? "—")
        )}
      </span>
      <span className="text-[9px] font-semibold uppercase leading-none tracking-[0.13em] text-[var(--muted)]">
        {label}
      </span>
      {breakdown ? (
        <span className="ml-0.5 flex items-center gap-1.5 whitespace-nowrap border-l border-[var(--rule)] pl-2 text-[10px] leading-none tabular-nums">
          <span>
            <strong className="font-semibold text-[var(--ink)]">
              {breakdown.sameDay}
            </strong>{" "}
            <span className="font-medium text-[var(--muted)]">same-day</span>
          </span>
          <span aria-hidden="true" className="text-[var(--border-strong)]">
            ·
          </span>
          <span>
            <strong className="font-semibold text-[var(--ink)]">
              {breakdown.backlog}
            </strong>{" "}
            <span className="font-medium text-[var(--muted)]">backlog</span>
          </span>
        </span>
      ) : null}
    </div>
  );
}

function GraduationCapIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m3 9 9-4 9 4-9 4-9-4Z" />
      <path d="M7 11v4.2c2.9 2.2 7.1 2.2 10 0V11" />
      <path d="M21 9v5" />
    </svg>
  );
}

function DatePopover({
  availableDates,
  selectedDate,
  onSelect,
  onClose,
}: {
  availableDates: readonly string[];
  selectedDate: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]',
    );
    (selected ?? list.querySelector("button"))?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (!list.parentElement?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ??
        [],
    );
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(options.length - 1, current + 1)
        : Math.max(0, current - 1);
    options[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Stats date"
      onKeyDown={handleKeyDown}
      className="rise-in absolute right-0 top-full z-50 mt-1.5 min-w-[13.5rem] rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] p-1 shadow-[0_10px_28px_color-mix(in_srgb,var(--shadow-color)_32%,transparent)]"
    >
      {availableDates.map((date, index) => {
        const selected = date === selectedDate;
        return (
          <button
            key={date}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => {
              onSelect(date);
              onClose();
            }}
            className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
              selected
                ? "bg-[var(--accent-soft)] font-semibold text-[var(--ink)]"
                : "font-medium text-[var(--muted)] hover:bg-[var(--sand)] hover:text-[var(--ink)]"
            }`}
          >
            <span>{relativeName(index, date)}</span>
            <span className="flex items-center gap-2 tabular-nums">
              {fullDate(date)}
              {selected ? (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3 text-[var(--accent)]"
                >
                  <path d="m3.5 8.5 3 3 6-7" />
                </svg>
              ) : null}
            </span>
          </button>
        );
      })}
      {selectedDate !== availableDates[0] ? (
        <button
          type="button"
          onClick={() => {
            onSelect(availableDates[0]);
            onClose();
          }}
          className="mt-1 flex w-full items-center justify-center rounded-lg border-t border-[var(--rule)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--sand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
        >
          Jump to Today
        </button>
      ) : null}
    </div>
  );
}

function StatsBarContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("statsDate");

  const [data, setData] = useState<OperationsStatsResponse | null>(null);
  const [observedAt, setObservedAt] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stats = useMemo(
    () => (data ? createDailyOperationsStats(data) : null),
    [data],
  );

  useEffect(() => {
    let active = true;

    const load = async (showSwitch: boolean) => {
      if (showSwitch) setSwitching(true);
      try {
        // BigBrother resolves the activity counters on the viewer's local
        // business day; report our current UTC offset so the server serves
        // the matching precomputed zone.
        const params = new URLSearchParams({
          tzOffset: String(new Date().getTimezoneOffset()),
        });
        if (urlDate) params.set("statsDate", urlDate);
        const response = await fetch(`/api/operations-metrics?${params}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const body = (await response.json()) as OperationsStatsResponse;
        if (active) {
          setData(body);
          setObservedAt(Date.now());
          setUnreachable(false);
        }
      } catch {
        // Keep the previous valid metrics and timestamp visible.
        if (active) setUnreachable(true);
      } finally {
        if (active) setSwitching(false);
      }
    };

    void load(true);
    const timer = window.setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [urlDate]);

  const selectDate = (date: string) => {
    if (!stats) return;
    const params = new URLSearchParams(searchParams.toString());
    if (date === stats.availableDates[0]) params.delete("statsDate");
    else params.set("statsDate", date);
    const query = params.toString();
    // Native history keeps Back/Forward and shared links working without a
    // server round trip; useSearchParams re-syncs and triggers the fetch.
    window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname);
  };

  const closePicker = () => {
    setPickerOpen(false);
    triggerRef.current?.focus();
  };

  const availableDates = stats?.availableDates ?? [];
  const selectedDate = stats?.selectedBusinessDate ?? null;
  const selectedIndex = selectedDate
    ? availableDates.indexOf(selectedDate)
    : -1;
  const metrics = stats?.metrics ?? null;
  const syncedAt = stats?.dataRevision.lastSuccessfulSyncAt ?? null;

  const refreshFailed =
    stats != null &&
    stats.refresh.lastAttemptStatus === "failed" &&
    stats.refresh.lastAttemptAt != null &&
    (syncedAt == null ||
      Date.parse(stats.refresh.lastAttemptAt) > Date.parse(syncedAt));
  const stale =
    stats != null &&
    syncedAt != null &&
    observedAt - Date.parse(syncedAt) > STALE_AFTER_MS;

  let tone: Tone = "ok";
  let statusLead = "Updated";
  let statusTime = updatedLabel(syncedAt);
  if (stats == null) {
    tone = "idle";
    statusLead = unreachable ? "Metrics unavailable" : "Loading";
    statusTime = "";
  } else if (unreachable || refreshFailed) {
    tone = "bad";
    statusLead = "Refresh issue";
  } else if (stale) {
    tone = "warn";
    statusLead = "Stale";
  }
  const statusTitle = `${statusLead}. ${syncTooltip(syncedAt)}`;
  const compactStatus =
    tone === "ok"
      ? statusTime
      : tone === "warn"
        ? "Stale"
        : tone === "bad"
          ? "Issue"
          : unreachable
            ? "Off"
            : "…";

  const initialLoading = stats == null && !unreachable;
  const dateName =
    selectedDate != null && selectedIndex >= 0
      ? `${relativeName(selectedIndex, selectedDate)} · ${shortDate(selectedDate)}`
      : "Today";
  const compactDateName =
    selectedDate == null
      ? "Today"
      : selectedIndex === 0
        ? "Today"
        : shortDate(selectedDate);
  const dayTitle = selectedDate
    ? `${selectedDate} (${stats?.businessTimezone ?? "local"} business day)`
    : "the selected business day";
  const bindTitle = selectedDate
    ? `${selectedDate} (${stats?.bindSentTimezone ?? "Eastern"} business day)`
    : "the selected business day";

  const arrowButtonClass =
    "flex h-7 w-6 shrink-0 items-center justify-center text-[13px] leading-none text-[var(--muted)] transition-colors hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-35";

  return (
    <section
      aria-label="Operational stats"
      className="bg-[var(--paper)]/95 backdrop-blur"
    >
      <div className="ops-bar-row grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-1.5 px-3 py-1.5 sm:gap-2 sm:px-4 xl:gap-3">
        <CompanySearch />

        <div
          className={`ops-metrics-scroll grid min-w-0 grid-cols-[minmax(14rem,1.7fr)_repeat(3,minmax(5.75rem,1fr))] items-center overflow-x-auto transition-opacity duration-150 xl:overflow-visible ${
            switching && stats != null ? "opacity-55" : "opacity-100"
          }`}
        >
          <div className="flex min-w-0 justify-center pr-2 sm:pr-3">
            <Metric
              label="Bind Sent"
              loading={initialLoading}
              value={metrics?.bindSent.total ?? null}
              breakdown={
                metrics
                  ? {
                      sameDay: metrics.bindSent.sameDay,
                      backlog: metrics.bindSent.backlog,
                    }
                  : null
              }
              title={`Binding packets sent on ${bindTitle}, split by whether the envelope's order was created the same business day`}
            />
          </div>
          <div className="flex min-w-0 justify-center border-l border-[var(--rule)] px-2 sm:px-3">
            <Metric
              label="New Orders"
              loading={initialLoading}
              value={metrics?.newOrders ?? null}
              title={`Orders created on ${dayTitle}`}
            />
          </div>
          <div className="flex min-w-0 justify-center border-l border-[var(--rule)] px-2 sm:px-3">
            <Metric
              label="Bound"
              tone="bound"
              loading={initialLoading}
              value={metrics?.bound ?? null}
              title={`Deals bound on ${dayTitle}`}
            />
          </div>
          <div className="flex min-w-0 justify-center border-l border-[var(--rule)] px-2 sm:px-3">
            <Metric
              label="COIs Sent"
              loading={initialLoading}
              value={metrics?.coisSent ?? null}
              title={`Certificates emailed on ${dayTitle}`}
            />
          </div>
        </div>

        <DailyStatsSnapshotButton stats={stats} disabled={switching} />

        <div className="relative flex w-[10rem] shrink-0 items-stretch rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] min-[480px]:w-[15.5rem] sm:w-[18rem]">
          <div className="flex items-center">
            <button
              type="button"
              aria-label="Previous day"
              disabled={
                stats == null ||
                selectedIndex < 0 ||
                selectedIndex >= availableDates.length - 1
              }
              onClick={() => selectDate(availableDates[selectedIndex + 1])}
              className={`${arrowButtonClass} h-8 rounded-l-lg`}
            >
              ‹
            </button>
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-label={`Change stats date, currently ${dateName}`}
              disabled={stats == null}
              onClick={() => setPickerOpen((open) => !open)}
              className="flex h-8 items-center gap-1.5 border-x border-[var(--rule)] px-2 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] disabled:pointer-events-none sm:px-2.5"
            >
              <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-[var(--ink)] min-[480px]:hidden">
                {compactDateName}
              </span>
              <span className="hidden whitespace-nowrap text-[11px] font-semibold tabular-nums text-[var(--ink)] min-[480px]:inline">
                {dateName}
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-2.5 w-2.5 shrink-0 text-[var(--muted)] transition-transform duration-150 ${
                  pickerOpen ? "rotate-180" : ""
                }`}
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Next day"
              disabled={stats == null || selectedIndex <= 0}
              onClick={() => selectDate(availableDates[selectedIndex - 1])}
              className={`${arrowButtonClass} h-8`}
            >
              ›
            </button>
          </div>
          <span
            role="status"
            aria-live="polite"
            title={statusTitle}
            className="flex h-8 items-center gap-1.5 border-l border-[var(--rule)] px-1.5 min-[480px]:px-2 sm:px-2.5"
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`}
            />
            <span className="sr-only max-[479px]:hidden sm:hidden">
              {statusLead}
            </span>
            <span
              className={`hidden whitespace-nowrap text-[10px] font-medium sm:inline ${TONE_TEXT[tone]}`}
            >
              {statusLead}
            </span>
            {compactStatus ? (
              <span
                className={`whitespace-nowrap text-[10px] font-semibold tabular-nums min-[480px]:hidden ${TONE_TEXT[tone]}`}
              >
                {compactStatus}
              </span>
            ) : null}
            {statusTime ? (
              <span className="hidden whitespace-nowrap text-[11px] font-semibold tabular-nums text-[var(--ink)] min-[480px]:inline">
                {statusTime}
              </span>
            ) : null}
          </span>

          {pickerOpen && stats != null && selectedDate != null ? (
            <DatePopover
              availableDates={availableDates}
              selectedDate={selectedDate}
              onSelect={selectDate}
              onClose={closePicker}
            />
          ) : null}
        </div>

        <a
          href={HARPER_UNIVERSITY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open Harper University in a new tab"
          title="Harper University — opens in a new tab"
          className="group flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_28%,var(--rule))] bg-[var(--accent-soft)] px-2 text-[11px] font-semibold text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_48%,var(--rule))] hover:bg-[color-mix(in_srgb,var(--accent-soft)_78%,var(--surface-raised))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:opacity-80"
        >
          <GraduationCapIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
          <span className="hidden whitespace-nowrap min-[1360px]:inline">
            Harper University
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="hidden h-2.5 w-2.5 shrink-0 text-[var(--muted)] transition-colors group-hover:text-[var(--accent)] min-[1360px]:inline"
          >
            <path d="M6 3H3.8A.8.8 0 0 0 3 3.8v8.4a.8.8 0 0 0 .8.8h8.4a.8.8 0 0 0 .8-.8V10" />
            <path d="M9 3h4v4M8 8l5-5" />
          </svg>
        </a>
      </div>
    </section>
  );
}

/**
 * Unified operational stats bar: the four desk KPIs for a selectable Harper
 * business day (today or the six prior days, kept in `?statsDate=`), the
 * authoritative refresh timestamp shared with the sidebar sync card, and the
 * Harper University shortcut.
 */
export function OperationsStatsBar() {
  return (
    // useSearchParams needs a Suspense boundary on statically rendered routes.
    <Suspense
      fallback={
        <section
          aria-label="Operational stats"
          className="h-[2.625rem] bg-[var(--paper)]/95 backdrop-blur"
        />
      }
    >
      <StatsBarContent />
    </Suspense>
  );
}
