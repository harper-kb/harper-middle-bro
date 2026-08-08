import "server-only";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  invalidatePreparedForAccount,
  migrateCertLedger,
} from "./cert-ledger";
import { getIntelligenceDb } from "./policy-intelligence";

/**
 * Red alerts — desk-wide stand-down orders.
 *
 * The defining case: the desk sent a No Loss letter (a signed statement that
 * no losses occurred during a lapse) and someone afterward acknowledged the
 * account has claims. That is a misrepresentation exposure: the letter and
 * the acknowledgment cannot both be true, and any further push — binding,
 * reinstatement, re-sending the letter, fast-path issuance — makes it worse.
 *
 * A red alert is loud on purpose. It shows on every page for every operator
 * until a manager resolves it with a written note, and while it is active
 * the blanket fast path and operator auto-send refuse the account outright.
 */

export type RedAlertKind = "no_loss_claims_conflict";

export interface RedAlert {
  id: string;
  accountId: string;
  accountName: string;
  kind: RedAlertKind;
  /** The No Loss letter on record — what was sent, when, to whom */
  noLossRef: string;
  /** The contradiction — who acknowledged claims, where, and when */
  claimsRef: string;
  note: string | null;
  raisedBy: string;
  raisedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

/** The standing directive shown wherever an active alert surfaces. */
export const RED_ALERT_DIRECTIVE =
  "Stand down on this account. Do not bind, do not push reinstatement, do not re-send or reference the No Loss letter, and route every request to the manager until the conflict is resolved on record.";

let migrated = false;

function db(): Database.Database {
  const handle = getIntelligenceDb();
  if (!migrated) {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS desk_red_alerts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        kind TEXT NOT NULL DEFAULT 'no_loss_claims_conflict',
        no_loss_ref TEXT NOT NULL,
        claims_ref TEXT NOT NULL,
        note TEXT,
        raised_by TEXT NOT NULL,
        raised_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT,
        resolution_note TEXT
      );
      CREATE INDEX IF NOT EXISTS red_alerts_account ON desk_red_alerts(account_id);
    `);
    seedDemoAlert(handle);
    migrated = true;
  }
  return handle;
}

/**
 * One seeded conflict so the desk can see the machinery working end to end.
 * Fixed id + INSERT OR IGNORE: resolving it stays resolved across restarts.
 */
function seedDemoAlert(handle: Database.Database) {
  const account = handle
    .prepare(`SELECT id, name FROM accounts WHERE id = 'acct-greenleaf'`)
    .get() as { id: string; name: string } | undefined;
  if (!account) return;
  const policy = handle
    .prepare(
      `SELECT policy_number FROM policies WHERE account_id = ? ORDER BY id LIMIT 1`,
    )
    .get(account.id) as { policy_number: string } | undefined;
  handle
    .prepare(
      `INSERT OR IGNORE INTO desk_red_alerts (
        id, account_id, kind, no_loss_ref, claims_ref, note, raised_by, raised_at
      ) VALUES (?, ?, 'no_loss_claims_conflict', ?, ?, ?, ?, ?)`,
    )
    .run(
      "ra-seed-greenleaf",
      account.id,
      `No Loss letter sent 2026-08-04 to the carrier for lapse reinstatement${
        policy ? ` on ${policy.policy_number}` : ""
      }.`,
      "Sales representative acknowledged on a 2026-08-06 call that the insured has open claims from the lapse period.",
      "Sandbox demonstration record — the seeded conflict every operator should see on sign-in.",
      "Desk Seed",
      "2026-08-06T18:20:00.000Z",
    );
}

function mapAlert(row: Record<string, unknown>): RedAlert {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    accountName: (row.account_name as string) ?? (row.account_id as string),
    kind: row.kind as RedAlertKind,
    noLossRef: row.no_loss_ref as string,
    claimsRef: row.claims_ref as string,
    note: (row.note as string | null) ?? null,
    raisedBy: row.raised_by as string,
    raisedAt: row.raised_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    resolvedBy: (row.resolved_by as string | null) ?? null,
    resolutionNote: (row.resolution_note as string | null) ?? null,
  };
}

const SELECT_JOINED = `
  SELECT r.*, a.name AS account_name
  FROM desk_red_alerts r
  JOIN accounts a ON a.id = r.account_id
`;

export function listActiveRedAlerts(): RedAlert[] {
  return (
    db()
      .prepare(
        `${SELECT_JOINED} WHERE r.resolved_at IS NULL ORDER BY r.raised_at DESC, r.id`,
      )
      .all() as Record<string, unknown>[]
  ).map(mapAlert);
}

export function getActiveRedAlertForAccount(
  accountId: string,
): RedAlert | null {
  const row = db()
    .prepare(
      `${SELECT_JOINED} WHERE r.account_id = ? AND r.resolved_at IS NULL
       ORDER BY r.raised_at DESC LIMIT 1`,
    )
    .get(accountId) as Record<string, unknown> | undefined;
  return row ? mapAlert(row) : null;
}

/** Full history for an account — active first, then resolved. */
export function listRedAlertsForAccount(accountId: string): RedAlert[] {
  return (
    db()
      .prepare(
        `${SELECT_JOINED} WHERE r.account_id = ?
         ORDER BY (r.resolved_at IS NULL) DESC, r.raised_at DESC, r.id`,
      )
      .all(accountId) as Record<string, unknown>[]
  ).map(mapAlert);
}

export function raiseRedAlert(input: {
  accountId: string;
  noLossRef: string;
  claimsRef: string;
  note: string | null;
  raisedBy: string;
}): RedAlert {
  const id = `ra-${randomUUID().slice(0, 8)}`;
  db()
    .prepare(
      `INSERT INTO desk_red_alerts (
        id, account_id, kind, no_loss_ref, claims_ref, note, raised_by, raised_at
      ) VALUES (?, ?, 'no_loss_claims_conflict', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.accountId,
      input.noLossRef,
      input.claimsRef,
      input.note,
      input.raisedBy,
      new Date().toISOString(),
    );
  // A red alert is an upstream fact change: any certificate prepared before
  // it cannot ride out the stand-down. Kill pending prepared artifacts now;
  // the send-moment registry check blocks anything else.
  const handle = db();
  migrateCertLedger(handle);
  invalidatePreparedForAccount(handle, input.accountId, "Red Alert Raised");
  const row = db()
    .prepare(`${SELECT_JOINED} WHERE r.id = ?`)
    .get(id) as Record<string, unknown>;
  return mapAlert(row);
}

export function resolveRedAlert(
  id: string,
  resolvedBy: string,
  resolutionNote: string,
): void {
  db()
    .prepare(
      `UPDATE desk_red_alerts
       SET resolved_at = ?, resolved_by = ?, resolution_note = ?
       WHERE id = ? AND resolved_at IS NULL`,
    )
    .run(new Date().toISOString(), resolvedBy, resolutionNote, id);
}
