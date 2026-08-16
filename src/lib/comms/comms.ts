import { listTickets } from "../db";
import { duplicateKey, ticketTouchCounts } from "../tickets/tickets";
import { loopReasonLabel } from "../types";
import type { Message, ThreadDetail, TicketDetail } from "../types";

/**
 * Everything market-facing, counted.
 *
 * The point isn't a prettier inbox — it's a denominator. Threads per ticket
 * and emails per ticket turn "we send a lot of email" into a number, and
 * loop reasons turn that number into a list of things to go kill.
 */

/** No reply after this long and the thread belongs in the chase queue. */
export const CHASE_AFTER_HOURS = 24;

export interface CommsRow {
  message: Message;
  thread: ThreadDetail;
  ticket: TicketDetail;
  /** Which touch this was on the ticket — 1 means first contact */
  touch: number;
}

export interface CommsFilters {
  q?: string;
  carrier?: string;
  underwriterId?: string;
  requestType?: string;
  direction?: "all" | "outbound" | "inbound";
  party?: "all" | "underwriter" | "client";
  channel?: string;
  operatorId?: string;
}

export function listComms(filters?: CommsFilters): CommsRow[] {
  const tickets = listTickets();
  const rows: CommsRow[] = [];

  for (const ticket of tickets) {
    const ordered = ticket.threads
      .flatMap((thread) => thread.messages.map((message) => ({ message, thread })))
      .sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt));

    ordered.forEach((r, i) => {
      rows.push({ ...r, ticket, touch: i + 1 });
    });
  }

  const q = filters?.q?.trim().toLowerCase();

  return rows
    .filter((r) => {
      if (filters?.carrier && filters.carrier !== "all") {
        if (r.thread.policy.carrier !== filters.carrier) return false;
      }
      if (filters?.underwriterId && filters.underwriterId !== "all") {
        if (r.thread.underwriterId !== filters.underwriterId) return false;
      }
      if (filters?.requestType && filters.requestType !== "all") {
        if (r.ticket.requestType !== filters.requestType) return false;
      }
      if (filters?.direction && filters.direction !== "all") {
        if (r.message.direction !== filters.direction) return false;
      }
      if (filters?.party && filters.party !== "all") {
        if (r.message.party !== filters.party) return false;
      }
      if (filters?.channel && filters.channel !== "all") {
        if (r.message.channel !== filters.channel) return false;
      }
      if (filters?.operatorId) {
        if (r.thread.operatorId !== filters.operatorId) return false;
      }
      if (q) {
        const hay = [
          r.ticket.account.name,
          r.message.subject,
          r.message.toName,
          r.message.body,
          r.thread.underwriter.name,
          r.thread.policy.carrier,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt));
}

export interface DeskStat {
  carrier: string;
  underwriter: string;
  touches: number;
  answers: number;
  avgHoursToAnswer: number | null;
  openThreads: number;
}

export interface ChaseRow {
  ticket: TicketDetail;
  thread: ThreadDetail;
  hoursWaiting: number;
  /** True when we already chased once — sending another is the waste */
  alreadyChased: boolean;
}

export interface DuplicateGroup {
  accountName: string;
  requestType: string;
  holderName: string;
  tickets: TicketDetail[];
}

export interface CommsSignals {
  tickets: number;
  contacted: number;
  threadsPerTicket: number;
  emailsPerTicket: number;
  closedOnFirstEmail: number;
  closedOnFirstEmailPct: number;
  resolved: number;
  loops: { id: string; label: string; count: number }[];
  untaggedLoops: number;
  duplicates: DuplicateGroup[];
  chase: ChaseRow[];
  desks: DeskStat[];
}

export function getCommsSignals(): CommsSignals {
  const tickets = listTickets();
  const contacted = tickets.filter((t) => t.threads.length > 0);

  const totalThreads = contacted.reduce((n, t) => n + t.threads.length, 0);
  const totalMessages = contacted.reduce(
    (n, t) => n + ticketTouchCounts(t.threads).total,
    0,
  );

  const resolvedTickets = tickets.filter(
    (t) =>
      t.status === "delivered" ||
      t.status === "closed" ||
      t.status === "ready_to_issue",
  );
  const firstPass = resolvedTickets.filter(
    (t) => ticketTouchCounts(t.threads).outbound === 1,
  );

  // ——— Loop reasons: every outbound after the first, tagged ———
  const loopTally = new Map<string, number>();
  let untagged = 0;
  for (const t of tickets) {
    const outbound = t.threads
      .flatMap((th) => th.messages)
      .filter((m) => m.direction === "outbound" && m.party === "underwriter")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const m of outbound.slice(1)) {
      if (m.loopReason) {
        loopTally.set(m.loopReason, (loopTally.get(m.loopReason) ?? 0) + 1);
      } else {
        untagged += 1;
      }
    }
  }

  const loops = [...loopTally.entries()]
    .map(([id, count]) => ({ id, label: loopReasonLabel(id), count }))
    .sort((a, b) => b.count - a.count);

  // ——— Duplicates: same account, request type, holder, opened twice ———
  const byKey = new Map<string, TicketDetail[]>();
  for (const t of tickets) {
    if (!t.holderName) continue;
    const k = duplicateKey(t);
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  const duplicates: DuplicateGroup[] = [...byKey.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      accountName: group[0].account.name,
      requestType: group[0].requestType,
      holderName: group[0].holderName ?? "",
      tickets: group,
    }));

  // ——— Chase queue: sent, no reply, past the line ———
  const now = Date.now();
  const chase: ChaseRow[] = [];
  for (const t of tickets) {
    if (t.status === "delivered" || t.status === "closed") continue;
    for (const thread of t.threads) {
      const lastInbound = [...thread.messages]
        .reverse()
        .find((m) => m.direction === "inbound");
      if (lastInbound) continue;

      const outbound = thread.messages.filter((m) => m.direction === "outbound");
      const first = outbound[0];
      if (!first) continue;

      const hours = Math.floor(
        (now - new Date(first.createdAt).getTime()) / 3_600_000,
      );
      if (hours < CHASE_AFTER_HOURS) continue;
      chase.push({
        ticket: t,
        thread,
        hoursWaiting: hours,
        alreadyChased: outbound.some((m) => m.loopReason === "chasing"),
      });
    }
  }
  chase.sort((a, b) => b.hoursWaiting - a.hoursWaiting);

  // ——— Slowest desks: who generates the volume ———
  const deskMap = new Map<string, DeskStat & { answerHours: number[] }>();
  for (const t of tickets) {
    for (const thread of t.threads) {
      const k = thread.underwriterId;
      const entry = deskMap.get(k) ?? {
        carrier: thread.policy.carrier,
        underwriter: thread.underwriter.name,
        touches: 0,
        answers: 0,
        avgHoursToAnswer: null,
        openThreads: 0,
        answerHours: [],
      };
      entry.touches += thread.messages.length;
      if (thread.status !== "closed") entry.openThreads += 1;

      const firstOut = thread.messages.find((m) => m.direction === "outbound");
      const firstIn = thread.messages.find((m) => m.direction === "inbound");
      if (firstOut && firstIn) {
        entry.answers += 1;
        entry.answerHours.push(
          (new Date(firstIn.createdAt).getTime() -
            new Date(firstOut.createdAt).getTime()) /
            3_600_000,
        );
      }
      deskMap.set(k, entry);
    }
  }

  const desks: DeskStat[] = [...deskMap.values()]
    .map((d) => ({
      carrier: d.carrier,
      underwriter: d.underwriter,
      touches: d.touches,
      answers: d.answers,
      avgHoursToAnswer:
        d.answerHours.length > 0
          ? d.answerHours.reduce((a, b) => a + b, 0) / d.answerHours.length
          : null,
      openThreads: d.openThreads,
    }))
    .sort((a, b) => b.touches - a.touches);

  return {
    tickets: tickets.length,
    contacted: contacted.length,
    threadsPerTicket: contacted.length ? totalThreads / contacted.length : 0,
    emailsPerTicket: contacted.length ? totalMessages / contacted.length : 0,
    closedOnFirstEmail: firstPass.length,
    closedOnFirstEmailPct: resolvedTickets.length
      ? (firstPass.length / resolvedTickets.length) * 100
      : 0,
    resolved: resolvedTickets.length,
    loops,
    untaggedLoops: untagged,
    duplicates,
    chase,
    desks,
  };
}
