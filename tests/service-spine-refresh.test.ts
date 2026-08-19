import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";

vi.mock("@/lib/supabase-management.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/supabase-management.server")>();
  return { ...actual, runSupabaseManagementQuery: vi.fn() };
});

import { runSupabaseManagementQuery } from "@/lib/supabase-management.server";
import {
  readSpineMeta,
  refreshSpineDelta,
  refreshSpineFull,
  scheduleServiceSpineRefresh,
  SPINE_META_EVENTS_MAX_ID,
  SPINE_META_EVENTS_SUPPRESSIONS,
  SPINE_META_EVENTS_TOTAL,
  SPINE_META_ISSUES_WATERMARK,
  SPINE_META_LINKS_WATERMARK,
  SPINE_META_TASKS_WATERMARK,
} from "@/lib/db/service-spine-refresh";

/**
 * The spine refresh leg against an in-memory mirror with the Management API
 * mocked: delta upsert idempotency under the two-minute overlap, incremental
 * stats equivalence with a from-scratch rebuild, watermark atomicity with the
 * data transaction, exact totals, reconcile delete semantics, and the
 * credentials-off no-op.
 */

type QueryMock = ReturnType<typeof vi.fn>;
const query = runSupabaseManagementQuery as unknown as QueryMock;

function freshDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

interface SourceEvent {
  id: number;
  issue_id: number | null;
  kind: string;
  at: string;
}

function issueRow(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    company_id: 900 + id,
    company_name: `Company ${id}`,
    issue_type: "policy_delivery",
    goal: `Goal ${id}`,
    status: "open",
    priority: "P1",
    blocking: "non_blocking",
    origin: "ai",
    correlation_key: "spine-prod-20260731:x",
    sla_due_at: null,
    latest_summary: null,
    last_communication_summary: null,
    resolution_summary: null,
    opened_at: "2026-08-18T00:00:00+00:00",
    // Deliberately the pg text shape (space + microseconds + bare offset) to
    // exercise ISO normalization at ingest.
    updated_at: "2026-08-18 10:00:00.123456+00",
    resolved_at: null,
    pending_order: true,
    ...over,
  };
}

function taskRow(id: number, issueId: number, over: Record<string, unknown> = {}) {
  return {
    id,
    issue_id: issueId,
    company_id: null,
    title: `Task ${id}`,
    owner_kind: "human",
    status: "todo",
    assignee: null,
    lane_skill: null,
    gate_label: null,
    sla_due_at: null,
    created_at: "2026-08-18T01:00:00+00:00",
    updated_at: "2026-08-18T02:00:00+00:00",
    completed_at: null,
    ...over,
  };
}

function linkRow(id: number, taskId: number, over: Record<string, unknown> = {}) {
  return {
    id,
    task_id: taskId,
    link_kind: "blocked_by_task",
    link_ref: "svc:task:1",
    created_at: "2026-08-18T03:00:00+00:00",
    ...over,
  };
}

function agentRow(id: string, name: string | null, email: string | null) {
  return { id, name, email, active: true };
}

/** The reconcile's GROUP BY issue_id, computed from a raw event stream. */
function eventStatsRows(events: SourceEvent[]) {
  const groups = new Map<
    string,
    {
      issue_id: number | null;
      n: number;
      last: string | null;
      draft: boolean;
      closure: boolean;
      maxId: number;
    }
  >();
  for (const event of events) {
    const key = event.issue_id === null ? "null" : String(event.issue_id);
    const group = groups.get(key) ?? {
      issue_id: event.issue_id,
      n: 0,
      last: null,
      draft: false,
      closure: false,
      maxId: 0,
    };
    group.n += 1;
    if (!group.last || event.at > group.last) group.last = event.at;
    if (event.kind === "draft_created") group.draft = true;
    if (event.kind === "closure_proposed") group.closure = true;
    if (event.id > group.maxId) group.maxId = event.id;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    issue_id: group.issue_id,
    n: group.n,
    last_event_at: group.last,
    has_draft: group.draft,
    closure_proposed: group.closure,
    max_id: group.maxId,
  }));
}

interface FullPayload {
  issues?: unknown[];
  tasks?: unknown[];
  links?: unknown[];
  stats?: unknown[];
  agents?: unknown[];
}

function mockFull(payload: FullPayload) {
  query
    .mockResolvedValueOnce(payload.issues ?? [])
    .mockResolvedValueOnce(payload.tasks ?? [])
    .mockResolvedValueOnce([
      {
        task_links: payload.links ?? [],
        event_stats: payload.stats ?? [],
        agents: payload.agents ?? [],
      },
    ]);
}

interface DeltaPayload {
  issues?: unknown[];
  tasks?: unknown[];
  links?: unknown[];
  events?: SourceEvent[];
  total?: number;
  suppressions?: number;
}

function mockDelta(payload: DeltaPayload) {
  query.mockResolvedValueOnce([
    {
      issues: payload.issues ?? [],
      tasks: payload.tasks ?? [],
      task_links: payload.links ?? [],
      events: payload.events ?? [],
      events_total: payload.total ?? 0,
      events_suppressions: payload.suppressions ?? 0,
    },
  ]);
}

function readStats(db: InstanceType<typeof Database>) {
  return db
    .prepare(
      `SELECT issue_id, event_count, last_event_at, has_draft, closure_proposed
       FROM spine_issue_stats ORDER BY issue_id ASC`,
    )
    .all();
}

function metaSnapshot(db: InstanceType<typeof Database>) {
  return {
    issues: readSpineMeta(db, SPINE_META_ISSUES_WATERMARK),
    tasks: readSpineMeta(db, SPINE_META_TASKS_WATERMARK),
    links: readSpineMeta(db, SPINE_META_LINKS_WATERMARK),
    eventsMaxId: readSpineMeta(db, SPINE_META_EVENTS_MAX_ID),
    total: readSpineMeta(db, SPINE_META_EVENTS_TOTAL),
    suppressions: readSpineMeta(db, SPINE_META_EVENTS_SUPPRESSIONS),
  };
}

const FULL_EVENTS: SourceEvent[] = [
  { id: 1, issue_id: 1, kind: "comment", at: "2026-08-17T10:00:00.000Z" },
  { id: 2, issue_id: 1, kind: "draft_created", at: "2026-08-17T11:00:00.000Z" },
  { id: 3, issue_id: 2, kind: "comment", at: "2026-08-17T12:00:00.000Z" },
  { id: 4, issue_id: null, kind: "signal_suppressed", at: "2026-08-17T13:00:00.000Z" },
  { id: 5, issue_id: 1, kind: "comment", at: "2026-08-17T14:00:00.000Z" },
];

async function seedFullMirror(db: InstanceType<typeof Database>) {
  mockFull({
    issues: [issueRow(1), issueRow(2, { status: "waiting_customer" })],
    tasks: [taskRow(10, 1, { assignee: "501" }), taskRow(11, 2)],
    links: [linkRow(100, 10)],
    stats: eventStatsRows(FULL_EVENTS),
    agents: [agentRow("501", "Jane Doe", "jane.doe@harperinsure.com")],
  });
  return refreshSpineFull(db);
}

afterEach(() => {
  query.mockReset();
});

describe("full reconcile", () => {
  it("ingests the whole spine, normalizes timestamps, and sets watermarks", async () => {
    const db = freshDb();
    const outcome = await seedFullMirror(db);
    expect(outcome.requests).toBe(3);
    expect(query).toHaveBeenCalledTimes(3);
    // The issue pull carries the cohort CASE predicates verbatim.
    const issuesSql = query.mock.calls[0][0] as string;
    expect(issuesSql).toContain("FROM service.issues i");
    expect(issuesSql).toContain("COALESCE(TRIM(d.policy_number), '') <> ''");
    expect(issuesSql).toContain("o.order_complete IS DISTINCT FROM TRUE");
    expect(issuesSql).toContain(
      "LOWER(COALESCE(dz.deal_stage, '')) NOT IN ('lost','dead','cancelled','denied')",
    );

    const issues = db
      .prepare(`SELECT * FROM spine_issues ORDER BY id`)
      .all() as Array<Record<string, unknown>>;
    expect(issues).toHaveLength(2);
    // pg text timestamp normalized to lexicographic-safe UTC ISO.
    expect(issues[0].updated_at).toBe("2026-08-18T10:00:00.123Z");
    expect(issues[0].wave).toBe("0731");
    expect(issues[0].pending_order).toBe(1);
    expect(String(issues[0].search_haystack)).toContain("company 1");
    expect(String(issues[0].search_haystack)).toContain("policy delivery");

    const meta = metaSnapshot(db);
    expect(meta.issues).toBe("2026-08-18T10:00:00.123Z");
    expect(meta.tasks).toBe("2026-08-18T02:00:00.000Z");
    expect(meta.links).toBe("2026-08-18T03:00:00.000Z");
    expect(meta.eventsMaxId).toBe("5");
    expect(meta.total).toBe("5");
    expect(meta.suppressions).toBe("1");

    // Stats rebuilt from the GROUP BY: suppressions never get a stats row.
    expect(readStats(db)).toEqual([
      {
        issue_id: 1,
        event_count: 3,
        last_event_at: "2026-08-17T14:00:00.000Z",
        has_draft: 1,
        closure_proposed: 0,
      },
      {
        issue_id: 2,
        event_count: 1,
        last_event_at: "2026-08-17T12:00:00.000Z",
        has_draft: 0,
        closure_proposed: 0,
      },
    ]);
  });

  it("deletes rows that disappeared upstream (scoped to reconcile)", async () => {
    const db = freshDb();
    await seedFullMirror(db);
    const remainingEvents = FULL_EVENTS.filter((e) => e.issue_id !== 2);
    mockFull({
      issues: [issueRow(1)],
      tasks: [taskRow(10, 1, { assignee: "501" })],
      links: [],
      stats: eventStatsRows(remainingEvents),
      agents: [agentRow("501", "Jane Doe", "jane.doe@harperinsure.com")],
    });
    await refreshSpineFull(db);

    const issueIds = db
      .prepare(`SELECT id FROM spine_issues ORDER BY id`)
      .all() as Array<{ id: number }>;
    expect(issueIds).toEqual([{ id: 1 }]);
    const taskIds = db
      .prepare(`SELECT id FROM spine_tasks ORDER BY id`)
      .all() as Array<{ id: number }>;
    expect(taskIds).toEqual([{ id: 10 }]);
    expect(
      db.prepare(`SELECT count(*) AS c FROM spine_task_links`).get(),
    ).toEqual({ c: 0 });
    const statRows = readStats(db) as Array<{ issue_id: number }>;
    expect(statRows.map((row) => row.issue_id)).toEqual([1]);
  });

  it("prunes departed agents but keeps the surviving directory", async () => {
    const db = freshDb();
    mockFull({
      agents: [
        agentRow("501", "Jane Doe", "jane.doe@harperinsure.com"),
        agentRow("502", "Bob Smith", null),
      ],
    });
    await refreshSpineFull(db);
    mockFull({ agents: [agentRow("501", "Jane Q Doe", null)] });
    await refreshSpineFull(db);
    expect(db.prepare(`SELECT id, name FROM spine_agents`).all()).toEqual([
      { id: "501", name: "Jane Q Doe" },
    ]);
  });
});

describe("delta tick", () => {
  it("refuses to run before the first reconcile established watermarks", async () => {
    const db = freshDb();
    await expect(refreshSpineDelta(db)).rejects.toThrow(
      "spine_delta_requires_watermarks",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("spends ONE request, applies the overlap, and never pulls event payloads", async () => {
    const db = freshDb();
    await seedFullMirror(db);
    query.mockClear();

    mockDelta({
      issues: [
        issueRow(1, {
          goal: "Goal 1 v2",
          updated_at: "2026-08-18T11:00:00+00:00",
        }),
      ],
      events: [
        { id: 6, issue_id: 2, kind: "closure_proposed", at: "2026-08-18T11:05:00.000Z" },
      ],
      total: 6,
      suppressions: 1,
    });
    const outcome = await refreshSpineDelta(db);
    expect(outcome).toEqual({
      requests: 1,
      issues: 1,
      tasks: 0,
      links: 0,
      events: 1,
    });
    expect(query).toHaveBeenCalledTimes(1);

    const sql = query.mock.calls[0][0] as string;
    // Two-minute overlap on the timestamp watermarks (10:00:00.123 → 09:58).
    expect(sql).toContain("i.updated_at > '2026-08-18T09:58:00.123Z'");
    expect(sql).toContain("t.updated_at > '2026-08-18T01:58:00.000Z'");
    expect(sql).toContain("tl.created_at > '2026-08-18T02:58:00.000Z'");
    // Strict id cursor for events.
    expect(sql).toContain("e.id > 5");
    // The mirror never carries event payloads or actors (PII rule).
    expect(sql).not.toContain("payload");
    expect(sql).not.toContain("actor");
  });

  it("converges under overlap re-application (idempotent upserts)", async () => {
    const db = freshDb();
    await seedFullMirror(db);

    const changed = issueRow(1, {
      goal: "Goal 1 v2",
      updated_at: "2026-08-18T11:00:00+00:00",
    });
    const changedTask = taskRow(10, 1, {
      assignee: "501",
      status: "in_progress",
      updated_at: "2026-08-18T11:01:00+00:00",
    });
    const newLink = linkRow(101, 10, {
      created_at: "2026-08-18T11:02:00+00:00",
    });
    mockDelta({
      issues: [changed],
      tasks: [changedTask],
      links: [newLink],
      events: [
        { id: 6, issue_id: 1, kind: "comment", at: "2026-08-18T11:03:00.000Z" },
      ],
      total: 6,
      suppressions: 1,
    });
    await refreshSpineDelta(db);
    const snapshotAfterFirst = {
      issues: db.prepare(`SELECT * FROM spine_issues ORDER BY id`).all(),
      tasks: db.prepare(`SELECT * FROM spine_tasks ORDER BY id`).all(),
      links: db.prepare(`SELECT * FROM spine_task_links ORDER BY id`).all(),
      stats: readStats(db),
    };

    // The overlap re-delivers the same watermarked rows next tick; events do
    // NOT repeat (strict id cursor — the SQL proves it below).
    mockDelta({
      issues: [changed],
      tasks: [changedTask],
      links: [newLink],
      events: [],
      total: 6,
      suppressions: 1,
    });
    await refreshSpineDelta(db);

    expect(db.prepare(`SELECT * FROM spine_issues ORDER BY id`).all()).toEqual(
      snapshotAfterFirst.issues,
    );
    expect(db.prepare(`SELECT * FROM spine_tasks ORDER BY id`).all()).toEqual(
      snapshotAfterFirst.tasks,
    );
    expect(
      db.prepare(`SELECT * FROM spine_task_links ORDER BY id`).all(),
    ).toEqual(snapshotAfterFirst.links);
    expect(readStats(db)).toEqual(snapshotAfterFirst.stats);

    const secondSql = query.mock.calls[query.mock.calls.length - 1][0] as string;
    expect(secondSql).toContain("e.id > 6");
    expect(secondSql).toContain("i.updated_at > '2026-08-18T10:58:00.000Z'");
  });

  it("keeps incremental stats equal to a from-scratch rebuild of the same stream", async () => {
    const db = freshDb();
    await seedFullMirror(db);

    const deltaAEvents: SourceEvent[] = [
      { id: 6, issue_id: 2, kind: "closure_proposed", at: "2026-08-18T11:05:00.000Z" },
      { id: 7, issue_id: 1, kind: "comment", at: "2026-08-18T11:06:00.000Z" },
    ];
    const deltaBEvents: SourceEvent[] = [
      { id: 8, issue_id: null, kind: "signal_suppressed", at: "2026-08-18T11:07:00.000Z" },
      { id: 9, issue_id: 3, kind: "draft_created", at: "2026-08-18T11:08:00.000Z" },
      { id: 10, issue_id: 3, kind: "comment", at: "2026-08-18T11:09:00.000Z" },
    ];
    mockDelta({ events: deltaAEvents, total: 7, suppressions: 1 });
    await refreshSpineDelta(db);
    mockDelta({
      issues: [issueRow(3, { updated_at: "2026-08-18T11:08:30+00:00" })],
      events: deltaBEvents,
      total: 10,
      suppressions: 2,
    });
    await refreshSpineDelta(db);

    const incremental = readStats(db);
    const allEvents = [...FULL_EVENTS, ...deltaAEvents, ...deltaBEvents];
    const expected = eventStatsRows(allEvents)
      .filter((row) => row.issue_id !== null)
      .map((row) => ({
        issue_id: row.issue_id,
        event_count: row.n,
        last_event_at: row.last_event_at,
        has_draft: row.has_draft ? 1 : 0,
        closure_proposed: row.closure_proposed ? 1 : 0,
      }))
      .sort((a, b) => (a.issue_id ?? 0) - (b.issue_id ?? 0));
    expect(incremental).toEqual(expected);

    // A reconcile over the same whole stream lands on the identical table.
    mockFull({
      issues: [issueRow(1), issueRow(2), issueRow(3)],
      tasks: [],
      links: [],
      stats: eventStatsRows(allEvents),
      agents: [],
    });
    await refreshSpineFull(db);
    expect(readStats(db)).toEqual(incremental);

    const meta = metaSnapshot(db);
    expect(meta.total).toBe("10");
    expect(meta.suppressions).toBe("2");
    expect(meta.eventsMaxId).toBe("10");
  });

  it("maintains exact whole-ledger totals from the delta's own counts", async () => {
    const db = freshDb();
    await seedFullMirror(db);
    mockDelta({ events: [], total: 160_042, suppressions: 33_882 });
    await refreshSpineDelta(db);
    const meta = metaSnapshot(db);
    expect(meta.total).toBe("160042");
    expect(meta.suppressions).toBe("33882");
  });

  it("advances watermarks only when the transaction commits", async () => {
    const db = freshDb();
    await seedFullMirror(db);
    const before = metaSnapshot(db);
    const statsBefore = readStats(db);
    const goalBefore = db
      .prepare(`SELECT goal FROM spine_issues WHERE id = 1`)
      .get() as { goal: string };

    // A mid-transaction failure: the link insert aborts AFTER the issue
    // upsert already ran inside the same transaction.
    db.exec(
      `CREATE TRIGGER spine_links_boom BEFORE INSERT ON spine_task_links
       BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    mockDelta({
      issues: [
        issueRow(1, {
          goal: "MUST NOT LAND",
          updated_at: "2026-08-18T12:00:00+00:00",
        }),
      ],
      links: [linkRow(300, 10, { created_at: "2026-08-18T12:01:00+00:00" })],
      events: [
        { id: 6, issue_id: 1, kind: "comment", at: "2026-08-18T12:02:00.000Z" },
      ],
      total: 6,
      suppressions: 1,
    });
    await expect(refreshSpineDelta(db)).rejects.toThrow();
    db.exec(`DROP TRIGGER spine_links_boom`);

    expect(metaSnapshot(db)).toEqual(before);
    expect(
      db.prepare(`SELECT goal FROM spine_issues WHERE id = 1`).get(),
    ).toEqual(goalBefore);
    expect(readStats(db)).toEqual(statsBefore);
    expect(
      db.prepare(`SELECT count(*) AS c FROM spine_task_links WHERE id = 300`).get(),
    ).toEqual({ c: 0 });

    // A corrupt payload is refused before the transaction ever opens.
    mockDelta({ tasks: [{ id: 999 }], total: 6, suppressions: 1 });
    await expect(refreshSpineDelta(db)).rejects.toThrow(
      "spine_task_row_invalid",
    );
    expect(metaSnapshot(db)).toEqual(before);
  });
});

describe("scheduling", () => {
  it("stays off with a warning when credentials are unset", () => {
    const db = freshDb();
    const scheduledKey = Symbol.for("stepbro.serviceSpineRefreshScheduled");
    const globalStore = globalThis as Record<symbol, unknown>;
    const previousGuard = globalStore[scheduledKey];
    delete globalStore[scheduledKey];
    const previousToken = process.env.SUPABASE_ACCESS_TOKEN;
    const previousRef = process.env.SUPABASE_PROJECT_REF;
    delete process.env.SUPABASE_ACCESS_TOKEN;
    delete process.env.SUPABASE_PROJECT_REF;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      scheduleServiceSpineRefresh(db);
      expect(warn).toHaveBeenCalledWith(
        "service_spine_refresh_disabled",
        expect.objectContaining({ reason: expect.any(String) }),
      );
      expect(query).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      if (previousToken !== undefined) {
        process.env.SUPABASE_ACCESS_TOKEN = previousToken;
      }
      if (previousRef !== undefined) {
        process.env.SUPABASE_PROJECT_REF = previousRef;
      }
      delete globalStore[scheduledKey];
      if (previousGuard !== undefined) globalStore[scheduledKey] = previousGuard;
    }
  });
});
