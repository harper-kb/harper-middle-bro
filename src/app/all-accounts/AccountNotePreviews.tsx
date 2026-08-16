"use client";

import type { ReactNode } from "react";
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

type NoteKind = "service" | "producer";

function ServiceNoteIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      className="note-preview-icon"
    >
      <path
        fill="currentColor"
        d="M3.25 2A1.25 1.25 0 0 0 2 3.25v9.5C2 13.44 2.56 14 3.25 14h9.5c.69 0 1.25-.56 1.25-1.25v-7.19a1.25 1.25 0 0 0-.366-.884L10.324 2.366A1.25 1.25 0 0 0 9.44 2H3.25Zm.25 1.25h5.5V5.5c0 .69.56 1.25 1.25 1.25h2.25v6H3.5v-9.5Zm7.75.884L13.116 5.75H11.5a.25.25 0 0 1-.25-.25V4.134ZM5 8.25h6a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1 0-1.5Zm0 3h4a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1 0-1.5Z"
      />
    </svg>
  );
}

/** Speech-bubble mark — shape alone separates Producer from Service Note. */
function ProducerNoteIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      className="note-preview-icon"
    >
      <path
        fill="currentColor"
        d="M8 2c-3.45 0-6.25 2.13-6.25 4.75 0 1.5.92 2.83 2.35 3.7-.12.9-.5 1.72-1.1 2.4a.63.63 0 0 0 .63 1.02c1.6-.3 2.86-.94 3.72-1.6.21.02.43.03.65.03 3.45 0 6.25-2.13 6.25-4.75S11.45 2 8 2Zm0 1.5c2.73 0 4.75 1.6 4.75 3.25S10.73 10 8 10c-.3 0-.6-.02-.88-.06a.75.75 0 0 0-.54.15c-.4.32-.92.64-1.56.9.24-.5.4-1.04.47-1.62a.75.75 0 0 0-.42-.77C4.02 8.98 3.25 7.93 3.25 6.75 3.25 5.1 5.27 3.5 8 3.5Z"
      />
    </svg>
  );
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
      {kind === "service" ? <ServiceNoteIcon /> : <ProducerNoteIcon />}
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
export function AccountNotePreviews({
  orders,
  onReveal,
}: {
  orders: readonly BookOrderListItem[];
  /** Expands the account so the full note detail is reachable. */
  onReveal?: () => void;
}) {
  const service = pickLatestServiceNote(orders);
  const producer = pickLatestProducerNote(orders);
  // Two stacked cards would double the row height at two lines each.
  const compact = Boolean(service && producer);

  return (
    <div className="note-preview-stack">
      {service ? (
        <NoteShell
          kind="service"
          compact={compact}
          onReveal={onReveal}
          ariaLabel={`Service note: ${serviceNotePreviewBody(service.body)} by ${service.author} on order ${service.orderId}`}
        >
          <NoteHead
            kind="service"
            label="Service Note"
            timestamp={service.createdAt}
            timestampVerb="Created"
            earlierCount={service.earlierCount}
          />
          <p className="note-preview-body">
            {serviceNotePreviewBody(service.body)}
          </p>
          <p className="note-preview-meta">
            <span className="note-preview-author">{service.author}</span>
            <span aria-hidden="true"> · </span>
            <span>Order #{service.orderId}</span>
          </p>
        </NoteShell>
      ) : null}

      {producer ? (
        <NoteShell
          kind="producer"
          compact={compact}
          onReveal={onReveal}
          ariaLabel={`Producer note: ${producerNotePreviewBody(producer.body)} on order ${producer.orderId}`}
        >
          <NoteHead
            kind="producer"
            label="Producer Note"
            timestamp={producer.updatedAt}
            timestampVerb="Updated"
            earlierCount={producer.earlierCount}
          />
          <p className="note-preview-body">
            {producerNotePreviewBody(producer.body)}
          </p>
          <p className="note-preview-meta">
            <span className="note-preview-author">
              {producer.author ?? "Unknown producer"}
            </span>
            <span aria-hidden="true"> · </span>
            <span>Order #{producer.orderId}</span>
          </p>
        </NoteShell>
      ) : null}

      {!service && !producer ? (
        <NoteShell kind="empty" compact={false} ariaLabel="No notes on this account">
          <div className="note-preview-head">
            <ServiceNoteIcon />
            <span className="note-preview-label">Notes</span>
          </div>
          <p className="note-preview-body note-preview-body--empty">
            No service or producer note
          </p>
        </NoteShell>
      ) : null}
    </div>
  );
}
