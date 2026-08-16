import { getRequestType } from "@/lib/catalog";
import { formatDate, formatMoney } from "@/lib/format";
import { ticketSourceLabel, ticketStatusLabel } from "@/lib/tickets";
import { loopReasonLabel } from "@/lib/types";
import type { TicketDetail } from "@/lib/types";

interface Entry {
  at: string;
  title: string;
  detail: string;
  tone: "neutral" | "good" | "warn" | "bad";
}

/** The audit trail — intake through outcome, in one column, no interpretation. */
export function TicketActivity({ ticket }: { ticket: TicketDetail }) {
  const entries: Entry[] = [
    {
      at: ticket.createdAt,
      title: `Ticket Opened — ${ticketSourceLabel(ticket.source)}`,
      detail: `${ticket.requestedBy}${ticket.requestedByEmail ? ` (${ticket.requestedByEmail})` : ""} asked for ${getRequestType(ticket.requestType).label}. Subject: “${ticket.subject}”`,
      tone: "neutral",
    },
  ];

  for (const doc of ticket.docs) {
    entries.push({
      at: ticket.createdAt,
      title: `Document Filed — ${doc.name}`,
      detail: doc.trusted
        ? "Trusted source — usable for limits and forms."
        : "Customer upload — acknowledged and filed, never a limits source.",
      tone: doc.trusted ? "neutral" : "warn",
    });
  }

  for (const thread of ticket.threads) {
    entries.push({
      at: thread.createdAt,
      title: `Thread Opened — ${thread.underwriter.name}`,
      detail: `${thread.policy.carrier} ${thread.policy.policyNumber} · sent by ${thread.agentName}`,
      tone: "neutral",
    });

    for (const m of thread.messages) {
      if (m.direction === "inbound") {
        entries.push({
          at: m.createdAt,
          title: `Reply From ${thread.underwriter.name}`,
          detail:
            m.premiumImpactCents == null
              ? m.subject || thread.subject
              : m.premiumImpactCents === 0
                ? "No additional premium — certificate is ours to issue."
                : `Quoted ${formatMoney(m.premiumImpactCents)}`,
          tone: m.premiumImpactCents === 0 ? "good" : "warn",
        });
        continue;
      }

      entries.push({
        at: m.createdAt,
        title:
          m.party === "client"
            ? `Sent To ${thread.account.name}`
            : `Sent To ${m.toName || thread.underwriter.name}`,
        detail: [
          m.subject || thread.subject,
          m.channel && m.channel !== "email" ? `via ${m.channel}` : null,
          m.loopReason ? `Loop: ${loopReasonLabel(m.loopReason)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        tone: m.loopReason ? "warn" : "neutral",
      });
    }
  }

  if (ticket.closedAt) {
    entries.push({
      at: ticket.closedAt,
      title: `Ticket ${ticketStatusLabel(ticket.status)}`,
      detail: "Outcome shipped — nothing left owed on this request.",
      tone: "good",
    });
  }

  entries.sort((a, b) => a.at.localeCompare(b.at));

  return (
    <ol className="relative space-y-4 border-l border-[var(--rule)] pl-5">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="relative">
          <span
            className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ${
              e.tone === "good"
                ? "bg-emerald-500"
                : e.tone === "warn"
                  ? "bg-amber-500"
                  : e.tone === "bad"
                    ? "bg-rose-500"
                    : "bg-[var(--muted)]/50"
            }`}
          />
          <p className="text-sm font-medium text-[var(--ink)]">{e.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
            {e.detail}
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">
            {formatDate(e.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}
