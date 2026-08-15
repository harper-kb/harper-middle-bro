/**
 * Owner-of-record persistence.
 *
 * The history table is the point. Today `tickets.operator_id` is overwritten on
 * claim and the spine's assignee is current-state only, so credit can be taken
 * by whoever touched an account last. An append-only assignment log makes "who
 * owned this account on the day it nearly cancelled" an answerable question.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  checkOwnershipInvariants,
  type OwnerAssignment,
  type OwnershipChangeReason,
  type OwnershipViolation,
} from "./ownership";

export function migrateOwnershipTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_owner_history (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      owner_agent_id TEXT,
      owner_display_name TEXT,
      assigned_at TEXT NOT NULL,
      ended_at TEXT,
      reason TEXT NOT NULL,
      assigned_by TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS service_owner_history_account
      ON service_owner_history(account_id, assigned_at);
    -- One open assignment per account is the no-orphan rule's other half:
    -- ownership can be absent or single, never ambiguous.
    CREATE UNIQUE INDEX IF NOT EXISTS service_owner_history_current
      ON service_owner_history(account_id) WHERE ended_at IS NULL;
  `);
}

function mapAssignment(row: Record<string, unknown>): OwnerAssignment {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    ownerAgentId: (row.owner_agent_id as string) ?? null,
    ownerDisplayName: (row.owner_display_name as string) ?? null,
    assignedAt: row.assigned_at as string,
    endedAt: (row.ended_at as string) ?? null,
    reason: row.reason as OwnershipChangeReason,
    assignedBy: (row.assigned_by as string) ?? null,
    note: (row.note as string) ?? null,
  };
}

export function listOwnerHistory(
  db: Database.Database,
  accountId?: string,
): OwnerAssignment[] {
  const rows = accountId
    ? (db
        .prepare(
          `SELECT * FROM service_owner_history WHERE account_id = ?
           ORDER BY assigned_at ASC`,
        )
        .all(accountId) as Record<string, unknown>[])
    : (db
        .prepare(`SELECT * FROM service_owner_history ORDER BY assigned_at ASC`)
        .all() as Record<string, unknown>[]);
  return rows.map(mapAssignment);
}

export function getCurrentOwner(
  db: Database.Database,
  accountId: string,
): OwnerAssignment | null {
  const row = db
    .prepare(
      `SELECT * FROM service_owner_history
        WHERE account_id = ? AND ended_at IS NULL`,
    )
    .get(accountId) as Record<string, unknown> | undefined;
  return row ? mapAssignment(row) : null;
}

/**
 * Move ownership. Closes the open assignment and opens a new one in one
 * transaction, so the account is never briefly ownerless and never briefly
 * doubly owned.
 */
export function assignOwner(
  db: Database.Database,
  input: {
    accountId: string;
    ownerAgentId: string | null;
    ownerDisplayName: string | null;
    reason: OwnershipChangeReason;
    assignedBy?: string | null;
    note?: string | null;
    at?: string;
  },
): OwnerAssignment {
  const at = input.at ?? new Date().toISOString();
  const id = `own-${randomUUID()}`;
  const move = db.transaction(() => {
    db.prepare(
      `UPDATE service_owner_history SET ended_at = ?
        WHERE account_id = ? AND ended_at IS NULL`,
    ).run(at, input.accountId);
    db.prepare(
      `INSERT INTO service_owner_history (
         id, account_id, owner_agent_id, owner_display_name, assigned_at,
         ended_at, reason, assigned_by, note
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      id,
      input.accountId,
      input.ownerAgentId,
      input.ownerDisplayName,
      at,
      input.reason,
      input.assignedBy ?? null,
      input.note ?? null,
    );
  });
  move();
  return getCurrentOwner(db, input.accountId)!;
}

/**
 * Backfill from the existing `service_owner` field. The field is real and
 * already read by custody resolution; it has simply never had a history behind
 * it. Accounts whose owner is null are written as recorded orphans rather than
 * skipped, so the no-orphan report can see them.
 */
export function seedOwnershipFromServiceOwner(
  db: Database.Database,
  rows: {
    accountId: string;
    serviceOwnerAgentId: string | null;
    serviceOwnerName: string | null;
    since?: string;
  }[],
): { seeded: number; orphans: number } {
  let seeded = 0;
  let orphans = 0;
  const seed = db.transaction(() => {
    for (const row of rows) {
      if (getCurrentOwner(db, row.accountId)) continue;
      assignOwner(db, {
        accountId: row.accountId,
        ownerAgentId: row.serviceOwnerAgentId,
        ownerDisplayName: row.serviceOwnerName,
        reason: "initial_assignment",
        assignedBy: "backfill:service_owner",
        note: row.serviceOwnerAgentId
          ? null
          : "service_owner was null at backfill — recorded orphan",
        at: row.since,
      });
      seeded += 1;
      if (!row.serviceOwnerAgentId) orphans += 1;
    }
  });
  seed();
  return { seeded, orphans };
}

export function auditOwnership(db: Database.Database): OwnershipViolation[] {
  return checkOwnershipInvariants(listOwnerHistory(db));
}
