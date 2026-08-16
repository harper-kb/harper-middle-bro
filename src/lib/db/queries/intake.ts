import type { IntakeEvent } from "../../types";
import { getDb } from "../connection";

function mapIntakeEvent(row: Record<string, unknown>): IntakeEvent {
  return {
    id: row.id as string,
    channel: row.channel as IntakeEvent["channel"],
    fromName: row.from_name as string,
    fromContact: row.from_contact as string,
    accountId: (row.account_id as string | null) ?? null,
    receivedAt: row.received_at as string,
    subject: (row.subject as string | null) ?? null,
    body: row.body as string,
    callMissed: row.call_missed == null ? null : Boolean(row.call_missed),
    callDurationSec: (row.call_duration_sec as number | null) ?? null,
    status: row.status as IntakeEvent["status"],
    ticketId: (row.ticket_id as string | null) ?? null,
    ackSentAt: (row.ack_sent_at as string | null) ?? null,
    ackBody: (row.ack_body as string | null) ?? null,
  };
}

export function listIntakeEvents(
  status?: IntakeEvent["status"],
): IntakeEvent[] {
  const db = getDb();
  const rows = (
    status
      ? db
          .prepare(
            `SELECT * FROM intake_events WHERE status = ? ORDER BY received_at DESC`,
          )
          .all(status)
      : db
          .prepare(`SELECT * FROM intake_events ORDER BY received_at DESC`)
          .all()
  ) as Record<string, unknown>[];
  return rows.map(mapIntakeEvent);
}

export function getIntakeEvent(id: string): IntakeEvent | null {
  const row = getDb()
    .prepare(`SELECT * FROM intake_events WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapIntakeEvent(row) : null;
}

export function dismissIntakeEvent(id: string): void {
  getDb()
    .prepare(`UPDATE intake_events SET status = 'dismissed' WHERE id = ?`)
    .run(id);
}

/** Link an intake event to a ticket — 'ticketed' created it, 'merged' joined it. */
export function attachIntakeToTicket(input: {
  intakeId: string;
  ticketId: string;
  merged: boolean;
}): void {
  getDb()
    .prepare(`UPDATE intake_events SET status = ?, ticket_id = ? WHERE id = ?`)
    .run(input.merged ? "merged" : "ticketed", input.ticketId, input.intakeId);
}

/** Record the service-inbox acknowledgment exactly as sent — the audit trail. */
export function recordIntakeAck(intakeId: string, ackBody: string): void {
  getDb()
    .prepare(`UPDATE intake_events SET ack_sent_at = ?, ack_body = ? WHERE id = ?`)
    .run(new Date().toISOString(), ackBody, intakeId);
}
