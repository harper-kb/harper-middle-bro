import Link from "next/link";
import { DeskSection } from "@/components/DeskSection";
import { Nav } from "@/components/Nav";
import { StatusPill } from "@/components/StatusPill";
import { CARRIERS, REQUEST_TYPES, getRequestType } from "@/lib/catalog";
import { getOversightStats } from "@/lib/db";
import { resetDbAction } from "@/lib/actions";
import { formatMoney } from "@/lib/format";
import { getSessionOperator } from "@/lib/session";
import type { RequestTypeId, ThreadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OversightPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    carrier?: string;
    type?: string;
    band?: string;
    day?: string;
  }>;
}) {
  const sp = await searchParams;
  const operator = await getSessionOperator();

  const status = (sp.status as ThreadStatus | "all" | undefined) ?? "all";
  const carrier = sp.carrier ?? "all";
  const requestType = (sp.type as RequestTypeId | "all" | undefined) ?? "all";
  const premiumBand =
    (sp.band as "all" | "under" | "over" | undefined) ?? "all";
  const day = (sp.day as "today" | "all" | undefined) ?? "all";

  const stats = getOversightStats({
    status,
    carrier,
    requestType,
    premiumBand,
    day,
  });

  function href(patch: Record<string, string>) {
    const next = {
      status,
      carrier,
      type: requestType,
      band: premiumBand,
      day,
      ...patch,
    };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v && v !== "all") params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/oversight?${qs}` : "/oversight";
  }

  return (
    <>
      <Nav active="/oversight" operator={operator} />
      <main className="mx-auto max-w-[1200px] px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Oversight Board</p>
            <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
              Agent Tracking
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              What agents are watching and what premium is on the table.
            </p>
          </div>
          <form action={resetDbAction}>
            <button type="submit" className="btn-ghost text-[var(--coral)]">
              Reset Demo Data
            </button>
          </form>
        </div>

        <div className="mb-5 flex flex-wrap gap-1.5">
          <Link
            href={href({ day: day === "today" ? "all" : "today" })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              day === "today"
                ? "bg-[var(--coral)] text-white"
                : "bg-white ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
            }`}
          >
            Today
          </Link>
          <Link
            href={href({ band: premiumBand === "under" ? "all" : "under" })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              premiumBand === "under"
                ? "bg-emerald-700 text-white"
                : "bg-white ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
            }`}
          >
            ≤ $500
          </Link>
          <Link
            href={href({ band: premiumBand === "over" ? "all" : "over" })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              premiumBand === "over"
                ? "bg-rose-700 text-white"
                : "bg-white ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
            }`}
          >
            &gt; $500
          </Link>
          {CARRIERS.slice(0, 6).map((c) => (
            <Link
              key={c}
              href={href({ carrier: carrier === c ? "all" : c })}
              className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                carrier === c
                  ? "bg-[var(--ink)] text-white"
                  : "bg-white ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
              }`}
            >
              {c}
            </Link>
          ))}
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Open Threads" value={String(stats.openThreads)} />
          <Stat label="Waiting On Underwriter" value={String(stats.waitingUw)} />
          <Stat
            label="Auto-Approved"
            value={String(stats.autoApproved)}
            note={formatMoney(stats.autoApprovedCents)}
            tone="good"
          />
          <Stat
            label="Needs Human"
            value={String(stats.needsHuman)}
            note={formatMoney(stats.humanHeldCents)}
            tone={stats.needsHuman > 0 ? "warn" : "good"}
          />
        </div>

        <div className="mb-6">
        <DeskSection
          title="Breakdowns"
          summary={formatMoney(stats.totalOfferedCents)}
        >
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Total Offered Premium">
            <p className="font-display text-3xl text-[var(--ink)]">
              {formatMoney(stats.totalOfferedCents)}
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Auto-cleared {formatMoney(stats.autoApprovedCents)} · Held{" "}
              {formatMoney(stats.humanHeldCents)}
            </p>
          </Panel>
          <Panel title="By Carrier">
            <ul className="space-y-2">
              {stats.byCarrier.slice(0, 6).map((c) => (
                <li
                  key={c.carrier}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span>{c.carrier}</span>
                  <span className="tabular-nums text-[var(--muted)]">
                    {c.count} · {formatMoney(c.offeredCents)}
                  </span>
                </li>
              ))}
              {stats.byCarrier.length === 0 && (
                <li className="text-xs text-[var(--muted)]">No data yet.</li>
              )}
            </ul>
          </Panel>
          <Panel title="By Request Type">
            <ul className="space-y-2">
              {stats.byRequestType.slice(0, 6).map((r) => (
                <li
                  key={r.requestType}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span>{getRequestType(r.requestType).shortLabel}</span>
                  <span className="text-[var(--muted)]">{r.count}</span>
                </li>
              ))}
              {stats.byRequestType.length === 0 && (
                <li className="text-xs text-[var(--muted)]">No data yet.</li>
              )}
            </ul>
          </Panel>
        </div>
        </DeskSection>
        </div>

        <div className="mb-3 flex flex-wrap gap-1">
          {REQUEST_TYPES.slice(0, 8).map((r) => (
            <Link
              key={r.id}
              href={href({ type: requestType === r.id ? "all" : r.id })}
              className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                requestType === r.id
                  ? "bg-[var(--coral)] text-white"
                  : "bg-white ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
              }`}
            >
              {r.shortLabel}
            </Link>
          ))}
        </div>

        {/* —— Thread ledger: aligned rows and columns —— */}
        <div className="overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--paper)]">
          <div className="hidden gap-3 border-b border-[var(--rule)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_6rem_8rem]">
            <span>Account</span>
            <span>Type / Carrier</span>
            <span className="text-right">Premium</span>
            <span>Status</span>
          </div>
          <ul className="divide-y divide-[var(--rule)]">
            {stats.threads.slice(0, 40).map((t) => (
              <li key={t.id}>
                <Link
                  href={`/threads/${t.id}`}
                  className="row-link grid grid-cols-1 items-center gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_6rem_8rem] md:gap-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {t.account.name}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--muted)]">
                      {t.agentName}
                    </span>
                  </span>
                  <span className="truncate text-xs text-[var(--ink)]">
                    {getRequestType(t.requestType).shortLabel} ·{" "}
                    {t.policy.carrier}
                  </span>
                  <span className="text-xs font-medium tabular-nums md:text-right">
                    {t.offeredPremiumCents != null
                      ? formatMoney(t.offeredPremiumCents)
                      : "—"}
                  </span>
                  <span>
                    <StatusPill status={t.status} />
                  </span>
                </Link>
              </li>
            ))}
            {stats.threads.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                Nothing to oversee yet.{" "}
                <Link href="/" className="underline">
                  Send from Sandbox
                </Link>
                .
              </li>
            )}
          </ul>
        </div>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const color =
    tone === "good"
      ? "text-emerald-800"
      : tone === "warn"
        ? "text-rose-800"
        : "text-[var(--ink)]";
  return (
    <div className="surface-card p-4">
      <p className="eyebrow">{label}</p>
      <p className={`mt-1 font-display text-3xl tabular-nums ${color}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-[var(--muted)]">{note}</p>}
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface-card p-5">
      <p className="eyebrow mb-3">{title}</p>
      {children}
    </div>
  );
}
