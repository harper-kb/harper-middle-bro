import type { IntakeEvent } from "./types";

/**
 * The hourly triage digest — "a spreadsheet every hour" that sorts missed
 * calls and unanswered comms by how long they've been sitting, so nothing
 * rots for 5–10 days. Pure and deterministic: same events + same `now`
 * always produce the same rows. No db imports — client-safe.
 */

export type TriageRisk = "overdue" | "aging" | "fresh";

export interface TriageDigestRow {
  /** Intake event id — stable tie-break and link target */
  id: string;
  /** When the comm arrived (ISO) */
  at: string;
  channel: IntakeEvent["channel"];
  from: string;
  fromContact: string;
  /** Matched account id — null means no account match */
  account: string | null;
  ageMinutes: number;
  risk: TriageRisk;
  finding: string;
  recommendedAction: string;
}

export interface TriageDigestTotals {
  missedCallsPending: number;
  emailsAwaitingAck: number;
  /** Age of the oldest still-pending event, in minutes — 0 when nothing is pending */
  oldestPendingMinutes: number;
}

export interface TriageDigestResult {
  rows: TriageDigestRow[];
  totals: TriageDigestTotals;
  generatedAt: string;
}

const OVERDUE_MINUTES = 24 * 60;
const AGING_MINUTES = 60;

const RISK_RANK: Record<TriageRisk, number> = {
  overdue: 0,
  aging: 1,
  fresh: 2,
};

function minutesBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 60_000));
}

function riskFor(ageMinutes: number): TriageRisk {
  if (ageMinutes >= OVERDUE_MINUTES) return "overdue";
  if (ageMinutes >= AGING_MINUTES) return "aging";
  return "fresh";
}

/** Human-honest age phrase used inside findings — deterministic. */
export function describeAge(ageMinutes: number): string {
  if (ageMinutes < 60) return `${ageMinutes}m`;
  if (ageMinutes < 24 * 60) return `${Math.floor(ageMinutes / 60)}h`;
  return `${Math.floor(ageMinutes / (24 * 60))}d`;
}

export function buildTriageDigest(
  events: IntakeEvent[],
  now: string,
): TriageDigestResult {
  const rows: TriageDigestRow[] = [];

  for (const event of events) {
    const ageMinutes = minutesBetween(event.receivedAt, now);
    const base = {
      id: event.id,
      at: event.receivedAt,
      channel: event.channel,
      from: event.fromName,
      fromContact: event.fromContact,
      account: event.accountId,
      ageMinutes,
      risk: riskFor(ageMinutes),
    };

    // Missed calls that never became a ticket surface immediately, even
    // fresh ones — a missed call is the triage priority by definition.
    if (
      event.channel === "call" &&
      event.callMissed === true &&
      event.status === "pending"
    ) {
      rows.push({
        ...base,
        finding: `Missed call pending ${describeAge(ageMinutes)} with no ticket opened`,
        recommendedAction: "Return The Call — open a ticket from Pending",
      });
      continue;
    }

    if (event.status !== "pending") continue;

    if (
      event.channel === "email" &&
      event.ackSentAt === null &&
      ageMinutes >= AGING_MINUTES
    ) {
      rows.push({
        ...base,
        finding: `Email unanswered for ${describeAge(ageMinutes)} — no acknowledgment has gone out`,
        recommendedAction:
          "Triage On Pending — client is waiting on the acknowledgment",
      });
      continue;
    }

    if (event.channel === "text" && ageMinutes >= AGING_MINUTES) {
      rows.push({
        ...base,
        finding: `Text unanswered for ${describeAge(ageMinutes)} — nothing sent back yet`,
        recommendedAction:
          "Triage On Pending — confirm a ticket or dismiss it",
      });
      continue;
    }

    // Catch-all: anything else still pending past a full day is overdue —
    // e.g. an answered call that never got triaged.
    if (ageMinutes >= OVERDUE_MINUTES) {
      rows.push({
        ...base,
        finding: `Pending for ${describeAge(ageMinutes)} without triage`,
        recommendedAction: "Triage On Pending — this has been pending a full day",
      });
    }
  }

  rows.sort((a, b) => {
    const rank = RISK_RANK[a.risk] - RISK_RANK[b.risk];
    if (rank !== 0) return rank;
    if (b.ageMinutes !== a.ageMinutes) return b.ageMinutes - a.ageMinutes;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const pendingAges = events
    .filter((e) => e.status === "pending")
    .map((e) => minutesBetween(e.receivedAt, now));

  const totals: TriageDigestTotals = {
    missedCallsPending: events.filter(
      (e) =>
        e.channel === "call" && e.callMissed === true && e.status === "pending",
    ).length,
    emailsAwaitingAck: events.filter(
      (e) =>
        e.channel === "email" && e.status === "pending" && e.ackSentAt === null,
    ).length,
    oldestPendingMinutes: pendingAges.length ? Math.max(...pendingAges) : 0,
  };

  return { rows, totals, generatedAt: now };
}
