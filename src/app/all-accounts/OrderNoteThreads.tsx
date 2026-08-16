"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  formatExactTimestamp,
  formatRelativeTime,
} from "@/lib/relative-time";
import type {
  NoteSummaryResponse,
  NoteThread,
  NoteThreadsResponse,
  NoteThreadType,
} from "@/lib/note-thread-types";

type SummaryState =
  | { status: "idle" | "loading" }
  | {
      status: "ready";
      text: string;
      generatedAt: string;
      version: string;
      method: "ai" | "extractive";
    }
  | { status: "unavailable"; version: string };

const EMPTY_SUMMARIES: Record<NoteThreadType, SummaryState> = {
  producer: { status: "idle" },
  service: { status: "idle" },
};

function ThreadIcon({ type }: { type: NoteThreadType }) {
  if (type === "producer") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <path
          d="M4 2.75h8.1L16 6.65v10.6H4V2.75Zm8 0v4h4M7 10h6M7 13h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        d="M3 4.25h14v9.5H8l-4 3v-3H3v-9.5ZM6.5 8h7M6.5 10.75h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="M8 1.5c.35 2.65 1.85 4.15 4.5 4.5C9.85 6.35 8.35 7.85 8 10.5 7.65 7.85 6.15 6.35 3.5 6 6.15 5.65 7.65 4.15 8 1.5ZM12.5 10c.18 1.32.93 2.07 2.25 2.25-1.32.18-2.07.93-2.25 2.25-.18-1.32-.93-2.07-2.25-2.25 1.32-.18 2.07-.93 2.25-2.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <span className="sr-only">Generating AI summary</span>
      <div className="h-2.5 w-full animate-pulse rounded bg-[var(--rule)] motion-reduce:animate-none" />
      <div className="h-2.5 w-5/6 animate-pulse rounded bg-[var(--rule)] motion-reduce:animate-none" />
      <div className="h-2.5 w-2/3 animate-pulse rounded bg-[var(--rule)] motion-reduce:animate-none" />
    </div>
  );
}

function SummaryCard({
  type,
  thread,
  summary,
  loadingThreads,
  threadUnavailable,
  onOpen,
  onRetry,
}: {
  type: NoteThreadType;
  thread: NoteThread | null;
  summary: SummaryState;
  loadingThreads: boolean;
  threadUnavailable: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
  onRetry: () => void;
}) {
  const producer = type === "producer";
  const label = producer ? "Producer Notes" : "Service Notes";
  const count = thread?.entries.length ?? 0;
  const latest = thread?.latestAt;
  const latestExact = formatExactTimestamp(latest);
  const summaryLabel =
    summary.status === "ready" && summary.method === "extractive"
      ? "Note overview"
      : "AI Summary";
  return (
    <article
      className={`flex min-h-[10.5rem] flex-col overflow-hidden rounded-xl border border-t-[3px] bg-white p-4 shadow-[0_2px_8px_rgba(26,44,54,0.07)] dark:bg-[var(--surface-raised)] dark:shadow-none ${
        producer
          ? "border-orange-300 border-t-orange-500 dark:border-orange-500/25 dark:border-t-orange-400/70"
          : "border-sky-300 border-t-sky-500 dark:border-sky-500/25 dark:border-t-sky-400/70"
      }`}
      aria-label={`${label} summary`}
    >
      <header className="flex items-center justify-between gap-3">
        <div
          className="flex min-w-0 items-center gap-2.5"
        >
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
              producer
                ? "bg-orange-100 text-orange-800 dark:bg-orange-500/10 dark:text-orange-300"
                : "bg-sky-100 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300"
            }`}
          >
            <ThreadIcon type={type} />
          </span>
          <div className="min-w-0">
            <h4 className="truncate text-xs font-semibold text-[var(--ink)]">
              {label}
            </h4>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600 dark:text-[var(--muted)]">
              {producer ? "This order" : "Entire account"}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 dark:border-[var(--rule)] dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)]">
          {loadingThreads
            ? "Loading…"
            : threadUnavailable
              ? "Unavailable"
            : `${count.toLocaleString()} ${count === 1 ? "note" : "notes"}`}
        </span>
      </header>

      <div className="mt-3 flex-1">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600 dark:text-[var(--muted)]">
          {summary.status !== "ready" || summary.method === "ai" ? (
            <SparkleIcon />
          ) : null}
          {summaryLabel}
        </div>
        {loadingThreads || summary.status === "loading" ? (
          <SummarySkeleton />
        ) : threadUnavailable ? (
          <p className="text-[13px] font-medium text-slate-600 dark:text-[var(--muted)]">
            Original notes are temporarily unavailable
          </p>
        ) : count === 0 ? (
          <p className="text-xs text-[var(--muted)]">
            No {producer ? "Producer" : "Service"} Notes yet
          </p>
        ) : summary.status === "ready" ? (
          <p className="whitespace-pre-line text-[13.5px] font-medium leading-[1.55] text-slate-900 dark:text-[var(--ink)]">
            {summary.text}
          </p>
        ) : summary.status === "unavailable" ? (
          <div role="status" aria-live="polite">
            <p className="text-[13px] font-medium text-slate-600 dark:text-[var(--muted)]">AI summary unavailable</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 rounded px-1 py-0.5 text-[11px] font-semibold text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-3">
        <p
          className="mb-2 text-[11px] font-medium text-slate-600 dark:text-[var(--muted)]"
          title={latestExact ?? undefined}
        >
          {summary.status === "ready"
            ? `${summary.method === "ai" ? "Generated" : "Updated from notes"} ${
                formatRelativeTime(summary.generatedAt) ?? "recently"
              }`
            : latest
              ? `Reflects notes through ${formatRelativeTime(latest) ?? "latest update"}`
              : producer
                ? "Current note for this order"
                : "Account-wide service thread"}
        </p>
        <button
          type="button"
          onClick={(event) => onOpen(event.currentTarget)}
          disabled={threadUnavailable}
          className={`note-thread-view-button note-thread-view-button--${type} flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none`}
          aria-label={`View full ${label} thread`}
        >
          View full thread
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

function ThreadEntries({
  thread,
  type,
}: {
  thread: NoteThread;
  type: NoteThreadType;
}) {
  const producer = type === "producer";
  if (thread.entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--rule)] px-4 py-10 text-center text-sm text-[var(--muted)]">
        No {producer ? "Producer" : "Service"} Notes yet
      </p>
    );
  }
  return (
    <ol className="space-y-3" aria-label={`${producer ? "Producer" : "Service"} Notes`}>
      {thread.entries.map((entry, index) => {
        const timestamp = entry.updatedAt ?? entry.createdAt;
        const exact = formatExactTimestamp(timestamp);
        return (
          <li
            key={entry.id}
            id={`note-entry-${entry.id}`}
            className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-3"
          >
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-[var(--ink)]">
                  {entry.author}
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                  {entry.orderLabel}
                  {entry.edited ? " · Edited" : ""}
                  {" · "}
                  Note #{entry.id.replace(/^producer-/, "")}
                </p>
              </div>
              <div className="text-right text-[10px] text-[var(--muted)]">
                {index === 0 ? (
                  <span className="mr-1.5 rounded-full border border-[var(--rule)] px-1.5 py-0.5 font-semibold">
                    Latest
                  </span>
                ) : null}
                <time dateTime={timestamp ?? undefined} title={exact ?? undefined}>
                  {formatRelativeTime(timestamp) ?? "Time unavailable"}
                </time>
                {exact ? <p className="mt-1">{exact}</p> : null}
              </div>
            </header>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--ink)]">
              {entry.body}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function ThreadDrawer({
  open,
  activeType,
  accountName,
  orderLabel,
  threads,
  canEditProducer,
  producerEditHref,
  serviceBody,
  serviceBusy,
  serviceError,
  dialogRef,
  onTypeChange,
  onClose,
  onServiceBodyChange,
  onServiceSubmit,
}: {
  open: boolean;
  activeType: NoteThreadType;
  accountName: string;
  orderLabel: string;
  threads: NoteThreadsResponse | null;
  canEditProducer: boolean;
  producerEditHref: string;
  serviceBody: string;
  serviceBusy: boolean;
  serviceError: string | null;
  dialogRef: RefObject<HTMLDivElement | null>;
  onTypeChange: (type: NoteThreadType) => void;
  onClose: () => void;
  onServiceBodyChange: (body: string) => void;
  onServiceSubmit: (event: FormEvent) => void;
}) {
  if (!open) return null;
  const thread = threads?.[activeType] ?? null;
  const typeLabel = activeType === "producer" ? "Producer Notes" : "Service Notes";
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 hidden bg-black/35 sm:block"
        aria-label="Close note thread viewer"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-thread-title"
        className="absolute inset-0 flex flex-col bg-[var(--surface-raised)] shadow-2xl sm:inset-y-0 sm:left-auto sm:w-[min(46rem,92vw)] sm:border-l sm:border-[var(--rule)]"
      >
        <header className="border-b border-[var(--rule)] px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-xs text-[var(--muted)]">{accountName}</p>
              <h2 id="note-thread-title" className="mt-0.5 text-base font-semibold text-[var(--ink)]">
                {typeLabel}
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {activeType === "service"
                  ? `All visible Service Notes for this account · opened from ${orderLabel}`
                  : `${orderLabel} · current Producer Note`}
                {thread
                  ? ` · ${thread.entries.length.toLocaleString()} ${
                      thread.entries.length === 1 ? "entry" : "entries"
                    }`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--rule)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="Close note thread viewer"
            >
              Close
            </button>
          </div>
          <div
            role="tablist"
            aria-label="Note thread type"
            className="mt-3 grid grid-cols-2 rounded-lg bg-[var(--surface-subtle)] p-1"
          >
            {(["producer", "service"] as const).map((type) => {
              const selected = activeType === type;
              const label = type === "producer" ? "Producer Notes" : "Service Notes";
              return (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`note-thread-panel-${type}`}
                  id={`note-thread-tab-${type}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onTypeChange(type)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      event.preventDefault();
                      const next =
                        type === "producer" ? "service" : "producer";
                      onTypeChange(next);
                      window.requestAnimationFrame(() =>
                        document.getElementById(`note-thread-tab-${next}`)?.focus(),
                      );
                    }
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    selected
                      ? "bg-[var(--surface-raised)] text-[var(--ink)] shadow-sm"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </header>

        <div
          role="tabpanel"
          id={`note-thread-panel-${activeType}`}
          aria-labelledby={`note-thread-tab-${activeType}`}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
        >
          <p className="mb-3 text-[10px] text-[var(--muted)]">
            AI-generated summaries are a convenience. The original notes below are the source of truth.
          </p>
          {thread ? (
            <ThreadEntries thread={thread} type={activeType} />
          ) : (
            <p role="status" className="py-10 text-center text-sm text-[var(--muted)]">
              Loading original notes…
            </p>
          )}

          {activeType === "producer" && canEditProducer ? (
            <a
              href={producerEditHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex rounded-lg border border-[var(--rule)] px-3 py-2 text-xs font-semibold text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Edit Producer Note in BigBrother
            </a>
          ) : null}

          {activeType === "service" ? (
            <form
              onSubmit={onServiceSubmit}
              className="mt-4 rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-3"
            >
              <label htmlFor="service-note-body" className="text-xs font-semibold text-[var(--ink)]">
                Add a Service Note
              </label>
              <textarea
                id="service-note-body"
                value={serviceBody}
                maxLength={2000}
                rows={3}
                onChange={(event) => onServiceBodyChange(event.target.value)}
                placeholder="Add a concise note for the service team…"
                className="mt-2 w-full resize-y rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[10px] tabular-nums text-[var(--muted)]">
                  {serviceBody.length.toLocaleString()}/2,000
                </span>
                <button
                  type="submit"
                  disabled={serviceBusy || !serviceBody.trim()}
                  className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {serviceBusy ? "Adding…" : "Add note"}
                </button>
              </div>
              {serviceError ? (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-300" role="alert">
                  {serviceError}
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function OrderNoteThreads({
  accountId,
  accountName,
  orderId,
  orderLabel,
  canEditProducer,
  producerEditHref,
}: {
  accountId: string;
  accountName: string;
  orderId: number;
  orderLabel: string;
  canEditProducer: boolean;
  producerEditHref: string;
}) {
  const companyId = Number(accountId.replace(/^co-/, ""));
  const [threads, setThreads] = useState<NoteThreadsResponse | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [summaries, setSummaries] =
    useState<Record<NoteThreadType, SummaryState>>(EMPTY_SUMMARIES);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeType, setActiveType] = useState<NoteThreadType>("producer");
  const [serviceBody, setServiceBody] = useState("");
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const loadSummary = useCallback(
    async (type: NoteThreadType, expectedVersion: string) => {
      setSummaries((current) => ({
        ...current,
        [type]: { status: "loading" },
      }));
      try {
        const response = await fetch("/api/orders/note-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, orderId, threadType: type }),
        });
        const result = (await response.json()) as NoteSummaryResponse;
        if (
          response.ok &&
          result.status === "ready" &&
          result.summary &&
          result.generatedAt &&
          result.threadVersion === expectedVersion
        ) {
          setSummaries((current) => ({
            ...current,
            [type]: {
              status: "ready",
              text: result.summary!,
              generatedAt: result.generatedAt!,
              version: result.threadVersion,
              method: result.method ?? "ai",
            },
          }));
          return;
        }
      } catch {
        // Original notes remain usable; summary failure is intentionally quiet.
      }
      setSummaries((current) => ({
        ...current,
        [type]: { status: "unavailable", version: expectedVersion },
      }));
    },
    [companyId, orderId],
  );

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    setThreadError(null);
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        orderId: String(orderId),
      });
      const response = await fetch(`/api/orders/note-threads?${params}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as NoteThreadsResponse & {
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Notes unavailable");
      setThreads(result);
      setSummaries(EMPTY_SUMMARIES);
      for (const type of ["producer", "service"] as const) {
        if (result[type].entries.length > 0) {
          void loadSummary(type, result[type].version);
        }
      }
    } catch (cause) {
      setThreadError(cause instanceof Error ? cause.message : "Notes unavailable");
    } finally {
      setLoadingThreads(false);
    }
  }, [companyId, orderId, loadSummary]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadThreads(), 0);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const first = dialog ? focusableElements(dialog)[0] : null;
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = focusableElements(dialog);
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      openerRef.current?.focus();
    };
  }, [drawerOpen]);

  function openDrawer(type: NoteThreadType, trigger: HTMLButtonElement) {
    openerRef.current = trigger;
    setActiveType(type);
    setDrawerOpen(true);
  }

  async function submitServiceNote(event: FormEvent) {
    event.preventDefault();
    const body = serviceBody.trim();
    if (!body || body.length > 2000) return;
    setServiceBusy(true);
    setServiceError(null);
    try {
      const response = await fetch("/api/orders/service-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, orderId, body }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Note was not added");
      setServiceBody("");
      setServiceBusy(false);
      void loadThreads();
    } catch (cause) {
      setServiceError(
        cause instanceof Error ? cause.message : "Note was not added",
      );
      setServiceBusy(false);
    }
  }

  return (
    <section className="mt-3 border-t border-[var(--rule)] pt-3" aria-label="Order note threads">
      {threadError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2">
          <p className="text-xs text-rose-700 dark:text-rose-300">{threadError}</p>
          <button
            type="button"
            onClick={() => void loadThreads()}
            className="rounded px-2 py-1 text-xs font-semibold text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-rose-300"
          >
            Retry
          </button>
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {(["producer", "service"] as const).map((type) => (
          <SummaryCard
            key={type}
            type={type}
            thread={threads?.[type] ?? null}
            summary={summaries[type]}
            loadingThreads={loadingThreads}
            threadUnavailable={Boolean(threadError)}
            onOpen={(trigger) => openDrawer(type, trigger)}
            onRetry={() => {
              const thread = threads?.[type];
              if (thread?.entries.length) {
                void loadSummary(type, thread.version);
              }
            }}
          />
        ))}
      </div>
      <ThreadDrawer
        open={drawerOpen}
        activeType={activeType}
        accountName={accountName}
        orderLabel={orderLabel}
        threads={threads}
        canEditProducer={canEditProducer}
        producerEditHref={producerEditHref}
        serviceBody={serviceBody}
        serviceBusy={serviceBusy}
        serviceError={serviceError}
        dialogRef={dialogRef}
        onTypeChange={setActiveType}
        onClose={() => setDrawerOpen(false)}
        onServiceBodyChange={setServiceBody}
        onServiceSubmit={(event) => void submitServiceNote(event)}
      />
    </section>
  );
}
