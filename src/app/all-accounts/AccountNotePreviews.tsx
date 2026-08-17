"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  formatExactTimestamp,
  formatRelativeTime,
} from "@/lib/relative-time";
import {
  pickLatestServiceNote,
  serviceNotePreviewBody,
} from "@/lib/service-note";
import {
  pickLatestProducerNote,
  producerNotePreviewBody,
} from "@/lib/producer-note";
import type { BookOrderListItem } from "@/lib/db";
import {
  NOTE_THREAD_PRESENTATION,
  NoteThreadIcon,
} from "@/components/NoteThreadIdentity";
import { displayNoteAuthor } from "@/lib/note-attribution";
import type { NoteSummaryResponse } from "@/lib/note-thread-types";

type NoteKind = "service" | "producer";
type PreviewSummaryState =
  | { status: "idle" | "loading" | "unavailable" }
  | { status: "ready"; text: string; participants: string[] };

let collapsedSummaryQueue: Promise<void> = Promise.resolve();

function enqueueCollapsedSummary(work: () => Promise<void>): Promise<void> {
  const next = collapsedSummaryQueue.then(work, work);
  collapsedSummaryQueue = next.catch(() => undefined);
  return next;
}

/** First-sentence display form; the expanded card retains the full summary. */
export function compactNoteSummary(raw: string, limit = 120): string {
  const normalized = raw
    .replace(/\*\*/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+/g, " ")
    .replace(/^Summary:\s*/i, "")
    .trim();
  const firstSentence =
    normalized.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? normalized;
  if (firstSentence.length <= limit) return firstSentence;
  const slice = firstSentence.slice(0, limit);
  const cut = slice.lastIndexOf(" ");
  return `${(cut > limit * 0.65 ? slice.slice(0, cut) : slice).trimEnd()}…`;
}

function NoteShell({
  kind,
  compact,
  ariaLabel,
  onReveal,
  children,
}: {
  kind: NoteKind | "empty";
  compact: boolean;
  ariaLabel: string;
  onReveal?: () => void;
  children: ReactNode;
}) {
  const className = [
    "note-preview",
    `note-preview--${kind}`,
    kind === "empty" ? "" : NOTE_THREAD_PRESENTATION[kind].identityClass,
    compact ? "note-preview--compact" : "",
    onReveal ? "note-preview--action" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (onReveal) {
    return (
      <button
        type="button"
        className={className}
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation();
          onReveal();
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={className} aria-label={ariaLabel}>
      {children}
    </div>
  );
}

function NoteHead({
  kind,
  label,
  timestamp,
  timestampVerb,
  earlierCount,
}: {
  kind: NoteKind;
  label: string;
  timestamp: string | null;
  timestampVerb: string;
  earlierCount: number;
}) {
  const relative = formatRelativeTime(timestamp);
  const exact = formatExactTimestamp(timestamp);

  return (
    <div className="note-preview-head">
      <span className="note-preview-icon-wrap">
        <NoteThreadIcon type={kind} className="note-preview-icon" />
      </span>
      <span className="note-preview-label">{label}</span>
      {relative ? (
        <>
          <span className="note-preview-dot" aria-hidden="true">
            ·
          </span>
          <time
            dateTime={timestamp ?? undefined}
            title={exact ?? undefined}
            aria-label={exact ? `${timestampVerb} ${exact}` : relative}
            className="note-preview-time"
          >
            {relative}
          </time>
        </>
      ) : (
        <span className="note-preview-time">Date unavailable</span>
      )}
      {earlierCount > 0 ? (
        <span className="note-preview-earlier">+{earlierCount} earlier</span>
      ) : null}
    </div>
  );
}

/**
 * Both note books an operator needs before expanding an account: the latest
 * Workbench Service Note (`service_note_entries`) and the latest Producer Note
 * (`orders_temp.producer_notes`), each carrying its own order number so the
 * bodies are never conflated across orders. Full text stays in the expanded
 * order card.
 */
export const AccountNotePreviews = memo(function AccountNotePreviews({
  accountId,
  orders,
  onReveal,
  initialServiceSummary = null,
  initialServiceParticipants = [],
}: {
  accountId: string;
  orders: readonly BookOrderListItem[];
  /** Expands the account so the full note detail is reachable. */
  onReveal?: () => void;
  /** Optional server/test seed; live lists lazily fill this when visible. */
  initialServiceSummary?: string | null;
  initialServiceParticipants?: string[];
}) {
  const service = pickLatestServiceNote(orders);
  const producer = pickLatestProducerNote(orders);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const [serviceSummary, setServiceSummary] = useState<PreviewSummaryState>(
    initialServiceSummary && service && service.earlierCount > 0
      ? {
          status: "ready",
          text: compactNoteSummary(initialServiceSummary),
          participants:
            initialServiceParticipants.length > 0
              ? initialServiceParticipants
              : [displayNoteAuthor(service.author)],
        }
      : { status: "idle" },
  );
  // Two stacked cards would double the row height at two lines each.
  const compact = Boolean(service && producer);
  const serviceNeedsSummary = Boolean(service && service.earlierCount > 0);
  const serviceOrderId = service?.orderId ?? null;
  const serviceAuthor = service?.author ?? null;
  const seededServiceSummary = Boolean(initialServiceSummary);
  const serviceDisplayBody =
    serviceSummary.status === "ready"
      ? serviceSummary.text
      : service
        ? serviceNotePreviewBody(service.body)
        : "";

  useEffect(() => {
    if (!serviceNeedsSummary || seededServiceSummary || serviceOrderId === null)
      return;
    const companyId = Number(accountId.replace(/^co-/, ""));
    if (!Number.isSafeInteger(companyId) || companyId <= 0) return;
    const controller = new AbortController();
    let requested = false;
    const load = () => {
      if (requested || controller.signal.aborted) return;
      requested = true;
      setServiceSummary({ status: "loading" });
      void enqueueCollapsedSummary(async () => {
        if (controller.signal.aborted) return;
        try {
          const response = await fetch("/api/orders/note-summary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              orderId: serviceOrderId,
              threadType: "service",
            }),
            cache: "no-store",
            signal: controller.signal,
          });
          const result = (await response.json()) as NoteSummaryResponse;
          if (
            response.ok &&
            result.status === "ready" &&
            result.method === "ai" &&
            result.summary
          ) {
            setServiceSummary({
              status: "ready",
              text: compactNoteSummary(result.summary),
              participants:
                result.participants && result.participants.length > 0
                  ? result.participants
                  : [displayNoteAuthor(serviceAuthor)],
            });
          } else {
            setServiceSummary({ status: "unavailable" });
          }
        } catch {
          if (!controller.signal.aborted) {
            setServiceSummary({ status: "unavailable" });
          }
        }
      });
    };

    const node = stackRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      const timer = window.setTimeout(load, 0);
      return () => {
        controller.abort();
        window.clearTimeout(timer);
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        load();
        observer.disconnect();
      },
      { rootMargin: "80px 0px" },
    );
    observer.observe(node);
    return () => {
      controller.abort();
      observer.disconnect();
    };
  }, [
    accountId,
    serviceNeedsSummary,
    serviceOrderId,
    seededServiceSummary,
    serviceAuthor,
  ]);

  return (
    <div ref={stackRef} className="note-preview-stack">
      {service ? (
        <NoteShell
          kind="service"
          compact={compact}
          onReveal={onReveal}
          ariaLabel={
            serviceSummary.status === "ready"
              ? `Service Notes AI summary: ${serviceDisplayBody}. Participants: ${serviceSummary.participants.join(", ")}`
              : `Service notes: ${serviceDisplayBody} by ${displayNoteAuthor(service.author)} on order ${service.orderId}`
          }
        >
          <NoteHead
            kind="service"
            label={NOTE_THREAD_PRESENTATION.service.label}
            timestamp={service.createdAt}
            timestampVerb="Created"
            earlierCount={service.earlierCount}
          />
          {serviceSummary.status === "ready" ? (
            <p className="note-preview-summary-label">
              <span aria-hidden="true">✦</span> AI Summary
            </p>
          ) : null}
          <p className="note-preview-body">{serviceDisplayBody}</p>
          <p className="note-preview-meta">
            {serviceSummary.status === "ready" ? (
              <>
                <span
                  className="note-preview-participants"
                  title={serviceSummary.participants.join(", ")}
                >
                  <span className="note-preview-meta-label">Participants:</span>{" "}
                  {serviceSummary.participants.join(", ")}
                </span>
                {onReveal ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="note-preview-expand">Expand</span>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <span className="note-preview-author">
                  {displayNoteAuthor(service.author)}
                </span>
                <span aria-hidden="true"> · </span>
                <span>Order #{service.orderId}</span>
              </>
            )}
          </p>
        </NoteShell>
      ) : null}

      {producer ? (
        <NoteShell
          kind="producer"
          compact={compact}
          onReveal={onReveal}
          ariaLabel={`Producer note: ${producerNotePreviewBody(producer.body)} by ${displayNoteAuthor(producer.author)} on order ${producer.orderId}`}
        >
          <NoteHead
            kind="producer"
            label={NOTE_THREAD_PRESENTATION.producer.label}
            timestamp={producer.updatedAt}
            timestampVerb="Updated"
            earlierCount={producer.earlierCount}
          />
          <p className="note-preview-body">
            {producerNotePreviewBody(producer.body)}
          </p>
          <p className="note-preview-meta">
            <span className="note-preview-author">
              {displayNoteAuthor(producer.author)}
            </span>
            <span aria-hidden="true"> · </span>
            <span>Order #{producer.orderId}</span>
          </p>
        </NoteShell>
      ) : null}

      {!service && !producer ? (
        <NoteShell kind="empty" compact={false} ariaLabel="No notes on this account">
          <div className="note-preview-head">
            <span className="note-preview-icon-wrap">
              <NoteThreadIcon type="service" className="note-preview-icon" />
            </span>
            <span className="note-preview-label">Notes</span>
          </div>
          <p className="note-preview-body note-preview-body--empty">
            No service or producer note
          </p>
        </NoteShell>
      ) : null}
    </div>
  );
});
