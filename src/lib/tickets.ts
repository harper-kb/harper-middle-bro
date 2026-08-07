import { getRequestType } from "./catalog";
import { AUTO_APPROVE_THRESHOLD_CENTS } from "./types";
import type {
  RequestTypeId,
  ThreadDetail,
  Ticket,
  TicketSource,
  TicketStatus,
} from "./types";

/**
 * Pure ticket helpers — safe on the client.
 * Status is never set by hand where it can be derived from the threads
 * underneath, so the queue can't drift from what actually happened.
 */

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  intake: "Intake",
  drafting: "Drafting",
  waiting_market: "Waiting On Market",
  needs_you: "Needs You",
  ready_to_issue: "Ready To Issue",
  delivered: "Delivered",
  closed: "Closed",
};

export const TICKET_STATUS_STYLES: Record<TicketStatus, string> = {
  intake: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  drafting: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
  waiting_market: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  needs_you: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
  ready_to_issue: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  delivered: "bg-emerald-600/10 text-emerald-900 ring-1 ring-emerald-300",
  closed: "bg-slate-50 text-slate-500 ring-1 ring-slate-200",
};

export const TICKET_SOURCE_LABELS: Record<TicketSource, string> = {
  producer: "Producer Relay",
  insured: "Insured Direct",
  portal: "Portal Request",
  email: "Inbound Email",
  sms: "Inbound Text",
  phone: "Phone Call",
  internal: "Service Request",
};

export const TICKET_SOURCES: TicketSource[] = [
  "producer",
  "insured",
  "portal",
  "email",
  "sms",
  "phone",
  "internal",
];

/** Lanes on the queue, in the order an operator should work them. */
export const TICKET_LANES: { id: TicketStatus[]; label: string }[] = [
  { id: ["needs_you", "intake", "drafting"], label: "Needs You" },
  { id: ["waiting_market"], label: "Waiting On Market" },
  { id: ["ready_to_issue"], label: "Ready To Issue" },
  { id: ["delivered", "closed"], label: "Delivered" },
];

export function ticketStatusLabel(status: TicketStatus): string {
  return TICKET_STATUS_LABELS[status];
}

export function ticketSourceLabel(source: TicketSource): string {
  return TICKET_SOURCE_LABELS[source];
}

export function isOpenTicket(status: TicketStatus): boolean {
  return status !== "delivered" && status !== "closed";
}

export function buildTicketTitle(input: {
  requestType: RequestTypeId;
  holderName?: string | null;
  accountName: string;
}): string {
  const label = getRequestType(input.requestType).label;
  return input.holderName?.trim()
    ? `${label} — ${input.holderName.trim()}`
    : `${label} — ${input.accountName}`;
}

/**
 * What the ticket status should be, given the market conversations under it.
 * Delivered and closed are terminal and set explicitly on the outcome.
 */
export function deriveTicketStatus(
  current: TicketStatus,
  threads: ThreadDetail[],
): TicketStatus {
  // Ready To Issue is reached deliberately — a no-charge answer or cleared
  // payment — and only the outcome moves it on.
  if (
    current === "delivered" ||
    current === "closed" ||
    current === "ready_to_issue"
  ) {
    return current;
  }
  if (threads.length === 0) return current === "drafting" ? "drafting" : "intake";

  const premiums = threads
    .map((t) => t.offeredPremiumCents)
    .filter((p): p is number => p != null);

  // A no-charge answer means the deliverable is ours to produce now.
  if (premiums.some((p) => p === 0)) return "ready_to_issue";
  if (threads.some((t) => t.status === "needs_human")) return "needs_you";
  if (premiums.some((p) => p > AUTO_APPROVE_THRESHOLD_CENTS)) return "needs_you";
  if (threads.some((t) => t.status === "waiting_uw")) return "waiting_market";
  if (threads.every((t) => t.status === "closed")) return "ready_to_issue";
  if (threads.some((t) => t.status === "auto_approved")) return "ready_to_issue";
  return "waiting_market";
}

/** Threads per ticket is the sprawl number — one ask, one conversation is the goal. */
export function ticketTouchCounts(threads: ThreadDetail[]) {
  const outbound = threads.reduce(
    (n, t) => n + t.messages.filter((m) => m.role !== "underwriter").length,
    0,
  );
  const inbound = threads.reduce(
    (n, t) => n + t.messages.filter((m) => m.role === "underwriter").length,
    0,
  );
  return { threads: threads.length, outbound, inbound, total: outbound + inbound };
}

/** Same account, same request, same holder, opened twice. */
export function duplicateKey(t: Ticket): string {
  return [
    t.accountId,
    t.requestType,
    (t.holderName ?? "").trim().toLowerCase(),
  ].join("|");
}
