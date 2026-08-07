import Link from "next/link";
import { Nav } from "@/components/Nav";
import {
  DeskStage,
  type DeskStageItem,
  type DeskStageView,
} from "@/components/DeskStage";
import { SampleShell } from "../SampleShell";
import { getRequestType } from "@/lib/catalog";
import { listThreads } from "@/lib/db";
import { formatDate, formatMoney, relativeAge } from "@/lib/format";
import { getSessionOperator } from "@/lib/session";
import type { Message, ThreadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Same order and wording the real /threads filter row uses. */
const STATUS_TABS: { id: ThreadStatus; label: string }[] = [
  { id: "waiting_uw", label: "Waiting UW" },
  { id: "needs_human", label: "Needs Human" },
  { id: "auto_approved", label: "Auto-Approved" },
  { id: "price_offered", label: "Price Offered" },
  { id: "drafting", label: "Drafting" },
  { id: "closed", label: "Closed" },
];

const STATUS_DOTS: Record<ThreadStatus, string> = {
  drafting: "bg-slate-400",
  waiting_uw: "bg-amber-500",
  price_offered: "bg-sky-500",
  auto_approved: "bg-emerald-500",
  needs_human: "bg-rose-500",
  closed: "bg-slate-300",
};

export default async function SampleThreadsPage() {
  const operator = await getSessionOperator();

  // Same set as the real /threads default view: every thread, most recently
  // touched first.
  const threads = listThreads();

  const tabs = STATUS_TABS.filter((s) =>
    threads.some((t) => t.status === s.id),
  );
  const statusLabel = (s: ThreadStatus) =>
    STATUS_TABS.find((t) => t.id === s)?.label ?? s;

  const items: DeskStageItem[] = threads.map((t) => ({
    id: t.id,
    meta: t.policy.carrier,
    dotClass: STATUS_DOTS[t.status],
    dotTitle: statusLabel(t.status),
    title: t.account.name,
    sub: `${getRequestType(t.requestType).label} · ${t.underwriter.name} · ${relativeAge(t.updatedAt)}`,
    tabIds: [t.status],
    searchText: [
      t.account.name,
      t.subject,
      t.policy.carrier,
      t.policy.policyNumber,
      t.underwriter.name,
      t.agentName,
      getRequestType(t.requestType).label,
      statusLabel(t.status),
    ].join(" "),
  }));

  const views: Record<string, DeskStageView> = {};
  for (const t of threads) {
    views[t.id] = {
      header: (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[12px] tracking-tight text-[var(--coral)]">
              {t.policy.policyNumber}
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
              {t.policy.carrier}
              <span className="mx-1.5 opacity-40">·</span>
              {t.underwriter.name}
              <span className="mx-1.5 opacity-40">·</span>
              {t.offeredPremiumCents != null
                ? formatMoney(t.offeredPremiumCents)
                : "No Price Yet"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {statusLabel(t.status)}
            </p>
            <Link
              href={`/threads/${t.id}`}
              className="text-sm font-medium text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--ink)]"
            >
              Open Thread
            </Link>
          </div>
        </div>
      ),
      panels: [
        {
          id: "conversation",
          title: "Conversation",
          subtitle: `${t.messages.length} Message${t.messages.length === 1 ? "" : "s"} · Chronological`,
          content: <MessageList messages={t.messages} />,
        },
        {
          id: "placement",
          title: "Placement",
          subtitle: `${t.policy.carrier} · ${t.underwriter.name}`,
          defaultOpen: false,
          content: (
            <div className="px-6 pb-6 sm:px-8">
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <PlacementRow label="Policy" value={t.policy.policyNumber} />
                <PlacementRow label="Carrier" value={t.policy.carrier} />
                <PlacementRow
                  label="Coverages"
                  value={t.policy.coverages.join(", ")}
                />
                <PlacementRow
                  label="Term"
                  value={`${t.policy.effectiveDate} – ${t.policy.expirationDate}`}
                />
                <PlacementRow
                  label="Annual Premium On File"
                  value={formatMoney(t.policy.premiumCents)}
                />
                <PlacementRow
                  label="Underwriter"
                  value={`${t.underwriter.name} <${t.underwriter.email}>`}
                />
                <PlacementRow label="Agent" value={t.agentName} />
                <PlacementRow
                  label="Opened"
                  value={formatDate(t.createdAt)}
                />
              </dl>
              {t.ticketId && (
                <Link
                  href={`/tickets/${t.ticketId}`}
                  className="mt-5 inline-block text-xs font-medium text-[var(--coral)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--coral)]"
                >
                  Open The Ticket Behind This Thread
                </Link>
              )}
            </div>
          ),
        },
      ],
    };
  }

  return (
    <>
      <Nav active="/threads" operator={operator} />
      <SampleShell
        backHref="/threads"
        backLabel="Back To Real Threads"
        eyebrow="Layout Preview · Thread Desk"
        title="Threads"
        description="Every market conversation the agent is watching, laid out
          as a rail of threads and a conversation stage — the same rows the
          real threads page lists."
      >
        <DeskStage
          railTitle="Thread Rail"
          searchPlaceholder="Account, subject, carrier…"
          tabs={tabs}
          items={items}
          views={views}
          emptyRailNote="No Threads Match."
          emptyStageNote="Select A Thread From The Rail."
        />
      </SampleShell>
    </>
  );
}

function MessageList({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <p className="px-6 pb-6 text-sm text-[var(--muted)] sm:px-8">
        No messages on this thread yet.
      </p>
    );
  }
  return (
    <ul className="max-h-[min(48vh,520px)] space-y-0 overflow-y-auto px-6 pb-6 sm:px-8">
      {messages.map((m) => (
        <li key={m.id} className="border-l-2 border-[var(--rule)] py-4 pl-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
              {m.direction === "inbound" ? "Inbound" : "Outbound"}
              <span className="mx-1.5 opacity-40">·</span>
              {m.party === "client" ? "Client" : "Underwriter"}
              <span className="mx-1.5 opacity-40">·</span>
              {m.channel}
            </p>
            <time className="font-mono text-[10px] text-[var(--muted)]">
              {formatDate(m.createdAt)}
            </time>
          </div>
          <p className="mt-1.5 text-sm font-medium text-[var(--ink)]">
            {m.subject || "(No Subject)"}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {m.toEmail ? `${m.toName} <${m.toEmail}>` : m.toName}
            {m.premiumImpactCents != null && (
              <>
                {" · "}
                {m.premiumImpactCents === 0
                  ? "No Charge"
                  : formatMoney(m.premiumImpactCents)}
              </>
            )}
          </p>
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[var(--ink)]/90">
            {m.body}
          </pre>
        </li>
      ))}
    </ul>
  );
}

function PlacementRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[var(--ink)]">{value}</dd>
    </div>
  );
}
