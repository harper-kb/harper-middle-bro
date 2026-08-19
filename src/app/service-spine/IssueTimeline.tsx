"use client";

import { useMemo, useState } from "react";
import { LocalDateTime } from "@/components/LocalDateTime";
import {
  eventKindLabel,
  type SpineTimeline,
} from "@/lib/service-spine/domain";

export const SPINE_TIMELINE_TRUNCATION_COPY =
  "Older events past the read limit remain in Service Spine.";
const INLINE_PAYLOAD_MAX_CHARS = 400;
const TIMELINE_PAGE = 20;

type TimelineFilter = "all" | "human" | "agent";
type ActorClass = "human" | "agent" | "system";

function isIdShapedValue(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmed,
    ) ||
    /^[0-9a-f]{16,}$/i.test(trimmed) ||
    /^\d{5,}$/.test(trimmed) ||
    /^[\w.-]+:\S+$/.test(trimmed)
  );
}

function isIdShapedKey(key: string): boolean {
  return /(^|_)(id|ids|ref|refs|key|keys|uuid|token)$/i.test(key);
}

export function splitSpinePayload(payload: unknown): {
  inline: Array<{ key: string | null; value: string }>;
  raw: string | null;
} {
  if (payload === null || payload === undefined) {
    return { inline: [], raw: null };
  }
  let raw: string;
  try {
    raw = JSON.stringify(payload, null, 2) ?? String(payload);
  } catch {
    raw = String(payload);
  }
  if (typeof payload === "string") {
    const inline =
      payload.length <= INLINE_PAYLOAD_MAX_CHARS && !isIdShapedValue(payload)
        ? [{ key: null, value: payload }]
        : [];
    return { inline, raw };
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { inline: [], raw };
  }
  const inline: Array<{ key: string | null; value: string }> = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= INLINE_PAYLOAD_MAX_CHARS &&
      !isIdShapedKey(key) &&
      !isIdShapedValue(value)
    ) {
      inline.push({ key, value });
    }
  }
  return { inline, raw };
}

export function spineTimelineActorClass(actor: string | null): ActorClass {
  const normalized = (actor ?? "").trim().toLowerCase();
  if (normalized.endsWith("@harperinsure.com")) return "human";
  if (normalized.startsWith("agent:") || normalized.includes("spine-agent")) {
    return "agent";
  }
  return "system";
}

function actorLabel(actor: string | null): string {
  const kind = spineTimelineActorClass(actor);
  if (kind === "agent") return "Service agent";
  if (kind === "system") return actor?.trim() || "System";
  return actor?.trim() || "Harper teammate";
}

function eventTone(kind: string): string {
  if (kind === "blocked" || kind === "cancelled") return "var(--danger)";
  if (kind === "resolved" || kind === "auto_closed") return "var(--success)";
  if (kind === "closure_proposed") return "var(--spine-closure-review)";
  if (kind === "task_done") return "var(--info)";
  return "var(--muted)";
}

function readablePayloadValue(value: string): string {
  return /^[a-z][a-z0-9_]+$/.test(value) && value.includes("_")
    ? value.replace(/_/g, " ")
    : value;
}

function RawPayloadDisclosure({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-7 items-center gap-1 text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <span
          aria-hidden="true"
          className={`transition-transform motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
        Raw payload
      </button>
      {open ? (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--rule)] bg-[var(--surface-subtle)] px-2.5 py-2 text-[10px] leading-4 text-[var(--muted)]">
          {raw}
        </pre>
      ) : null}
    </div>
  );
}

function TimelineEventRow({
  event,
}: {
  event: SpineTimeline["events"][number];
}) {
  const { inline, raw } = splitSpinePayload(event.payload);
  const actorClass = spineTimelineActorClass(event.actor);
  const label = eventKindLabel(event.kind);
  return (
    <li
      className={`relative border-l border-[var(--rule)] pb-5 pl-5 ${
        actorClass === "agent" ? "text-[var(--muted)]" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className="absolute -left-[4.5px] top-1 h-2 w-2 rounded-full ring-4 ring-[var(--surface-raised)]"
        style={{ background: eventTone(event.kind) }}
      />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 className="text-xs font-semibold text-[var(--ink)]">{label}</h4>
        <span className="text-[10px] text-[var(--muted)]">
          {actorLabel(event.actor)}
        </span>
        <span className="ml-auto whitespace-nowrap text-[10px] tabular-nums text-[var(--muted)]">
          {event.at ? <LocalDateTime value={event.at} /> : "Time unknown"}
        </span>
      </div>
      {inline.slice(0, 2).map((entry, index) => (
        <p
          key={entry.key ?? `payload-${index}`}
          className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--ink)]"
        >
          {entry.key ? (
            <span className="text-[var(--muted)]">
              {entry.key.replace(/_/g, " ")}:{" "}
            </span>
          ) : null}
          {readablePayloadValue(entry.value)}
        </p>
      ))}
      {raw !== null ? <RawPayloadDisclosure raw={raw} /> : null}
    </li>
  );
}

export function IssueTimeline({
  timeline,
  timelineError,
}: {
  timeline: SpineTimeline | null;
  timelineError: string | null;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [limit, setLimit] = useState(TIMELINE_PAGE);

  const filtered = useMemo(() => {
    if (!timeline) return [];
    return timeline.events
      .filter((event) => {
        if (filter === "all") return true;
        return spineTimelineActorClass(event.actor) === filter;
      })
      .slice()
      .reverse();
  }, [filter, timeline]);
  const visible = filtered.slice(0, limit);

  if (!timeline) {
    return (
      <div
        role="status"
        className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] px-4 py-4"
      >
        <p className="text-sm font-semibold text-[var(--ink)]">
          Timeline unavailable
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          {timelineError ?? "The issue timeline is temporarily unavailable."}
        </p>
      </div>
    );
  }

  if (timeline.events.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--rule)] px-4 py-5 text-sm text-[var(--muted)]">
        No events are recorded on this issue.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="radiogroup"
          aria-label="Filter timeline events"
          className="seg inline-flex"
        >
          {(["all", "human", "agent"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter === value}
              onClick={() => {
                setFilter(value);
                setLimit(TIMELINE_PAGE);
              }}
              className="seg-option min-h-9 capitalize"
            >
              {value === "all" ? "All events" : value}
            </button>
          ))}
        </div>
        <p className="text-[10px] tabular-nums text-[var(--muted)]">
          {visible.length.toLocaleString("en-US")} shown ·{" "}
          {timeline.events.length.toLocaleString("en-US")} loaded ·{" "}
          {timeline.totalEvents.toLocaleString("en-US")} total
        </p>
      </div>

      {timeline.truncated ? (
        <p className="mt-3 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-[11px] leading-4 text-[var(--muted)]">
          Showing the newest {timeline.events.length.toLocaleString("en-US")} of{" "}
          {timeline.totalEvents.toLocaleString("en-US")} events.{" "}
          {SPINE_TIMELINE_TRUNCATION_COPY}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          No {filter} events are present in the loaded timeline.
        </p>
      ) : (
        <>
          <ol
            aria-label="Issue timeline, newest first"
            className="mt-4 pl-1"
          >
            {visible.map((event) => (
              <TimelineEventRow key={event.id} event={event} />
            ))}
          </ol>
          {visible.length < filtered.length ? (
            <button
              type="button"
              className="btn-ghost min-h-10 w-full text-xs"
              onClick={() =>
                setLimit((current) =>
                  Math.min(filtered.length, current + TIMELINE_PAGE),
                )
              }
            >
              Show {Math.min(TIMELINE_PAGE, filtered.length - visible.length)}{" "}
              older events
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
