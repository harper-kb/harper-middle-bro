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
import {
  NOTE_THREAD_PRESENTATION,
  NoteThreadIcon,
} from "@/components/NoteThreadIdentity";
import {
  displayNoteAuthor,
  visibleNoteParticipants,
} from "@/lib/note-attribution";

export type SummaryState =
  | { status: "idle" }
  | { status: "loading"; version: string }
  | {
      status: "ready";
      text: string;
      generatedAt: string;
      version: string;
      method: "ai";
    }
  | { status: "unavailable"; version: string };

const EMPTY_SUMMARIES: Record<NoteThreadType, SummaryState> = {
  producer: { status: "idle" },
  service: { status: "idle" },
};

const THREAD_TYPES: readonly NoteThreadType[] = ["producer", "service"];

/**
 * Silent retry schedule for the initial thread load. The threads ride a
 * shared, rate-limited Management API connection, so a first fetch can fail
 * transiently; retrying quietly keeps the card in its loading state instead
 * of flashing an error the operator has to click through. Manual Retry
 * remains for the persistent case.
 */
export const NOTE_THREAD_AUTO_RETRY_DELAYS_MS: readonly number[] = [
  1_500, 4_000,
];

const INITIAL_THREAD_LOADING: Record<NoteThreadType, boolean> = {
  producer: true,
  service: true,
};

const EMPTY_THREAD_ERRORS: Record<NoteThreadType, string | null> = {
  producer: null,
  service: null,
};

type DrawerIntent = "view" | "add";

/**
 * The order's Producer Note as the book snapshot knows it — the
 * same data the collapsed previews render. The Producer thread is by design
 * the single current note on the order, so the snapshot can stand in for the
 * whole thread instantly while the live fetch confirms; without it the card
 * shows a skeleton for the full round-trip even when there is nothing to load.
 *
 * Service Notes get no such seed: their thread is account-scoped, and one
 * order's snapshot cannot honestly claim the account has no notes elsewhere.
 */
export type ProducerNotePreview = {
  body: string | null;
  updatedAt: string | null;
  authorName: string | null;
};

export function provisionalProducerThread(
  orderId: number,
  preview: ProducerNotePreview | null | undefined,
): NoteThread | null {
  if (!preview) return null;
  const body = preview.body ?? "";
  const updatedAt = preview.updatedAt ?? null;
  const entries: NoteThread["entries"] = body.trim()
    ? [
        {
          id: `producer-${orderId}`,
          body,
          author: preview.authorName ?? "Unknown author",
          createdAt: updatedAt,
          updatedAt,
          edited: false,
          orderId,
          orderLabel: `Order #${orderId}`,
        },
      ]
    : [];
  return {
    type: "producer",
    scope: "order",
    entries,
    version: `snapshot:${orderId}:${updatedAt ?? "none"}`,
    latestAt: updatedAt,
  };
}

/**
 * Provisional empty Service thread, seedable only when the caller verified —
 * at account level, across every book order regardless of view filters —
 * that the snapshot carries no visible Service Note. The live fetch still
 * runs and reconciles, so a note written since the last refresh tick
 * appears moments later instead of the card holding a skeleton for a
 * round-trip that will almost always come back empty.
 */
export function provisionalServiceThread(
  companyId: number,
  accountKnownEmpty: boolean | undefined,
): NoteThread | null {
  if (!accountKnownEmpty) return null;
  return {
    type: "service",
    scope: "account",
    entries: [],
    version: `snapshot:company-${companyId}:empty`,
    latestAt: null,
  };
}

export type VisibleThreadState =
  | { kind: "empty"; visibleCount: 0 }
  | { kind: "single"; visibleCount: 1; note: NoteThread["entries"][number] }
  | {
      kind: "multiple";
      visibleCount: number;
      notes: NoteThread["entries"];
    };

export function selectVisibleThreadState(
  thread: NoteThread,
): VisibleThreadState {
  const visibleCount = thread.entries.length;
  if (visibleCount === 0) return { kind: "empty", visibleCount: 0 };
  if (visibleCount === 1) {
    return { kind: "single", visibleCount: 1, note: thread.entries[0]! };
  }
  return {
    kind: "multiple",
    visibleCount,
    notes: thread.entries,
  };
}

export type NoteThreadCardState =
  | { kind: "loading" }
  | { kind: "error"; recoverable: boolean; message: string }
  | {
      kind: "empty";
      visibleCount: 0;
      canAdd: boolean;
      thread: NoteThread;
    }
  | {
      kind: "single";
      visibleCount: 1;
      note: NoteThread["entries"][number];
      thread: NoteThread;
    }
  | {
      kind: "multiple";
      visibleCount: number;
      notes: NoteThread["entries"];
      thread: NoteThread;
      summaryState: SummaryState;
    };

export function resolveNoteThreadCardState({
  thread,
  summary,
  loading,
  error,
  canAdd,
}: {
  thread: NoteThread | null;
  summary: SummaryState;
  loading: boolean;
  error: string | null;
  canAdd: boolean;
}): NoteThreadCardState {
  // Data on hand beats an error card: a thread (fetched or seeded from the
  // snapshot) keeps rendering through a failed refresh. The error state — and
  // its Retry affordance — appears only when there is nothing to show.
  if (!thread) {
    if (error) return { kind: "error", recoverable: true, message: error };
    return loading
      ? { kind: "loading" }
      : {
          kind: "error",
          recoverable: true,
          message: "Notes are temporarily unavailable.",
        };
  }
  const visible = selectVisibleThreadState(thread);
  if (visible.kind === "empty") {
    return { ...visible, canAdd, thread };
  }
  if (visible.kind === "single") {
    return { ...visible, thread };
  }
  return {
    ...visible,
    thread,
    summaryState: summary,
  };
}

export function mergeRequestedThreads(
  current: NoteThreadsResponse | null,
  incoming: NoteThreadsResponse,
  requestedTypes: readonly NoteThreadType[],
): NoteThreadsResponse {
  if (!current || requestedTypes.length === THREAD_TYPES.length) return incoming;
  const next = { ...current };
  for (const type of requestedTypes) next[type] = incoming[type];
  return next;
}

export function summaryTargets(
  threads: NoteThreadsResponse,
  requestedTypes: readonly NoteThreadType[],
): NoteThreadType[] {
  return requestedTypes.filter((type) => threads[type].entries.length >= 2);
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

function SummarySkeleton({
  label = "Generating AI summary",
}: {
  label?: string;
}) {
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="h-2.5 w-full animate-pulse rounded bg-[var(--rule)] motion-reduce:animate-none" />
      <div className="h-2.5 w-5/6 animate-pulse rounded bg-[var(--rule)] motion-reduce:animate-none" />
      <div className="h-2.5 w-2/3 animate-pulse rounded bg-[var(--rule)] motion-reduce:animate-none" />
    </div>
  );
}

function NoteAttribution({
  note,
  participants = [],
  className = "mt-3",
  showExact = false,
  latest = false,
}: {
  note: NoteThread["entries"][number];
  participants?: readonly string[];
  className?: string;
  showExact?: boolean;
  latest?: boolean;
}) {
  const timestamp = note.updatedAt ?? note.createdAt;
  const relative = formatRelativeTime(timestamp) ?? "Time unavailable";
  const exact = formatExactTimestamp(timestamp);
  return (
    <div className={`note-thread-attribution text-[11px] ${className}`}>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {latest ? (
          <span className="rounded-full border border-[var(--rule)] px-1.5 py-0.5 text-[10px] font-semibold">
            Latest
          </span>
        ) : null}
        <span className="note-thread-author">
          {displayNoteAuthor(note.author)}
        </span>
        <span aria-hidden="true">·</span>
        <time
          dateTime={timestamp ?? undefined}
          title={exact ?? undefined}
          aria-label={exact ?? relative}
          className="tabular-nums"
        >
          {relative}
        </time>
        <span aria-hidden="true">·</span>
        <span>{note.orderLabel}</span>
        {note.edited ? <span>· Edited</span> : null}
      </p>
      {showExact && exact ? (
        <p className="mt-1 tabular-nums">{exact}</p>
      ) : null}
      {participants.length > 1 ? (
        <p className="mt-1 truncate" title={participants.join(", ")}>
          <span className="font-semibold text-[var(--ink)]">Participants:</span>{" "}
          {participants.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function NoteThreadCard({
  type,
  state,
  orderId,
  promoted,
  onOpen,
  onRetry,
}: {
  type: NoteThreadType;
  state: NoteThreadCardState;
  orderId: number;
  promoted: boolean;
  onOpen: (trigger: HTMLButtonElement, intent: DrawerIntent) => void;
  onRetry: () => void;
}) {
  const presentation = NOTE_THREAD_PRESENTATION[type];
  const headingId = `note-thread-heading-${orderId}-${type}`;
  const viewButtonId = `note-thread-view-${orderId}-${type}`;

  if (state.kind === "empty") {
    return (
      <article
        // The min-height matches the add-action variant, so an empty card
        // without the button (no permission) sits at the same height as its
        // neighbor with one.
        className={`note-thread-card note-thread-card--empty note-thread-card--compact ${presentation.identityClass} flex min-h-0 flex-col gap-2 rounded-lg border border-l-[3px] px-3 py-2.5 min-[480px]:min-h-[3.375rem] min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between`}
        aria-labelledby={headingId}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="note-thread-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          >
            <NoteThreadIcon type={type} className="h-4 w-4" />
          </span>
          <h4
            id={headingId}
            className="shrink-0 text-xs font-semibold text-[var(--ink)]"
          >
            {presentation.label}
          </h4>
          <span
            role="status"
            className="truncate text-[11px] text-[var(--muted)]"
          >
            No notes yet
          </span>
        </div>
        {state.canAdd ? (
          <button
            type="button"
            onClick={(event) => onOpen(event.currentTarget, "add")}
            aria-label={presentation.addLabel}
            className="note-thread-action inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
          >
            <span aria-hidden="true">+</span>
            {presentation.addLabel}
          </button>
        ) : null}
      </article>
    );
  }

  if (state.kind === "loading") {
    return (
      <article
        className={`note-thread-card note-thread-card--full ${presentation.identityClass} flex min-h-[8rem] flex-col rounded-xl border border-t-[3px] p-4 shadow-[0_2px_8px_rgba(26,44,54,0.07)] dark:shadow-none`}
        aria-labelledby={headingId}
        aria-busy="true"
      >
        <header className="flex items-center gap-2.5">
          <span
            className="note-thread-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          >
            <NoteThreadIcon type={type} className="h-4 w-4" />
          </span>
          <div>
            <h4
              id={headingId}
              className="text-xs font-semibold text-[var(--ink)]"
            >
              {presentation.label}
            </h4>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Loading visible notes…
            </p>
          </div>
        </header>
        <div className="mt-3">
          <SummarySkeleton label="Loading visible notes" />
        </div>
      </article>
    );
  }

  if (state.kind === "error") {
    return (
      <article
        className={`note-thread-card note-thread-card--error note-thread-card--compact ${presentation.identityClass} flex min-h-0 flex-col gap-2 rounded-lg border border-l-[3px] px-3 py-2.5 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between`}
        aria-labelledby={headingId}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="note-thread-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          >
            <NoteThreadIcon type={type} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h4
              id={headingId}
              className="text-xs font-semibold text-[var(--ink)]"
            >
              {presentation.label}
            </h4>
            <p className="truncate text-[11px] text-[var(--muted)]" role="alert">
              {state.message}
            </p>
          </div>
        </div>
        {state.recoverable ? (
          <button
            type="button"
            onClick={onRetry}
            className="note-thread-action min-h-8 shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2"
          >
            Retry
          </button>
        ) : null}
      </article>
    );
  }

  const thread = state.thread;
  const visibleCount = state.visibleCount;
  const latestNote =
    state.kind === "single" ? state.note : state.notes[0]!;
  const participants =
    state.kind === "single" ? [] : visibleNoteParticipants(state.notes);
  let content: React.ReactNode;
  let freshness: string | null = null;
  if (state.kind === "single") {
    content = (
      <p className="whitespace-pre-wrap break-words text-[13.5px] font-medium leading-[1.55] text-slate-900 dark:text-[var(--ink)]">
        {state.note.body}
      </p>
    );
  } else {
    const summary = state.summaryState;
    freshness =
      summary.status === "ready"
        ? `Generated ${
            formatRelativeTime(summary.generatedAt) ?? "recently"
          }`
        : `Reflects notes through ${
            formatRelativeTime(thread.latestAt) ?? "latest update"
          }`;
    content =
      summary.status === "loading" || summary.status === "idle" ? (
        <SummarySkeleton />
      ) : summary.status === "ready" ? (
        <p className="whitespace-pre-line text-[13.5px] font-medium leading-[1.55] text-slate-900 dark:text-[var(--ink)]">
          {summary.text}
        </p>
      ) : (
        <div role="status" aria-live="polite">
          <p className="text-[13px] font-medium text-slate-600 dark:text-[var(--muted)]">
            AI summary unavailable
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="note-thread-action mt-1 rounded border px-2 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2"
          >
            Retry
          </button>
        </div>
      );
  }

  return (
    <article
      className={`note-thread-card note-thread-card--full ${presentation.identityClass} flex flex-col overflow-hidden rounded-xl border border-t-[3px] p-4 shadow-[0_2px_8px_rgba(26,44,54,0.07)] dark:shadow-none ${
        promoted ? "note-thread-card--promoted" : ""
      }`}
      aria-labelledby={headingId}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="note-thread-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
            <NoteThreadIcon type={type} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h4
              id={headingId}
              className="truncate text-xs font-semibold text-[var(--ink)]"
            >
              {presentation.label}
            </h4>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600 dark:text-[var(--muted)]">
              {presentation.scopeLabel}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 dark:border-[var(--rule)] dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)]">
          {`${visibleCount.toLocaleString()} ${
            visibleCount === 1 ? "note" : "notes"
          }`}
        </span>
      </header>

      <NoteAttribution note={latestNote} participants={participants} />

      <div className="mt-3 flex-1">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600 dark:text-[var(--muted)]">
          {state.kind === "single" ? null : <SparkleIcon />}
          {state.kind === "single" ? "Note" : "AI Summary"}
        </div>
        {content}
      </div>

      <div className="mt-3">
        {freshness ? (
          <p className="mb-2 text-[11px] font-medium text-slate-600 dark:text-[var(--muted)]">
            {freshness}
          </p>
        ) : null}
        <button
          id={viewButtonId}
          type="button"
          onClick={(event) => onOpen(event.currentTarget, "view")}
          className="note-thread-view-button flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
          aria-label={`View full ${presentation.label} thread`}
        >
          View full thread
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

export function NoteThreadCardGrid({
  states,
  orderId,
  promotedType = null,
  onOpen,
  onRetry,
}: {
  states: Record<NoteThreadType, NoteThreadCardState>;
  orderId: number;
  promotedType?: NoteThreadType | null;
  onOpen: (
    type: NoteThreadType,
    trigger: HTMLButtonElement,
    intent: DrawerIntent,
  ) => void;
  onRetry: (type: NoteThreadType) => void;
}) {
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      {THREAD_TYPES.map((type) => (
        <NoteThreadCard
          key={type}
          type={type}
          state={states[type]}
          orderId={orderId}
          promoted={promotedType === type}
          onOpen={(trigger, intent) => onOpen(type, trigger, intent)}
          onRetry={() => onRetry(type)}
        />
      ))}
    </div>
  );
}

export function FullNoteThreadEntries({
  thread,
  type,
}: {
  thread: NoteThread;
  type: NoteThreadType;
}) {
  const producer = type === "producer";
  if (thread.entries.length === 0) {
    return (
      <p
        className="rounded-lg border border-[var(--rule)] bg-[var(--surface)] px-3 py-2.5 text-xs text-[var(--muted)]"
        role="status"
      >
        No notes yet
      </p>
    );
  }
  return (
    <ol className="space-y-3" aria-label={`${producer ? "Producer" : "Service"} Notes`}>
      {thread.entries.map((entry, index) => {
        return (
          <li
            key={entry.id}
            id={`note-entry-${entry.id}`}
            className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-3"
          >
            <NoteAttribution
              note={entry}
              latest={index === 0}
              showExact
              className=""
            />
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
  canAddService,
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
  canAddService: boolean;
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
  const presentation = NOTE_THREAD_PRESENTATION[activeType];
  const typeLabel = presentation.label;
  const empty = thread?.entries.length === 0;
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
        className={`absolute inset-0 flex flex-col bg-[var(--surface-raised)] shadow-2xl sm:inset-y-0 sm:left-auto sm:w-[min(46rem,92vw)] sm:border-l sm:border-[var(--rule)] ${presentation.identityClass}`}
      >
        <header className="border-b border-[var(--rule)] px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="note-thread-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                <NoteThreadIcon type={activeType} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs text-[var(--muted)]">
                  {accountName}
                </p>
                <h2
                  id="note-thread-title"
                  className="mt-0.5 text-base font-semibold text-[var(--note-ink)]"
                >
                  {typeLabel}
                </h2>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                  {activeType === "service"
                    ? `All visible Service Notes for this account · opened from ${orderLabel}`
                    : `${orderLabel} · current Producer Note`}
                  {thread && thread.entries.length > 0
                    ? ` · ${thread.entries.length.toLocaleString()} ${
                        thread.entries.length === 1 ? "entry" : "entries"
                      }`
                    : ""}
                </p>
              </div>
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
                  className={`note-thread-tab ${NOTE_THREAD_PRESENTATION[type].identityClass} rounded-md px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--note-tint)] ${
                    selected
                      ? "note-thread-tab--selected shadow-sm"
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
          {thread && thread.entries.length >= 2 ? (
            <p className="mb-3 text-[10px] text-[var(--muted)]">
              AI-generated summaries are a convenience. The original notes below are the source of truth.
            </p>
          ) : null}
          {thread ? (
            <FullNoteThreadEntries thread={thread} type={activeType} />
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
              data-note-primary-action="producer"
              aria-label={
                empty
                  ? "Add producer note in BigBrother"
                  : "Edit producer note in BigBrother"
              }
              className="note-thread-action mt-4 inline-flex rounded-lg border px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2"
            >
              {empty
                ? "Add Producer Note in BigBrother"
                : "Edit Producer Note in BigBrother"}
            </a>
          ) : null}

          {activeType === "service" && canAddService ? (
            <form
              onSubmit={onServiceSubmit}
              className="mt-4 rounded-xl border border-[var(--note-border)] bg-[var(--note-surface)] p-3"
            >
              <label htmlFor="service-note-body" className="text-xs font-semibold text-[var(--ink)]">
                Add a Service Note
              </label>
              <textarea
                id="service-note-body"
                value={serviceBody}
                maxLength={2000}
                rows={3}
                disabled={serviceBusy}
                onChange={(event) => onServiceBodyChange(event.target.value)}
                placeholder="Add a concise note for the service team…"
                aria-describedby={
                  serviceError ? "service-note-error" : "service-note-count"
                }
                className="mt-2 w-full resize-y rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--note-tint)]"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span
                  id="service-note-count"
                  className="text-[10px] tabular-nums text-[var(--muted)]"
                >
                  {serviceBody.length.toLocaleString()}/2,000
                </span>
                <button
                  type="submit"
                  disabled={serviceBusy || !serviceBody.trim()}
                  aria-label="Add service note"
                  className="note-thread-action rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {serviceBusy ? "Adding…" : "Add note"}
                </button>
              </div>
              {serviceError ? (
                <p
                  id="service-note-error"
                  className="mt-2 text-xs text-rose-600 dark:text-rose-300"
                  role="alert"
                >
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
  canAddService = true,
  producerEditHref,
  producerNotePreview,
  accountServiceNotesEmpty,
}: {
  accountId: string;
  accountName: string;
  orderId: number;
  orderLabel: string;
  canEditProducer: boolean;
  /** Every authenticated operator with this visible book order can append. */
  canAddService?: boolean;
  producerEditHref: string;
  /** Snapshot seed for the Producer card — renders instantly, live fetch reconciles. */
  producerNotePreview?: ProducerNotePreview;
  /**
   * Account-level verified "no visible Service Notes" from the snapshot —
   * lets the Service card render its empty state instantly. Leave undefined
   * when unknown; never pass a per-view or per-order guess.
   */
  accountServiceNotesEmpty?: boolean;
}) {
  const companyId = Number(accountId.replace(/^co-/, ""));
  const provisionalProducer = provisionalProducerThread(
    orderId,
    producerNotePreview,
  );
  const provisionalService = provisionalServiceThread(
    companyId,
    accountServiceNotesEmpty,
  );
  const [threads, setThreads] = useState<NoteThreadsResponse | null>(null);
  const [threadErrors, setThreadErrors] =
    useState<Record<NoteThreadType, string | null>>(EMPTY_THREAD_ERRORS);
  const [loadingThreads, setLoadingThreads] =
    useState<Record<NoteThreadType, boolean>>(INITIAL_THREAD_LOADING);
  const [summaries, setSummaries] =
    useState<Record<NoteThreadType, SummaryState>>(EMPTY_SUMMARIES);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeType, setActiveType] = useState<NoteThreadType>("producer");
  const [serviceBody, setServiceBody] = useState("");
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [promotedType, setPromotedType] = useState<NoteThreadType | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const drawerInitialFocusRef = useRef<NoteThreadType | null>(null);
  const focusAfterCloseRef = useRef<NoteThreadType | null>(null);

  const loadSummary = useCallback(
    async (type: NoteThreadType, expectedVersion: string) => {
      setSummaries((current) => ({
        ...current,
        [type]: { status: "loading", version: expectedVersion },
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
          setSummaries((current) => {
            const pending = current[type];
            if (
              pending.status !== "loading" ||
              pending.version !== expectedVersion
            ) {
              return current;
            }
            return {
              ...current,
              [type]: {
                status: "ready",
                text: result.summary!,
                generatedAt: result.generatedAt!,
                version: result.threadVersion,
                method: result.method ?? "ai",
              },
            };
          });
          return;
        }
      } catch {
        // Original notes remain usable; summary failure is intentionally quiet.
      }
      setSummaries((current) => {
        const pending = current[type];
        if (
          pending.status !== "loading" ||
          pending.version !== expectedVersion
        ) {
          return current;
        }
        return {
          ...current,
          [type]: { status: "unavailable", version: expectedVersion },
        };
      });
    },
    [companyId, orderId],
  );

  const loadThreads = useCallback(
    async (
      requestedTypes: readonly NoteThreadType[] = THREAD_TYPES,
      options: {
        /**
         * A silent auto-retry is already scheduled: keep the loading state
         * up and hold the error back instead of flashing the error card
         * between attempts.
         */
        keepPendingOnError?: boolean;
      } = {},
    ): Promise<NoteThreadsResponse | null> => {
      setLoadingThreads((current) => {
        const next = { ...current };
        for (const type of requestedTypes) next[type] = true;
        return next;
      });
      setThreadErrors((current) => {
        const next = { ...current };
        for (const type of requestedTypes) next[type] = null;
        return next;
      });
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

        setThreads((current) =>
          mergeRequestedThreads(current, result, requestedTypes),
        );
        setSummaries((current) => {
          const next = { ...current };
          for (const type of requestedTypes) next[type] = { status: "idle" };
          return next;
        });
        setLoadingThreads((current) => {
          const next = { ...current };
          for (const type of requestedTypes) next[type] = false;
          return next;
        });
        // Empty and single-note threads render originals and never summarize.
        for (const type of summaryTargets(result, requestedTypes)) {
          void loadSummary(type, result[type].version);
        }
        return result;
      } catch (cause) {
        if (options.keepPendingOnError) return null;
        const message =
          cause instanceof Error ? cause.message : "Notes unavailable";
        setThreadErrors((current) => {
          const next = { ...current };
          for (const type of requestedTypes) next[type] = message;
          return next;
        });
        setLoadingThreads((current) => {
          const next = { ...current };
          for (const type of requestedTypes) next[type] = false;
          return next;
        });
        return null;
      }
    },
    [companyId, orderId, loadSummary],
  );

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    // First load with silent retries: only the final failed attempt surfaces
    // the error card, so a transient blip never breaks a card the collapsed
    // preview is happily rendering from the local snapshot.
    const attempt = (index: number) => {
      const isLast = index >= NOTE_THREAD_AUTO_RETRY_DELAYS_MS.length;
      void loadThreads(THREAD_TYPES, { keepPendingOnError: !isLast }).then(
        (result) => {
          if (cancelled || result || isLast) return;
          timer = window.setTimeout(
            () => attempt(index + 1),
            NOTE_THREAD_AUTO_RETRY_DELAYS_MS[index],
          );
        },
      );
    };
    timer = window.setTimeout(() => attempt(0), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadThreads]);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(""), 1_500);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const requestedFocus =
      drawerInitialFocusRef.current === "service"
        ? dialog?.querySelector<HTMLElement>("#service-note-body")
        : drawerInitialFocusRef.current === "producer"
          ? dialog?.querySelector<HTMLElement>(
              '[data-note-primary-action="producer"]',
            )
          : null;
    drawerInitialFocusRef.current = null;
    const first = requestedFocus ?? (dialog ? focusableElements(dialog)[0] : null);
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
      const focusType = focusAfterCloseRef.current;
      focusAfterCloseRef.current = null;
      if (focusType) {
        window.requestAnimationFrame(() => {
          document
            .getElementById(`note-thread-view-${orderId}-${focusType}`)
            ?.focus();
        });
      } else {
        openerRef.current?.focus();
      }
    };
  }, [drawerOpen, orderId]);

  function openDrawer(
    type: NoteThreadType,
    trigger: HTMLButtonElement,
    intent: DrawerIntent,
  ) {
    openerRef.current = trigger;
    drawerInitialFocusRef.current = intent === "add" ? type : null;
    setServiceError(null);
    setActiveType(type);
    setDrawerOpen(true);
  }

  async function submitServiceNote(event: FormEvent) {
    event.preventDefault();
    const body = serviceBody.trim();
    if (!body || body.length > 2000 || serviceBusy || !canAddService) return;
    setServiceBusy(true);
    setServiceError(null);
    const previousVersion = threads?.service.version ?? null;
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
      let refreshed = await loadThreads(["service"]);
      if (
        refreshed &&
        previousVersion !== null &&
        refreshed.service.version === previousVersion
      ) {
        // The action can return before the read path observes the write. One
        // bounded retry avoids either inventing a note or leaving a successful
        // first write looking empty.
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        refreshed = await loadThreads(["service"]);
      }
      if (
        !refreshed ||
        (previousVersion !== null &&
          refreshed.service.version === previousVersion)
      ) {
        setServiceError(
          "The note was added, but the thread could not refresh. Retry the thread before adding another note.",
        );
        return;
      }
      setServiceBody("");
      setPromotedType("service");
      setAnnouncement("Service note added.");
      focusAfterCloseRef.current = "service";
      setDrawerOpen(false);
    } catch (cause) {
      setServiceError(
        cause instanceof Error ? cause.message : "Note was not added",
      );
    } finally {
      setServiceBusy(false);
    }
  }

  const cardStates: Record<NoteThreadType, NoteThreadCardState> = {
    producer: resolveNoteThreadCardState({
      thread: threads?.producer ?? provisionalProducer,
      summary: summaries.producer,
      loading: loadingThreads.producer,
      error: threadErrors.producer,
      canAdd: canEditProducer,
    }),
    service: resolveNoteThreadCardState({
      thread: threads?.service ?? provisionalService,
      summary: summaries.service,
      loading: loadingThreads.service,
      error: threadErrors.service,
      canAdd: canAddService,
    }),
  };

  return (
    <section
      className="order-note-threads mt-3 border-t border-[var(--rule)] pt-3"
      aria-label="Order note threads"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <NoteThreadCardGrid
        states={cardStates}
        orderId={orderId}
        promotedType={promotedType}
        onOpen={openDrawer}
        onRetry={(type) => {
          const thread = threads?.[type];
          if (thread && thread.entries.length >= 2) {
            void loadSummary(type, thread.version);
          } else {
            void loadThreads([type]);
          }
        }}
      />
      <ThreadDrawer
        open={drawerOpen}
        activeType={activeType}
        accountName={accountName}
        orderLabel={orderLabel}
        threads={threads}
        canEditProducer={canEditProducer}
        canAddService={canAddService}
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
