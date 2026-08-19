import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  buildSpineSearchHaystack,
  waveOf,
  type SpineSyncStatus,
} from "../service-spine/domain";
import {
  isRateLimited,
  rateLimitResetMs,
  runSupabaseManagementQuery,
} from "../supabase-management.server";

/**
 * Service Spine refresh leg (docs/service-spine/step-bro-design.md §3.2).
 *
 * Every two minutes, pull whatever changed in the service spine ledger
 * (service.issues / service.tasks / service.task_links / service.issue_events
 * on the Harper prod Postgres) and upsert it into the local SQLite mirror the
 * Service Spine section reads. Separate from the book digest machinery
 * because the spine tables carry real watermarks: issues/tasks have
 * `updated_at`, task_links are append-only on `created_at`, and issue_events
 * is an append-only bigint id ledger.
 *
 * The delta tick costs ONE Management API request when idle: a single CTE
 * statement folds the four changed-row sets plus the exact whole-ledger event
 * totals into one row of JSON aggregate columns. Timestamp watermarks are
 * read back with a two-minute overlap and every upsert is idempotent, so a
 * repeated row converges instead of duplicating. Event rows ride a strict
 * `id > watermark` cursor (no overlap) and are applied exactly once as
 * increments to `spine_issue_stats`; the events ledger itself is deliberately
 * never mirrored, and only `(id, issue_id, kind, at)` are ever pulled —
 * payload/actor stay out of the mirror entirely (PII).
 *
 * Every thirty minutes a tick pulls the whole spine instead: full
 * issues/tasks/links replaces, a whole-ledger `GROUP BY issue_id` stats
 * rebuild, exact totals, the `internal_agents` directory, and deletion of
 * rows that disappeared upstream (deletes are scoped to the reconcile only).
 * The reconcile clock lives in the status file so a restart resumes the
 * schedule instead of spending a full pull per boot. Cohort staleness
 * (pending/active can change without the issue row changing) is bounded by
 * this reconcile — documented, acceptable v1.
 *
 * Failure policy: never wipe. Watermarks and data commit in ONE SQLite
 * transaction, so a failed cycle repeats itself instead of skipping rows, and
 * any fetch/parse error keeps the last good mirror in place. A rate-limited
 * tick waits out the window the quota reports (doubling fallback when it
 * reports none) and is not recorded as a failure. Logs are shape-only —
 * counts, categories and durations, never row content.
 */

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const FULL_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Timestamp watermarks are re-read with this overlap so a row that committed
 * just before the previous pull's cut (or under modest clock skew) is seen
 * again rather than skipped. Upserts are idempotent, so the re-read is free.
 */
const WATERMARK_OVERLAP_MS = 2 * 60 * 1000;

/** Ceiling for the doubling fallback when a 429 arrives without a window. */
const MAX_BACKOFF_MS = 16 * 60 * 1000;

/**
 * Per-tick bound on the event cursor. The ledger grows ~140k/week, so a
 * process that was off for days would otherwise pull an unbounded delta. A
 * capped tick advances the id watermark to the last row it served and the
 * next tick continues; the whole-table totals are exact regardless (they ride
 * their own COUNT columns), and the 30-minute reconcile rebuilds stats
 * wholesale anyway.
 */
const DELTA_EVENT_ROW_CAP = 50_000;

const MANAGEMENT_TIMEOUT_MS = 120_000;

// ── spine_meta keys ───────────────────────────────────────────────────────────
export const SPINE_META_ISSUES_WATERMARK = "issues_watermark";
export const SPINE_META_TASKS_WATERMARK = "tasks_watermark";
export const SPINE_META_LINKS_WATERMARK = "links_watermark";
export const SPINE_META_EVENTS_MAX_ID = "events_max_id";
export const SPINE_META_EVENTS_TOTAL = "events_total";
export const SPINE_META_EVENTS_SUPPRESSIONS = "events_suppressions";

export function readSpineMeta(
  db: Database.Database,
  key: string,
): string | null {
  const row = db
    .prepare(`SELECT value FROM spine_meta WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function readSpineMetaInt(db: Database.Database, key: string): number | null {
  const raw = readSpineMeta(db, key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

// ── Status file (data/service-spine-refresh-status.local.json) ───────────────

const STATUS_PATH = path.join(
  process.cwd(),
  "data",
  "service-spine-refresh-status.local.json",
);

const EMPTY_STATUS: SpineSyncStatus = {
  lastSyncAt: null,
  lastFullSyncAt: null,
  lastFailureAt: null,
};

function validTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

export function readSpineRefreshStatus(): SpineSyncStatus {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8")) as {
      lastSyncAt?: unknown;
      lastFullSyncAt?: unknown;
      lastFailureAt?: unknown;
    };
    return {
      lastSyncAt: validTimestamp(parsed.lastSyncAt),
      lastFullSyncAt: validTimestamp(parsed.lastFullSyncAt),
      lastFailureAt: validTimestamp(parsed.lastFailureAt),
    };
  } catch {
    return EMPTY_STATUS;
  }
}

function writeSpineRefreshStatus(status: SpineSyncStatus): void {
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  const tempPath = `${STATUS_PATH}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(status)}\n`);
  fs.renameSync(tempPath, STATUS_PATH);
}

function recordSpineRefreshSuccess(
  completedAt: string,
  options: { full?: boolean } = {},
): void {
  const previous = readSpineRefreshStatus();
  writeSpineRefreshStatus({
    lastSyncAt: completedAt,
    lastFullSyncAt: options.full ? completedAt : previous.lastFullSyncAt,
    lastFailureAt: previous.lastFailureAt,
  });
}

function recordSpineRefreshFailure(failedAt: string): void {
  const previous = readSpineRefreshStatus();
  writeSpineRefreshStatus({
    lastSyncAt: previous.lastSyncAt,
    lastFullSyncAt: previous.lastFullSyncAt,
    lastFailureAt: failedAt,
  });
}

// ── Source SQL (SELECT-only; the Management API is never handed a write) ─────

/**
 * The account-stage cohort CASE, predicates verbatim from the audited source
 * (harper-coi-workbench @ 718064e5, src/lib/service-spine/reads.ts:69–118 and
 * src/lib/service/bound-policy-sql.ts):
 *   TRUE  = Pending orders (live pending order AND the account is not bound)
 *   FALSE = Active services (>=1 bound policy; bound wins when both apply)
 *   NULL  = neither, or no company — wears no tag, never forced into Active.
 * Fixed SQL only; nothing here is ever caller text.
 */
const COHORT_PENDING_ORDER_SQL = `CASE
    WHEN i.company_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.deals_v2 d
      WHERE d.company_id = i.company_id
        AND (d.is_deleted = FALSE OR d.is_deleted IS NULL)
        AND COALESCE(TRIM(d.policy_number), '') <> ''
    ) THEN FALSE
    WHEN EXISTS (
      SELECT 1 FROM public.orders_temp o
      WHERE o.company_id = i.company_id
        AND (o.is_deleted = FALSE OR o.is_deleted IS NULL)
        AND o.order_complete IS DISTINCT FROM TRUE
        AND (o.lost_reason IS NULL OR TRIM(o.lost_reason) = '')
        AND (
          NOT EXISTS (SELECT 1 FROM public.deals_v2 dx
                      WHERE dx.order_number = o.id
                        AND (dx.is_deleted = FALSE OR dx.is_deleted IS NULL))
          OR EXISTS (SELECT 1 FROM public.deals_v2 dz
                     WHERE dz.order_number = o.id
                       AND (dz.is_deleted = FALSE OR dz.is_deleted IS NULL)
                       AND COALESCE(TRIM(dz.policy_number), '') = ''
                       AND LOWER(COALESCE(dz.deal_stage, '')) NOT IN ('lost','dead','cancelled','denied'))
        )
    ) THEN TRUE
    ELSE NULL
  END`;

/** Issue row shape shared by the delta CTE and the reconcile's full pull. */
const ISSUE_SELECT_SQL = `SELECT i.id, i.company_id, c.company_name, i.issue_type, i.goal, i.status,
         i.priority, i.blocking, i.origin, i.correlation_key, i.sla_due_at,
         i.latest_summary, i.last_communication_summary, i.resolution_summary,
         i.opened_at, i.updated_at, i.resolved_at,
         ${COHORT_PENDING_ORDER_SQL} AS pending_order
  FROM service.issues i
  LEFT JOIN public.companies c ON c.id = i.company_id`;

const TASK_SELECT_SQL = `SELECT t.id, t.issue_id, t.company_id, t.title, t.owner_kind, t.status,
         t.assignee, t.lane_skill, t.gate_label, t.sla_due_at, t.created_at,
         t.updated_at, t.completed_at
  FROM service.tasks t`;

const LINK_SELECT_SQL = `SELECT tl.id, tl.task_id, tl.link_kind, tl.link_ref, tl.created_at
  FROM service.task_links tl`;

/**
 * One ISO timestamp literal for interpolation. Only values that parse are
 * ever serialized, and `toISOString` output contains nothing but
 * `[0-9TZ:.-]`, so the quoted literal cannot carry anything else.
 */
function isoLiteral(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error("spine_watermark_invalid");
  return new Date(ms).toISOString();
}

function overlappedIso(watermark: string): string {
  const ms = Date.parse(watermark);
  if (!Number.isFinite(ms)) throw new Error("spine_watermark_invalid");
  return new Date(ms - WATERMARK_OVERLAP_MS).toISOString();
}

/**
 * The whole delta tick as ONE statement: CTEs folded to one row of JSON
 * aggregate columns. Events are `(id, issue_id, kind, at)` ONLY — never
 * payload or actor — and the two totals are exact whole-table counts.
 */
function spineDeltaSql(args: {
  issuesSince: string;
  tasksSince: string;
  linksSince: string;
  eventsAfterId: number;
}): string {
  if (!Number.isSafeInteger(args.eventsAfterId) || args.eventsAfterId < 0) {
    throw new Error("spine_events_watermark_invalid");
  }
  return `WITH changed_issues AS (
  ${ISSUE_SELECT_SQL}
  WHERE i.updated_at > '${isoLiteral(args.issuesSince)}'::timestamptz
),
changed_tasks AS (
  ${TASK_SELECT_SQL}
  WHERE t.updated_at > '${isoLiteral(args.tasksSince)}'::timestamptz
),
new_links AS (
  ${LINK_SELECT_SQL}
  WHERE tl.created_at > '${isoLiteral(args.linksSince)}'::timestamptz
),
new_events AS (
  SELECT e.id, e.issue_id, e.kind, e.at
  FROM service.issue_events e
  WHERE e.id > ${args.eventsAfterId}
  ORDER BY e.id ASC
  LIMIT ${DELTA_EVENT_ROW_CAP}
)
SELECT
  (SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) FROM changed_issues x) AS issues,
  (SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) FROM changed_tasks x) AS tasks,
  (SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) FROM new_links x) AS task_links,
  (SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) FROM new_events x) AS events,
  (SELECT count(*) FROM service.issue_events) AS events_total,
  (SELECT count(*) FROM service.issue_events WHERE issue_id IS NULL) AS events_suppressions`;
}

const FULL_ISSUES_SQL = `${ISSUE_SELECT_SQL}
  ORDER BY i.id ASC`;

const FULL_TASKS_SQL = `${TASK_SELECT_SQL}
  ORDER BY t.id ASC`;

/**
 * The reconcile's small row sets in one statement: every task link, the
 * whole-ledger per-issue stats GROUP BY (the `issue_id IS NULL` group is
 * exactly the suppressions), and the internal_agents directory.
 */
const FULL_EXTRAS_SQL = `SELECT
  (SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) FROM (
    ${LINK_SELECT_SQL}
  ) x) AS task_links,
  (SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) FROM (
    SELECT e.issue_id, count(*) AS n, max(e.at) AS last_event_at,
           bool_or(e.kind = 'draft_created') AS has_draft,
           bool_or(e.kind = 'closure_proposed') AS closure_proposed,
           max(e.id) AS max_id
    FROM service.issue_events e
    GROUP BY e.issue_id
  ) x) AS event_stats,
  (SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) FROM (
    SELECT ia.id::text AS id,
           NULLIF(TRIM(COALESCE(ia.first_name, '') || ' ' || COALESCE(ia.last_name, '')), '') AS name,
           NULLIF(TRIM(ia.email), '') AS email,
           COALESCE(ia.active, FALSE) AS active
    FROM public.internal_agents ia
  ) x) AS agents`;

// ── Ingest normalization ──────────────────────────────────────────────────────

/**
 * Management API timestamps arrive as strings with offsets (Postgres JSON or
 * text serialization: "2026-08-19T17:47:00.123456+00:00" or
 * "2026-08-19 17:47:00.123456+00"). Normalized to one UTC ISO shape once at
 * ingest so SQLite string comparison is chronological.
 */
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

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value === "" ? null : value;
}

function requiredText(value: unknown): string {
  return value == null ? "" : String(value);
}

function intOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function asCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Booleans may ride as JSON booleans or pg text ("t"/"true"). */
function boolToInt(value: unknown): number {
  return value === true || value === "true" || value === "t" ? 1 : 0;
}

function pendingOrderToInt(value: unknown): number | null {
  if (value === true || value === "true" || value === "t") return 1;
  if (value === false || value === "false" || value === "f") return 0;
  return null;
}

function arrayValue(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function recordOf(raw: unknown, category: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(category);
  }
  return raw as Record<string, unknown>;
}

interface ParsedIssue {
  id: number;
  companyId: number | null;
  companyName: string | null;
  issueType: string;
  goal: string;
  status: string;
  priority: string;
  blocking: string | null;
  origin: string | null;
  correlationKey: string | null;
  wave: string | null;
  slaDueAt: string | null;
  latestSummary: string | null;
  lastCommunicationSummary: string | null;
  resolutionSummary: string | null;
  openedAt: string | null;
  updatedAt: string | null;
  resolvedAt: string | null;
  pendingOrder: number | null;
  searchHaystack: string;
}

function parseIssueRow(raw: unknown): ParsedIssue {
  const r = recordOf(raw, "spine_issue_row_invalid");
  const id = Number(r.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("spine_issue_row_invalid");
  }
  const companyId = intOrNull(r.company_id);
  const companyName = textOrNull(r.company_name);
  const issueType = requiredText(r.issue_type);
  const goal = requiredText(r.goal);
  const status = requiredText(r.status);
  const priority = requiredText(r.priority);
  const correlationKey = textOrNull(r.correlation_key);
  const latestSummary = textOrNull(r.latest_summary);
  const origin = textOrNull(r.origin);
  return {
    id,
    companyId,
    companyName,
    issueType,
    goal,
    status,
    priority,
    blocking: textOrNull(r.blocking),
    origin,
    correlationKey,
    wave: waveOf(correlationKey),
    slaDueAt: toIso(r.sla_due_at),
    latestSummary,
    lastCommunicationSummary: textOrNull(r.last_communication_summary),
    resolutionSummary: textOrNull(r.resolution_summary),
    openedAt: toIso(r.opened_at),
    updatedAt: toIso(r.updated_at),
    resolvedAt: toIso(r.resolved_at),
    pendingOrder: pendingOrderToInt(r.pending_order),
    // Recomputed on every upsert — the one place the source search law is
    // materialized, so SQLite LIKE matches exactly what the source matched.
    searchHaystack: buildSpineSearchHaystack({
      companyName,
      companyId,
      id,
      goal,
      issueType,
      status,
      priority,
      correlationKey,
      latestSummary,
      origin,
    }),
  };
}

interface ParsedTask {
  id: number;
  issueId: number;
  companyId: number | null;
  title: string;
  ownerKind: string;
  status: string;
  assignee: string | null;
  laneSkill: string | null;
  gateLabel: string | null;
  slaDueAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

function parseTaskRow(raw: unknown): ParsedTask {
  const r = recordOf(raw, "spine_task_row_invalid");
  const id = Number(r.id);
  const issueId = Number(r.issue_id);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(issueId) ||
    issueId <= 0
  ) {
    throw new Error("spine_task_row_invalid");
  }
  return {
    id,
    issueId,
    companyId: intOrNull(r.company_id),
    title: requiredText(r.title),
    ownerKind: requiredText(r.owner_kind),
    status: requiredText(r.status),
    assignee: textOrNull(r.assignee),
    laneSkill: textOrNull(r.lane_skill),
    gateLabel: textOrNull(r.gate_label),
    slaDueAt: toIso(r.sla_due_at),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    completedAt: toIso(r.completed_at),
  };
}

interface ParsedLink {
  id: number;
  taskId: number;
  linkKind: string;
  linkRef: string | null;
  createdAt: string | null;
}

function parseLinkRow(raw: unknown): ParsedLink {
  const r = recordOf(raw, "spine_link_row_invalid");
  const id = Number(r.id);
  const taskId = Number(r.task_id);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(taskId) ||
    taskId <= 0
  ) {
    throw new Error("spine_link_row_invalid");
  }
  // link_ref has shipped as both text and jsonb upstream; a display read, so
  // either shape flattens to one string here (source precedent).
  const ref = r.link_ref;
  return {
    id,
    taskId,
    linkKind: requiredText(r.link_kind),
    linkRef:
      ref == null ? null : typeof ref === "string" ? ref : JSON.stringify(ref),
    createdAt: toIso(r.created_at),
  };
}

interface ParsedEvent {
  id: number;
  issueId: number | null;
  kind: string;
  at: string | null;
}

function parseEventRow(raw: unknown): ParsedEvent {
  const r = recordOf(raw, "spine_event_row_invalid");
  const id = Number(r.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("spine_event_row_invalid");
  }
  return {
    id,
    issueId: intOrNull(r.issue_id),
    kind: requiredText(r.kind),
    at: toIso(r.at),
  };
}

interface ParsedAgent {
  id: string;
  name: string | null;
  email: string | null;
  active: number;
}

function parseAgentRow(raw: unknown): ParsedAgent {
  const r = recordOf(raw, "spine_agent_row_invalid");
  const id = requiredText(r.id).trim();
  if (!id) throw new Error("spine_agent_row_invalid");
  return {
    id,
    name: textOrNull(r.name),
    email: textOrNull(r.email),
    active: boolToInt(r.active),
  };
}

interface ParsedStats {
  issueId: number | null;
  n: number;
  lastEventAt: string | null;
  hasDraft: number;
  closureProposed: number;
  maxId: number;
}

function parseStatsRow(raw: unknown): ParsedStats {
  const r = recordOf(raw, "spine_stats_row_invalid");
  return {
    issueId: intOrNull(r.issue_id),
    n: asCount(r.n),
    lastEventAt: toIso(r.last_event_at),
    hasDraft: boolToInt(r.has_draft),
    closureProposed: boolToInt(r.closure_proposed),
    maxId: asCount(r.max_id),
  };
}

// ── SQLite writers ────────────────────────────────────────────────────────────

function prepareSpineWriters(db: Database.Database) {
  return {
    upsertIssue: db.prepare(`
      INSERT INTO spine_issues (
        id, company_id, company_name, issue_type, goal, status, priority,
        blocking, origin, correlation_key, wave, sla_due_at, latest_summary,
        last_communication_summary, resolution_summary, opened_at, updated_at,
        resolved_at, pending_order, search_haystack
      ) VALUES (
        @id, @companyId, @companyName, @issueType, @goal, @status, @priority,
        @blocking, @origin, @correlationKey, @wave, @slaDueAt, @latestSummary,
        @lastCommunicationSummary, @resolutionSummary, @openedAt, @updatedAt,
        @resolvedAt, @pendingOrder, @searchHaystack
      )
      ON CONFLICT(id) DO UPDATE SET
        company_id = excluded.company_id,
        company_name = excluded.company_name,
        issue_type = excluded.issue_type,
        goal = excluded.goal,
        status = excluded.status,
        priority = excluded.priority,
        blocking = excluded.blocking,
        origin = excluded.origin,
        correlation_key = excluded.correlation_key,
        wave = excluded.wave,
        sla_due_at = excluded.sla_due_at,
        latest_summary = excluded.latest_summary,
        last_communication_summary = excluded.last_communication_summary,
        resolution_summary = excluded.resolution_summary,
        opened_at = excluded.opened_at,
        updated_at = excluded.updated_at,
        resolved_at = excluded.resolved_at,
        pending_order = excluded.pending_order,
        search_haystack = excluded.search_haystack
    `),
    upsertTask: db.prepare(`
      INSERT INTO spine_tasks (
        id, issue_id, company_id, title, owner_kind, status, assignee,
        lane_skill, gate_label, sla_due_at, created_at, updated_at,
        completed_at
      ) VALUES (
        @id, @issueId, @companyId, @title, @ownerKind, @status, @assignee,
        @laneSkill, @gateLabel, @slaDueAt, @createdAt, @updatedAt, @completedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        issue_id = excluded.issue_id,
        company_id = excluded.company_id,
        title = excluded.title,
        owner_kind = excluded.owner_kind,
        status = excluded.status,
        assignee = excluded.assignee,
        lane_skill = excluded.lane_skill,
        gate_label = excluded.gate_label,
        sla_due_at = excluded.sla_due_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `),
    upsertLink: db.prepare(`
      INSERT INTO spine_task_links (id, task_id, link_kind, link_ref, created_at)
      VALUES (@id, @taskId, @linkKind, @linkRef, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        link_kind = excluded.link_kind,
        link_ref = excluded.link_ref,
        created_at = excluded.created_at
    `),
    // Delta increment: exactly-once by construction (strict id cursor), so
    // += is safe; the OR-style flags and the max fold mirror the ledger law.
    incrementStats: db.prepare(`
      INSERT INTO spine_issue_stats (
        issue_id, event_count, last_event_at, has_draft, closure_proposed
      ) VALUES (@issueId, @n, @lastEventAt, @hasDraft, @closureProposed)
      ON CONFLICT(issue_id) DO UPDATE SET
        event_count = spine_issue_stats.event_count + excluded.event_count,
        last_event_at = CASE
          WHEN spine_issue_stats.last_event_at IS NULL THEN excluded.last_event_at
          WHEN excluded.last_event_at IS NULL THEN spine_issue_stats.last_event_at
          WHEN excluded.last_event_at > spine_issue_stats.last_event_at
            THEN excluded.last_event_at
          ELSE spine_issue_stats.last_event_at
        END,
        has_draft = MAX(spine_issue_stats.has_draft, excluded.has_draft),
        closure_proposed = MAX(spine_issue_stats.closure_proposed, excluded.closure_proposed)
    `),
    insertStats: db.prepare(`
      INSERT INTO spine_issue_stats (
        issue_id, event_count, last_event_at, has_draft, closure_proposed
      ) VALUES (@issueId, @n, @lastEventAt, @hasDraft, @closureProposed)
    `),
    upsertAgent: db.prepare(`
      INSERT INTO spine_agents (id, name, email, active)
      VALUES (@id, @name, @email, @active)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        active = excluded.active
    `),
    writeMeta: db.prepare(`
      INSERT INTO spine_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
  };
}

/** Lexicographic max over normalized ISO strings = chronological max. */
function maxIso(...values: Array<string | null>): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (value && (!best || value > best)) best = value;
  }
  return best;
}

// ── Refresh cycles ────────────────────────────────────────────────────────────

export interface SpineRefreshOutcome {
  requests: number;
  issues: number;
  tasks: number;
  links: number;
  events: number;
}

async function runManagementQuery<T>(sql: string): Promise<T[]> {
  return runSupabaseManagementQuery<T>(sql, MANAGEMENT_TIMEOUT_MS, {
    priority: "refresh",
  });
}

interface SpineDeltaResponseRow {
  issues: unknown;
  tasks: unknown;
  task_links: unknown;
  events: unknown;
  events_total: unknown;
  events_suppressions: unknown;
}

/**
 * One incremental cycle: a single Management API request, then one SQLite
 * transaction. Watermarks are written inside the same transaction as the
 * rows they describe, so they can only ever advance with a commit — a failed
 * cycle repeats itself instead of skipping rows.
 */
export async function refreshSpineDelta(
  db: Database.Database,
): Promise<SpineRefreshOutcome> {
  const issuesWm = readSpineMeta(db, SPINE_META_ISSUES_WATERMARK);
  const tasksWm = readSpineMeta(db, SPINE_META_TASKS_WATERMARK);
  const linksWm = readSpineMeta(db, SPINE_META_LINKS_WATERMARK);
  const eventsMaxId = readSpineMetaInt(db, SPINE_META_EVENTS_MAX_ID);
  if (!issuesWm || !tasksWm || !linksWm || eventsMaxId === null) {
    throw new Error("spine_delta_requires_watermarks");
  }

  const rows = await runManagementQuery<SpineDeltaResponseRow>(
    spineDeltaSql({
      issuesSince: overlappedIso(issuesWm),
      tasksSince: overlappedIso(tasksWm),
      linksSince: overlappedIso(linksWm),
      eventsAfterId: eventsMaxId,
    }),
  );
  const row = rows[0];
  if (!row) throw new Error("spine_delta_empty_response");

  // Parse (and refuse) before the transaction opens: a corrupt payload keeps
  // the last good mirror whole and the watermarks where they were.
  const issues = arrayValue(row.issues).map(parseIssueRow);
  const tasks = arrayValue(row.tasks).map(parseTaskRow);
  const links = arrayValue(row.task_links).map(parseLinkRow);
  const events = arrayValue(row.events).map(parseEventRow);
  const eventsTotal = asCount(row.events_total);
  const eventsSuppressions = asCount(row.events_suppressions);

  // Fold event rows per issue before touching SQLite; suppressions
  // (issue_id IS NULL) only exist in the totals.
  const statsByIssue = new Map<
    number,
    { n: number; lastAt: string | null; hasDraft: number; closureProposed: number }
  >();
  let eventsCursor = eventsMaxId;
  for (const event of events) {
    if (event.id > eventsCursor) eventsCursor = event.id;
    if (event.issueId === null) continue;
    const bucket = statsByIssue.get(event.issueId) ?? {
      n: 0,
      lastAt: null,
      hasDraft: 0,
      closureProposed: 0,
    };
    bucket.n += 1;
    bucket.lastAt = maxIso(bucket.lastAt, event.at);
    if (event.kind === "draft_created") bucket.hasDraft = 1;
    if (event.kind === "closure_proposed") bucket.closureProposed = 1;
    statsByIssue.set(event.issueId, bucket);
  }

  const writers = prepareSpineWriters(db);
  const nextIssuesWm = maxIso(issuesWm, ...issues.map((i) => i.updatedAt));
  const nextTasksWm = maxIso(tasksWm, ...tasks.map((t) => t.updatedAt));
  const nextLinksWm = maxIso(linksWm, ...links.map((l) => l.createdAt));

  const tx = db.transaction(() => {
    for (const issue of issues) writers.upsertIssue.run(issue);
    for (const task of tasks) writers.upsertTask.run(task);
    for (const link of links) writers.upsertLink.run(link);
    for (const [issueId, bucket] of statsByIssue) {
      writers.incrementStats.run({
        issueId,
        n: bucket.n,
        lastEventAt: bucket.lastAt,
        hasDraft: bucket.hasDraft,
        closureProposed: bucket.closureProposed,
      });
    }
    writers.writeMeta.run(SPINE_META_EVENTS_TOTAL, String(eventsTotal));
    writers.writeMeta.run(
      SPINE_META_EVENTS_SUPPRESSIONS,
      String(eventsSuppressions),
    );
    writers.writeMeta.run(SPINE_META_ISSUES_WATERMARK, nextIssuesWm ?? issuesWm);
    writers.writeMeta.run(SPINE_META_TASKS_WATERMARK, nextTasksWm ?? tasksWm);
    writers.writeMeta.run(SPINE_META_LINKS_WATERMARK, nextLinksWm ?? linksWm);
    writers.writeMeta.run(SPINE_META_EVENTS_MAX_ID, String(eventsCursor));
  });
  tx();

  return {
    requests: 1,
    issues: issues.length,
    tasks: tasks.length,
    links: links.length,
    events: events.length,
  };
}

interface SpineExtrasResponseRow {
  task_links: unknown;
  event_stats: unknown;
  agents: unknown;
}

/**
 * Full reconcile: three serial Management API requests (the shared quota
 * punishes concurrency — book-refresh law), then one SQLite transaction that
 * upserts everything, rebuilds `spine_issue_stats` from the whole-ledger
 * GROUP BY, writes exact totals, refreshes the agents directory, and deletes
 * rows that disappeared upstream. Deletes happen only here, only after every
 * pull succeeded and parsed — the never-wipe rule.
 */
export async function refreshSpineFull(
  db: Database.Database,
): Promise<SpineRefreshOutcome> {
  const pullStartedIso = new Date().toISOString();
  const issueRows = await runManagementQuery<unknown>(FULL_ISSUES_SQL);
  const taskRows = await runManagementQuery<unknown>(FULL_TASKS_SQL);
  const extrasRows = await runManagementQuery<SpineExtrasResponseRow>(
    FULL_EXTRAS_SQL,
  );
  const extras = extrasRows[0];
  if (!extras) throw new Error("spine_reconcile_empty_response");

  const issues = issueRows.map(parseIssueRow);
  const tasks = taskRows.map(parseTaskRow);
  const links = arrayValue(extras.task_links).map(parseLinkRow);
  const stats = arrayValue(extras.event_stats).map(parseStatsRow);
  const agents = arrayValue(extras.agents).map(parseAgentRow);

  let eventsTotal = 0;
  let eventsSuppressions = 0;
  let eventsMaxId = 0;
  const issueStats: ParsedStats[] = [];
  for (const row of stats) {
    eventsTotal += row.n;
    if (row.maxId > eventsMaxId) eventsMaxId = row.maxId;
    if (row.issueId === null) eventsSuppressions += row.n;
    else issueStats.push(row);
  }

  const issuesWm =
    maxIso(...issues.map((i) => i.updatedAt)) ?? pullStartedIso;
  const tasksWm = maxIso(...tasks.map((t) => t.updatedAt)) ?? pullStartedIso;
  const linksWm = maxIso(...links.map((l) => l.createdAt)) ?? pullStartedIso;

  const writers = prepareSpineWriters(db);
  const deleteDepartedIssues = db.prepare(
    `DELETE FROM spine_issues WHERE id NOT IN (SELECT value FROM json_each(?))`,
  );
  const deleteDepartedTasks = db.prepare(
    `DELETE FROM spine_tasks WHERE id NOT IN (SELECT value FROM json_each(?))`,
  );
  const deleteDepartedLinks = db.prepare(
    `DELETE FROM spine_task_links WHERE id NOT IN (SELECT value FROM json_each(?))`,
  );
  const deleteDepartedAgents = db.prepare(
    `DELETE FROM spine_agents WHERE id NOT IN (SELECT value FROM json_each(?))`,
  );

  const tx = db.transaction(() => {
    for (const issue of issues) writers.upsertIssue.run(issue);
    for (const task of tasks) writers.upsertTask.run(task);
    for (const link of links) writers.upsertLink.run(link);
    for (const agent of agents) writers.upsertAgent.run(agent);
    deleteDepartedIssues.run(JSON.stringify(issues.map((i) => i.id)));
    deleteDepartedTasks.run(JSON.stringify(tasks.map((t) => t.id)));
    deleteDepartedLinks.run(JSON.stringify(links.map((l) => l.id)));
    deleteDepartedAgents.run(JSON.stringify(agents.map((a) => a.id)));
    // Whole-ledger stats rebuild: the reconcile's copy is exact by
    // construction, so replace rather than merge.
    db.prepare(`DELETE FROM spine_issue_stats`).run();
    for (const row of issueStats) {
      writers.insertStats.run({
        issueId: row.issueId,
        n: row.n,
        lastEventAt: row.lastEventAt,
        hasDraft: row.hasDraft,
        closureProposed: row.closureProposed,
      });
    }
    writers.writeMeta.run(SPINE_META_EVENTS_TOTAL, String(eventsTotal));
    writers.writeMeta.run(
      SPINE_META_EVENTS_SUPPRESSIONS,
      String(eventsSuppressions),
    );
    writers.writeMeta.run(SPINE_META_ISSUES_WATERMARK, issuesWm);
    writers.writeMeta.run(SPINE_META_TASKS_WATERMARK, tasksWm);
    writers.writeMeta.run(SPINE_META_LINKS_WATERMARK, linksWm);
    writers.writeMeta.run(SPINE_META_EVENTS_MAX_ID, String(eventsMaxId));
  });
  tx();

  return {
    requests: 3,
    issues: issues.length,
    tasks: tasks.length,
    links: links.length,
    events: eventsTotal,
  };
}

// ── Scheduling ────────────────────────────────────────────────────────────────

export function isSpineRefreshConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF,
  );
}

interface SpineRefreshState {
  running: boolean;
  backoffUntil: number;
  consecutiveRateLimits: number;
}

const STATE = Symbol.for("stepbro.serviceSpineRefreshState");

function spineRefreshState(): SpineRefreshState {
  const g = globalThis as Record<symbol, SpineRefreshState | undefined>;
  g[STATE] ??= { running: false, backoffUntil: 0, consecutiveRateLimits: 0 };
  return g[STATE];
}

/**
 * A delta can only continue from watermarks it already stored; anything else
 * (first sync, wiped meta) needs the whole spine first. The reconcile clock
 * is read from the status file so restarts resume the schedule instead of
 * spending a full pull per boot.
 */
function fullReconcileDue(db: Database.Database): boolean {
  if (
    !readSpineMeta(db, SPINE_META_ISSUES_WATERMARK) ||
    !readSpineMeta(db, SPINE_META_TASKS_WATERMARK) ||
    !readSpineMeta(db, SPINE_META_LINKS_WATERMARK) ||
    readSpineMetaInt(db, SPINE_META_EVENTS_MAX_ID) === null
  ) {
    return true;
  }
  const lastFullAt = readSpineRefreshStatus().lastFullSyncAt;
  const lastFull = lastFullAt ? Date.parse(lastFullAt) : Number.NaN;
  if (!Number.isFinite(lastFull)) return true;
  return Date.now() - lastFull >= FULL_RECONCILE_INTERVAL_MS;
}

async function runSpineRefreshSafely(
  db: Database.Database,
  trigger: string,
): Promise<void> {
  const state = spineRefreshState();
  // An overrunning cycle must not stack a second one on top of itself.
  if (state.running) {
    console.warn("service_spine_refresh_skipped", {
      trigger,
      reason: "previous_cycle_running",
    });
    return;
  }
  if (Date.now() < state.backoffUntil) return;
  state.running = true;
  const startedMs = Date.now();
  const mode = fullReconcileDue(db) ? "full" : "delta";

  try {
    const outcome =
      mode === "full" ? await refreshSpineFull(db) : await refreshSpineDelta(db);
    state.consecutiveRateLimits = 0;
    state.backoffUntil = 0;
    try {
      recordSpineRefreshSuccess(new Date().toISOString(), {
        full: mode === "full",
      });
    } catch (statusError) {
      console.warn("service_spine_refresh_status_write_failed", {
        errorCategory:
          statusError instanceof Error ? statusError.message : "unknown",
      });
    }
    console.log("service_spine_refresh", {
      trigger,
      mode,
      requests: outcome.requests,
      issues: outcome.issues,
      tasks: outcome.tasks,
      links: outcome.links,
      events: outcome.events,
      ms: Date.now() - startedMs,
    });
  } catch (err) {
    if (isRateLimited(err)) {
      state.consecutiveRateLimits += 1;
      // Wait out the window the quota itself reports; double only when the
      // refusal arrived without one. Not recorded as a failure: the mirror
      // is still whole and still being served.
      const wait =
        rateLimitResetMs(err) ??
        Math.min(
          REFRESH_INTERVAL_MS * 2 ** state.consecutiveRateLimits,
          MAX_BACKOFF_MS,
        );
      state.backoffUntil = Date.now() + wait;
      console.warn("service_spine_refresh_rate_limited", {
        trigger,
        mode,
        backoffMs: wait,
      });
    } else {
      try {
        recordSpineRefreshFailure(new Date().toISOString());
      } catch {
        // Status bookkeeping must never mask the original failure.
      }
      console.warn("service_spine_refresh_failed", {
        trigger,
        mode,
        errorCategory:
          err instanceof Error ? err.message : "unknown_spine_refresh_error",
      });
    }
  } finally {
    state.running = false;
  }
}

// Survives dev-mode module re-evaluation — one timer per process, ever.
const SCHEDULED = Symbol.for("stepbro.serviceSpineRefreshScheduled");

/**
 * Start the two-minute spine refresh loop (idempotent per process). Called
 * from `getDb()` beside `scheduleBookRefresh` so anything that touches the
 * database keeps the spine mirror current. Without credentials the refresher
 * stays off and the section serves whatever the mirror last held.
 */
export function scheduleServiceSpineRefresh(db: Database.Database): void {
  const g = globalThis as Record<symbol, boolean | undefined>;
  if (g[SCHEDULED]) return;
  g[SCHEDULED] = true;

  if (!isSpineRefreshConfigured()) {
    console.warn("service_spine_refresh_disabled", {
      reason: "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set",
    });
    return;
  }

  const tick = (trigger: string) => {
    void runSpineRefreshSafely(db, trigger);
  };

  // Boot catch-up runs async so the first page load is never held hostage by
  // the network. A mirror younger than one tick is already current enough.
  const lastSyncAt = readSpineRefreshStatus().lastSyncAt;
  const lastSyncMs = lastSyncAt ? Date.parse(lastSyncAt) : Number.NaN;
  if (!Number.isFinite(lastSyncMs) || Date.now() - lastSyncMs > REFRESH_INTERVAL_MS) {
    tick("boot");
  }

  const timer = setInterval(() => tick("interval"), REFRESH_INTERVAL_MS);
  timer.unref();
}
