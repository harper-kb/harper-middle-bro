import type { IntakeEvent, WorkItem } from "@/lib/types";

export type CommHygiene =
  | "needs_ack"
  | "needs_ticket"
  | "needs_assignment"
  | "awaiting_response"
  | "complete"
  | "missed_thread";

export function classifyIntakeHygiene(event: Pick<IntakeEvent, "status" | "ackSentAt" | "channel" | "callMissed" | "ticketId">): CommHygiene {
  if (event.status === "dismissed" || event.status === "ticketed" || event.status === "merged") {
    return event.status === "dismissed" ? "complete" : "complete";
  }
  if (event.channel === "call" && event.callMissed && !event.ticketId) return "needs_ticket";
  if (!event.ackSentAt && event.channel === "email") return "needs_ack";
  if (!event.ticketId) return "needs_ticket";
  return "needs_assignment";
}

export function classifyCommWorkItem(item: WorkItem): CommHygiene {
  const hay = `${item.title} ${item.summary}`.toLowerCase();
  if (/awaiting|waiting on/.test(hay)) return "awaiting_response";
  if (/missed|no reply|stale thread/.test(hay)) return "missed_thread";
  if (/ack|acknowledge/.test(hay)) return "needs_ack";
  if (/assign/.test(hay)) return "needs_assignment";
  if (/complete|done|closed/.test(hay)) return "complete";
  return "needs_ticket";
}

export const COMM_HYGIENE_LABELS: Record<CommHygiene, string> = {
  needs_ack: "Needs Acknowledgment",
  needs_ticket: "Needs Ticket",
  needs_assignment: "Needs Assignment",
  awaiting_response: "Awaiting Response",
  complete: "Complete",
  missed_thread: "Missed Thread",
};
