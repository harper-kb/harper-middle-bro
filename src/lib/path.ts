import { formatMoney } from "./format";
import { ticketSourceLabel, ticketStatusLabel } from "./tickets";
import type { TicketDetail } from "./types";

/**
 * The shape of a request's journey.
 *
 * One lane per market desk, one node per message, left to right in time.
 * Two lanes means the request hit two desks — which is exactly the sprawl
 * the Signals view counts, drawn instead of tallied.
 */

export type NodeTone =
  | "intake"
  | "outbound"
  | "inbound"
  | "client"
  | "outcome";

export interface PathNode {
  id: string;
  col: number;
  lane: number;
  title: string;
  subtitle: string;
  detail: string;
  tone: NodeTone;
  messageId: string | null;
  at: string | null;
}

export interface PathEdge {
  from: string;
  to: string;
  /** A fan edge splits out of intake into a lane; flow edges run along one */
  kind: "flow" | "fan";
}

export interface TicketPath {
  nodes: PathNode[];
  edges: PathEdge[];
  cols: number;
  lanes: number;
}

export function buildTicketPath(ticket: TicketDetail): TicketPath {
  const nodes: PathNode[] = [];
  const edges: PathEdge[] = [];

  const laneCount = Math.max(ticket.threads.length, 1);
  const centerLane = (laneCount - 1) / 2;

  nodes.push({
    id: "intake",
    col: 0,
    lane: centerLane,
    title: ticketSourceLabel(ticket.source),
    subtitle: ticket.requestedBy,
    detail: ticket.subject,
    tone: "intake",
    messageId: null,
    at: ticket.createdAt,
  });

  let widest = 0;

  ticket.threads.forEach((thread, lane) => {
    const ordered = [...thread.messages].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    ordered.forEach((m, i) => {
      const col = i + 1;
      widest = Math.max(widest, col);

      const tone: NodeTone =
        m.party === "client"
          ? "client"
          : m.direction === "inbound"
            ? "inbound"
            : "outbound";

      nodes.push({
        id: m.id,
        col,
        lane,
        title:
          m.direction === "inbound"
            ? `From ${thread.underwriter.name.split(" ")[0]}`
            : m.party === "client"
              ? `To ${ticket.account.name}`
              : `To ${m.toName.split(" ")[0]}`,
        subtitle:
          m.premiumImpactCents == null
            ? (m.channel ?? "email")
            : m.premiumImpactCents === 0
              ? "No charge"
              : formatMoney(m.premiumImpactCents),
        detail: m.subject,
        tone,
        messageId: m.id,
        at: m.createdAt,
      });

      if (i === 0) {
        edges.push({ from: "intake", to: m.id, kind: "fan" });
      } else {
        edges.push({ from: ordered[i - 1].id, to: m.id, kind: "flow" });
      }
    });
  });

  const outcomeCol = widest + 1;
  nodes.push({
    id: "outcome",
    col: outcomeCol,
    lane: centerLane,
    title: ticketStatusLabel(ticket.status),
    subtitle: ticket.closedAt ? "Closed" : "Open",
    detail: ticket.title,
    tone: "outcome",
    messageId: null,
    at: ticket.closedAt ?? ticket.updatedAt,
  });

  for (const thread of ticket.threads) {
    const last = [...thread.messages].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )[thread.messages.length - 1];
    if (last) edges.push({ from: last.id, to: "outcome", kind: "fan" });
  }

  if (ticket.threads.length === 0) {
    edges.push({ from: "intake", to: "outcome", kind: "flow" });
  }

  return { nodes, edges, cols: outcomeCol + 1, lanes: laneCount };
}
