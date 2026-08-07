import Link from "next/link";
import { Nav } from "@/components/Nav";
import {
  DeskStage,
  type DeskStageItem,
  type DeskStageView,
} from "@/components/DeskStage";
import { SampleShell } from "../SampleShell";
import { SERVICE_MAILBOX } from "@/lib/brand";
import { getRequestType } from "@/lib/catalog";
import { listComms } from "@/lib/comms";
import { formatDate, formatMoney } from "@/lib/format";
import { getSessionOperator } from "@/lib/session";
import { ticketStatusLabel } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function SampleCommsPage() {
  const operator = await getSessionOperator();

  // Same stream the real /comms Emails view shows: every market-facing
  // message, newest first.
  const rows = listComms();

  const tabs = [
    { id: "outbound", label: "Outbound" },
    { id: "inbound", label: "Inbound" },
  ].filter((t) => rows.some((r) => r.message.direction === t.id));

  const items: DeskStageItem[] = rows.map((r) => ({
    id: r.message.id,
    meta: `Touch ${r.touch} · ${r.message.channel}`,
    dotClass:
      r.message.direction === "outbound" ? "bg-sky-500" : "bg-emerald-500",
    dotTitle: r.message.direction === "outbound" ? "Outbound" : "Inbound",
    title: r.message.subject || "(No Subject)",
    sub: `${r.ticket.account.name} · ${r.thread.underwriter.name}`,
    tabIds: [r.message.direction],
    searchText: [
      r.message.subject,
      r.message.body,
      r.message.toName,
      r.ticket.account.name,
      r.ticket.srNumber,
      r.thread.underwriter.name,
      r.thread.policy.carrier,
    ].join(" "),
  }));

  const views: Record<string, DeskStageView> = {};
  for (const r of rows) {
    const m = r.message;
    views[m.id] = {
      header: (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[12px] tracking-tight text-[var(--coral)]">
              {r.ticket.srNumber || "SR —"}
            </p>
            <h2 className="mt-1 font-display text-[clamp(1.75rem,3vw,2.35rem)] leading-none tracking-[-0.02em] text-[var(--ink)]">
              {r.ticket.account.name}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
              {m.subject || "(No Subject)"}
            </p>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {m.direction === "inbound" ? "Inbound" : "Outbound"}
              <span className="mx-1.5 opacity-40">·</span>
              {m.channel}
              <span className="mx-1.5 opacity-40">·</span>
              Touch {r.touch} On This Ticket
              <span className="mx-1.5 opacity-40">·</span>
              {formatDate(m.createdAt)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {m.party === "client" ? "Client" : "Underwriter"}
            </p>
            <Link
              href={`/tickets/${r.ticket.id}`}
              className="text-sm font-medium text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--ink)]"
            >
              Open Ticket
            </Link>
          </div>
        </div>
      ),
      panels: [
        {
          id: "message",
          title: "Message",
          subtitle: m.toEmail
            ? `To ${m.toName} <${m.toEmail}>`
            : `To ${m.toName}`,
          content: (
            <div className="px-6 pb-6 sm:px-8">
              <p className="text-xs text-[var(--muted)]">
                {m.direction === "outbound"
                  ? `From ${SERVICE_MAILBOX}`
                  : `To ${SERVICE_MAILBOX}`}
                <span className="mx-1.5 opacity-40">·</span>
                {r.thread.underwriter.name} · {r.thread.policy.carrier}
                {m.premiumImpactCents != null && (
                  <>
                    <span className="mx-1.5 opacity-40">·</span>
                    {m.premiumImpactCents === 0
                      ? "No Charge"
                      : formatMoney(m.premiumImpactCents)}
                  </>
                )}
              </p>
              <pre className="mt-4 max-h-[min(44vh,480px)] overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[var(--ink)]/90">
                {m.body}
              </pre>
            </div>
          ),
        },
        {
          id: "ticket",
          title: "Ticket Context",
          subtitle: `${r.ticket.srNumber || "SR —"} · ${ticketStatusLabel(r.ticket.status)}`,
          defaultOpen: false,
          content: (
            <div className="px-6 pb-6 sm:px-8">
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <ContextRow label="SR" value={r.ticket.srNumber || "—"} />
                <ContextRow
                  label="Status"
                  value={ticketStatusLabel(r.ticket.status)}
                />
                <ContextRow
                  label="Request Type"
                  value={getRequestType(r.ticket.requestType).label}
                />
                <ContextRow label="Subject" value={r.ticket.subject} />
              </dl>
              <Link
                href={`/threads/${r.thread.id}`}
                className="mt-5 inline-block text-xs font-medium text-[var(--coral)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--coral)]"
              >
                Open The Full Thread
              </Link>
            </div>
          ),
        },
        {
          id: "composer",
          title: "Composer",
          subtitle: "Read-Only Mock — Sending Lives On The Real Pages",
          defaultOpen: false,
          content: (
            <div className="px-6 pb-6 sm:px-8">
              <div className="surface-card px-5 py-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="chip">Read-Only Mock</span>
                  <span className="text-[11px] text-[var(--muted)]">
                    Prefilled From The Selected Message — Nothing Sends From
                    Here
                  </span>
                </div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  To
                </label>
                <input
                  className="field mb-3 opacity-70"
                  value={m.toEmail ? `${m.toName} <${m.toEmail}>` : m.toName}
                  disabled
                  readOnly
                />
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Subject
                </label>
                <input
                  className="field mb-3 opacity-70"
                  value={m.subject || "(No Subject)"}
                  disabled
                  readOnly
                />
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Body
                </label>
                <textarea
                  className="field mb-4 min-h-28 opacity-70"
                  placeholder="Drafting is disabled in this layout sample."
                  disabled
                  readOnly
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-primary cursor-not-allowed px-4 py-1.5 text-xs opacity-40"
                    disabled
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    className="btn-ghost cursor-not-allowed text-xs opacity-40"
                    disabled
                  >
                    Save Draft
                  </button>
                </div>
              </div>
            </div>
          ),
        },
      ],
    };
  }

  return (
    <>
      <Nav active="/comms" operator={operator} />
      <SampleShell
        backHref="/comms"
        backLabel="Back To Real Comms"
        eyebrow="Layout Preview · Everything Market-Facing"
        title="Comms"
        description="The same message stream the real comms page counts, laid
          out as a rail of touches and a reading stage — with a read-only
          composer mock to show where a reply would live."
      >
        <DeskStage
          railTitle="Message Stream"
          searchPlaceholder="Subject, account, desk…"
          tabs={tabs}
          items={items}
          views={views}
          emptyRailNote="No Messages Match."
          emptyStageNote="Select A Message From The Stream."
        />
      </SampleShell>
    </>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[var(--ink)]">{value}</dd>
    </div>
  );
}
