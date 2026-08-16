import { randomUUID } from "crypto";
import { endOfLocalDayIso } from "../../dates";
import { buildTicketTitle, deriveTicketStatus } from "../../tickets/tickets";
import type {
  AccountDoc,
  RequestTypeId,
  Ticket,
  TicketDetail,
  TicketSource,
  TicketStatus,
  ThreadDetail,
} from "../../types";
import { getDb } from "../connection";
import { mapPolicy } from "../mappers";
import { allocateSrNumber } from "../migrate";
import { getAccountDetail } from "./accounts";
import { insertDecision } from "./decisions";
import { getThreadDetail } from "./threads";

export function mapTicket(row: Record<string, unknown>): Ticket {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    requestType: row.request_type as RequestTypeId,
    title: row.title as string,
    subject: (row.subject as string) ?? "",
    source: row.source as TicketSource,
    requestedBy: row.requested_by as string,
    requestedByEmail: (row.requested_by_email as string | null) ?? null,
    holderName: (row.holder_name as string | null) ?? null,
    holderAddress: (row.holder_address as string | null) ?? null,
    wording: (row.wording as string) ?? "",
    namedOnPolicyRequired: Boolean(row.named_on_policy),
    fastPathBasis: (row.fast_path_basis as string | null) ?? null,
    escalatedToId: (row.escalated_to as string | null) ?? null,
    escalationNote: (row.escalation_note as string | null) ?? null,
    escalatedAt: (row.escalated_at as string | null) ?? null,
    escalationDueBy: (row.escalation_due_by as string | null) ?? null,
    escalationResolvedAt: (row.escalation_resolved_at as string | null) ?? null,
    status: row.status as TicketStatus,
    srNumber: (row.sr_number as string) || "",
    operatorId: (row.operator_id as string | null) ?? null,
    docs: JSON.parse((row.docs_json as string) ?? "[]") as AccountDoc[],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    closedAt: (row.closed_at as string | null) ?? null,
  };
}

export function getTicketDetail(idOrSr: string): TicketDetail | null {
  const db = getDb();
  let row = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(idOrSr) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    const sr = idOrSr.trim().toUpperCase().replace(/^#/, "");
    row = db
      .prepare(`SELECT * FROM tickets WHERE upper(sr_number) = ?`)
      .get(sr) as Record<string, unknown> | undefined;
  }
  if (!row) return null;

  const ticket = mapTicket(row);
  const id = ticket.id;
  const account = getAccountDetail(ticket.accountId);
  if (!account) return null;
  const policies = (
    db
      .prepare(
        `SELECT p.* FROM policies p
         JOIN ticket_policies tp ON tp.policy_id = p.id
         WHERE tp.ticket_id = ?
         ORDER BY p.effective_date DESC`,
      )
      .all(id) as Record<string, unknown>[]
  ).map(mapPolicy);
  const threadIds = db
    .prepare(`SELECT id FROM threads WHERE ticket_id = ? ORDER BY created_at ASC`)
    .all(id) as { id: string }[];
  const threads = threadIds
    .map((t) => getThreadDetail(t.id))
    .filter((t): t is ThreadDetail => t != null);

  return { ...ticket, account, policies, threads };
}

export function listTickets(filters?: {
  status?: TicketStatus | "all";
  requestType?: RequestTypeId | "all";
  source?: TicketSource | "all";
  operatorId?: string;
  /** Unassigned only — the grab pile */
  unclaimedOnly?: boolean;
  openOnly?: boolean;
  q?: string;
}): TicketDetail[] {
  const db = getDb();
  let sql = `SELECT t.id FROM tickets t
    JOIN accounts a ON a.id = t.account_id
    WHERE 1=1`;
  const params: string[] = [];

  if (filters?.status && filters.status !== "all") {
    sql += ` AND t.status = ?`;
    params.push(filters.status);
  }
  if (filters?.requestType && filters.requestType !== "all") {
    sql += ` AND t.request_type = ?`;
    params.push(filters.requestType);
  }
  if (filters?.source && filters.source !== "all") {
    sql += ` AND t.source = ?`;
    params.push(filters.source);
  }
  if (filters?.operatorId) {
    sql += ` AND t.operator_id = ?`;
    params.push(filters.operatorId);
  }
  if (filters?.unclaimedOnly) {
    sql += ` AND t.operator_id IS NULL`;
  }
  if (filters?.openOnly) {
    sql += ` AND t.status NOT IN ('delivered', 'closed')`;
  }
  if (filters?.q?.trim()) {
    const raw = filters.q.trim();
    const q = `%${raw.toLowerCase()}%`;
    const sr = raw.toUpperCase().replace(/^#/, "");
    sql += ` AND (
      lower(a.name) LIKE ? OR lower(coalesce(a.dba, '')) LIKE ?
      OR lower(t.title) LIKE ? OR lower(t.subject) LIKE ?
      OR lower(coalesce(t.holder_name, '')) LIKE ? OR lower(t.requested_by) LIKE ?
      OR upper(coalesce(t.sr_number, '')) = ? OR upper(coalesce(t.sr_number, '')) LIKE ?
    )`;
    params.push(q, q, q, q, q, q, sr, `%${sr}%`);
  }

  sql += ` ORDER BY t.created_at ASC`;
  const ids = db.prepare(sql).all(...params) as { id: string }[];
  return ids
    .map((r) => getTicketDetail(r.id))
    .filter((t): t is TicketDetail => t != null);
}

export function createTicket(input: {
  accountId: string;
  policyIds: string[];
  requestType: RequestTypeId;
  source: TicketSource;
  requestedBy: string;
  requestedByEmail?: string | null;
  subject?: string;
  holderName?: string | null;
  holderAddress?: string | null;
  wording: string;
  namedOnPolicyRequired?: boolean;
  operatorId: string | null;
}): TicketDetail {
  const db = getDb();
  const account = getAccountDetail(input.accountId);
  if (!account) throw new Error("Account not found");
  if (input.policyIds.length === 0) {
    throw new Error("Pick at least one policy for the ticket");
  }

  const id = `tkt-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const srNumber = allocateSrNumber(db);
  const title = buildTicketTitle({
    requestType: input.requestType,
    holderName: input.holderName,
    accountName: account.name,
  });

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO tickets (
        id, account_id, request_type, title, subject, source,
        requested_by, requested_by_email, holder_name, holder_address,
        wording, named_on_policy, status, sr_number, operator_id, docs_json, created_at, updated_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intake', ?, ?, '[]', ?, ?, NULL)`,
    ).run(
      id,
      input.accountId,
      input.requestType,
      title,
      input.subject?.trim() || title,
      input.source,
      input.requestedBy,
      input.requestedByEmail ?? null,
      input.holderName ?? null,
      input.holderAddress ?? null,
      input.wording,
      input.namedOnPolicyRequired ? 1 : 0,
      srNumber,
      input.operatorId,
      now,
      now,
    );
    const link = db.prepare(
      `INSERT OR IGNORE INTO ticket_policies (ticket_id, policy_id) VALUES (?, ?)`,
    );
    for (const pid of input.policyIds) link.run(id, pid);
  });
  tx();

  return getTicketDetail(id)!;
}

export function setTicketStatus(
  ticketId: string,
  status: TicketStatus,
): TicketDetail {
  const db = getDb();
  const now = new Date().toISOString();
  const closed = status === "delivered" || status === "closed";
  db.prepare(
    `UPDATE tickets SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?`,
  ).run(status, now, closed ? now : null, ticketId);
  return getTicketDetail(ticketId)!;
}

/**
 * The blanket fast path: the schedule of record already grants this by
 * blanket endorsement and the holder accepts wording — the cert issues
 * without a market email. The reason and the exact form land in the trace.
 */
export function applyBlanketFastPath(
  ticketId: string,
  input: {
    basis: string;
    form: { form: string; edition: string; title: string };
    policyNumber: string;
    requestLabel: string;
  },
): TicketDetail {
  const db = getDb();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tickets SET status = 'ready_to_issue', fast_path_basis = ?, updated_at = ? WHERE id = ?`,
    ).run(input.basis, now, ticketId);

    insertDecision(db, {
      ticketId,
      kind: "certificate",
      author: "ai",
      headline: "Blanket Fast Path — No Market Touch",
      summary: `${input.requestLabel} satisfied by ${input.form.form} ${input.form.edition} already on ${input.policyNumber}. Certificate issues on wording alone; no quote needed.`,
      steps: [
        {
          id: "blanket-check",
          label: "Blanket Check",
          rule: "If the schedule of record carries a blanket endorsement of the requested kind and the holder accepts wording, skip the market and go straight to issue.",
          inputs: [
            { label: "Request", value: input.requestLabel },
            {
              label: "Form On Policy",
              value: `${input.form.form} ${input.form.edition} — ${input.form.title}`,
            },
            { label: "Policy", value: input.policyNumber },
            { label: "Holder Requires Named On Policy", value: "No" },
          ],
          outcome: "Ready To Issue — wording only, no quote needed.",
          verdict: "ok",
          source: "rule",
        },
      ],
      createdAt: now,
    });
  });
  tx();

  return getTicketDetail(ticketId)!;
}

export function claimTicket(ticketId: string, operatorId: string): TicketDetail {
  const db = getDb();
  db.prepare(
    `UPDATE tickets SET operator_id = ?, updated_at = ? WHERE id = ?`,
  ).run(operatorId, new Date().toISOString(), ticketId);
  return getTicketDetail(ticketId)!;
}

/** Pull ticket status back in line with the threads underneath it. */
export function syncTicketStatus(ticketId: string | null): void {
  if (!ticketId) return;
  const ticket = getTicketDetail(ticketId);
  if (!ticket) return;
  const next = deriveTicketStatus(ticket.status, ticket.threads);
  if (next === ticket.status) return;
  getDb()
    .prepare(`UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?`)
    .run(next, new Date().toISOString(), ticketId);
}

// ————————————————— Escalation —————————————————

/**
 * Flag a ticket up for help. The promise is explicit: unless the flagger
 * says otherwise, the manager gets to it by end of the flagging day.
 */
export function escalateTicket(input: {
  ticketId: string;
  toOperatorId: string;
  note: string;
  dueBy?: string | null;
}): TicketDetail {
  const now = new Date();
  // Default promise: the manager gets to it by end of the flagging day.
  const dueBy = input.dueBy ?? endOfLocalDayIso();
  getDb()
    .prepare(
      `UPDATE tickets SET
        escalated_to = ?, escalation_note = ?, escalated_at = ?,
        escalation_due_by = ?, escalation_resolved_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.toOperatorId,
      input.note,
      now.toISOString(),
      dueBy,
      now.toISOString(),
      input.ticketId,
    );
  return getTicketDetail(input.ticketId)!;
}

export function resolveEscalation(ticketId: string): TicketDetail {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE tickets SET escalation_resolved_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(now, now, ticketId);
  return getTicketDetail(ticketId)!;
}

/** Open escalations, oldest promise first — the manager's help inbox. */
export function listEscalatedTickets(toOperatorId?: string): TicketDetail[] {
  const db = getDb();
  const rows = (
    toOperatorId
      ? db
          .prepare(
            `SELECT id FROM tickets
             WHERE escalated_to = ? AND escalation_resolved_at IS NULL
             ORDER BY escalation_due_by ASC, escalated_at ASC`,
          )
          .all(toOperatorId)
      : db
          .prepare(
            `SELECT id FROM tickets
             WHERE escalated_to IS NOT NULL AND escalation_resolved_at IS NULL
             ORDER BY escalation_due_by ASC, escalated_at ASC`,
          )
          .all()
  ) as { id: string }[];
  return rows
    .map((r) => getTicketDetail(r.id))
    .filter((t): t is TicketDetail => t != null);
}
