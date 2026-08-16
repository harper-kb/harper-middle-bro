import { getRequestType } from "../catalog";
import { buildTicketPath, type TicketPath } from "../path";
import { ticketStatusLabel, ticketTouchCounts } from "../tickets/tickets";
import {
  hasModelStep,
  worstVerdict,
  type DecisionTrace,
  type StepVerdict,
} from "./trace";
import type { TicketDetail, TicketStatus } from "../types";

/**
 * Everything the explorer needs, flattened once on the server.
 *
 * The client gets plain data — no detail objects, no lazy lookups — so
 * selecting a node or scrubbing a chain never waits on a round trip.
 */

/** Flattened message for the manager review thread pane. */
export interface TraceThreadMessageView {
  id: string;
  threadId: string;
  desk: string;
  carrier: string;
  direction: "outbound" | "inbound";
  party: "underwriter" | "client";
  channel: string;
  subject: string;
  body: string;
  toName: string;
  toEmail: string | null;
  createdAt: string;
  premiumImpactCents: number | null;
}

export interface TraceTicketView {
  id: string;
  srNumber: string;
  account: string;
  subject: string;
  requestLabel: string;
  statusLabel: string;
  carriers: string[];
  threads: number;
  messages: number;
  path: TicketPath;
  /** messageId → decision id, so clicking a node lands on its reasoning */
  decisionByMessage: Record<string, string>;
  /** Chronological thread for manager review */
  threadMessages: TraceThreadMessageView[];
}

export interface TraceRowView {
  id: string;
  ticketId: string;
  srNumber: string;
  messageId: string | null;
  kind: string;
  author: string;
  headline: string;
  summary: string;
  createdAt: string;
  account: string;
  requestLabel: string;
  verdict: StepVerdict;
  hasModel: boolean;
  steps: DecisionTrace["steps"];
}

export function buildTraceViews(
  tickets: TicketDetail[],
  decisions: DecisionTrace[],
): { rows: TraceRowView[]; ticketViews: TraceTicketView[] } {
  const byId = new Map(tickets.map((t) => [t.id, t]));

  const rows: TraceRowView[] = decisions.map((d) => {
    const ticket = byId.get(d.ticketId);
    return {
      id: d.id,
      ticketId: d.ticketId,
      srNumber: ticket?.srNumber ?? "",
      messageId: d.messageId,
      kind: d.kind,
      author: d.author,
      headline: d.headline,
      summary: d.summary,
      createdAt: d.createdAt,
      account: ticket?.account.name ?? "Unknown Account",
      requestLabel: ticket
        ? getRequestType(ticket.requestType).label
        : "Unknown Request",
      verdict: worstVerdict(d.steps),
      hasModel: hasModelStep(d.steps),
      steps: d.steps,
    };
  });

  const touched = new Set(decisions.map((d) => d.ticketId));
  const ticketViews: TraceTicketView[] = tickets
    .filter((t) => touched.has(t.id))
    .map((ticket) => {
      const counts = ticketTouchCounts(ticket.threads);
      const decisionByMessage: Record<string, string> = {};
      for (const d of decisions) {
        if (d.ticketId === ticket.id && d.messageId) {
          decisionByMessage[d.messageId] = d.id;
        }
      }

      const threadMessages: TraceThreadMessageView[] = ticket.threads
        .flatMap((th) =>
          th.messages.map((m) => ({
            id: m.id,
            threadId: th.id,
            desk: th.underwriter.name,
            carrier: th.policy.carrier,
            direction: m.direction,
            party: m.party,
            channel: m.channel,
            subject: m.subject,
            body: m.body,
            toName: m.toName,
            toEmail: m.toEmail,
            createdAt: m.createdAt,
            premiumImpactCents: m.premiumImpactCents,
          })),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      return {
        id: ticket.id,
        srNumber: ticket.srNumber,
        account: ticket.account.name,
        subject: ticket.subject,
        requestLabel: getRequestType(ticket.requestType).label,
        statusLabel: ticketStatusLabel(ticket.status),
        carriers: [...new Set(ticket.policies.map((p) => p.carrier))],
        threads: counts.threads,
        messages: counts.total,
        path: buildTicketPath(ticket),
        decisionByMessage,
        threadMessages,
      };
    });

  return { rows, ticketViews };
}

/* ——— Overview level (zoom 0) ——— */

/**
 * The whole desk on one plane: a lane per carrier, a dot per ticket.
 * Everything below is counted from the same rows the drill levels render —
 * no number appears here that the ticket level would contradict.
 */

export type OverviewOutcome = "needs_you" | "waiting" | "ready" | "delivered";

export const OVERVIEW_OUTCOME_LABELS: Record<OverviewOutcome, string> = {
  needs_you: "Needs You",
  waiting: "Waiting On Market",
  ready: "Ready To Issue",
  delivered: "Delivered",
};

/** Worked-first order, matching the queue's lane order. */
export const OVERVIEW_OUTCOME_ORDER: OverviewOutcome[] = [
  "needs_you",
  "waiting",
  "ready",
  "delivered",
];

/** Same grouping the queue lanes use, so the two views never disagree. */
export function overviewOutcome(status: TicketStatus): OverviewOutcome {
  switch (status) {
    case "delivered":
    case "closed":
      return "delivered";
    case "ready_to_issue":
      return "ready";
    case "waiting_market":
      return "waiting";
    // intake, drafting, needs_you — all sit in the operator's court
    default:
      return "needs_you";
  }
}

export interface TraceOverviewTicket {
  id: string;
  srNumber: string;
  account: string;
  subject: string;
  requestLabel: string;
  statusLabel: string;
  outcome: OverviewOutcome;
  carriers: string[];
  threads: number;
  messages: number;
  decisions: number;
  autoSends: number;
  /** Issued on the blanket fast path — ready with zero threads, no market touch */
  fastPath: boolean;
  /** At least one decision logged — the only tickets the drill can land on */
  hasTrace: boolean;
  updatedAt: string;
}

export interface TraceOverviewLane {
  carrier: string;
  tickets: TraceOverviewTicket[];
  /** Decisions logged on tickets touching this carrier */
  decisions: number;
  autoSends: number;
  outcomes: Record<OverviewOutcome, number>;
}

export interface TraceOverviewTotals {
  tickets: number;
  /** Tickets with at least one decision logged */
  tracedTickets: number;
  decisions: number;
  autoSends: number;
  /** Decisions that carried at least one model step */
  modelDecisions: number;
  /** Blanket fast-path issues — counted honestly: ready, zero threads */
  fastPaths: number;
  outcomes: Record<OverviewOutcome, number>;
  lanes: number;
}

export interface TraceOverview {
  lanes: TraceOverviewLane[];
  totals: TraceOverviewTotals;
}

const NO_CARRIER_LANE = "No Carrier On File";

function emptyOutcomes(): Record<OverviewOutcome, number> {
  return { needs_you: 0, waiting: 0, ready: 0, delivered: 0 };
}

/**
 * A ticket spanning carriers appears in each of its lanes — that is the
 * point of a lane view — so lane counts sum past the totals. The totals
 * are computed over distinct tickets and distinct decisions.
 */
export function buildTraceOverview(
  tickets: TicketDetail[],
  decisions: DecisionTrace[],
): TraceOverview {
  const decisionsByTicket = new Map<string, DecisionTrace[]>();
  for (const d of decisions) {
    const list = decisionsByTicket.get(d.ticketId);
    if (list) list.push(d);
    else decisionsByTicket.set(d.ticketId, [d]);
  }

  const dots: TraceOverviewTicket[] = tickets.map((ticket) => {
    const counts = ticketTouchCounts(ticket.threads);
    const own = decisionsByTicket.get(ticket.id) ?? [];
    return {
      id: ticket.id,
      srNumber: ticket.srNumber,
      account: ticket.account.name,
      subject: ticket.subject,
      requestLabel: getRequestType(ticket.requestType).label,
      statusLabel: ticketStatusLabel(ticket.status),
      outcome: overviewOutcome(ticket.status),
      carriers: [...new Set(ticket.policies.map((p) => p.carrier))].sort(
        (a, b) => a.localeCompare(b),
      ),
      threads: counts.threads,
      messages: counts.total,
      decisions: own.length,
      autoSends: own.filter((d) => d.kind === "auto_send").length,
      fastPath: ticket.fastPathBasis != null,
      hasTrace: own.length > 0,
      updatedAt: ticket.updatedAt,
    };
  });

  // Freshest activity first; id breaks ties so the order never shuffles.
  dots.sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );

  const laneMap = new Map<string, TraceOverviewLane>();
  for (const dot of dots) {
    const laneKeys = dot.carriers.length ? dot.carriers : [NO_CARRIER_LANE];
    for (const key of laneKeys) {
      let lane = laneMap.get(key);
      if (!lane) {
        lane = {
          carrier: key,
          tickets: [],
          decisions: 0,
          autoSends: 0,
          outcomes: emptyOutcomes(),
        };
        laneMap.set(key, lane);
      }
      lane.tickets.push(dot);
      lane.decisions += dot.decisions;
      lane.autoSends += dot.autoSends;
      lane.outcomes[dot.outcome] += 1;
    }
  }

  const lanes = [...laneMap.values()].sort((a, b) => {
    const aNone = a.carrier === NO_CARRIER_LANE ? 1 : 0;
    const bNone = b.carrier === NO_CARRIER_LANE ? 1 : 0;
    return (
      aNone - bNone ||
      b.tickets.length - a.tickets.length ||
      a.carrier.localeCompare(b.carrier)
    );
  });

  const outcomes = emptyOutcomes();
  for (const dot of dots) outcomes[dot.outcome] += 1;

  return {
    lanes,
    totals: {
      tickets: dots.length,
      tracedTickets: dots.filter((d) => d.hasTrace).length,
      decisions: decisions.length,
      autoSends: decisions.filter((d) => d.kind === "auto_send").length,
      modelDecisions: decisions.filter((d) => hasModelStep(d.steps)).length,
      fastPaths: dots.filter((d) => d.fastPath).length,
      outcomes,
      lanes: lanes.length,
    },
  };
}
