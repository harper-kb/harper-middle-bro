import Link from "next/link";
import { Nav } from "@/components/Nav";
import {
  DeskStage,
  type DeskStageItem,
  type DeskStageView,
} from "@/components/DeskStage";
import { SampleShell } from "../SampleShell";
import { IN_PLAY_LIMIT } from "@/lib/aidesk";
import { listTickets } from "@/lib/db";
import { formatDate, formatMoney, relativeAge } from "@/lib/format";
import { premiumOnFileCents } from "@/lib/queue";
import { getSessionOperator } from "@/lib/session";
import { ticketSourceLabel, ticketStatusLabel } from "@/lib/tickets";
import type { TicketDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

type Lane = "in_play" | "held" | "done";

const LANE_LABELS: Record<Lane, string> = {
  in_play: "In Play",
  held: "Held",
  done: "Done",
};

const LANE_DOTS: Record<Lane, string> = {
  in_play: "bg-emerald-500",
  held: "bg-amber-500",
  done: "bg-slate-300",
};

export default async function SampleAiDeskPage() {
  const operator = await getSessionOperator();

  // Same set the real AI Desk paces: every Additional Insured ticket, with
  // the first few pending ones in play and the rest held.
  const tickets = listTickets({ requestType: "additional_insured" });
  const pending = tickets
    .filter((t) => t.status === "intake" || t.status === "drafting")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const inPlayIds = new Set(pending.slice(0, IN_PLAY_LIMIT).map((t) => t.id));
  const pendingIds = new Set(pending.map((t) => t.id));

  const laneOf = (t: TicketDetail): Lane =>
    inPlayIds.has(t.id) ? "in_play" : pendingIds.has(t.id) ? "held" : "done";

  const ordered: TicketDetail[] = [
    ...pending,
    ...tickets.filter((t) => !pendingIds.has(t.id)),
  ];

  const tabs = (Object.keys(LANE_LABELS) as Lane[])
    .filter((lane) => ordered.some((t) => laneOf(t) === lane))
    .map((lane) => ({ id: lane, label: LANE_LABELS[lane] }));

  const items: DeskStageItem[] = ordered.map((t) => {
    const lane = laneOf(t);
    return {
      id: t.id,
      meta: t.srNumber || "—",
      dotClass: LANE_DOTS[lane],
      dotTitle: LANE_LABELS[lane],
      title: t.holderName ?? t.account.name,
      sub: `${t.account.name} · ${ticketStatusLabel(t.status)} · ${relativeAge(t.createdAt)}`,
      tabIds: [lane],
      searchText: [
        t.srNumber,
        t.account.name,
        t.holderName ?? "",
        t.subject,
        t.wording,
        ticketStatusLabel(t.status),
        LANE_LABELS[lane],
      ].join(" "),
    };
  });

  const views: Record<string, DeskStageView> = {};
  for (const t of ordered) {
    const lane = laneOf(t);
    views[t.id] = {
      header: (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[12px] tracking-tight text-[var(--coral)]">
              {t.srNumber || "SR —"}
            </p>
            <h2 className="mt-1 font-display text-[clamp(1.75rem,3vw,2.35rem)] leading-none tracking-[-0.02em] text-[var(--ink)]">
              {t.holderName ?? t.account.name}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
              {t.subject}
            </p>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {t.account.name}
              <span className="mx-1.5 opacity-40">·</span>
              {ticketSourceLabel(t.source)}
              <span className="mx-1.5 opacity-40">·</span>
              {LANE_LABELS[lane]}
              <span className="mx-1.5 opacity-40">·</span>
              Opened {formatDate(t.createdAt)}
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
          id: "request",
          title: "The Ask",
          subtitle: t.namedOnPolicyRequired
            ? "Holder Requires Being Named On The Policy"
            : "Blanket Wording May Satisfy The Holder",
          content: (
            <div className="px-6 pb-6 sm:px-8">
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <AskRow label="Holder" value={t.holderName ?? "—"} />
                <AskRow label="Holder Address" value={t.holderAddress ?? "—"} />
                <AskRow
                  label="Requested By"
                  value={
                    t.requestedByEmail
                      ? `${t.requestedBy} <${t.requestedByEmail}>`
                      : t.requestedBy
                  }
                />
                <AskRow
                  label="Fast Path Basis"
                  value={t.fastPathBasis ?? "None — Goes To The Market"}
                />
              </dl>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Required Wording
              </p>
              <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[var(--ink)]/90">
                {t.wording || "—"}
              </pre>
            </div>
          ),
        },
        {
          id: "book",
          title: "Account & Policies",
          subtitle: `${t.account.name} · ${formatMoney(premiumOnFileCents(t))} Premium On File`,
          defaultOpen: false,
          content: (
            <div className="px-6 pb-6 sm:px-8">
              {(t.policies.length ? t.policies : t.account.policies).length ===
              0 ? (
                <p className="text-sm text-[var(--muted)]">
                  No policies on file for this account.
                </p>
              ) : (
                <ul className="space-y-2">
                  {(t.policies.length ? t.policies : t.account.policies).map(
                    (p) => (
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
                        <span className="shrink-0 font-mono text-[11px] font-semibold text-[var(--ink)]">
                          {formatMoney(p.premiumCents)}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              )}
              <Link
                href={`/accounts/${t.accountId}`}
                className="mt-4 inline-block text-xs font-medium text-[var(--coral)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--coral)]"
              >
                Open Account
              </Link>
            </div>
          ),
        },
        {
          id: "comms",
          title: "Underwriter Comms",
          subtitle: `${t.threads.length} Thread${t.threads.length === 1 ? "" : "s"} On This Ticket`,
          defaultOpen: t.threads.length > 0,
          content: (
            <div className="px-6 pb-6 sm:px-8">
              {t.threads.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  Nothing sent to a market yet — the send itself stays on the
                  real AI Desk.
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
      <Nav active="/ai-desk" operator={operator} />
      <SampleShell
        backHref="/ai-desk"
        backLabel="Back To Real AI Desk"
        eyebrow="Layout Preview · One Request Type, Mastered"
        title="AI Desk"
        description="The same Additional Insured tickets the real desk paces —
          a few in play, the rest held — laid out as an activity rail and a
          working stage. Drafting and sending stay on the real desk."
      >
        <DeskStage
          railTitle="Activity Rail"
          searchPlaceholder="SR, holder, account…"
          tabs={tabs}
          items={items}
          views={views}
          emptyRailNote="No Additional Insured Tickets."
          emptyStageNote="Select A Ticket From The Rail."
        />
      </SampleShell>
    </>
  );
}

function AskRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[var(--ink)]">{value}</dd>
    </div>
  );
}
