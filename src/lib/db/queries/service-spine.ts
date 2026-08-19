import type Database from "better-sqlite3";
import {
  ISSUE_TERMINAL_STATUSES,
  issueInSpineQueue,
  isOpenTaskStatus,
  SPINE_COLUMNS,
  spineColumnLabel,
  spineColumnOf,
  TASK_CLOSED_STATUSES,
  type SpineBoardColumn,
  type SpineBoardResult,
  type SpineFilterOptions,
  type SpineIssueCard,
  type SpineIssueDetail,
  type SpineListQuery,
  type SpineSummary,
  type SpineTableResult,
  type SpineTaskLinkRow,
  type SpineTaskRow,
} from "../../service-spine/domain";
import {
  readSpineMeta,
  SPINE_META_EVENTS_SUPPRESSIONS,
  SPINE_META_EVENTS_TOTAL,
} from "../service-spine-refresh";

/**
 * Service Spine read service (docs/service-spine/step-bro-design.md §3.4):
 * synchronous prepared statements over the local SQLite mirror, one
 * consistent snapshot per render — which structurally eliminates the
 * source's mid-walk duplicate/gap class.
 *
 * Split of labor: SQL narrows search/priority/type/wave/cohort and imposes
 * the deterministic order; the JS pass applies the queue law over assignee
 * match tokens (a directory-resolution law that lives in domain.ts, not
 * SQL), folds board columns, and computes exact per-column totals. The
 * mirror holds ≤ ~4k issues, so the JS pass is one cheap linear walk. Board
 * and table share one eligible-set helper so the two faces can never
 * disagree. Empty tables (pre-first-sync) return empty results, never throw.
 */

/** Re-exported per design §3.4 so the page reads sync state from one door. */
export { readSpineRefreshStatus as getSpineSyncStatus } from "../service-spine-refresh";

/** Fixed vocabulary from domain.ts — never caller text. */
const TASK_CLOSED_SQL = TASK_CLOSED_STATUSES.map((s) => `'${s}'`).join(", ");
const ISSUE_TERMINAL_SQL = ISSUE_TERMINAL_STATUSES.map((s) => `'${s}'`).join(
  ", ",
);

// ── Assignee resolution (source law: my-queue.ts) ────────────────────────────

interface SpineAgentIdentity {
  name: string;
  email: string | null;
}

/**
 * internal_agents id (text) → person, from the mirrored directory. Only
 * named agents enter the map (source law) — an id the directory cannot name
 * degrades to the raw token rather than a blank owner.
 */
function loadSpineAgentMap(
  db: Database.Database,
): Map<string, SpineAgentIdentity> {
  const rows = db
    .prepare(`SELECT id, name, email FROM spine_agents`)
    .all() as Array<{ id: string; name: string | null; email: string | null }>;
  const byId = new Map<string, SpineAgentIdentity>();
  for (const row of rows) {
    const name = (row.name ?? "").trim();
    if (!row.id || !name) continue;
    byId.set(row.id, { name, email: row.email?.trim() || null });
  }
  return byId;
}

/** Match tokens: directory name AND email for a resolved id, raw otherwise. */
function assigneeMatchTokens(
  assignee: string,
  byId: Map<string, SpineAgentIdentity>,
): string[] {
  const raw = assignee.trim();
  if (!raw) return [];
  const hit = byId.get(raw);
  if (!hit) return [raw];
  return [hit.name, hit.email].filter(
    (value): value is string => !!value && value.trim() !== "",
  );
}

/** Display names only — an email-shaped token never becomes a name. */
function assigneeDisplayNames(
  assignee: string,
  byId: Map<string, SpineAgentIdentity>,
): string[] {
  const raw = assignee.trim();
  if (!raw) return [];
  const label = byId.get(raw)?.name ?? raw;
  if (!label || label.includes("@")) return [];
  return [label];
}

/** Directory-resolved display label for a task cell (raw when unresolved). */
function assigneeLabel(
  assignee: string | null,
  byId: Map<string, SpineAgentIdentity>,
): string | null {
  const raw = (assignee ?? "").trim();
  if (!raw) return null;
  return byId.get(raw)?.name ?? raw;
}

/** Case-insensitive dedupe keeping the first spelling (source asStringList). */
function dedupeTokens(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const token = value.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

// ── Eligible set (shared by board and table) ──────────────────────────────────

interface EligibleSqlRow {
  id: number;
  company_id: number | null;
  company_name: string | null;
  issue_type: string;
  goal: string;
  status: string;
  priority: string;
  blocking: string | null;
  origin: string | null;
  correlation_key: string | null;
  wave: string | null;
  sla_due_at: string | null;
  latest_summary: string | null;
  opened_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  pending_order: number | null;
  event_count: number;
  last_event_at: string | null;
  has_draft: number;
  closure_proposed: number;
  agent_total: number;
  agent_open: number;
  human_total: number;
  human_open: number;
  assignees_json: string;
}

/** Escape LIKE wildcards so operator text matches literally (source law is
 * a substring test, not a pattern language). */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

const ISSUE_CARD_SELECT = `
  SELECT i.id, i.company_id, i.company_name, i.issue_type, i.goal, i.status,
         i.priority, i.blocking, i.origin, i.correlation_key, i.wave,
         i.sla_due_at, i.latest_summary, i.opened_at, i.updated_at,
         i.resolved_at, i.pending_order,
         COALESCE(s.event_count, 0) AS event_count,
         s.last_event_at,
         COALESCE(s.has_draft, 0) AS has_draft,
         COALESCE(s.closure_proposed, 0) AS closure_proposed,
         COALESCE(t.agent_total, 0) AS agent_total,
         COALESCE(t.agent_open, 0) AS agent_open,
         COALESCE(t.human_total, 0) AS human_total,
         COALESCE(t.human_open, 0) AS human_open,
         COALESCE(t.assignees_json, '[]') AS assignees_json
  FROM spine_issues i
  LEFT JOIN spine_issue_stats s ON s.issue_id = i.id
  LEFT JOIN (
    SELECT issue_id,
           count(*) FILTER (WHERE owner_kind = 'agent') AS agent_total,
           count(*) FILTER (WHERE owner_kind = 'agent'
             AND status NOT IN (${TASK_CLOSED_SQL})) AS agent_open,
           count(*) FILTER (WHERE owner_kind = 'human') AS human_total,
           count(*) FILTER (WHERE owner_kind = 'human'
             AND status NOT IN (${TASK_CLOSED_SQL})) AS human_open,
           COALESCE(json_group_array(trim(assignee)) FILTER (
             WHERE owner_kind = 'human'
               AND status NOT IN (${TASK_CLOSED_SQL})
               AND assignee IS NOT NULL
               AND trim(assignee) <> ''
           ), '[]') AS assignees_json
    FROM spine_tasks
    GROUP BY issue_id
  ) t ON t.issue_id = i.id`;

function parseAssignees(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((value) => String(value ?? ""))
      : [];
  } catch {
    return [];
  }
}

function cardFromRow(
  row: EligibleSqlRow,
  agents: Map<string, SpineAgentIdentity>,
  hasBookAccount: (companyId: number) => boolean,
): SpineIssueCard {
  const rawAssignees = dedupeTokens(parseAssignees(row.assignees_json));
  const closureProposed = row.closure_proposed > 0;
  const companyId = row.company_id;
  return {
    id: row.id,
    companyId,
    accountId:
      companyId !== null && hasBookAccount(companyId)
        ? `co-${companyId}`
        : null,
    companyName: row.company_name,
    issueType: row.issue_type,
    goal: row.goal,
    status: row.status,
    priority: row.priority,
    blocking: row.blocking,
    origin: row.origin,
    correlationKey: row.correlation_key,
    wave: row.wave,
    slaDueAt: row.sla_due_at,
    latestSummary: row.latest_summary,
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    agentOpen: row.agent_open,
    agentTotal: row.agent_total,
    humanOpen: row.human_open,
    humanTotal: row.human_total,
    openHumanAssignees: dedupeTokens(
      rawAssignees.flatMap((raw) => assigneeMatchTokens(raw, agents)),
    ),
    openHumanAssigneeNames: dedupeTokens(
      rawAssignees.flatMap((raw) => assigneeDisplayNames(raw, agents)),
    ),
    eventCount: row.event_count,
    lastEventAt: row.last_event_at,
    hasDraft: row.has_draft > 0,
    closureProposed,
    pendingOrder:
      row.pending_order === 1 ? true : row.pending_order === 0 ? false : null,
    column: spineColumnOf({ status: row.status, closureProposed }),
  };
}

/** Book-membership check, one prepared point lookup memoized per call. */
function bookAccountLookup(
  db: Database.Database,
): (companyId: number) => boolean {
  const statement = db.prepare(`SELECT 1 FROM accounts WHERE id = ?`);
  const known = new Map<number, boolean>();
  return (companyId: number) => {
    const cached = known.get(companyId);
    if (cached !== undefined) return cached;
    const exists = statement.get(`co-${companyId}`) !== undefined;
    known.set(companyId, exists);
    return exists;
  };
}

interface EligibleSet {
  rows: SpineIssueCard[];
  mirrorTotal: number;
}

/**
 * The one eligible set both faces read: SQL filters + deterministic order,
 * then the queue law in JS. Order: recency = `updated_at DESC, id DESC`
 * (source server order); priority = `priority ASC, updated_at DESC, id DESC`
 * (lexicographic — parity with the source's localeCompare over P0…P5).
 */
function selectEligibleSpineRows(
  db: Database.Database,
  q: SpineListQuery,
): EligibleSet {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  const search = q.search.trim().toLowerCase();
  if (search) {
    where.push(`i.search_haystack LIKE @search ESCAPE '\\'`);
    params.search = likePattern(search);
  }
  if (q.priority) {
    where.push(`i.priority = @priority`);
    params.priority = q.priority;
  }
  if (q.issueType) {
    where.push(`i.issue_type = @issueType`);
    params.issueType = q.issueType;
  }
  if (q.wave) {
    where.push(`i.wave = @wave`);
    params.wave = q.wave;
  }
  if (q.cohort === "pending") where.push(`i.pending_order = 1`);
  else if (q.cohort === "active") where.push(`i.pending_order = 0`);
  else if (q.cohort === "others") where.push(`i.pending_order IS NULL`);

  const orderBy =
    q.sort === "priority"
      ? `i.priority ASC, i.updated_at DESC, i.id DESC`
      : `i.updated_at DESC, i.id DESC`;
  const sql = `${ISSUE_CARD_SELECT}
  ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
  ORDER BY ${orderBy}`;

  const rows = db.prepare(sql).all(params) as unknown as EligibleSqlRow[];
  const agents = loadSpineAgentMap(db);
  const hasBookAccount = bookAccountLookup(db);
  const cards: SpineIssueCard[] = [];
  for (const row of rows) {
    const card = cardFromRow(row, agents, hasBookAccount);
    if (!issueInSpineQueue(card, q.queue, q.viewer)) continue;
    cards.push(card);
  }
  const mirrorTotal = (
    db.prepare(`SELECT count(*) AS c FROM spine_issues`).get() as { c: number }
  ).c;
  return { rows: cards, mirrorTotal };
}

// ── Board ─────────────────────────────────────────────────────────────────────

export function listSpineBoard(
  db: Database.Database,
  q: SpineListQuery & { columnLimit: number },
): SpineBoardResult {
  const { rows, mirrorTotal } = selectEligibleSpineRows(db, q);
  const columnLimit = Math.max(1, Math.floor(q.columnLimit) || 1);

  // Buckets keyed by working column; Map insertion order preserves the
  // first-seen order for unknown statuses (parity law: appended verbatim).
  const buckets = new Map<string, SpineIssueCard[]>();
  for (const card of rows) {
    const bucket = buckets.get(card.column);
    if (bucket) bucket.push(card);
    else buckets.set(card.column, [card]);
  }

  const knownIds = new Set(SPINE_COLUMNS.map((column) => column.id));
  const columns: SpineBoardColumn[] = [];
  for (const def of SPINE_COLUMNS) {
    const bucket = buckets.get(def.id) ?? [];
    // The blocked column folds away when empty (alwaysShown law).
    if (!def.alwaysShown && bucket.length === 0) continue;
    columns.push({
      id: def.id,
      label: def.label,
      total: bucket.length,
      rows: bucket.slice(0, columnLimit),
    });
  }
  for (const [columnId, bucket] of buckets) {
    if (knownIds.has(columnId)) continue;
    columns.push({
      id: columnId,
      label: spineColumnLabel(columnId),
      total: bucket.length,
      rows: bucket.slice(0, columnLimit),
    });
  }

  return { columns, filteredTotal: rows.length, mirrorTotal };
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function listSpineTable(
  db: Database.Database,
  q: SpineListQuery & { page: number; pageSize: number },
): SpineTableResult {
  const { rows, mirrorTotal } = selectEligibleSpineRows(db, q);
  const pageSize = Math.max(1, Math.floor(q.pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(q.page) || 1), pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    filteredTotal: rows.length,
    mirrorTotal,
    page,
    pageCount,
    pageSize,
  };
}

// ── Summary (whole mirror, exact) ─────────────────────────────────────────────

export function getSpineSummary(db: Database.Database): SpineSummary {
  const statusRows = db
    .prepare(
      `SELECT status, count(*) AS n FROM spine_issues
       GROUP BY status
       ORDER BY n DESC, status ASC`,
    )
    .all() as Array<{ status: string; n: number }>;
  const taskRows = db
    .prepare(
      `SELECT owner_kind AS ownerKind,
              count(*) AS total,
              count(*) FILTER (WHERE status NOT IN (${TASK_CLOSED_SQL})) AS open
       FROM spine_tasks
       GROUP BY owner_kind`,
    )
    .all() as Array<{ ownerKind: string; total: number; open: number }>;

  const tally = {
    agent: { open: 0, total: 0 },
    human: { open: 0, total: 0 },
  };
  for (const row of taskRows) {
    const bucket =
      row.ownerKind === "agent"
        ? tally.agent
        : row.ownerKind === "human"
          ? tally.human
          : null;
    if (!bucket) continue;
    bucket.total += Number(row.total) || 0;
    bucket.open += Number(row.open) || 0;
  }

  // The whole-mirror count of the board's "Closure proposed" column: the
  // overlay outranks raw status only while the issue is non-terminal
  // (spineColumnOf), so the terminal cut belongs in the count too.
  const closureProposedRow = db
    .prepare(
      `SELECT count(*) AS n
       FROM spine_issues i
       JOIN spine_issue_stats s ON s.issue_id = i.id
       WHERE s.closure_proposed = 1
         AND i.status NOT IN (${ISSUE_TERMINAL_SQL})`,
    )
    .get() as { n: number };

  const issuesByStatus = statusRows.map((row) => ({
    status: row.status,
    n: Number(row.n) || 0,
  }));
  return {
    issuesByStatus,
    issuesTotal: issuesByStatus.reduce((sum, row) => sum + row.n, 0),
    closureProposedOpen: Number(closureProposedRow?.n) || 0,
    agentTasks: tally.agent,
    humanTasks: tally.human,
    events: {
      total: Number(readSpineMeta(db, SPINE_META_EVENTS_TOTAL)) || 0,
      suppressions:
        Number(readSpineMeta(db, SPINE_META_EVENTS_SUPPRESSIONS)) || 0,
    },
  };
}

// ── Issue detail (head + tasks + links; timeline stays on demand) ─────────────

export function getSpineIssueDetail(
  db: Database.Database,
  issueId: number,
): SpineIssueDetail | null {
  if (!Number.isSafeInteger(issueId) || issueId <= 0) return null;
  const head = db
    .prepare(
      `SELECT i.id, i.company_id, i.company_name, i.issue_type, i.goal,
              i.status, i.priority, i.blocking, i.origin, i.correlation_key,
              i.wave, i.sla_due_at, i.latest_summary,
              i.last_communication_summary, i.resolution_summary, i.opened_at,
              i.updated_at, i.resolved_at, i.pending_order,
              COALESCE(s.event_count, 0) AS event_count,
              s.last_event_at,
              COALESCE(s.has_draft, 0) AS has_draft,
              COALESCE(s.closure_proposed, 0) AS closure_proposed
       FROM spine_issues i
       LEFT JOIN spine_issue_stats s ON s.issue_id = i.id
       WHERE i.id = ?`,
    )
    .get(issueId) as
    | {
        id: number;
        company_id: number | null;
        company_name: string | null;
        issue_type: string;
        goal: string;
        status: string;
        priority: string;
        blocking: string | null;
        origin: string | null;
        correlation_key: string | null;
        wave: string | null;
        sla_due_at: string | null;
        latest_summary: string | null;
        last_communication_summary: string | null;
        resolution_summary: string | null;
        opened_at: string | null;
        updated_at: string | null;
        resolved_at: string | null;
        pending_order: number | null;
        event_count: number;
        last_event_at: string | null;
        has_draft: number;
        closure_proposed: number;
      }
    | undefined;
  if (!head) return null;

  const taskRows = db
    .prepare(
      `SELECT id, issue_id, title, owner_kind, status, assignee, lane_skill,
              gate_label, sla_due_at, created_at, completed_at
       FROM spine_tasks
       WHERE issue_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(issueId) as Array<{
    id: number;
    issue_id: number;
    title: string;
    owner_kind: string;
    status: string;
    assignee: string | null;
    lane_skill: string | null;
    gate_label: string | null;
    sla_due_at: string | null;
    created_at: string | null;
    completed_at: string | null;
  }>;
  const linkRows = db
    .prepare(
      `SELECT tl.id, tl.task_id, tl.link_kind, tl.link_ref, tl.created_at,
              t.title AS task_title
       FROM spine_task_links tl
       JOIN spine_tasks t ON t.id = tl.task_id
       WHERE t.issue_id = ?
       ORDER BY tl.created_at ASC, tl.id ASC`,
    )
    .all(issueId) as Array<{
    id: number;
    task_id: number;
    link_kind: string;
    link_ref: string | null;
    created_at: string | null;
    task_title: string | null;
  }>;

  const agents = loadSpineAgentMap(db);
  const tasks: SpineTaskRow[] = taskRows.map((row) => ({
    id: row.id,
    issueId: row.issue_id,
    title: row.title,
    ownerKind: row.owner_kind,
    status: row.status,
    assignee: row.assignee,
    assigneeLabel: assigneeLabel(row.assignee, agents),
    laneSkill: row.lane_skill,
    gateLabel: row.gate_label,
    slaDueAt: row.sla_due_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
  const taskLinks: SpineTaskLinkRow[] = linkRows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    linkKind: row.link_kind,
    linkRef: row.link_ref,
    createdAt: row.created_at,
  }));

  // Source law: the panel's per-issue tallies derive from the detail's own
  // task rows (never a second aggregate that could disagree on-screen);
  // event-shape signals come from spine_issue_stats.
  const openHumanRaw = dedupeTokens(
    taskRows
      .filter(
        (row) => row.owner_kind === "human" && isOpenTaskStatus(row.status),
      )
      .map((row) => (row.assignee ?? "").trim())
      .filter((assignee) => assignee !== ""),
  );
  const closureProposed = head.closure_proposed > 0;
  const companyId = head.company_id;
  const hasBookAccount = bookAccountLookup(db);

  return {
    issue: {
      id: head.id,
      companyId,
      accountId:
        companyId !== null && hasBookAccount(companyId)
          ? `co-${companyId}`
          : null,
      companyName: head.company_name,
      issueType: head.issue_type,
      goal: head.goal,
      status: head.status,
      priority: head.priority,
      blocking: head.blocking,
      origin: head.origin,
      correlationKey: head.correlation_key,
      wave: head.wave,
      slaDueAt: head.sla_due_at,
      latestSummary: head.latest_summary,
      openedAt: head.opened_at,
      updatedAt: head.updated_at,
      resolvedAt: head.resolved_at,
      agentOpen: tasks.filter(
        (task) => task.ownerKind === "agent" && isOpenTaskStatus(task.status),
      ).length,
      agentTotal: tasks.filter((task) => task.ownerKind === "agent").length,
      humanOpen: tasks.filter(
        (task) => task.ownerKind === "human" && isOpenTaskStatus(task.status),
      ).length,
      humanTotal: tasks.filter((task) => task.ownerKind === "human").length,
      openHumanAssignees: dedupeTokens(
        openHumanRaw.flatMap((raw) => assigneeMatchTokens(raw, agents)),
      ),
      openHumanAssigneeNames: dedupeTokens(
        openHumanRaw.flatMap((raw) => assigneeDisplayNames(raw, agents)),
      ),
      eventCount: head.event_count,
      lastEventAt: head.last_event_at,
      hasDraft: head.has_draft > 0,
      closureProposed,
      pendingOrder:
        head.pending_order === 1
          ? true
          : head.pending_order === 0
            ? false
            : null,
      column: spineColumnOf({ status: head.status, closureProposed }),
      lastCommunicationSummary: head.last_communication_summary,
      resolutionSummary: head.resolution_summary,
    },
    tasks,
    taskLinks,
  };
}

// ── Filter options (whole mirror — improvement over the source's
//    loaded-window derivation, documented in the design doc) ──────────────────

export function getSpineFilterOptions(
  db: Database.Database,
): SpineFilterOptions {
  const priorities = (
    db
      .prepare(
        `SELECT DISTINCT priority FROM spine_issues
         WHERE priority <> '' ORDER BY priority ASC`,
      )
      .all() as Array<{ priority: string }>
  ).map((row) => row.priority);
  const issueTypes = (
    db
      .prepare(
        `SELECT DISTINCT issue_type FROM spine_issues
         WHERE issue_type <> '' ORDER BY issue_type ASC`,
      )
      .all() as Array<{ issue_type: string }>
  ).map((row) => row.issue_type);
  // wave is precomputed at upsert (waveOf over correlation_key) so DISTINCT
  // stays a plain column scan instead of a per-row parse.
  const waves = (
    db
      .prepare(
        `SELECT DISTINCT wave FROM spine_issues
         WHERE wave IS NOT NULL ORDER BY wave ASC`,
      )
      .all() as Array<{ wave: string }>
  ).map((row) => row.wave);

  // People: port of the source's spineQueuePeople — per ISSUE, the distinct
  // open-human assignee match tokens; tokens holding "@" (emails) never
  // become picker entries; counts are issues on the desk, most-loaded first.
  const agents = loadSpineAgentMap(db);
  const assigneeRows = db
    .prepare(
      `SELECT issue_id, assignee FROM spine_tasks
       WHERE owner_kind = 'human'
         AND status NOT IN (${TASK_CLOSED_SQL})
         AND assignee IS NOT NULL
         AND trim(assignee) <> ''`,
    )
    .all() as Array<{ issue_id: number; assignee: string }>;
  const rawByIssue = new Map<number, string[]>();
  for (const row of assigneeRows) {
    const bucket = rawByIssue.get(row.issue_id);
    if (bucket) bucket.push(row.assignee);
    else rawByIssue.set(row.issue_id, [row.assignee]);
  }
  const byKey = new Map<string, { label: string; n: number }>();
  for (const rawAssignees of rawByIssue.values()) {
    const seen = new Set<string>();
    const tokens = dedupeTokens(rawAssignees).flatMap((raw) =>
      assigneeMatchTokens(raw, agents),
    );
    for (const token of tokens) {
      const label = token.trim();
      if (!label || label.includes("@")) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const hit = byKey.get(key);
      if (hit) hit.n += 1;
      else byKey.set(key, { label, n: 1 });
    }
  }
  const people = [...byKey.values()].sort(
    (a, b) => b.n - a.n || a.label.localeCompare(b.label),
  );

  return { priorities, issueTypes, waves, people };
}
