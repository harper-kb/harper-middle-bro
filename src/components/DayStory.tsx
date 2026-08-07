"use client";

import Link from "next/link";
import { useState } from "react";
import { DeskSection } from "@/components/DeskSection";
import {
  formatClockTime,
  type DayChapter,
  type DayEvent,
  type StoryBucket,
} from "@/lib/day-story";

/**
 * The narrative half of My Day. Everything here is precomputed server-side —
 * this component only toggles between the three bucket widths and renders.
 */

type Interval = "60" | "20" | "10";

const INTERVALS: { id: Interval; label: string }[] = [
  { id: "60", label: "60 Min" },
  { id: "20", label: "20 Min" },
  { id: "10", label: "10 Min" },
];

const CLOSE_KINDS = new Set(["ticket_closed", "fast_path"]);

export function DayStory({
  summary,
  chapters,
  buckets,
}: {
  summary: string;
  chapters: DayChapter[];
  buckets: Record<Interval, StoryBucket[]>;
}) {
  const [interval, setInterval] = useState<Interval>("60");
  const active = buckets[interval];
  const maxClosed = Math.max(1, ...active.map((b) => b.closedCount));
  const totalClosed = active.reduce((n, b) => n + b.closedCount, 0);

  return (
    <div className="space-y-8">
      <section className="surface-card p-6">
        <p className="eyebrow">Your Day, In Order</p>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--ink)]">
          {summary}
        </p>
      </section>

      {chapters.length > 0 && (
        <section className="space-y-6">
          {chapters.map((chapter) => (
            <div key={chapter.id}>
              <h3 className="eyebrow">{chapter.title}</h3>
              <ol className="mt-3 space-y-0 border-l border-[var(--rule)]">
                {chapter.events.map((event, i) => (
                  <TimelineEntry key={`${event.at}-${i}`} event={event} />
                ))}
              </ol>
            </div>
          ))}
        </section>
      )}

      <DeskSection title="Closed Per Hour" summary={`${totalClosed} Closed`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-xs text-[var(--muted)]">
            {totalClosed === 0
              ? "No closes recorded in this span yet."
              : `${totalClosed} closed across the working span.`}
          </p>
          <div
            className="flex items-center gap-1.5"
            role="group"
            aria-label="Bucket Width"
          >
            {INTERVALS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setInterval(opt.id)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] active:scale-95 ${
                  interval === opt.id
                    ? "bg-[var(--ink)] text-[var(--paper)]"
                    : "bg-white text-[var(--muted)] ring-1 ring-[var(--rule)] hover:text-[var(--ink)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {active.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-[var(--rule)] px-4 py-6 text-center text-sm text-[var(--muted)]">
            The strip fills in once the first event of the day is recorded.
          </p>
        ) : (
          <div className="mt-5 flex items-end gap-px overflow-x-auto pb-1">
            {active.map((bucket) => (
              <div
                key={bucket.start}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
                title={`${bucket.label} — ${bucket.closedCount} Closed, ${bucket.count} Events`}
              >
                <div className="flex h-16 w-full items-end px-px">
                  <div
                    className={`w-full rounded-t-sm transition-[height] duration-300 ${
                      bucket.closedCount > 0
                        ? "bg-[var(--gold)]"
                        : "bg-[var(--sand)]"
                    }`}
                    style={{
                      height: `${
                        bucket.closedCount > 0
                          ? Math.max(12, (bucket.closedCount / maxClosed) * 100)
                          : 4
                      }%`,
                    }}
                  />
                </div>
                <span className="w-full truncate text-center text-[9px] leading-tight text-[var(--muted)]">
                  {bucket.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </DeskSection>
    </div>
  );
}

function TimelineEntry({ event }: { event: DayEvent }) {
  const closed = CLOSE_KINDS.has(event.kind);
  return (
    <li className="relative pb-5 pl-6 last:pb-1">
      <span
        aria-hidden
        className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--paper)] ${
          closed ? "bg-[var(--gold)]" : "border border-[var(--rule)] bg-white"
        }`}
      />
      <p className="font-mono text-[11px] text-[var(--muted)]">
        {formatClockTime(event.at)}
      </p>
      <p className="mt-0.5 text-sm leading-relaxed text-[var(--ink)]">
        {event.href ? (
          <Link
            href={event.href}
            className="transition-colors hover:text-[var(--coral)] hover:underline"
          >
            {event.headline}
          </Link>
        ) : (
          event.headline
        )}
      </p>
      {event.detail && (
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
          {event.detail}
        </p>
      )}
    </li>
  );
}
