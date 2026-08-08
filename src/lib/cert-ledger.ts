import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CertCheckResult } from "./cert-checks";
import { PREPARED_CERT_TTL_HOURS } from "./cert-checks";
import type { FactSnapshot } from "./cert-snapshot";

/**
 * Certificate ledger — the persistent record behind the single send path.
 *
 * Every issuance attempt lands here (pass or block, with the full per-check
 * results), every override is an attributed row, every issued certificate
 * carries its frozen fact snapshot, and corrections form an explicit
 * supersede chain: the erroneous certificate, its replacement, and the
 * holder re-notification are all linked rows, never overwrites.
 *
 * Functions take an explicit database handle (same pattern as
 * policy-intelligence.ts) so the harness can run the whole ledger against an
 * in-memory database.
 */

export function migrateCertLedger(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cert_issue_attempts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      ticket_id TEXT,
      requirement_key TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      path TEXT NOT NULL,
      outcome TEXT NOT NULL,
      blocked_check_ids TEXT NOT NULL DEFAULT '[]',
      results_json TEXT NOT NULL,
      attempted_by TEXT NOT NULL,
      attempted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cert_check_overrides (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL REFERENCES cert_issue_attempts(id),
      check_id TEXT NOT NULL,
      operator TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cert_issued (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      ticket_id TEXT,
      requirement_key TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      holder_address TEXT NOT NULL DEFAULT '',
      form_key TEXT NOT NULL,
      policy_numbers_json TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      snapshot_json TEXT NOT NULL,
      snapshot_digest TEXT NOT NULL,
      attempt_id TEXT,
      issued_by TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      supersedes TEXT,
      superseded_by TEXT,
      revoked_at TEXT,
      revoked_by TEXT,
      revoke_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS cert_prepared (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      requirement_key TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      snapshot_digest TEXT NOT NULL,
      prepared_by TEXT NOT NULL,
      prepared_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      invalidated_at TEXT,
      invalidated_reason TEXT,
      consumed_by_cert_id TEXT
    );

    CREATE TABLE IF NOT EXISTS cert_holder_notices (
      id TEXT PRIMARY KEY,
      cert_id TEXT NOT NULL REFERENCES cert_issued(id),
      account_id TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS cert_attempts_account ON cert_issue_attempts(account_id);
    CREATE INDEX IF NOT EXISTS cert_issued_account ON cert_issued(account_id);
    CREATE INDEX IF NOT EXISTS cert_issued_requirement ON cert_issued(account_id, requirement_key);
    CREATE INDEX IF NOT EXISTS cert_prepared_account ON cert_prepared(account_id);
    CREATE INDEX IF NOT EXISTS cert_notices_account ON cert_holder_notices(account_id);
  `);
}

export type IssuedCertStatus = "active" | "superseded" | "revoked";

export interface IssuedCertRecord {
  id: string;
  accountId: string;
  ticketId: string | null;
  requirementKey: string;
  holderName: string;
  holderAddress: string;
  formKey: string;
  policyNumbers: string[];
  description: string;
  snapshot: FactSnapshot;
  snapshotDigest: string;
  attemptId: string | null;
  issuedBy: string;
  issuedAt: string;
  status: IssuedCertStatus;
  supersedes: string | null;
  supersededBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export interface IssueAttemptRecord {
  id: string;
  accountId: string;
  ticketId: string | null;
  requirementKey: string;
  holderName: string;
  path: string;
  outcome: "issued" | "blocked";
  blockedCheckIds: string[];
  results: CertCheckResult[];
  attemptedBy: string;
  attemptedAt: string;
}

export interface CheckOverrideRecord {
  id: string;
  attemptId: string;
  checkId: string;
  operator: string;
  reason: string;
  createdAt: string;
}

export interface PreparedCertRecord {
  id: string;
  accountId: string;
  requirementKey: string;
  holderName: string;
  snapshot: FactSnapshot;
  snapshotDigest: string;
  preparedBy: string;
  preparedAt: string;
  expiresAt: string;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
  consumedByCertId: string | null;
}

export type HolderNoticeKind = "issued" | "corrected" | "revoked";

export interface HolderNoticeRecord {
  id: string;
  certId: string;
  accountId: string;
  holderName: string;
  kind: HolderNoticeKind;
  body: string;
  createdAt: string;
}

/** Stable requirement identity: the ticket when one exists, else the holder. */
export function requirementKeyFor(input: {
  ticketId?: string | null;
  holderName: string;
}): string {
  if (input.ticketId) return `ticket:${input.ticketId}`;
  return `holder:${input.holderName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

function mapIssued(row: Record<string, unknown>): IssuedCertRecord {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    ticketId: (row.ticket_id as string | null) ?? null,
    requirementKey: row.requirement_key as string,
    holderName: row.holder_name as string,
    holderAddress: row.holder_address as string,
    formKey: row.form_key as string,
    policyNumbers: JSON.parse(row.policy_numbers_json as string) as string[],
    description: row.description as string,
    snapshot: JSON.parse(row.snapshot_json as string) as FactSnapshot,
    snapshotDigest: row.snapshot_digest as string,
    attemptId: (row.attempt_id as string | null) ?? null,
    issuedBy: row.issued_by as string,
    issuedAt: row.issued_at as string,
    status: row.status as IssuedCertStatus,
    supersedes: (row.supersedes as string | null) ?? null,
    supersededBy: (row.superseded_by as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    revokedBy: (row.revoked_by as string | null) ?? null,
    revokeReason: (row.revoke_reason as string | null) ?? null,
  };
}

function mapAttempt(row: Record<string, unknown>): IssueAttemptRecord {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    ticketId: (row.ticket_id as string | null) ?? null,
    requirementKey: row.requirement_key as string,
    holderName: row.holder_name as string,
    path: row.path as string,
    outcome: row.outcome as "issued" | "blocked",
    blockedCheckIds: JSON.parse(row.blocked_check_ids as string) as string[],
    results: JSON.parse(row.results_json as string) as CertCheckResult[],
    attemptedBy: row.attempted_by as string,
    attemptedAt: row.attempted_at as string,
  };
}

function mapPrepared(row: Record<string, unknown>): PreparedCertRecord {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    requirementKey: row.requirement_key as string,
    holderName: row.holder_name as string,
    snapshot: JSON.parse(row.snapshot_json as string) as FactSnapshot,
    snapshotDigest: row.snapshot_digest as string,
    preparedBy: row.prepared_by as string,
    preparedAt: row.prepared_at as string,
    expiresAt: row.expires_at as string,
    invalidatedAt: (row.invalidated_at as string | null) ?? null,
    invalidatedReason: (row.invalidated_reason as string | null) ?? null,
    consumedByCertId: (row.consumed_by_cert_id as string | null) ?? null,
  };
}

function mapNotice(row: Record<string, unknown>): HolderNoticeRecord {
  return {
    id: row.id as string,
    certId: row.cert_id as string,
    accountId: row.account_id as string,
    holderName: row.holder_name as string,
    kind: row.kind as HolderNoticeKind,
    body: row.body as string,
    createdAt: row.created_at as string,
  };
}

/* ————————————————— Attempts + overrides ————————————————— */

export function recordIssueAttempt(
  db: Database.Database,
  input: {
    accountId: string;
    ticketId: string | null;
    requirementKey: string;
    holderName: string;
    path: string;
    outcome: "issued" | "blocked";
    results: CertCheckResult[];
    attemptedBy: string;
    attemptedAt: string;
  },
): IssueAttemptRecord {
  const id = `att-${randomUUID().slice(0, 12)}`;
  const blocked = input.results
    .filter((r) => r.status === "fail" && r.severity === "blocking")
    .map((r) => r.id);
  db.prepare(
    `INSERT INTO cert_issue_attempts (
      id, account_id, ticket_id, requirement_key, holder_name, path, outcome,
      blocked_check_ids, results_json, attempted_by, attempted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.accountId,
    input.ticketId,
    input.requirementKey,
    input.holderName,
    input.path,
    input.outcome,
    JSON.stringify(blocked),
    JSON.stringify(input.results),
    input.attemptedBy,
    input.attemptedAt,
  );
  // Overrides applied on this attempt are attributed rows of their own.
  const insertOverride = db.prepare(
    `INSERT INTO cert_check_overrides (id, attempt_id, check_id, operator, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const r of input.results) {
    if (r.status !== "overridden") continue;
    insertOverride.run(
      `ovr-${randomUUID().slice(0, 12)}`,
      id,
      r.id,
      r.overriddenBy ?? input.attemptedBy,
      r.overrideReason ?? "",
      input.attemptedAt,
    );
  }
  return mapAttempt(
    db.prepare(`SELECT * FROM cert_issue_attempts WHERE id = ?`).get(id) as Record<string, unknown>,
  );
}

export function listIssueAttempts(
  db: Database.Database,
  accountId: string,
): IssueAttemptRecord[] {
  return (
    db
      .prepare(
        `SELECT * FROM cert_issue_attempts WHERE account_id = ? ORDER BY attempted_at DESC, id`,
      )
      .all(accountId) as Record<string, unknown>[]
  ).map(mapAttempt);
}

export function listCheckOverrides(
  db: Database.Database,
  attemptId: string,
): CheckOverrideRecord[] {
  return (
    db
      .prepare(`SELECT * FROM cert_check_overrides WHERE attempt_id = ? ORDER BY created_at, id`)
      .all(attemptId) as Record<string, unknown>[]
  ).map((row) => ({
    id: row.id as string,
    attemptId: row.attempt_id as string,
    checkId: row.check_id as string,
    operator: row.operator as string,
    reason: row.reason as string,
    createdAt: row.created_at as string,
  }));
}

/* ————————————————— Issued certificates + supersede chain ————————————————— */

export function issueCert(
  db: Database.Database,
  input: {
    accountId: string;
    ticketId: string | null;
    requirementKey: string;
    holderName: string;
    holderAddress: string;
    formKey: string;
    policyNumbers: string[];
    description: string;
    snapshot: FactSnapshot;
    attemptId: string | null;
    issuedBy: string;
    issuedAt: string;
  },
): IssuedCertRecord {
  const id = `cert-${randomUUID().slice(0, 12)}`;
  const tx = db.transaction(() => {
    // One active certificate per (holder, requirement): the newest issuance
    // supersedes anything active, and the chain links to the most recent
    // prior certificate for the requirement even when it was revoked — the
    // corrected certificate must point at the paper it replaces.
    const prior = db
      .prepare(
        `SELECT id, status FROM cert_issued
         WHERE account_id = ? AND requirement_key = ?
         ORDER BY issued_at DESC, id DESC LIMIT 1`,
      )
      .get(input.accountId, input.requirementKey) as
      | { id: string; status: IssuedCertStatus }
      | undefined;

    db.prepare(
      `UPDATE cert_issued SET status = 'superseded', superseded_by = ?
       WHERE account_id = ? AND requirement_key = ? AND status = 'active'`,
    ).run(id, input.accountId, input.requirementKey);
    if (prior && prior.status === "revoked") {
      db.prepare(`UPDATE cert_issued SET superseded_by = ? WHERE id = ?`).run(id, prior.id);
    }

    db.prepare(
      `INSERT INTO cert_issued (
        id, account_id, ticket_id, requirement_key, holder_name, holder_address,
        form_key, policy_numbers_json, description, snapshot_json, snapshot_digest,
        attempt_id, issued_by, issued_at, status, supersedes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).run(
      id,
      input.accountId,
      input.ticketId,
      input.requirementKey,
      input.holderName,
      input.holderAddress,
      input.formKey,
      JSON.stringify(input.policyNumbers),
      input.description,
      JSON.stringify(input.snapshot),
      input.snapshot.digest,
      input.attemptId,
      input.issuedBy,
      input.issuedAt,
      prior?.id ?? null,
    );

    // Holder re-notification: a certificate replacing revoked paper carries a
    // corrected notice; a plain issuance carries an issued notice.
    const kind: HolderNoticeKind = prior?.status === "revoked" ? "corrected" : "issued";
    db.prepare(
      `INSERT INTO cert_holder_notices (id, cert_id, account_id, holder_name, kind, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `ntc-${randomUUID().slice(0, 12)}`,
      id,
      input.accountId,
      input.holderName,
      kind,
      kind === "corrected"
        ? `Corrected certificate issued to ${input.holderName}. It replaces the revoked certificate ${prior!.id}; the revoked paper is no longer valid.`
        : `Certificate issued to ${input.holderName} covering ${input.policyNumbers.join(", ") || "the account"}.`,
      input.issuedAt,
    );

    // Consume any live prepared artifact for the same requirement.
    db.prepare(
      `UPDATE cert_prepared SET consumed_by_cert_id = ?
       WHERE account_id = ? AND requirement_key = ?
         AND consumed_by_cert_id IS NULL AND invalidated_at IS NULL`,
    ).run(id, input.accountId, input.requirementKey);
  });
  tx();
  return getIssuedCert(db, id)!;
}

export function getIssuedCert(
  db: Database.Database,
  id: string,
): IssuedCertRecord | null {
  const row = db.prepare(`SELECT * FROM cert_issued WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapIssued(row) : null;
}

export function listIssuedCerts(
  db: Database.Database,
  accountId: string,
): IssuedCertRecord[] {
  return (
    db
      .prepare(`SELECT * FROM cert_issued WHERE account_id = ? ORDER BY issued_at DESC, id DESC`)
      .all(accountId) as Record<string, unknown>[]
  ).map(mapIssued);
}

/**
 * Mark an issued certificate erroneous: status becomes revoked, the reason
 * and operator go on record, and a holder re-notification entry is created.
 * The next issuance for the same requirement links itself to this record.
 */
export function markCertErroneous(
  db: Database.Database,
  input: { certId: string; revokedBy: string; reason: string; revokedAt?: string },
): IssuedCertRecord | null {
  const cert = getIssuedCert(db, input.certId);
  if (!cert || cert.status === "revoked") return cert;
  const at = input.revokedAt ?? new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE cert_issued SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_reason = ?
       WHERE id = ?`,
    ).run(at, input.revokedBy, input.reason, input.certId);
    db.prepare(
      `INSERT INTO cert_holder_notices (id, cert_id, account_id, holder_name, kind, body, created_at)
       VALUES (?, ?, ?, ?, 'revoked', ?, ?)`,
    ).run(
      `ntc-${randomUUID().slice(0, 12)}`,
      input.certId,
      cert.accountId,
      cert.holderName,
      `Certificate ${input.certId} issued to ${cert.holderName} has been found erroneous and is revoked: ${input.reason} Do not rely on it; a corrected certificate follows.`,
      at,
    );
  });
  tx();
  return getIssuedCert(db, input.certId);
}

export function listHolderNotices(
  db: Database.Database,
  accountId: string,
): HolderNoticeRecord[] {
  return (
    db
      .prepare(
        `SELECT * FROM cert_holder_notices WHERE account_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(accountId) as Record<string, unknown>[]
  ).map(mapNotice);
}

/* ————————————————— Prepared artifacts (TTL + invalidation) ————————————————— */

export function preparedTtlExpiry(fromIso: string): string {
  return new Date(
    new Date(fromIso).getTime() + PREPARED_CERT_TTL_HOURS * 3_600_000,
  ).toISOString();
}

export function upsertPrepared(
  db: Database.Database,
  input: {
    accountId: string;
    requirementKey: string;
    holderName: string;
    snapshot: FactSnapshot;
    preparedBy: string;
    preparedAt?: string;
  },
): PreparedCertRecord {
  const at = input.preparedAt ?? new Date().toISOString();
  const id = `prep-${randomUUID().slice(0, 12)}`;
  const tx = db.transaction(() => {
    // A new preparation replaces any live one for the same requirement.
    db.prepare(
      `UPDATE cert_prepared SET invalidated_at = ?, invalidated_reason = 'Superseded By A Newer Preparation'
       WHERE account_id = ? AND requirement_key = ?
         AND consumed_by_cert_id IS NULL AND invalidated_at IS NULL`,
    ).run(at, input.accountId, input.requirementKey);
    db.prepare(
      `INSERT INTO cert_prepared (
        id, account_id, requirement_key, holder_name, snapshot_json, snapshot_digest,
        prepared_by, prepared_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.accountId,
      input.requirementKey,
      input.holderName,
      JSON.stringify(input.snapshot),
      input.snapshot.digest,
      input.preparedBy,
      at,
      preparedTtlExpiry(at),
    );
  });
  tx();
  return mapPrepared(
    db.prepare(`SELECT * FROM cert_prepared WHERE id = ?`).get(id) as Record<string, unknown>,
  );
}

export function getLivePrepared(
  db: Database.Database,
  accountId: string,
  requirementKey: string,
): PreparedCertRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM cert_prepared
       WHERE account_id = ? AND requirement_key = ?
         AND consumed_by_cert_id IS NULL AND invalidated_at IS NULL
       ORDER BY prepared_at DESC LIMIT 1`,
    )
    .get(accountId, requirementKey) as Record<string, unknown> | undefined;
  return row ? mapPrepared(row) : null;
}

export function listPrepared(
  db: Database.Database,
  accountId: string,
): PreparedCertRecord[] {
  return (
    db
      .prepare(`SELECT * FROM cert_prepared WHERE account_id = ? ORDER BY prepared_at DESC, id`)
      .all(accountId) as Record<string, unknown>[]
  ).map(mapPrepared);
}

/** Kill one prepared artifact (send-moment staleness discovery). */
export function invalidatePreparedRow(
  db: Database.Database,
  id: string,
  reason: string,
): void {
  db.prepare(
    `UPDATE cert_prepared SET invalidated_at = ?, invalidated_reason = ?
     WHERE id = ? AND invalidated_at IS NULL`,
  ).run(new Date().toISOString(), reason, id);
}

/**
 * Upstream fact change → every pending prepared certificate on the account
 * is dead. Called from the mutation sites (red alert raised, placement rule
 * changed, schedule attached); the send-moment digest comparison catches
 * anything a hook missed.
 */
export function invalidatePreparedForAccount(
  db: Database.Database,
  accountId: string,
  reason: string,
): number {
  const res = db
    .prepare(
      `UPDATE cert_prepared SET invalidated_at = ?, invalidated_reason = ?
       WHERE account_id = ? AND consumed_by_cert_id IS NULL AND invalidated_at IS NULL`,
    )
    .run(new Date().toISOString(), reason, accountId);
  return res.changes;
}
