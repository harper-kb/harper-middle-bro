import { randomUUID } from "crypto";
import { AUTO_SEND_UNLOCK_AT } from "../../desk/aidesk";
import { buildSignature } from "../../session/signature";
import type { AccountGrant, Operator, RequestTypeId } from "../../types";
import { getDb } from "../connection";
import { mapOperator } from "../mappers";

export function getOperator(id: string): Operator | null {
  const row = getDb()
    .prepare(`SELECT * FROM operators WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapOperator(row) : null;
}

export function getOperatorByClerkUserId(clerkUserId: string): Operator | null {
  const row = getDb()
    .prepare(`SELECT * FROM operators WHERE clerk_user_id = ?`)
    .get(clerkUserId) as Record<string, unknown> | undefined;
  return row ? mapOperator(row) : null;
}

export function getOperatorByEmail(email: string): Operator | null {
  const row = getDb()
    .prepare(`SELECT * FROM operators WHERE lower(email) = lower(?)`)
    .get(email) as Record<string, unknown> | undefined;
  return row ? mapOperator(row) : null;
}

/**
 * First Clerk sign-in creates (or links) a desk operator so drafts keep a
 * stable signature + streak history.
 */
export function ensureOperatorForClerkUser(input: {
  clerkUserId: string;
  email: string;
  displayName: string;
}): Operator {
  const existing = getOperatorByClerkUserId(input.clerkUserId);
  if (existing) return existing;

  const db = getDb();
  const byEmail = input.email ? getOperatorByEmail(input.email) : null;
  if (byEmail) {
    db.prepare(`UPDATE operators SET clerk_user_id = ? WHERE id = ?`).run(
      input.clerkUserId,
      byEmail.id,
    );
    return getOperator(byEmail.id)!;
  }

  const id = `op-${randomUUID().slice(0, 8)}`;
  const displayName = input.displayName.trim() || "Operator";
  const email = input.email.trim() || `${id}@harperinsure.com`;
  const title = "Commercial Lines Service";
  const signature = buildSignature({
    displayName,
    title,
    email,
    phone: null,
  });

  db.prepare(
    `INSERT INTO operators (
      id, clerk_user_id, display_name, email, title, phone, signature, default_template
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'standard')`,
  ).run(id, input.clerkUserId, displayName, email, title, signature);

  return getOperator(id)!;
}

export function listOperators(): Operator[] {
  return (
    getDb()
      .prepare(`SELECT * FROM operators ORDER BY display_name`)
      .all() as Record<string, unknown>[]
  ).map(mapOperator);
}

export function updateOperator(
  id: string,
  patch: {
    displayName: string;
    email: string;
    title: string;
    phone: string | null;
    signature: string;
    defaultTemplate: Operator["defaultTemplate"];
  },
): Operator {
  getDb()
    .prepare(
      `UPDATE operators SET
        display_name = ?, email = ?, title = ?, phone = ?,
        signature = ?, default_template = ?
       WHERE id = ?`,
    )
    .run(
      patch.displayName,
      patch.email,
      patch.title,
      patch.phone,
      patch.signature,
      patch.defaultTemplate,
      id,
    );
  const op = getOperator(id);
  if (!op) throw new Error("Operator not found");
  return op;
}

// ————————————————— Auto-Send Unlock —————————————————

export interface OperatorStreak {
  operatorId: string;
  requestType: RequestTypeId;
  cleanStreak: number;
  confirmedTotal: number;
  autoSend: boolean;
}

function mapStreak(row: Record<string, unknown>): OperatorStreak {
  return {
    operatorId: row.operator_id as string,
    requestType: row.request_type as RequestTypeId,
    cleanStreak: row.clean_streak as number,
    confirmedTotal: row.confirmed_total as number,
    autoSend: Boolean(row.auto_send),
  };
}

export function getStreak(
  operatorId: string,
  requestType: RequestTypeId,
): OperatorStreak {
  const row = getDb()
    .prepare(
      `SELECT * FROM operator_streaks WHERE operator_id = ? AND request_type = ?`,
    )
    .get(operatorId, requestType) as Record<string, unknown> | undefined;
  return row
    ? mapStreak(row)
    : {
        operatorId,
        requestType,
        cleanStreak: 0,
        confirmedTotal: 0,
        autoSend: false,
      };
}

export function listStreaks(operatorId: string): OperatorStreak[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM operator_streaks WHERE operator_id = ? ORDER BY confirmed_total DESC`,
      )
      .all(operatorId) as Record<string, unknown>[]
  ).map(mapStreak);
}

/**
 * A send with no edits and no overridden warnings is clean. Enough of those in
 * a row and this request type stops needing a human on the button.
 */
export function recordSendOutcome(input: {
  operatorId: string;
  requestType: RequestTypeId;
  clean: boolean;
}): OperatorStreak {
  const db = getDb();
  const prev = getStreak(input.operatorId, input.requestType);
  const cleanStreak = input.clean ? prev.cleanStreak + 1 : 0;
  const confirmedTotal = prev.confirmedTotal + 1;
  const autoSend = prev.autoSend || cleanStreak >= AUTO_SEND_UNLOCK_AT;

  db.prepare(
    `INSERT INTO operator_streaks (
       operator_id, request_type, clean_streak, confirmed_total, auto_send, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(operator_id, request_type) DO UPDATE SET
       clean_streak = excluded.clean_streak,
       confirmed_total = excluded.confirmed_total,
       auto_send = excluded.auto_send,
       updated_at = excluded.updated_at`,
  ).run(
    input.operatorId,
    input.requestType,
    cleanStreak,
    confirmedTotal,
    autoSend ? 1 : 0,
    new Date().toISOString(),
  );

  return { ...prev, cleanStreak, confirmedTotal, autoSend };
}

/** Revocable in one click — trust is granted, never permanent. */
export function setAutoSend(
  operatorId: string,
  requestType: RequestTypeId,
  on: boolean,
): OperatorStreak {
  const db = getDb();
  const prev = getStreak(operatorId, requestType);
  db.prepare(
    `INSERT INTO operator_streaks (
       operator_id, request_type, clean_streak, confirmed_total, auto_send, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(operator_id, request_type) DO UPDATE SET
       auto_send = excluded.auto_send,
       clean_streak = excluded.clean_streak,
       updated_at = excluded.updated_at`,
  ).run(
    operatorId,
    requestType,
    on ? prev.cleanStreak : 0,
    prev.confirmedTotal,
    on ? 1 : 0,
    new Date().toISOString(),
  );
  return { ...prev, autoSend: on, cleanStreak: on ? prev.cleanStreak : 0 };
}

// ————————————————— Roles & Grants —————————————————

/** Every grant on the desk — the manager's assignment board reads this. */
export function listAccountGrants(): AccountGrant[] {
  return (
    getDb()
      .prepare(`SELECT * FROM operator_accounts ORDER BY granted_at ASC`)
      .all() as Record<string, unknown>[]
  ).map((row) => ({
    operatorId: row.operator_id as string,
    accountId: row.account_id as string,
    grantedBy: (row.granted_by as string | null) ?? null,
    grantedAt: row.granted_at as string,
  }));
}

/** Account ids this operator can see. Managers see the whole book — callers check role first. */
export function listOperatorAccountIds(operatorId: string): string[] {
  return (
    getDb()
      .prepare(
        `SELECT account_id FROM operator_accounts WHERE operator_id = ? ORDER BY account_id`,
      )
      .all(operatorId) as { account_id: string }[]
  ).map((r) => r.account_id);
}

export function grantAccountAccess(input: {
  operatorId: string;
  accountId: string;
  grantedBy: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO operator_accounts (operator_id, account_id, granted_by, granted_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      input.operatorId,
      input.accountId,
      input.grantedBy,
      new Date().toISOString(),
    );
}

export function revokeAccountAccess(operatorId: string, accountId: string): void {
  getDb()
    .prepare(
      `DELETE FROM operator_accounts WHERE operator_id = ? AND account_id = ?`,
    )
    .run(operatorId, accountId);
}

export function setOperatorRole(
  operatorId: string,
  role: Operator["role"],
): void {
  getDb()
    .prepare(`UPDATE operators SET role = ? WHERE id = ?`)
    .run(role, operatorId);
}
