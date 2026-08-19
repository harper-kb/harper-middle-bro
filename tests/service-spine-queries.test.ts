import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";
import {
  buildSpineSearchHaystack,
  waveOf,
  type SpineListQuery,
} from "@/lib/service-spine/domain";
import {
  getSpineFilterOptions,
  getSpineIssueDetail,
  getSpineSummary,
  listSpineBoard,
  listSpineTable,
} from "@/lib/db/queries/service-spine";
import {
  SPINE_META_EVENTS_SUPPRESSIONS,
  SPINE_META_EVENTS_TOTAL,
} from "@/lib/db/service-spine-refresh";

/**
 * The Service Spine read service over an in-memory mirror: board fold
 * (columns, caps, exact totals, unknown statuses), every filter alone and
 * combined, the search law over the precomputed haystack, queue filtering,
 * deterministic sorts, board/table eligible-set agreement, detail-derived
 * aggregates, and pre-sync empty-table behavior.
 */

type Db = InstanceType<typeof Database>;

function freshDb(): Db {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

interface IssueFixture {
  id: number;
  companyId?: number | null;
  companyName?: string | null;
  issueType?: string;
  goal?: string;
  status?: string;
  priority?: string;
  blocking?: string | null;
  origin?: string | null;
  correlationKey?: string | null;
  slaDueAt?: string | null;
  latestSummary?: string | null;
  lastCommunicationSummary?: string | null;
  resolutionSummary?: string | null;
  openedAt?: string | null;
  updatedAt?: string | null;
  resolvedAt?: string | null;
  pendingOrder?: number | null;
}

/** Mirrors the refresher's derivation: wave + haystack computed at upsert. */
function insertIssue(db: Db, fixture: IssueFixture): void {
  const issue = {
    companyId: null as number | null,
    companyName: null as string | null,
    issueType: "general_request",
    goal: `Goal ${fixture.id}`,
    status: "open",
    priority: "P2",
    blocking: null as string | null,
    origin: "ai" as string | null,
    correlationKey: null as string | null,
    slaDueAt: null as string | null,
    latestSummary: null as string | null,
    lastCommunicationSummary: null as string | null,
    resolutionSummary: null as string | null,
    openedAt: "2026-08-01T00:00:00.000Z" as string | null,
    updatedAt: "2026-08-10T00:00:00.000Z" as string | null,
    resolvedAt: null as string | null,
    pendingOrder: null as number | null,
    ...fixture,
  };
  db.prepare(
    `INSERT INTO spine_issues (
       id, company_id, company_name, issue_type, goal, status, priority,
       blocking, origin, correlation_key, wave, sla_due_at, latest_summary,
       last_communication_summary, resolution_summary, opened_at, updated_at,
       resolved_at, pending_order, search_haystack
     ) VALUES (
       @id, @companyId, @companyName, @issueType, @goal, @status, @priority,
       @blocking, @origin, @correlationKey, @wave, @slaDueAt, @latestSummary,
       @lastCommunicationSummary, @resolutionSummary, @openedAt, @updatedAt,
       @resolvedAt, @pendingOrder, @searchHaystack
     )`,
  ).run({
    ...issue,
    wave: waveOf(issue.correlationKey),
    searchHaystack: buildSpineSearchHaystack({
      companyName: issue.companyName,
      companyId: issue.companyId,
      id: issue.id,
      goal: issue.goal,
      issueType: issue.issueType,
      status: issue.status,
      priority: issue.priority,
      correlationKey: issue.correlationKey,
      latestSummary: issue.latestSummary,
      origin: issue.origin,
    }),
  });
}

interface TaskFixture {
  id: number;
  issueId: number;
  ownerKind?: string;
  status?: string;
  assignee?: string | null;
  title?: string;
  laneSkill?: string | null;
  gateLabel?: string | null;
  slaDueAt?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
}

function insertTask(db: Db, fixture: TaskFixture): void {
  const task = {
    ownerKind: "human",
    status: "todo",
    assignee: null as string | null,
    title: `Task ${fixture.id}`,
    laneSkill: null as string | null,
    gateLabel: null as string | null,
    slaDueAt: null as string | null,
    createdAt: "2026-08-02T00:00:00.000Z" as string | null,
    completedAt: null as string | null,
    ...fixture,
  };
  db.prepare(
    `INSERT INTO spine_tasks (
       id, issue_id, company_id, title, owner_kind, status, assignee,
       lane_skill, gate_label, sla_due_at, created_at, updated_at, completed_at
     ) VALUES (
       @id, @issueId, NULL, @title, @ownerKind, @status, @assignee,
       @laneSkill, @gateLabel, @slaDueAt, @createdAt, @createdAt, @completedAt
     )`,
  ).run(task);
}

function insertLink(
  db: Db,
  fixture: { id: number; taskId: number; linkKind?: string; linkRef?: string | null; createdAt?: string },
): void {
  db.prepare(
    `INSERT INTO spine_task_links (id, task_id, link_kind, link_ref, created_at)
     VALUES (@id, @taskId, @linkKind, @linkRef, @createdAt)`,
  ).run({
    linkKind: "blocked_by_task",
    linkRef: "svc:task:1",
    createdAt: "2026-08-03T00:00:00.000Z",
    ...fixture,
  });
}

function insertStats(
  db: Db,
  fixture: {
    issueId: number;
    eventCount?: number;
    lastEventAt?: string | null;
    hasDraft?: number;
    closureProposed?: number;
  },
): void {
  db.prepare(
    `INSERT INTO spine_issue_stats (
       issue_id, event_count, last_event_at, has_draft, closure_proposed
     ) VALUES (@issueId, @eventCount, @lastEventAt, @hasDraft, @closureProposed)`,
  ).run({
    eventCount: 1,
    lastEventAt: "2026-08-09T00:00:00.000Z",
    hasDraft: 0,
    closureProposed: 0,
    ...fixture,
  });
}

function insertAgent(
  db: Db,
  fixture: { id: string; name?: string | null; email?: string | null; active?: number },
): void {
  db.prepare(
    `INSERT INTO spine_agents (id, name, email, active)
     VALUES (@id, @name, @email, @active)`,
  ).run({ name: null, email: null, active: 1, ...fixture });
}

function insertAccount(db: Db, id: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO underwriters (id, name, email, carrier)
     VALUES ('uw-x', 'Test UW', 'uw@example.com', 'Hiscox')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, name, industry, state, primary_uw_id, status)
     VALUES (?, 'Acme Trucking LLC', 'Trucking', 'CA', 'uw-x', 'active')`,
  ).run(id);
}

function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO spine_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

const baseQuery: SpineListQuery = {
  search: "",
  priority: null,
  issueType: null,
  wave: null,
  cohort: null,
  queue: "all",
  viewer: { name: null, email: null },
  sort: "recency",
};

function boardQ(
  over: Partial<SpineListQuery> = {},
  columnLimit = 100,
): SpineListQuery & { columnLimit: number } {
  return { ...baseQuery, ...over, columnLimit };
}

function tableQ(
  over: Partial<SpineListQuery> = {},
  page = 1,
  pageSize = 100,
): SpineListQuery & { page: number; pageSize: number } {
  return { ...baseQuery, ...over, page, pageSize };
}

function columnById(result: ReturnType<typeof listSpineBoard>, id: string) {
  return result.columns.find((column) => column.id === id);
}

describe("board fold", () => {
  it("never duplicates an issue row across its one-to-many tasks", () => {
    const db = freshDb();
    insertIssue(db, { id: 1 });
    insertTask(db, { id: 10, issueId: 1, ownerKind: "human", status: "todo" });
    insertTask(db, { id: 11, issueId: 1, ownerKind: "agent", status: "done" });
    insertTask(db, { id: 12, issueId: 1, ownerKind: "human", status: "waiting" });
    const board = listSpineBoard(db, boardQ());
    const allRows = board.columns.flatMap((column) => column.rows);
    expect(allRows.map((row) => row.id)).toEqual([1]);
    expect(board.filteredTotal).toBe(1);
    expect(allRows[0].humanTotal).toBe(2);
    expect(allRows[0].humanOpen).toBe(2);
    expect(allRows[0].agentTotal).toBe(1);
    expect(allRows[0].agentOpen).toBe(0);
  });

  it("reports exact per-column totals while capping served rows", () => {
    const db = freshDb();
    insertIssue(db, { id: 1, updatedAt: "2026-08-10T03:00:00.000Z" });
    insertIssue(db, { id: 2, updatedAt: "2026-08-10T02:00:00.000Z" });
    insertIssue(db, { id: 3, updatedAt: "2026-08-10T01:00:00.000Z" });
    const board = listSpineBoard(db, boardQ({}, 2));
    const open = columnById(board, "open")!;
    expect(open.total).toBe(3);
    expect(open.rows.map((row) => row.id)).toEqual([1, 2]);
    expect(board.filteredTotal).toBe(3);
    expect(board.mirrorTotal).toBe(3);
  });

  it("folds the blocked column away only while it is empty", () => {
    const db = freshDb();
    insertIssue(db, { id: 1 });
    const withoutBlocked = listSpineBoard(db, boardQ());
    expect(withoutBlocked.columns.map((column) => column.id)).toEqual([
      "open",
      "waiting_customer",
      "waiting_third_party",
      "closure-proposed",
      "closed",
    ]);
    insertIssue(db, { id: 2, status: "blocked" });
    const withBlocked = listSpineBoard(db, boardQ());
    expect(withBlocked.columns.map((column) => column.id)).toEqual([
      "open",
      "waiting_customer",
      "waiting_third_party",
      "blocked",
      "closure-proposed",
      "closed",
    ]);
  });

  it("appends unknown statuses verbatim in first-seen order", () => {
    const db = freshDb();
    insertIssue(db, { id: 1, status: "paused", updatedAt: "2026-08-10T01:00:00.000Z" });
    insertIssue(db, { id: 2, status: "weird_status", updatedAt: "2026-08-10T02:00:00.000Z" });
    insertIssue(db, { id: 3 });
    const board = listSpineBoard(db, boardQ());
    // Eligible order is recency, so weird_status (newer) is seen first.
    expect(board.columns.map((column) => column.id)).toEqual([
      "open",
      "waiting_customer",
      "waiting_third_party",
      "closure-proposed",
      "closed",
      "weird_status",
      "paused",
    ]);
    expect(columnById(board, "paused")!.label).toBe("paused");
    expect(columnById(board, "weird_status")!.label).toBe("weird status");
  });

  it("files closure-proposed ahead of raw status and terminal ahead of both", () => {
    const db = freshDb();
    insertIssue(db, { id: 1, status: "open" });
    insertStats(db, { issueId: 1, closureProposed: 1 });
    insertIssue(db, { id: 2, status: "resolved" });
    insertIssue(db, { id: 3, status: "cancelled" });
    insertStats(db, { issueId: 3, closureProposed: 1 });
    const board = listSpineBoard(db, boardQ());
    expect(columnById(board, "closure-proposed")!.rows.map((r) => r.id)).toEqual([1]);
    expect(columnById(board, "open")!.total).toBe(0);
    expect(columnById(board, "closed")!.rows.map((r) => r.id).sort()).toEqual([2, 3]);
  });
});

describe("filters and search", () => {
  function filterFixture(): Db {
    const db = freshDb();
    insertIssue(db, {
      id: 41,
      companyId: 77,
      companyName: "Acme Trucking LLC",
      issueType: "policy_delivery",
      priority: "P0",
      status: "waiting_customer",
      correlationKey: "spine-prod-20260731:a",
      latestSummary: "Waiting on the insured",
      origin: "deterministic",
      pendingOrder: 1,
      updatedAt: "2026-08-10T04:00:00.000Z",
    });
    insertIssue(db, {
      id: 42,
      companyName: "Blue Harbor Seafood",
      issueType: "cancellation",
      priority: "P1",
      status: "open",
      correlationKey: "spine-prod-20260812:b",
      pendingOrder: 0,
      updatedAt: "2026-08-10T03:00:00.000Z",
    });
    insertIssue(db, {
      id: 43,
      companyName: "Cedar Deli",
      issueType: "policy_delivery",
      priority: "P1",
      status: "open",
      correlationKey: "deterministic:iq_coi_send:order:13265",
      pendingOrder: null,
      goal: "Refund 100% of the fee",
      updatedAt: "2026-08-10T02:00:00.000Z",
    });
    return db;
  }

  it("filters by priority, type, wave, and cohort — alone and combined", () => {
    const db = filterFixture();
    const ids = (q: SpineListQuery & { page: number; pageSize: number }) =>
      listSpineTable(db, q).rows.map((row) => row.id);

    expect(ids(tableQ({ priority: "P1" }))).toEqual([42, 43]);
    expect(ids(tableQ({ issueType: "policy_delivery" }))).toEqual([41, 43]);
    expect(ids(tableQ({ wave: "0731" }))).toEqual([41]);
    expect(ids(tableQ({ wave: "0812" }))).toEqual([42]);
    expect(ids(tableQ({ cohort: "pending" }))).toEqual([41]);
    expect(ids(tableQ({ cohort: "active" }))).toEqual([42]);
    expect(ids(tableQ({ cohort: "others" }))).toEqual([43]);
    expect(
      ids(tableQ({ priority: "P1", issueType: "policy_delivery" })),
    ).toEqual([43]);
    expect(ids(tableQ({ priority: "P1", search: "harbor" }))).toEqual([42]);
    expect(ids(tableQ({ priority: "P5" }))).toEqual([]);
  });

  it("searches every source-law field, case-insensitively", () => {
    const db = filterFixture();
    const ids = (search: string) =>
      listSpineTable(db, tableQ({ search })).rows.map((row) => row.id);

    expect(ids("ACME")).toEqual([41]); // company name, any case
    expect(ids("77")).toEqual([41]); // company id
    expect(ids("13265")).toEqual([43]); // correlation key
    expect(ids("waiting on customer")).toEqual([41]); // status label
    expect(ids("waiting_customer")).toEqual([41]); // raw status
    expect(ids("policy delivery")).toEqual([41, 43]); // type label
    expect(ids("waiting on the insured")).toEqual([41]); // latest summary
    expect(ids("deterministic")).toEqual([41, 43]); // origin + key
    expect(ids("goal 42")).toEqual([42]); // goal
    expect(ids("no such text")).toEqual([]);
  });

  it("treats LIKE wildcards in operator text as literals", () => {
    const db = filterFixture();
    const ids = (search: string) =>
      listSpineTable(db, tableQ({ search })).rows.map((row) => row.id);
    expect(ids("100%")).toEqual([43]);
    expect(ids("100_")).toEqual([]);
  });
});

describe("queue filtering", () => {
  function queueFixture(): Db {
    const db = freshDb();
    insertAgent(db, {
      id: "501",
      name: "Jane Doe",
      email: "jane.doe@harperinsure.com",
    });
    insertIssue(db, { id: 1, updatedAt: "2026-08-10T04:00:00.000Z" });
    insertTask(db, { id: 10, issueId: 1, ownerKind: "human", status: "todo", assignee: "501" });
    insertIssue(db, { id: 2, updatedAt: "2026-08-10T03:00:00.000Z" });
    insertTask(db, { id: 11, issueId: 2, ownerKind: "agent", status: "in_progress" });
    insertIssue(db, { id: 3, updatedAt: "2026-08-10T02:00:00.000Z" });
    insertTask(db, { id: 12, issueId: 3, ownerKind: "human", status: "done", assignee: "Bob Smith" });
    insertIssue(db, { id: 4, updatedAt: "2026-08-10T01:00:00.000Z" });
    insertTask(db, { id: 13, issueId: 4, ownerKind: "human", status: "waiting", assignee: "Bob Smith" });
    return db;
  }

  it("cuts by owner kind over OPEN work only", () => {
    const db = queueFixture();
    const ids = (queue: string) =>
      listSpineTable(db, tableQ({ queue })).rows.map((row) => row.id);
    expect(ids("all")).toEqual([1, 2, 3, 4]);
    expect(ids("human")).toEqual([1, 4]); // issue 3's human task is done
    expect(ids("ai")).toEqual([2]);
    expect(ids("human+ai")).toEqual([1, 2, 4]);
  });

  it("resolves id-shaped assignees through the directory for mine", () => {
    const db = queueFixture();
    const mine = (viewer: { name: string | null; email: string | null }) =>
      listSpineTable(db, tableQ({ queue: "mine", viewer })).rows.map(
        (row) => row.id,
      );
    expect(mine({ name: "Jane Doe", email: "other@x.com" })).toEqual([1]);
    expect(mine({ name: "Nobody", email: "jane.doe@harperinsure.com" })).toEqual([1]);
    expect(mine({ name: "Bob Smith", email: null })).toEqual([4]);
    expect(mine({ name: "Nobody", email: null })).toEqual([]);
  });

  it("matches person: on the exact token law", () => {
    const db = queueFixture();
    const ids = (queue: string) =>
      listSpineTable(db, tableQ({ queue })).rows.map((row) => row.id);
    expect(ids("person:jane doe")).toEqual([1]);
    expect(ids("person:jane")).toEqual([]);
    expect(ids("person:bob smith")).toEqual([4]);
  });

  it("carries match tokens and display names per the directory law", () => {
    const db = queueFixture();
    const rows = listSpineTable(db, tableQ()).rows;
    const issue1 = rows.find((row) => row.id === 1)!;
    expect(issue1.openHumanAssignees).toEqual([
      "Jane Doe",
      "jane.doe@harperinsure.com",
    ]);
    expect(issue1.openHumanAssigneeNames).toEqual(["Jane Doe"]);
    const issue4 = rows.find((row) => row.id === 4)!;
    expect(issue4.openHumanAssignees).toEqual(["Bob Smith"]);
    expect(issue4.openHumanAssigneeNames).toEqual(["Bob Smith"]);
  });
});

describe("deterministic sorts", () => {
  function sortFixture(): Db {
    const db = freshDb();
    insertIssue(db, { id: 5, priority: "P2", updatedAt: "2026-08-10T02:00:00.000Z" });
    insertIssue(db, { id: 6, priority: "P0", updatedAt: "2026-08-10T01:00:00.000Z" });
    insertIssue(db, { id: 7, priority: "P0", updatedAt: "2026-08-10T02:00:00.000Z" });
    insertIssue(db, { id: 8, priority: "P1", updatedAt: "2026-08-10T02:00:00.000Z" });
    return db;
  }

  it("orders recency by updated_at DESC with id DESC breaking ties", () => {
    const db = sortFixture();
    const rows = listSpineTable(db, tableQ({ sort: "recency" })).rows;
    expect(rows.map((row) => row.id)).toEqual([8, 7, 5, 6]);
  });

  it("orders priority lexicographically, then updated_at DESC, then id DESC", () => {
    const db = sortFixture();
    const rows = listSpineTable(db, tableQ({ sort: "priority" })).rows;
    expect(rows.map((row) => row.id)).toEqual([7, 6, 8, 5]);
  });
});

describe("table face", () => {
  it("shares one eligible set with the board", () => {
    const db = freshDb();
    for (let id = 1; id <= 12; id += 1) {
      insertIssue(db, {
        id,
        status: id % 3 === 0 ? "waiting_customer" : "open",
        priority: id % 2 === 0 ? "P1" : "P2",
        updatedAt: `2026-08-10T0${(id % 9) + 1}:00:00.000Z`,
      });
    }
    const filters: Partial<SpineListQuery> = { priority: "P1" };
    const board = listSpineBoard(db, boardQ(filters));
    const table = listSpineTable(db, tableQ(filters, 1, 100));
    const boardIds = board.columns
      .flatMap((column) => column.rows.map((row) => row.id))
      .sort((a, b) => a - b);
    const tableIds = table.rows.map((row) => row.id).sort((a, b) => a - b);
    expect(boardIds).toEqual(tableIds);
    expect(board.filteredTotal).toBe(table.filteredTotal);
    expect(board.mirrorTotal).toBe(table.mirrorTotal);
  });

  it("pages deterministically and clamps out-of-range pages", () => {
    const db = freshDb();
    for (let id = 1; id <= 25; id += 1) {
      insertIssue(db, { id, updatedAt: "2026-08-10T00:00:00.000Z" });
    }
    const pageOne = listSpineTable(db, tableQ({}, 1, 10));
    expect(pageOne.pageCount).toBe(3);
    expect(pageOne.rows.map((row) => row.id)).toEqual([
      25, 24, 23, 22, 21, 20, 19, 18, 17, 16,
    ]);
    const lastPage = listSpineTable(db, tableQ({}, 999, 10));
    expect(lastPage.page).toBe(3);
    expect(lastPage.rows).toHaveLength(5);
    const clampedLow = listSpineTable(db, tableQ({}, 0, 10));
    expect(clampedLow.page).toBe(1);
    // Pages tile the eligible set exactly once.
    const union = [1, 2, 3].flatMap(
      (page) => listSpineTable(db, tableQ({}, page, 10)).rows.map((r) => r.id),
    );
    expect(new Set(union).size).toBe(25);
  });
});

describe("summary", () => {
  it("counts issues by status, tasks by the closed-status law, events from meta", () => {
    const db = freshDb();
    insertIssue(db, { id: 1, status: "open" });
    insertIssue(db, { id: 2, status: "open" });
    insertIssue(db, { id: 3, status: "resolved" });
    insertTask(db, { id: 10, issueId: 1, ownerKind: "agent", status: "todo" });
    insertTask(db, { id: 11, issueId: 1, ownerKind: "agent", status: "done" });
    insertTask(db, { id: 12, issueId: 2, ownerKind: "human", status: "waiting" });
    insertTask(db, { id: 13, issueId: 2, ownerKind: "human", status: "cancelled" });
    insertTask(db, { id: 14, issueId: 2, ownerKind: "human", status: "in_progress" });
    // Closure-proposed law on the summary: the signal counts only while the
    // issue is non-terminal (the overlay never outranks resolved/cancelled).
    insertStats(db, { issueId: 1, closureProposed: 1 });
    insertStats(db, { issueId: 3, closureProposed: 1 });
    setMeta(db, SPINE_META_EVENTS_TOTAL, "160042");
    setMeta(db, SPINE_META_EVENTS_SUPPRESSIONS, "33882");

    const summary = getSpineSummary(db);
    expect(summary.issuesByStatus).toEqual([
      { status: "open", n: 2 },
      { status: "resolved", n: 1 },
    ]);
    expect(summary.issuesTotal).toBe(3);
    expect(summary.closureProposedOpen).toBe(1);
    expect(summary.agentTasks).toEqual({ open: 1, total: 2 });
    expect(summary.humanTasks).toEqual({ open: 2, total: 3 });
    expect(summary.events).toEqual({ total: 160042, suppressions: 33882 });
  });
});

describe("issue detail", () => {
  function detailFixture(): Db {
    const db = freshDb();
    insertAccount(db, "co-77");
    insertAgent(db, {
      id: "501",
      name: "Jane Doe",
      email: "jane.doe@harperinsure.com",
    });
    insertIssue(db, {
      id: 9,
      companyId: 77,
      companyName: "Acme Trucking LLC",
      status: "waiting_customer",
      lastCommunicationSummary: "Emailed the insured Tuesday.",
      resolutionSummary: null,
      correlationKey: "spine-prod-20260731:z",
    });
    insertStats(db, {
      issueId: 9,
      eventCount: 5,
      lastEventAt: "2026-08-09T12:00:00.000Z",
      hasDraft: 1,
      closureProposed: 0,
    });
    insertTask(db, {
      id: 21,
      issueId: 9,
      ownerKind: "human",
      status: "todo",
      assignee: "501",
      createdAt: "2026-08-02T00:00:00.000Z",
    });
    insertTask(db, {
      id: 22,
      issueId: 9,
      ownerKind: "agent",
      status: "done",
      createdAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T05:00:00.000Z",
    });
    insertTask(db, {
      id: 23,
      issueId: 9,
      ownerKind: "human",
      status: "done",
      assignee: "Bob Smith",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    insertLink(db, { id: 31, taskId: 21, createdAt: "2026-08-04T00:00:00.000Z" });
    insertLink(db, { id: 30, taskId: 22, createdAt: "2026-08-03T00:00:00.000Z" });
    // Another issue's rows must never leak into this detail.
    insertIssue(db, { id: 10 });
    insertTask(db, { id: 24, issueId: 10, ownerKind: "human", status: "todo" });
    return db;
  }

  it("returns null for invalid or missing ids without throwing", () => {
    const db = detailFixture();
    expect(getSpineIssueDetail(db, 0)).toBeNull();
    expect(getSpineIssueDetail(db, -3)).toBeNull();
    expect(getSpineIssueDetail(db, 1.5)).toBeNull();
    expect(getSpineIssueDetail(db, 999)).toBeNull();
  });

  it("derives aggregates from the detail's own rows plus stats", () => {
    const db = detailFixture();
    const detail = getSpineIssueDetail(db, 9)!;
    expect(detail.tasks.map((task) => task.id)).toEqual([22, 21, 23]);
    expect(detail.taskLinks.map((link) => link.id)).toEqual([30, 31]);
    expect(detail.taskLinks[0].taskTitle).toBe("Task 22");

    expect(detail.issue.humanTotal).toBe(2);
    expect(detail.issue.humanOpen).toBe(1);
    expect(detail.issue.agentTotal).toBe(1);
    expect(detail.issue.agentOpen).toBe(0);
    expect(detail.issue.eventCount).toBe(5);
    expect(detail.issue.hasDraft).toBe(true);
    expect(detail.issue.closureProposed).toBe(false);
    expect(detail.issue.lastCommunicationSummary).toBe(
      "Emailed the insured Tuesday.",
    );
    expect(detail.issue.resolutionSummary).toBeNull();
    expect(detail.issue.accountId).toBe("co-77");
    expect(detail.issue.wave).toBe("0731");
    // Only OPEN human assignees carry tokens (task 23 is done).
    expect(detail.issue.openHumanAssignees).toEqual([
      "Jane Doe",
      "jane.doe@harperinsure.com",
    ]);
    expect(detail.issue.openHumanAssigneeNames).toEqual(["Jane Doe"]);
    // Task cells resolve labels through the directory, raw when unresolved.
    expect(detail.tasks.find((t) => t.id === 21)!.assigneeLabel).toBe("Jane Doe");
    expect(detail.tasks.find((t) => t.id === 23)!.assigneeLabel).toBe("Bob Smith");
  });

  it("agrees with the list face on the same issue", () => {
    const db = detailFixture();
    const detail = getSpineIssueDetail(db, 9)!;
    const card = listSpineTable(db, tableQ())
      .rows.find((row) => row.id === 9)!;
    expect(detail.issue.humanOpen).toBe(card.humanOpen);
    expect(detail.issue.agentOpen).toBe(card.agentOpen);
    expect(detail.issue.eventCount).toBe(card.eventCount);
    expect(detail.issue.column).toBe(card.column);
    expect(detail.issue.openHumanAssignees).toEqual(card.openHumanAssignees);
  });
});

describe("account linking", () => {
  it("mints co- ids only for companies present in the book", () => {
    const db = freshDb();
    insertAccount(db, "co-77");
    insertIssue(db, { id: 1, companyId: 77, companyName: "Acme Trucking LLC" });
    insertIssue(db, { id: 2, companyId: 88, companyName: "Not In Book Inc" });
    insertIssue(db, { id: 3, companyId: null });
    const rows = listSpineTable(db, tableQ()).rows;
    expect(rows.find((row) => row.id === 1)!.accountId).toBe("co-77");
    expect(rows.find((row) => row.id === 2)!.accountId).toBeNull();
    expect(rows.find((row) => row.id === 3)!.accountId).toBeNull();
  });
});

describe("filter options", () => {
  it("derives whole-mirror distincts and most-loaded-first people", () => {
    const db = freshDb();
    insertAgent(db, {
      id: "501",
      name: "Jane Doe",
      email: "jane.doe@harperinsure.com",
    });
    insertIssue(db, {
      id: 1,
      priority: "P1",
      issueType: "cancellation",
      correlationKey: "spine-prod-20260731:a",
    });
    insertIssue(db, {
      id: 2,
      priority: "P0",
      issueType: "policy_delivery",
      correlationKey: "spine-prod-20260812:b",
    });
    insertIssue(db, {
      id: 3,
      priority: "P1",
      issueType: "policy_delivery",
      correlationKey: "deterministic:iq_coi_send:order:13265",
    });
    // Jane holds open work on issues 1 and 2 (two tasks on issue 1 still
    // count that issue once); Bob holds issue 3 only.
    insertTask(db, { id: 10, issueId: 1, status: "todo", assignee: "501" });
    insertTask(db, { id: 11, issueId: 1, status: "waiting", assignee: "501" });
    insertTask(db, { id: 12, issueId: 2, status: "in_progress", assignee: "501" });
    insertTask(db, { id: 13, issueId: 3, status: "todo", assignee: "Bob Smith" });
    // Closed and agent-owned work never feeds the picker.
    insertTask(db, { id: 14, issueId: 3, status: "done", assignee: "Carol Woo" });
    insertTask(db, { id: 15, issueId: 3, ownerKind: "agent", status: "todo", assignee: "502" });

    const options = getSpineFilterOptions(db);
    expect(options.priorities).toEqual(["P0", "P1"]);
    expect(options.issueTypes).toEqual(["cancellation", "policy_delivery"]);
    expect(options.waves).toEqual(["0731", "0812"]);
    expect(options.people).toEqual([
      { label: "Jane Doe", n: 2 },
      { label: "Bob Smith", n: 1 },
    ]);
  });
});

describe("pre-sync empty mirror", () => {
  it("returns empty results everywhere, never throwing", () => {
    const db = freshDb();
    const board = listSpineBoard(db, boardQ());
    expect(board.filteredTotal).toBe(0);
    expect(board.mirrorTotal).toBe(0);
    expect(board.columns.map((column) => column.id)).toEqual([
      "open",
      "waiting_customer",
      "waiting_third_party",
      "closure-proposed",
      "closed",
    ]);
    for (const column of board.columns) {
      expect(column.total).toBe(0);
      expect(column.rows).toEqual([]);
    }

    const table = listSpineTable(db, tableQ());
    expect(table).toEqual({
      rows: [],
      filteredTotal: 0,
      mirrorTotal: 0,
      page: 1,
      pageCount: 1,
      pageSize: 100,
    });

    const summary = getSpineSummary(db);
    expect(summary.issuesByStatus).toEqual([]);
    expect(summary.issuesTotal).toBe(0);
    expect(summary.closureProposedOpen).toBe(0);
    expect(summary.agentTasks).toEqual({ open: 0, total: 0 });
    expect(summary.humanTasks).toEqual({ open: 0, total: 0 });
    expect(summary.events).toEqual({ total: 0, suppressions: 0 });

    expect(getSpineFilterOptions(db)).toEqual({
      priorities: [],
      issueTypes: [],
      waves: [],
      people: [],
    });
    expect(getSpineIssueDetail(db, 1)).toBeNull();
  });
});
