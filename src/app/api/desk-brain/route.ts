import { NextResponse, type NextRequest } from "next/server";
import {
  buildDeskBrainBundle,
  type DeskWideBundle,
} from "@/lib/desk-brain";
import {
  getAccountDetail,
  getOperator,
  getTicketDetail,
  listAccounts,
  listDecisions,
  listIntakeEvents,
  listOperators,
  listQuoteSamples,
  listTickets,
} from "@/lib/db";
import { getPolicyFormSet } from "@/lib/forms";
import { getSessionOperator } from "@/lib/session";
import type { IntakeChannel, TicketStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Step Bro Bot context route. Assembles the Desk Brain bundle server-side
 * (the same assembly the account/ticket pages do inline) so the follow-you
 * dock can answer deterministically on any page. No question ever reaches
 * this route — it hands over structured data; the client engine answers.
 *
 *   ?ticket={idOrSr} → scoped ticket bundle
 *   ?account={id}    → scoped account bundle
 *   (none)           → desk-wide bundle
 */
export async function GET(request: NextRequest) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json({ error: "Sign In To Ask" }, { status: 401 });
  }
  const op = { id: operator.id, name: operator.displayName };
  const params = request.nextUrl.searchParams;
  const ticketParam = params.get("ticket");
  const accountParam = params.get("account");

  if (ticketParam) {
    const ticket = getTicketDetail(ticketParam);
    if (!ticket) {
      return NextResponse.json({ error: "Ticket Not Found" }, { status: 404 });
    }
    const bundle = buildDeskBrainBundle({
      account: ticket.account,
      formSets: Object.fromEntries(
        ticket.account.policies.map((p) => [p.id, getPolicyFormSet(p)]),
      ),
      ticket,
      ticketThreads: ticket.threads,
      decisions: listDecisions({ ticketId: ticket.id }).map((d) => ({
        headline: d.headline,
        kind: d.kind,
        createdAt: d.createdAt,
      })),
      quoteSamples: listQuoteSamples(),
    });
    return NextResponse.json({ operator: op, scope: "ticket", bundle });
  }

  if (accountParam) {
    const account = getAccountDetail(accountParam);
    if (!account) {
      return NextResponse.json({ error: "Account Not Found" }, { status: 404 });
    }
    const bundle = buildDeskBrainBundle({
      account,
      formSets: Object.fromEntries(
        account.policies.map((p) => [p.id, getPolicyFormSet(p)]),
      ),
      quoteSamples: listQuoteSamples(),
    });
    return NextResponse.json({ operator: op, scope: "account", bundle });
  }

  return NextResponse.json({
    operator: op,
    scope: "desk",
    bundle: buildDeskWideBundleFromDb(),
  });
}

const ALL_STATUSES: TicketStatus[] = [
  "intake",
  "drafting",
  "waiting_market",
  "needs_you",
  "ready_to_issue",
  "delivered",
  "closed",
];

const CHANNELS: IntakeChannel[] = ["email", "text", "call"];

function buildDeskWideBundleFromDb(): DeskWideBundle {
  const tickets = listTickets();
  const open = tickets.filter(
    (t) => t.status !== "delivered" && t.status !== "closed",
  );
  const today = new Date().toISOString().slice(0, 10);
  const pending = listIntakeEvents("pending");

  const openByOperator = new Map<string, number>();
  for (const t of open) {
    if (t.operatorId) {
      openByOperator.set(t.operatorId, (openByOperator.get(t.operatorId) ?? 0) + 1);
    }
  }

  return {
    ticketCounts: ALL_STATUSES.map((status) => ({
      status,
      count: tickets.filter((t) => t.status === status).length,
    })),
    openTicketCount: open.length,
    unclaimedOpenCount: open.filter((t) => t.operatorId == null).length,
    escalations: tickets
      .filter((t) => t.escalatedToId != null && t.escalationResolvedAt == null)
      .map((t) => ({
        ticketId: t.id,
        srNumber: t.srNumber,
        toName: t.escalatedToId
          ? (getOperator(t.escalatedToId)?.displayName ?? null)
          : null,
        dueBy: t.escalationDueBy,
      })),
    pendingIntake: CHANNELS.map((channel) => ({
      channel,
      count: pending.filter((e) => e.channel === channel).length,
    })),
    operators: listOperators().map((o) => ({
      id: o.id,
      name: o.displayName,
      openTickets: openByOperator.get(o.id) ?? 0,
    })),
    accounts: listAccounts().map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
    })),
    changedToday: tickets
      .filter((t) => t.updatedAt.slice(0, 10) === today)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((t) => ({
        ticketId: t.id,
        srNumber: t.srNumber,
        subject: t.subject,
        status: t.status,
      })),
  };
}
