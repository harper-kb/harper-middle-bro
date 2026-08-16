"use client";

import { useId, useState } from "react";
import {
  formatExactTimestamp,
  formatRelativeTime,
} from "@/lib/relative-time";

/** Collapsed preview budget — enough to identify the note without a layout jump. */
const PREVIEW_CHARS = 160;

export type ProducerNoteCardProps = {
  note: string;
  /** Last write stamp from `orders_temp.producer_notes_updated_at`. */
  updatedAt: string | null;
  /** Resolved from `producer_notes_updated_by` → `internal_agents`. */
  authorName: string | null;
  canEdit: boolean;
  /** BigBrother deep-link where the producer note is edited today. */
  editHref: string | null;
};

function NoteIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      className="mt-0.5 shrink-0 text-[var(--accent)]"
    >
      <path
        fill="currentColor"
        d="M3.5 1.5A1.5 1.5 0 0 0 2 3v10a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 14 13V5.207a1.5 1.5 0 0 0-.44-1.06L10.853 1.44A1.5 1.5 0 0 0 9.793 1H3.5ZM3 3a.5.5 0 0 1 .5-.5H9v2.5A1.5 1.5 0 0 0 10.5 6.5H13V13a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 13V3Zm8.5 2.5H10.5a.5.5 0 0 1-.5-.5V3.207L12.793 5.5H11.5Z"
      />
      <path
        fill="currentColor"
        d="M4.75 8.25h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Zm0 3h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z"
      />
    </svg>
  );
}

function previewText(note: string): { preview: string; needsToggle: boolean } {
  const hasBreaks = /\n/.test(note);
  const normalized = note.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_CHARS && !hasBreaks) {
    return { preview: normalized, needsToggle: false };
  }
  if (normalized.length <= PREVIEW_CHARS) {
    // Multiline but short: collapse to one line for the preview; expand restores breaks.
    return { preview: normalized, needsToggle: true };
  }
  const slice = normalized.slice(0, PREVIEW_CHARS);
  const cut = slice.lastIndexOf(" ");
  const preview = (cut > 80 ? slice.slice(0, cut) : slice).trimEnd();
  return { preview: `${preview}…`, needsToggle: true };
}

export function ProducerNoteCard({
  note,
  updatedAt,
  authorName,
  canEdit,
  editHref,
}: ProducerNoteCardProps) {
  const body = note.trim();
  if (!body) return null;

  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const { preview, needsToggle } = previewText(body);
  const relative = formatRelativeTime(updatedAt);
  const exact = formatExactTimestamp(updatedAt);
  const author = authorName?.trim() || "Unknown producer";
  const showToggle = needsToggle;

  return (
    <article
      className="mt-2 rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] shadow-sm"
      aria-label="Producer note"
    >
      <div className="border-l-2 border-[var(--accent)] px-3 py-2.5 sm:px-3.5">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 items-start gap-2">
            <NoteIcon />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h3 className="text-xs font-semibold text-[var(--ink)]">
                  Producer Note
                </h3>
                {relative ? (
                  <time
                    dateTime={updatedAt ?? undefined}
                    title={exact ?? undefined}
                    aria-label={exact ? `Updated ${exact}` : relative}
                    className="text-[11px] text-[var(--muted)]"
                  >
                    {relative}
                  </time>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                {author}
              </p>
            </div>
          </div>

          {canEdit && editHref ? (
            <a
              href={editHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Edit producer note"
              title="Edit producer note in BigBrother"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--rule)] bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span aria-hidden="true">✎</span>
              Edit
            </a>
          ) : null}
        </header>

        <div
          id={panelId}
          className="mt-2 text-xs leading-snug text-[var(--ink)]"
        >
          {expanded || !showToggle ? (
            <p className="whitespace-pre-wrap break-words">{body}</p>
          ) : (
            <p className="break-words">{preview}</p>
          )}
        </div>

        {showToggle ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((value) => !value)}
            className="mt-1.5 rounded-md px-1 py-0.5 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
