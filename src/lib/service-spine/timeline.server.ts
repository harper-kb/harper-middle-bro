import "server-only";

import { getDb } from "../db/connection";
import {
  isRateLimited,
  runSupabaseManagementQuery,
} from "../supabase-management.server";
import {
  SPINE_TIMELINE_EVENT_CAP,
  type SpineTimeline,
  type SpineTimelineEvent,
} from "./domain";

/**
 * Per-issue timeline, on demand (design §3.3). The 160k-row issue_events
 * ledger is deliberately never mirrored; when the operator opens one issue's
 * timeline, the newest 500 events are fetched live through the Management
 * API with `count(*) OVER ()` so a capped page still reports the true total
 * (the source EVENTS_SQL shape), then cached durably in SQLite's
 * `remote_cache` under `spine-timeline:v1:{issueId}` with a five-minute TTL
 * (company-detail.server.ts precedent: durable cache, in-flight dedup,
 * prune). On a fetch failure with a cached copy, the cached copy is served
 * with its own fetchedAt — honestly older, never fabricated. With no cache,
 * a typed error surfaces so the API route can map it to a named failure.
 */

const TIMELINE_TTL_MS = 5 * 60_000;
/** Sweep horizon for persisted timeline payloads (company-detail precedent). */
const REMOTE_CACHE_PRUNE_MS = 7 * 24 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Per-event payload byte budget. The Management API refuses answers past
 * roughly a megabyte (measured live: a 939 KB payload sum served, 1.34 MB was
 * refused), so a hot issue's newest-500 page must be bounded by BYTES, not
 * just rows. An oversized payload is clamped in SQL to an honest preview
 * object (`payload_clamped: true`, original `chars`, `preview` text) — the
 * page stays ≤ ~750 KB worst case, the event itself is never dropped, and
 * `total_events` stays exact.
 */
const PAYLOAD_CLAMP_CHARS = 1_500;
const PAYLOAD_PREVIEW_CHARS = 1_200;

export type SpineTimelineFailure =
  | "invalid_issue_id"
  | "rate_limited"
  | "unavailable";

/** Typed failure the API route maps to a named response — never a payload. */
export class SpineTimelineError extends Error {
  readonly failure: SpineTimelineFailure;
  readonly cause?: unknown;

  constructor(failure: SpineTimelineFailure, cause?: unknown) {
    super(`spine_timeline_${failure}`);
    this.name = "SpineTimelineError";
    this.failure = failure;
    this.cause = cause;
  }
}

const inFlight = new Map<number, Promise<SpineTimeline>>();

function timelineCacheKey(issueId: number): string {
  return `spine-timeline:v1:${issueId}`;
}

function readCachedTimeline(
  key: string,
): { timeline: SpineTimeline; ageMs: number } | null {
  const row = getDb()
    .prepare(`SELECT payload, fetched_at FROM remote_cache WHERE cache_key = ?`)
    .get(key) as { payload: string; fetched_at: number } | undefined;
  if (!row) return null;
  try {
    return {
      timeline: JSON.parse(row.payload) as SpineTimeline,
      ageMs: Math.max(0, Date.now() - row.fetched_at),
    };
  } catch {
    return null;
  }
}

function persistTimeline(key: string, timeline: SpineTimeline): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_cache (cache_key, payload, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at`,
  ).run(key, JSON.stringify(timeline), Date.now());
  db.prepare(`DELETE FROM remote_cache WHERE fetched_at <= ?`).run(
    Date.now() - REMOTE_CACHE_PRUNE_MS,
  );
}

interface TimelineRow {
  id: unknown;
  kind: unknown;
  payload: unknown;
  actor: unknown;
  at: unknown;
  total_events: unknown;
}

function asInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Offset-carrying source timestamps → one UTC ISO shape (asIso-style). */
function toIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    const normalized = value
      .trim()
      .replace(" ", "T")
      .replace(/(\.\d{3})\d+/, "$1")
      .replace(/([+-]\d{2})$/, "$1:00");
    ms = Date.parse(normalized);
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function fetchSpineTimeline(issueId: number): Promise<SpineTimeline> {
  // The source EVENTS_SQL shape: newest page + a window total computed before
  // the LIMIT, so a capped page still reports the whole partition. issueId is
  // validated a positive safe integer before this string is ever built — the
  // established Management-API interpolation pattern; nothing else is ever
  // interpolated.
  const sql = `SELECT id, kind,
       CASE WHEN length(payload::text) <= ${PAYLOAD_CLAMP_CHARS} THEN payload
            ELSE jsonb_build_object(
              'payload_clamped', true,
              'chars', length(payload::text),
              'preview', left(payload::text, ${PAYLOAD_PREVIEW_CHARS})
            )
       END AS payload,
       actor, at,
       count(*) OVER () AS total_events
  FROM service.issue_events
  WHERE issue_id = ${issueId}
  ORDER BY at DESC, id DESC
  LIMIT ${SPINE_TIMELINE_EVENT_CAP}`;
  const rows = await runSupabaseManagementQuery<TimelineRow>(
    sql,
    FETCH_TIMEOUT_MS,
    { priority: "interactive" },
  );
  // Served oldest-first (the timeline's own order) — source law.
  const events: SpineTimelineEvent[] = rows
    .map((row) => ({
      id: asInt(row.id),
      kind: String(row.kind ?? ""),
      payload: row.payload ?? null,
      actor: typeof row.actor === "string" && row.actor ? row.actor : null,
      at: toIso(row.at),
    }))
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.id - b.id);
  const totalEvents = rows.length > 0 ? asInt(rows[0].total_events) : 0;
  return {
    events,
    totalEvents,
    truncated: totalEvents > events.length,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getSpineIssueTimeline(
  issueId: number,
): Promise<SpineTimeline> {
  if (!Number.isSafeInteger(issueId) || issueId <= 0) {
    throw new SpineTimelineError("invalid_issue_id");
  }
  const key = timelineCacheKey(issueId);
  const cached = readCachedTimeline(key);
  if (cached && cached.ageMs < TIMELINE_TTL_MS) {
    console.log("service_spine_timeline_fetch", {
      issueId,
      served: cached.timeline.events.length,
      truncated: cached.timeline.truncated,
      cache: "hit",
    });
    return cached.timeline;
  }

  const existing = inFlight.get(issueId);
  if (existing) return existing;

  const request = fetchSpineTimeline(issueId)
    .then((timeline) => {
      persistTimeline(key, timeline);
      console.log("service_spine_timeline_fetch", {
        issueId,
        served: timeline.events.length,
        truncated: timeline.truncated,
        cache: "miss",
      });
      return timeline;
    })
    .catch((cause: unknown) => {
      // Serve the stale copy with its own fetchedAt — honestly older beats
      // absent; only a never-cached issue surfaces the failure.
      if (cached) {
        console.warn("service_spine_timeline_stale_served", {
          issueId,
          errorCategory:
            cause instanceof Error ? cause.message : "unknown_timeline_error",
        });
        return cached.timeline;
      }
      console.warn("service_spine_timeline_failed", {
        issueId,
        errorCategory:
          cause instanceof Error ? cause.message : "unknown_timeline_error",
      });
      throw new SpineTimelineError(
        isRateLimited(cause) ? "rate_limited" : "unavailable",
        cause,
      );
    })
    .finally(() => {
      inFlight.delete(issueId);
    });
  inFlight.set(issueId, request);
  return request;
}
