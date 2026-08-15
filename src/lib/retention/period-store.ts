/**
 * Period and dispute persistence.
 *
 * The shadow period only works if the numbers stop moving. Publishing freezes
 * the pod and person rows as they read at that moment and stores them with the
 * period, so an argument three weeks later is an argument about a fixed set of
 * figures rather than about whatever the board happens to say today. Without
 * that, "we already fixed it" ends every dispute and nothing is ever learned.
 *
 * Disputes are stored rather than tracked in a thread for the same reason the
 * defect ledger is a state machine: a dispute that can be closed without a
 * recorded resolution is a suggestion box.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  isSettled,
  periodReadiness,
  type DisputeState,
  type DisputeSubject,
  type PeriodState,
  type ReadinessCheck,
  type ScorecardDispute,
  type ScorecardPeriod,
} from "./period";
import type { MetricSource, PersonScorecard, PodScorecard } from "./scorecard";

export function migratePeriodTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scorecard_periods (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      from_at TEXT NOT NULL,
      to_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'shadow',
      pool_cents INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      -- The frozen board. Disputes argue with this, not with a live query.
      published_pods_json TEXT,
      published_people_json TEXT,
      attached_at TEXT,
      attached_by TEXT
    );

    CREATE TABLE IF NOT EXISTS scorecard_disputes (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES scorecard_periods(id),
      subject TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      raised_by TEXT NOT NULL,
      raised_at TEXT NOT NULL,
      claim TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      resolved_at TEXT,
      resolved_by TEXT,
      resolution_note TEXT,
      correction_applied INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS scorecard_disputes_period
      ON scorecard_disputes(period_id, state);
  `);
}

type PeriodRow = {
  id: string;
  label: string;
  from_at: string;
  to_at: string;
  state: string;
  pool_cents: number;
  published_at: string | null;
  published_pods_json: string | null;
  published_people_json: string | null;
  attached_at: string | null;
  attached_by: string | null;
};

function toPeriod(row: PeriodRow): ScorecardPeriod {
  return {
    id: row.id,
    label: row.label,
    from: row.from_at,
    to: row.to_at,
    state: row.state as PeriodState,
    poolCents: row.pool_cents,
    publishedAt: row.published_at,
  };
}

export function upsertPeriod(db: Database.Database, period: ScorecardPeriod): void {
  db.prepare(
    `INSERT INTO scorecard_periods (id, label, from_at, to_at, state, pool_cents, published_at)
     VALUES (@id, @label, @from_at, @to_at, @state, @pool_cents, @published_at)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       from_at = excluded.from_at,
       to_at = excluded.to_at,
       state = excluded.state,
       pool_cents = excluded.pool_cents`,
  ).run({
    id: period.id,
    label: period.label,
    from_at: period.from,
    to_at: period.to,
    state: period.state,
    pool_cents: period.poolCents,
    published_at: period.publishedAt,
  });
}

export function getPeriod(db: Database.Database, id: string): ScorecardPeriod | null {
  const row = db
    .prepare(`SELECT * FROM scorecard_periods WHERE id = ?`)
    .get(id) as PeriodRow | undefined;
  return row ? toPeriod(row) : null;
}

export function listPeriods(db: Database.Database): ScorecardPeriod[] {
  return (
    db
      .prepare(`SELECT * FROM scorecard_periods ORDER BY from_at DESC`)
      .all() as PeriodRow[]
  ).map(toPeriod);
}

export interface PublishedBoard {
  period: ScorecardPeriod;
  pods: PodScorecard[];
  people: PersonScorecard[];
}

/**
 * Freeze and publish. Republishing is allowed only while nothing has been
 * disputed yet — once someone has argued with a figure, replacing it silently
 * would erase the thing they argued with.
 */
export function publishPeriod(
  db: Database.Database,
  period: ScorecardPeriod,
  board: { pods: PodScorecard[]; people: PersonScorecard[] },
  publishedAt: string = new Date().toISOString(),
): ScorecardPeriod {
  upsertPeriod(db, period);
  const existing = getPeriod(db, period.id);
  if (existing?.publishedAt) {
    const disputes = listDisputes(db, period.id);
    if (disputes.length > 0) {
      throw new Error(
        `Period ${period.id} was published on ${existing.publishedAt} and already carries ${disputes.length} dispute(s) — settle them rather than republishing`,
      );
    }
  }
  db.prepare(
    `UPDATE scorecard_periods
        SET published_at = ?, published_pods_json = ?, published_people_json = ?
      WHERE id = ?`,
  ).run(
    publishedAt,
    JSON.stringify(board.pods),
    JSON.stringify(board.people),
    period.id,
  );
  return { ...period, publishedAt };
}

export function getPublishedBoard(
  db: Database.Database,
  periodId: string,
): PublishedBoard | null {
  const row = db
    .prepare(`SELECT * FROM scorecard_periods WHERE id = ?`)
    .get(periodId) as PeriodRow | undefined;
  if (!row || !row.published_at) return null;
  return {
    period: toPeriod(row),
    pods: JSON.parse(row.published_pods_json ?? "[]") as PodScorecard[],
    people: JSON.parse(row.published_people_json ?? "[]") as PersonScorecard[],
  };
}

// ——— Disputes ———

type DisputeRow = {
  id: string;
  period_id: string;
  subject: string;
  subject_id: string;
  raised_by: string;
  raised_at: string;
  claim: string;
  state: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  correction_applied: number;
};

function toDispute(row: DisputeRow): ScorecardDispute {
  return {
    id: row.id,
    periodId: row.period_id,
    subject: row.subject as DisputeSubject,
    subjectId: row.subject_id,
    raisedBy: row.raised_by,
    raisedAt: row.raised_at,
    claim: row.claim,
    state: row.state as DisputeState,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNote: row.resolution_note,
    correctionApplied: row.correction_applied === 1,
  };
}

export function raiseDispute(
  db: Database.Database,
  input: {
    periodId: string;
    subject: DisputeSubject;
    subjectId: string;
    raisedBy: string;
    claim: string;
    raisedAt?: string;
  },
): ScorecardDispute {
  const period = getPeriod(db, input.periodId);
  if (!period) throw new Error(`Unknown period ${input.periodId}`);
  if (!period.publishedAt) {
    throw new Error(
      `Period ${input.periodId} has not been published — there is nothing to dispute yet`,
    );
  }
  const dispute: ScorecardDispute = {
    id: `dsp-${randomUUID()}`,
    periodId: input.periodId,
    subject: input.subject,
    subjectId: input.subjectId,
    raisedBy: input.raisedBy,
    raisedAt: input.raisedAt ?? new Date().toISOString(),
    claim: input.claim,
    state: "open",
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    correctionApplied: false,
  };
  db.prepare(
    `INSERT INTO scorecard_disputes
       (id, period_id, subject, subject_id, raised_by, raised_at, claim, state)
     VALUES (@id, @periodId, @subject, @subjectId, @raisedBy, @raisedAt, @claim, 'open')`,
  ).run(dispute);
  return dispute;
}

/**
 * Settle a dispute. A resolution note is required on every terminal state,
 * including rejection — "no" without a reason is what teaches people to stop
 * raising them.
 */
export function settleDispute(
  db: Database.Database,
  input: {
    disputeId: string;
    state: Exclude<DisputeState, "open">;
    resolvedBy: string;
    resolutionNote: string;
    correctionApplied?: boolean;
    resolvedAt?: string;
  },
): ScorecardDispute {
  const row = db
    .prepare(`SELECT * FROM scorecard_disputes WHERE id = ?`)
    .get(input.disputeId) as DisputeRow | undefined;
  if (!row) throw new Error(`Unknown dispute ${input.disputeId}`);
  if (row.state !== "open") {
    throw new Error(`Dispute ${input.disputeId} is already ${row.state}`);
  }
  if (!input.resolutionNote.trim()) {
    throw new Error("A dispute cannot be settled without a resolution note");
  }
  db.prepare(
    `UPDATE scorecard_disputes
        SET state = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?, correction_applied = ?
      WHERE id = ?`,
  ).run(
    input.state,
    input.resolvedAt ?? new Date().toISOString(),
    input.resolvedBy,
    input.resolutionNote,
    input.correctionApplied ? 1 : 0,
    input.disputeId,
  );
  return toDispute({
    ...row,
    state: input.state,
    resolved_at: input.resolvedAt ?? new Date().toISOString(),
    resolved_by: input.resolvedBy,
    resolution_note: input.resolutionNote,
    correction_applied: input.correctionApplied ? 1 : 0,
  });
}

export function listDisputes(
  db: Database.Database,
  periodId?: string,
  state?: DisputeState,
): ScorecardDispute[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (periodId) {
    clauses.push("period_id = ?");
    params.push(periodId);
  }
  if (state) {
    clauses.push("state = ?");
    params.push(state);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return (
    db
      .prepare(`SELECT * FROM scorecard_disputes ${where} ORDER BY raised_at ASC`)
      .all(...params) as DisputeRow[]
  ).map(toDispute);
}

/**
 * Reconcile the period against everything that was raised against it, then
 * report whether pay may be attached. This is the whole shadow-period ritual
 * in one call, and it deliberately reads the *published* board rather than a
 * fresh one.
 */
export function reconcilePeriod(
  db: Database.Database,
  periodId: string,
  now: Date = new Date(),
): {
  period: ScorecardPeriod;
  readiness: ReadinessCheck;
  disputes: ScorecardDispute[];
  unsettled: ScorecardDispute[];
} {
  const published = getPublishedBoard(db, periodId);
  const period = published?.period ?? getPeriod(db, periodId);
  if (!period) throw new Error(`Unknown period ${periodId}`);
  const disputes = listDisputes(db, periodId);
  const metricSources: { key: string; source: MetricSource }[] = (
    published?.pods ?? []
  ).flatMap((p) => p.metrics.map((m) => ({ key: m.key as string, source: m.source })));

  return {
    period,
    readiness: periodReadiness(period, disputes, metricSources, now),
    disputes,
    unsettled: disputes.filter((d) => !isSettled(d)),
  };
}

export function markPeriodAttached(
  db: Database.Database,
  periodId: string,
  attachedBy: string,
  attachedAt: string = new Date().toISOString(),
): void {
  db.prepare(
    `UPDATE scorecard_periods
        SET state = 'attached', attached_at = ?, attached_by = ?
      WHERE id = ?`,
  ).run(attachedAt, attachedBy, periodId);
}
