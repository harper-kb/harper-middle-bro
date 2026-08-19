import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { STATUS_LABELS, type SpineListQuery } from "@/lib/service-spine/domain";
import {
  getSpineSummary,
  listSpineBoard,
} from "@/lib/db/queries/service-spine";
import {
  SPINE_META_EVENTS_SUPPRESSIONS,
  SPINE_META_EVENTS_TOTAL,
} from "@/lib/db/service-spine-refresh";

/**
 * Mirror invariants against the real synced spine in
 * data/underwriter-desk.db (read-only). Self-skipping when the spine tables
 * are absent or empty — the same live-book pattern as
 * tests/accounts-carrier-live.test.ts. No live IDs are hardcoded.
 */

const DB_PATH = path.join(process.cwd(), "data", "underwriter-desk.db");

function spineIsSynced(): boolean {
  if (!fs.existsSync(DB_PATH)) return false;
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const hasTable = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'spine_issues'`,
      )
      .get();
    if (!hasTable) return false;
    const count = (
      db.prepare(`SELECT count(*) AS c FROM spine_issues`).get() as {
        c: number;
      }
    ).c;
    return count > 0;
  } finally {
    db.close();
  }
}

const withSpine = spineIsSynced() ? describe : describe.skip;

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

withSpine("service spine mirror invariants against the live book", () => {
  let db: InstanceType<typeof Database>;

  beforeAll(() => {
    db = new Database(DB_PATH, { readonly: true });
  });
  afterAll(() => {
    db?.close();
  });

  it("holds only real status strings, warning about unknown vocabulary", () => {
    const statuses = (
      db
        .prepare(`SELECT DISTINCT status FROM spine_issues`)
        .all() as Array<{ status: string }>
    ).map((row) => row.status);
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(typeof status).toBe("string");
      expect(status.trim()).not.toBe("");
    }
    const unknown = statuses.filter((status) => !(status in STATUS_LABELS));
    if (unknown.length > 0) {
      // Unknown statuses are legal (they become appended columns) — but the
      // desk should hear about new vocabulary. Count only, never row text.
      console.warn("service_spine_live_unknown_statuses", {
        count: unknown.length,
      });
    }
  });

  it("sums column buckets exactly to the filtered and mirror totals", () => {
    const board = listSpineBoard(db, { ...baseQuery, columnLimit: 50 });
    const bucketSum = board.columns.reduce(
      (sum, column) => sum + column.total,
      0,
    );
    expect(bucketSum).toBe(board.filteredTotal);
    expect(board.filteredTotal).toBe(board.mirrorTotal);
    expect(board.mirrorTotal).toBeGreaterThan(0);

    const seen = new Set<number>();
    for (const column of board.columns) {
      expect(column.rows.length).toBeLessThanOrEqual(50);
      expect(column.rows.length).toBeLessThanOrEqual(column.total);
      for (const row of column.rows) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
    }
  });

  it("carries whole-ledger event totals in spine_meta", () => {
    const readMeta = (key: string) =>
      db.prepare(`SELECT value FROM spine_meta WHERE key = ?`).get(key) as
        | { value: string }
        | undefined;
    const total = readMeta(SPINE_META_EVENTS_TOTAL);
    const suppressions = readMeta(SPINE_META_EVENTS_SUPPRESSIONS);
    expect(total).toBeDefined();
    expect(suppressions).toBeDefined();

    const summary = getSpineSummary(db);
    expect(summary.events.total).toBe(Number(total!.value));
    expect(summary.events.suppressions).toBe(Number(suppressions!.value));
    expect(summary.events.total).toBeGreaterThanOrEqual(
      summary.events.suppressions,
    );
    expect(summary.issuesTotal).toBeGreaterThan(0);
  });
});

if (!spineIsSynced()) {
  console.warn(
    "[service-spine-live-book.test] no synced spine mirror in data/underwriter-desk.db — skipped",
  );
}
