import Link from "next/link";
import { Nav } from "@/components/Nav";
import {
  DeskStage,
  type DeskStageItem,
  type DeskStageView,
} from "@/components/DeskStage";
import { SampleShell } from "../SampleShell";
import { getRequestType } from "@/lib/catalog";
import { listOperators, listTickets } from "@/lib/db";
import { formatDate, formatMoney, relativeAge } from "@/lib/format";
import { ageDays, premiumOnFileCents, sortTickets } from "@/lib/queue";
import { getSessionOperator } from "@/lib/session";
import { ticketSourceLabel, ticketStatusLabel } from "@/lib/tickets";
import type { TicketStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Pipeline order for the rail tabs — mirrors the queue board's status rank. */
const STATUS_ORDER: TicketStatus[] = [
  "needs_you",
  "intake",
  "drafting",
  "waiting_market",
  "ready_to_issue",
  "delivered",
  "closed",
];

const STATUS_DOTS: Record<TicketStatus, string> = {
  needs_you: "bg-rose-500",
  intake: "bg-slate-400",
  drafting: "bg-sky-500",
  waiting_market: "bg-amber-500",
  ready_to_issue: "bg-emerald-500",
  delivered: "bg-emerald-600",
  closed: "bg-slate-300",
};

export default async function SampleQueuePage() {
  const operator = await getSessionOperator();
  const operatorsById = Object.fromEntries(
    listOperators().map((o) => [o.id, o.displayName]),
  );

  // Same base set as the real /queue default view: every open ticket,
  // oldest first.
  const tickets = sortTickets(
    listTickets({ openOnly: true }),
    "age",
    "desc",
    operatorsById,
  );

  const tabs = STATUS_ORDER.filter((s) =>
    tickets.some((t) => t.status === s),
  ).map((s) => ({ id: s, label: ticketStatusLabel(s) }));

  const items: DeskStageItem[] = tickets.map((t) => {
    const owner = t.operatorId
      ? (operatorsById[t.operatorId] ?? "Assigned")
      : "Unclaimed";
    return {
      id: t.id,
      meta: t.srNumber || "—",
      dotClass: STATUS_DOTS[t.status],
      dotTitle: ticketStatusLabel(t.status),
      title: t.account.name,
      sub: `${getRequestType(t.requestType).label} · ${owner} · ${relativeAge(t.createdAt)}`,
      tabIds: [t.status],
      searchText: [
        t.srNumber,
        t.account.name,
        t.subject,
        t.title,
        t.holderName ?? "",
        getRequestType(t.requestType).label,
        ticketStatusLabel(t.status),
        owner,
      ].join(" "),
    };
  });

  const views: Record<string, DeskStageView> = {};
  for (const t of tickets) {
    const owner = t.operatorId
      ? (operatorsById[t.operatorId] ?? "Assigned")
      : "Unclaimed";
    const policies = t.policies.length ? t.policies : t.account.policies;

    views[t.id] = {
      header: (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[12px] tracking-tight text-[var(--coral)]">
              {t.srNumber || "SR —"}
            </p>
            <h2 className="mt-1 font-display text-[clamp(1.75rem,3vw,2.35rem)] leading-none tracking-[-0.02em] text-[var(--ink)]">
              {t.account.name}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
              {t.subject}
            </p>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {getRequestType(t.requestType).label}
              <span className="mx-1.5 opacity-40">·</span>
              {ticketSourceLabel(t.source)}
              <span className="mx-1.5 opacity-40">·</span>
              {ageDays(t.createdAt).toFixed(1)} Days Old
              <span className="mx-1.5 opacity-40">·</span>
              {owner}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {ticketStatusLabel(t.status)}
            </p>
            <Link
              href={`/tickets/${t.id}`}
              className="text-sm font-medium text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--ink)]"
            >
              Open Ticket
            </Link>
          </div>
        </div>
      ),
      panels: [
        {
          id: "triage",
          title: "Triage",
          subtitle: `${ticketStatusLabel(t.status)} · Requested By ${t.requestedBy}`,
          content: (
            <div className="px-6 pb-6 sm:px-8">
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <TriageRow label="Status" value={ticketStatusLabel(t.status)} />
                <TriageRow
                  label="Request Type"
                  value={getRequestType(t.requestType).label}
                />
                <TriageRow label="Source" value={ticketSourceLabel(t.source)} />
                <TriageRow
                  label="Requested By"
                  value={
                    t.requestedByEmail
                      ? `${t.requestedBy} <${t.requestedByEmail}>`
                      : t.requestedBy
                  }
                />
                <TriageRow label="Holder" value={t.holderName ?? "—"} />
                <TriageRow
                  label="Holder Address"
                  value={t.holderAddress ?? "—"}
                />
                <TriageRow
                  label="Premium On File"
                  value={formatMoney(premiumOnFileCents(t))}
                />
                <TriageRow label="Opened" value={formatDate(t.createdAt)} />
              </dl>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Link
                  href={`/tickets/${t.id}`}
                  className="btn-primary px-4 py-1.5 text-xs"
                >
                  Open Ticket
                </Link>
                <Link
                  href={`/trace?ticket=${t.id}`}
                  className="btn-ghost text-xs"
                >
                  View Trace
                </Link>
              </div>
            </div>
          ),
        },
        {
          id: "policies",
          title: "Policies",
          subtitle: t.policies.length
            ? `${t.policies.length} Linked To The Ticket`
            : `None Linked — Showing The Account Book (${t.account.policies.length})`,
          content: (
            <div className="px-6 pb-6 sm:px-8">
              {policies.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  No policies on file for this account.
                </p>
              ) : (
                <ul className="space-y-2">
                  {policies.map((p) => (
                    <li
                      key={p.id}
                      className="surface-card flex flex-wrap items-baseline justify-between gap-3 px-4 py-3"
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-xs text-[var(--ink)]">
                          {p.policyNumber}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--muted)]">
                          {p.carrier} · {p.coverages.join(", ")}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-3 text-[11px] text-[var(--muted)]">
                        <span className="font-mono">
                          {p.effectiveDate} – {p.expirationDate}
                        </span>
                        <span className="font-mono font-semibold text-[var(--ink)]">
                          {formatMoney(p.premiumCents)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ),
        },
        {
          id: "threads",
          title: "Market Threads",
          subtitle: `${t.threads.length} Conversation${t.threads.length === 1 ? "" : "s"} Under This Ticket`,
          defaultOpen: t.threads.length > 0,
          content: (
            <div className="px-6 pb-6 sm:px-8">
              {t.threads.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  Nothing has gone to a market yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {t.threads.map((th) => (
                    <li key={th.id}>
                      <Link
                        href={`/threads/${th.id}`}
                        className="surface-card flex flex-wrap items-baseline justify-between gap-3 px-4 py-3 transition hover:ring-1 hover:ring-[var(--gold)]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-[var(--ink)]">
                            {th.subject}
                          </span>
                          <span className="block truncate text-[11px] text-[var(--muted)]">
                            {th.policy.carrier} · {th.underwriter.name} ·{" "}
                            {th.messages.length} Message
                            {th.messages.length === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--muted)]">
                          {th.offeredPremiumCents != null
                            ? formatMoney(th.offeredPremiumCents)
                            : "No Price Yet"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ),
        },
      ],
    };
  }

  return (
    <>
      <Nav active="/queue" operator={operator} />
      <SampleShell
        backHref="/queue"
        backLabel="Back To Real Queue"
        eyebrow="Layout Preview · Service Requests"
        title="Queue"
        description="The same open tickets the real queue shows, laid out as a
          ledger rail and triage stage — pick an SR on the left, work it on the
          right."
      >
        <DeskStage
          railTitle="Ticket Rail"
          searchPlaceholder="SR, account, holder…"
          tabs={tabs}
          items={items}
          views={views}
          emptyRailNote="No Open Tickets Match."
          emptyStageNote="Select A Ticket From The Rail."
        />
      </SampleShell>
    </>
  );
}

function TriageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[var(--ink)]">{value}</dd>
    </div>
  );
}
