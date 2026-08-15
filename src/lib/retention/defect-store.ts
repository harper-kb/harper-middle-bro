/**
 * Origination defect persistence.
 *
 * Adjudication is a state machine rather than a boolean because a defect that
 * cannot be disputed is a blame list. Transitions are validated on write, so an
 * invalid move fails loudly here instead of producing a confirmed defect nobody
 * agreed to.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  canTransition,
  DEFECT_STATE_LABELS,
  type DefectSeverity,
  type DefectState,
  type OriginationDefect,
  type OriginationDefectKind,
} from "./defects";
import type { ServicePodId } from "./pods";
import {
  buildRenewalTransfer,
  type RenewalTransfer,
  type RenewalTransferState,
} from "./renewal-transfer";

export function migrateDefectTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS origination_defects (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      policy_id TEXT,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'proposed',
      producer_agent_id TEXT,
      producer_name TEXT,
      absorbing_pod_id TEXT,
      absorbing_agent_id TEXT,
      bound_at TEXT,
      issue_opened_at TEXT NOT NULL,
      raised_at TEXT NOT NULL,
      raised_by TEXT,
      adjudicated_at TEXT,
      adjudicated_by TEXT,
      adjudication_note TEXT,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      sla_paused_hours REAL NOT NULL DEFAULT 0,
      detail TEXT NOT NULL DEFAULT ''
    );
    -- One defect per issue: an issue is either origination's fault or it is not.
    CREATE UNIQUE INDEX IF NOT EXISTS origination_defects_issue
      ON origination_defects(issue_id);
    CREATE INDEX IF NOT EXISTS origination_defects_producer
      ON origination_defects(producer_agent_id, state);
    CREATE INDEX IF NOT EXISTS origination_defects_pod
      ON origination_defects(absorbing_pod_id, state);

    CREATE TABLE IF NOT EXISTS defect_state_log (
      id TEXT PRIMARY KEY,
      defect_id TEXT NOT NULL REFERENCES origination_defects(id),
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      at TEXT NOT NULL,
      actor TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS defect_state_log_defect
      ON defect_state_log(defect_id, at);

    CREATE TABLE IF NOT EXISTS renewal_transfers (
      id TEXT PRIMARY KEY,
      defect_id TEXT NOT NULL REFERENCES origination_defects(id),
      account_id TEXT NOT NULL,
      policy_id TEXT,
      from_producer_agent_id TEXT,
      to_pod_id TEXT,
      renewal_due_at TEXT,
      transferred_at TEXT NOT NULL,
      renewal_commission_cents INTEGER,
      state TEXT NOT NULL DEFAULT 'pending',
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS renewal_transfers_account
      ON renewal_transfers(account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS renewal_transfers_defect
      ON renewal_transfers(defect_id);
  `);
}

function mapDefect(row: Record<string, unknown>): OriginationDefect {
  return {
    id: row.id as string,
    issueId: row.issue_id as string,
    accountId: row.account_id as string,
    policyId: (row.policy_id as string) ?? null,
    kind: row.kind as OriginationDefectKind,
    severity: row.severity as DefectSeverity,
    state: row.state as DefectState,
    producerAgentId: (row.producer_agent_id as string) ?? null,
    producerName: (row.producer_name as string) ?? null,
    absorbingPodId: (row.absorbing_pod_id as ServicePodId) ?? null,
    absorbingAgentId: (row.absorbing_agent_id as string) ?? null,
    boundAt: (row.bound_at as string) ?? null,
    issueOpenedAt: row.issue_opened_at as string,
    raisedAt: row.raised_at as string,
    raisedBy: (row.raised_by as string) ?? null,
    adjudicatedAt: (row.adjudicated_at as string) ?? null,
    adjudicatedBy: (row.adjudicated_by as string) ?? null,
    adjudicationNote: (row.adjudication_note as string) ?? null,
    evidenceRefs: JSON.parse((row.evidence_json as string) || "[]") as string[],
    slaPausedHours: (row.sla_paused_hours as number) ?? 0,
    detail: (row.detail as string) ?? "",
  };
}

export type RaiseDefectInput = {
  issueId: string;
  accountId: string;
  policyId?: string | null;
  kind: OriginationDefectKind;
  severity: DefectSeverity;
  producerAgentId?: string | null;
  producerName?: string | null;
  absorbingPodId?: ServicePodId | null;
  absorbingAgentId?: string | null;
  boundAt?: string | null;
  issueOpenedAt: string;
  raisedBy?: string | null;
  evidenceRefs?: string[];
  detail?: string;
  /** Auto-classified proposals land as `proposed`; a person raises to `raised`. */
  state?: Extract<DefectState, "proposed" | "raised">;
  at?: string;
};

export function raiseDefect(
  db: Database.Database,
  input: RaiseDefectInput,
): OriginationDefect {
  const id = `def-${randomUUID()}`;
  const at = input.at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO origination_defects (
       id, issue_id, account_id, policy_id, kind, severity, state,
       producer_agent_id, producer_name, absorbing_pod_id, absorbing_agent_id,
       bound_at, issue_opened_at, raised_at, raised_by, evidence_json, detail
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(issue_id) DO NOTHING`,
  ).run(
    id,
    input.issueId,
    input.accountId,
    input.policyId ?? null,
    input.kind,
    input.severity,
    input.state ?? "proposed",
    input.producerAgentId ?? null,
    input.producerName ?? null,
    input.absorbingPodId ?? null,
    input.absorbingAgentId ?? null,
    input.boundAt ?? null,
    input.issueOpenedAt,
    at,
    input.raisedBy ?? null,
    JSON.stringify(input.evidenceRefs ?? []),
    input.detail ?? "",
  );
  return getDefectByIssue(db, input.issueId)!;
}

export function getDefect(
  db: Database.Database,
  id: string,
): OriginationDefect | null {
  const row = db
    .prepare(`SELECT * FROM origination_defects WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapDefect(row) : null;
}

export function getDefectByIssue(
  db: Database.Database,
  issueId: string,
): OriginationDefect | null {
  const row = db
    .prepare(`SELECT * FROM origination_defects WHERE issue_id = ?`)
    .get(issueId) as Record<string, unknown> | undefined;
  return row ? mapDefect(row) : null;
}

export function listDefects(
  db: Database.Database,
  filter: {
    state?: DefectState;
    producerAgentId?: string;
    absorbingPodId?: ServicePodId;
    accountId?: string;
    openedFrom?: string;
    openedTo?: string;
  } = {},
): OriginationDefect[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.state) {
    where.push("state = ?");
    args.push(filter.state);
  }
  if (filter.producerAgentId) {
    where.push("producer_agent_id = ?");
    args.push(filter.producerAgentId);
  }
  if (filter.absorbingPodId) {
    where.push("absorbing_pod_id = ?");
    args.push(filter.absorbingPodId);
  }
  if (filter.accountId) {
    where.push("account_id = ?");
    args.push(filter.accountId);
  }
  if (filter.openedFrom) {
    where.push("issue_opened_at >= ?");
    args.push(filter.openedFrom);
  }
  if (filter.openedTo) {
    where.push("issue_opened_at <= ?");
    args.push(filter.openedTo);
  }
  const sql = `SELECT * FROM origination_defects${
    where.length ? ` WHERE ${where.join(" AND ")}` : ""
  } ORDER BY issue_opened_at DESC`;
  return (db.prepare(sql).all(...args) as Record<string, unknown>[]).map(mapDefect);
}

export class DefectTransitionError extends Error {}

/**
 * Move a defect through adjudication. Confirming without evidence is refused:
 * the ledger's credibility rests entirely on being settled against transcripts
 * and documents rather than assertions.
 */
export function transitionDefect(
  db: Database.Database,
  id: string,
  to: DefectState,
  opts: { actor?: string | null; note?: string | null; at?: string } = {},
): OriginationDefect {
  const current = getDefect(db, id);
  if (!current) throw new DefectTransitionError(`Defect ${id} not found`);
  if (!canTransition(current.state, to)) {
    throw new DefectTransitionError(
      `Cannot move defect from ${DEFECT_STATE_LABELS[current.state]} to ${DEFECT_STATE_LABELS[to]}`,
    );
  }
  if (to === "confirmed" && current.evidenceRefs.length === 0) {
    throw new DefectTransitionError(
      "Cannot confirm a defect with no evidence attached",
    );
  }
  const at = opts.at ?? new Date().toISOString();
  const adjudicating = to === "confirmed" || to === "rejected";
  const move = db.transaction(() => {
    db.prepare(
      `UPDATE origination_defects
          SET state = ?,
              adjudicated_at = CASE WHEN ? THEN ? ELSE adjudicated_at END,
              adjudicated_by = CASE WHEN ? THEN ? ELSE adjudicated_by END,
              adjudication_note = COALESCE(?, adjudication_note)
        WHERE id = ?`,
    ).run(
      to,
      adjudicating ? 1 : 0,
      at,
      adjudicating ? 1 : 0,
      opts.actor ?? null,
      opts.note ?? null,
      id,
    );
    db.prepare(
      `INSERT INTO defect_state_log (id, defect_id, from_state, to_state, at, actor, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `dsl-${randomUUID()}`,
      id,
      current.state,
      to,
      at,
      opts.actor ?? null,
      opts.note ?? null,
    );
  });
  move();
  return getDefect(db, id)!;
}

export function attachDefectEvidence(
  db: Database.Database,
  id: string,
  refs: string[],
): OriginationDefect {
  const current = getDefect(db, id);
  if (!current) throw new DefectTransitionError(`Defect ${id} not found`);
  const merged = [...new Set([...current.evidenceRefs, ...refs])];
  db.prepare(`UPDATE origination_defects SET evidence_json = ? WHERE id = ?`).run(
    JSON.stringify(merged),
    id,
  );
  return getDefect(db, id)!;
}

export function setDefectSlaPause(
  db: Database.Database,
  id: string,
  pausedHours: number,
): void {
  db.prepare(`UPDATE origination_defects SET sla_paused_hours = ? WHERE id = ?`).run(
    Math.max(0, pausedHours),
    id,
  );
}

// ——— Renewal transfers ———

function mapTransfer(row: Record<string, unknown>): RenewalTransfer {
  return {
    id: row.id as string,
    defectId: row.defect_id as string,
    accountId: row.account_id as string,
    policyId: (row.policy_id as string) ?? null,
    fromProducerAgentId: (row.from_producer_agent_id as string) ?? null,
    toPodId: (row.to_pod_id as ServicePodId) ?? null,
    renewalDueAt: (row.renewal_due_at as string) ?? null,
    transferredAt: row.transferred_at as string,
    renewalCommissionCents: (row.renewal_commission_cents as number) ?? null,
    state: row.state as RenewalTransferState,
    note: (row.note as string) ?? null,
  };
}

/**
 * Record the sanction against a confirmed defect. `buildRenewalTransfer`
 * refuses ineligible defects, so an unconfirmed or unattributed defect can
 * never reach this table.
 */
export function createRenewalTransfer(
  db: Database.Database,
  defectId: string,
  opts: { renewalCommissionCents?: number | null; at?: string } = {},
): RenewalTransfer {
  const defect = getDefect(db, defectId);
  if (!defect) throw new DefectTransitionError(`Defect ${defectId} not found`);
  const built = buildRenewalTransfer(defect, opts);
  const id = `rtx-${randomUUID()}`;
  db.prepare(
    `INSERT INTO renewal_transfers (
       id, defect_id, account_id, policy_id, from_producer_agent_id, to_pod_id,
       renewal_due_at, transferred_at, renewal_commission_cents, state, note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(defect_id) DO NOTHING`,
  ).run(
    id,
    built.defectId,
    built.accountId,
    built.policyId,
    built.fromProducerAgentId,
    built.toPodId,
    built.renewalDueAt,
    built.transferredAt,
    built.renewalCommissionCents,
    built.state,
    built.note,
  );
  return listRenewalTransfers(db, { defectId }).at(0)!;
}

export function listRenewalTransfers(
  db: Database.Database,
  filter: { defectId?: string; accountId?: string; producerAgentId?: string } = {},
): RenewalTransfer[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.defectId) {
    where.push("defect_id = ?");
    args.push(filter.defectId);
  }
  if (filter.accountId) {
    where.push("account_id = ?");
    args.push(filter.accountId);
  }
  if (filter.producerAgentId) {
    where.push("from_producer_agent_id = ?");
    args.push(filter.producerAgentId);
  }
  const sql = `SELECT * FROM renewal_transfers${
    where.length ? ` WHERE ${where.join(" AND ")}` : ""
  } ORDER BY transferred_at DESC`;
  return (db.prepare(sql).all(...args) as Record<string, unknown>[]).map(mapTransfer);
}

/** Reversal is the appeal outcome — the sanction has to be undoable to be fair. */
export function setRenewalTransferState(
  db: Database.Database,
  id: string,
  state: RenewalTransferState,
  note?: string | null,
): void {
  db.prepare(
    `UPDATE renewal_transfers SET state = ?, note = COALESCE(?, note) WHERE id = ?`,
  ).run(state, note ?? null, id);
}

export function listDefectStateLog(
  db: Database.Database,
  defectId: string,
): {
  from: DefectState;
  to: DefectState;
  at: string;
  actor: string | null;
  note: string | null;
}[] {
  const rows = db
    .prepare(`SELECT * FROM defect_state_log WHERE defect_id = ? ORDER BY at ASC`)
    .all(defectId) as Record<string, unknown>[];
  return rows.map((r) => ({
    from: r.from_state as DefectState,
    to: r.to_state as DefectState,
    at: r.at as string,
    actor: (r.actor as string) ?? null,
    note: (r.note as string) ?? null,
  }));
}
