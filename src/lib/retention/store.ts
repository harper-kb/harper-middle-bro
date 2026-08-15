/**
 * Retention ledger persistence.
 *
 * Two tables carry the whole save mechanism: `at_risk_windows` (a policy that
 * was leaving, and the interval it could still be kept in) and
 * `retention_events` (everything recorded inside that interval, with the
 * evidence pointer that makes it payable).
 *
 * Writes are idempotent on the derived id so the ledger can be re-derived from
 * `lifecycle.signals` on every sync without duplicating windows. Re-derivation
 * never overwrites a valuation or an operator's close note.
 */

import type Database from "better-sqlite3";
import { migrateOwnershipTables } from "./ownership-store";
import { migrateDefectTables } from "./defect-store";
import type { DerivedLedger } from "./signals";
import type {
  AtRiskOutcome,
  AtRiskTriggerKind,
  AtRiskWindow,
  BillMode,
  DifficultyTier,
  RetentionActorKind,
  RetentionEvent,
  RetentionEventKind,
  RetentionSourceKind,
} from "./types";
import type { CancelReasonCode } from "@/lib/lanes/pending-cancels";
import type { ServiceLaneId } from "@/lib/types";

export function migrateRetentionTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS at_risk_windows (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      policy_id TEXT,
      issue_id TEXT,
      lane TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      bill_mode TEXT NOT NULL DEFAULT 'unknown',
      opened_at TEXT NOT NULL,
      effective_at TEXT,
      closed_at TEXT,
      outcome TEXT NOT NULL DEFAULT 'open',
      outcome_note TEXT,
      premium_cents INTEGER,
      commission_rate_bps INTEGER,
      commission_at_risk_cents INTEGER,
      replacement_commission_cents INTEGER,
      difficulty_tier TEXT NOT NULL DEFAULT 'standard',
      owner_agent_id TEXT,
      source_kind TEXT NOT NULL,
      source_ref TEXT
    );
    CREATE INDEX IF NOT EXISTS at_risk_windows_account
      ON at_risk_windows(account_id);
    CREATE INDEX IF NOT EXISTS at_risk_windows_outcome
      ON at_risk_windows(outcome, opened_at);

    CREATE TABLE IF NOT EXISTS retention_events (
      id TEXT PRIMARY KEY,
      window_id TEXT NOT NULL REFERENCES at_risk_windows(id),
      kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_agent_id TEXT,
      detail TEXT NOT NULL DEFAULT '',
      evidence_ref TEXT
    );
    CREATE INDEX IF NOT EXISTS retention_events_window
      ON retention_events(window_id, occurred_at);
    CREATE INDEX IF NOT EXISTS retention_events_actor
      ON retention_events(actor_agent_id);
  `);
  migrateOwnershipTables(db);
  migrateDefectTables(db);
}

function mapWindow(row: Record<string, unknown>): AtRiskWindow {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    policyId: (row.policy_id as string) ?? null,
    issueId: (row.issue_id as string) ?? null,
    lane: row.lane as ServiceLaneId,
    trigger: row.trigger_kind as AtRiskTriggerKind,
    reason: row.reason as CancelReasonCode,
    billMode: row.bill_mode as BillMode,
    openedAt: row.opened_at as string,
    effectiveAt: (row.effective_at as string) ?? null,
    closedAt: (row.closed_at as string) ?? null,
    outcome: row.outcome as AtRiskOutcome,
    outcomeNote: (row.outcome_note as string) ?? null,
    premiumCents: (row.premium_cents as number) ?? null,
    commissionRateBps: (row.commission_rate_bps as number) ?? null,
    commissionAtRiskCents: (row.commission_at_risk_cents as number) ?? null,
    replacementCommissionCents:
      (row.replacement_commission_cents as number) ?? null,
    difficultyTier: row.difficulty_tier as DifficultyTier,
    ownerAgentId: (row.owner_agent_id as string) ?? null,
    sourceKind: row.source_kind as RetentionSourceKind,
    sourceRef: (row.source_ref as string) ?? null,
  };
}

function mapEvent(row: Record<string, unknown>): RetentionEvent {
  return {
    id: row.id as string,
    windowId: row.window_id as string,
    kind: row.kind as RetentionEventKind,
    occurredAt: row.occurred_at as string,
    actor: row.actor as string,
    actorKind: row.actor_kind as RetentionActorKind,
    actorAgentId: (row.actor_agent_id as string) ?? null,
    detail: (row.detail as string) ?? "",
    evidenceRef: (row.evidence_ref as string) ?? null,
  };
}

export function upsertAtRiskWindow(
  db: Database.Database,
  w: AtRiskWindow,
): void {
  db.prepare(
    `INSERT INTO at_risk_windows (
       id, account_id, policy_id, issue_id, lane, trigger_kind, reason,
       bill_mode, opened_at, effective_at, closed_at, outcome, outcome_note,
       premium_cents, commission_rate_bps, commission_at_risk_cents,
       replacement_commission_cents, difficulty_tier, owner_agent_id,
       source_kind, source_ref
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       issue_id = COALESCE(excluded.issue_id, at_risk_windows.issue_id),
       effective_at = COALESCE(excluded.effective_at, at_risk_windows.effective_at),
       closed_at = COALESCE(excluded.closed_at, at_risk_windows.closed_at),
       outcome = CASE WHEN excluded.outcome = 'open'
                      THEN at_risk_windows.outcome ELSE excluded.outcome END,
       outcome_note = COALESCE(at_risk_windows.outcome_note, excluded.outcome_note),
       difficulty_tier = excluded.difficulty_tier,
       bill_mode = excluded.bill_mode`,
  ).run(
    w.id,
    w.accountId,
    w.policyId,
    w.issueId,
    w.lane,
    w.trigger,
    w.reason,
    w.billMode,
    w.openedAt,
    w.effectiveAt,
    w.closedAt,
    w.outcome,
    w.outcomeNote,
    w.premiumCents,
    w.commissionRateBps,
    w.commissionAtRiskCents,
    w.replacementCommissionCents,
    w.difficultyTier,
    w.ownerAgentId,
    w.sourceKind,
    w.sourceRef,
  );
}

export function insertRetentionEvent(
  db: Database.Database,
  e: RetentionEvent,
): void {
  db.prepare(
    `INSERT INTO retention_events (
       id, window_id, kind, occurred_at, actor, actor_kind, actor_agent_id,
       detail, evidence_ref
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    e.id,
    e.windowId,
    e.kind,
    e.occurredAt,
    e.actor,
    e.actorKind,
    e.actorAgentId,
    e.detail,
    e.evidenceRef,
  );
}

export type LedgerSyncResult = {
  windowsWritten: number;
  eventsWritten: number;
  unmatchedCloses: number;
};

/** Persist a derived ledger. Safe to run repeatedly against the same signals. */
export function syncDerivedLedger(
  db: Database.Database,
  derived: DerivedLedger,
): LedgerSyncResult {
  const write = db.transaction(() => {
    for (const w of derived.windows) upsertAtRiskWindow(db, w);
    for (const e of derived.events) insertRetentionEvent(db, e);
  });
  write();
  return {
    windowsWritten: derived.windows.length,
    eventsWritten: derived.events.length,
    unmatchedCloses: derived.unmatchedCloses.length,
  };
}

export function listAtRiskWindows(
  db: Database.Database,
  filter: {
    accountId?: string;
    outcome?: AtRiskOutcome;
    openedFrom?: string;
    openedTo?: string;
  } = {},
): AtRiskWindow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.accountId) {
    where.push("account_id = ?");
    args.push(filter.accountId);
  }
  if (filter.outcome) {
    where.push("outcome = ?");
    args.push(filter.outcome);
  }
  if (filter.openedFrom) {
    where.push("opened_at >= ?");
    args.push(filter.openedFrom);
  }
  if (filter.openedTo) {
    where.push("opened_at <= ?");
    args.push(filter.openedTo);
  }
  const sql = `SELECT * FROM at_risk_windows${
    where.length ? ` WHERE ${where.join(" AND ")}` : ""
  } ORDER BY opened_at DESC`;
  return (db.prepare(sql).all(...args) as Record<string, unknown>[]).map(mapWindow);
}

export function listRetentionEvents(
  db: Database.Database,
  windowId?: string,
): RetentionEvent[] {
  const rows = windowId
    ? (db
        .prepare(
          `SELECT * FROM retention_events WHERE window_id = ? ORDER BY occurred_at ASC`,
        )
        .all(windowId) as Record<string, unknown>[])
    : (db
        .prepare(`SELECT * FROM retention_events ORDER BY occurred_at ASC`)
        .all() as Record<string, unknown>[]);
  return rows.map(mapEvent);
}

/** Apply a valuation to a window without disturbing its lifecycle columns. */
export function setWindowValuation(
  db: Database.Database,
  windowId: string,
  valuation: {
    premiumCents: number | null;
    commissionRateBps: number | null;
    commissionAtRiskCents: number | null;
    replacementCommissionCents?: number | null;
  },
): void {
  db.prepare(
    `UPDATE at_risk_windows
        SET premium_cents = ?,
            commission_rate_bps = ?,
            commission_at_risk_cents = ?,
            replacement_commission_cents = ?
      WHERE id = ?`,
  ).run(
    valuation.premiumCents,
    valuation.commissionRateBps,
    valuation.commissionAtRiskCents,
    valuation.replacementCommissionCents ?? null,
    windowId,
  );
}

export function setWindowOwner(
  db: Database.Database,
  windowId: string,
  ownerAgentId: string | null,
): void {
  db.prepare(`UPDATE at_risk_windows SET owner_agent_id = ? WHERE id = ?`).run(
    ownerAgentId,
    windowId,
  );
}
