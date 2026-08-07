import Link from "next/link";
import { DeskSection } from "@/components/DeskSection";
import { Nav } from "@/components/Nav";
import { StatusPill } from "@/components/StatusPill";
import { CARRIERS, REQUEST_TYPES, getRequestType } from "@/lib/catalog";
import { listThreads } from "@/lib/db";
import { formatMoney, relativeAge } from "@/lib/format";
import { getSessionOperator } from "@/lib/session";
import type { RequestTypeId, ThreadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: { id: ThreadStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting_uw", label: "Waiting On UW" },
  { id: "needs_human", label: "Needs Human" },
  { id: "auto_approved", label: "Auto-Approved" },
  { id: "price_offered", label: "Price Offered" },
  { id: "closed", label: "Closed" },
];

export default async function ThreadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    carrier?: string;
    type?: string;
    band?: string;
    day?: string;
    q?: string;
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

  const threads = listThreads({
    status,
    carrier,
    requestType,
    premiumBand,
    day,
    q: sp.q,
  });

  function href(patch: Record<string, string>) {
    const next = {
      status,
      carrier,
      type: requestType,
      band: premiumBand,
      day,
      q: sp.q ?? "",
      ...patch,
    };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v && v !== "all" && !(k === "q" && !v)) params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/threads?${qs}` : "/threads";
  }

  return (
    <>
      <Nav active="/threads" operator={operator} />
      <main className="mx-auto max-w-[1200px] px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Thread Desk</p>
            <Link href="/samples/threads" className="chip mt-1.5 transition hover:border-[var(--coral)] hover:text-[var(--coral)]">Preview New Layout</Link>
            <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
              Underwriter (UW) Conversations
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              Every mock email thread the agent is watching.
            </p>
          </div>
          <Link href="/" className="btn-primary px-5 py-2">
            New From Sandbox
          </Link>
        </div>

        <form action="/threads" className="mb-4 flex flex-wrap gap-2">
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="carrier" value={carrier} />
          <input type="hidden" name="type" value={requestType} />
          <input type="hidden" name="band" value={premiumBand} />
          <input type="hidden" name="day" value={day} />
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search account, subject, carrier…"
            className="field max-w-sm"
          />
          <button type="submit" className="btn-ghost">
            Search
          </button>
        </form>

        <div className="mb-5 flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <Link
              key={s.id}
              href={href({ status: s.id })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                status === s.id
                  ? "bg-[var(--ink)] text-white"
                  : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
              }`}
            >
              {s.label}
            </Link>
          ))}
          <Link
            href={href({ day: day === "today" ? "all" : "today" })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              day === "today"
                ? "bg-[var(--coral)] text-white"
                : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
            }`}
          >
            Today
          </Link>
          <Link
            href={href({ band: premiumBand === "under" ? "all" : "under" })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              premiumBand === "under"
                ? "bg-emerald-700 text-white"
                : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
            }`}
          >
            ≤ $500
          </Link>
          <Link
            href={href({ band: premiumBand === "over" ? "all" : "over" })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              premiumBand === "over"
                ? "bg-rose-700 text-white"
                : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
            }`}
          >
            &gt; $500
          </Link>
        </div>

        <div className="mb-5">
          <DeskSection
            title="Carrier & Type Filters"
            summary={
              [carrier !== "all" ? 1 : 0, requestType !== "all" ? 1 : 0].reduce(
                (a, b) => a + b,
                0,
              ) === 0
                ? "None Active"
                : `${(carrier !== "all" ? 1 : 0) + (requestType !== "all" ? 1 : 0)} Active`
            }
            defaultOpen={carrier !== "all" || requestType !== "all"}
          >
            <div className="flex flex-wrap gap-1">
              <Link
                href={href({ carrier: "all" })}
                className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                  carrier === "all"
                    ? "bg-[var(--ink)] text-white"
                    : "bg-white ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
                }`}
              >
                All Carriers
              </Link>
              {CARRIERS.slice(0, 8).map((c) => (
                <Link
                  key={c}
                  href={href({ carrier: c })}
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
            <div className="mt-2 flex flex-wrap gap-1">
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
          </DeskSection>
        </div>

        {/* —— Thread ledger: aligned rows and columns —— */}
        <div className="overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--paper)]">
          <div className="hidden gap-3 border-b border-[var(--rule)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_6rem_8rem_4.5rem]">
            <span>Account</span>
            <span>Type / Carrier</span>
            <span className="text-right">Premium</span>
            <span>Status</span>
            <span className="text-right">Age</span>
          </div>
          <ul className="divide-y divide-[var(--rule)]">
            {threads.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/threads/${t.id}`}
                  className="row-link grid grid-cols-1 items-center gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_6rem_8rem_4.5rem] md:gap-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--ink)]">
                      {t.account.name}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--muted)]">
                      {t.underwriter.name} · {t.agentName}
                    </span>
                  </span>
                  <span className="truncate text-xs text-[var(--ink)]">
                    {getRequestType(t.requestType).shortLabel} ·{" "}
                    {t.policy.carrier}
                  </span>
                  <span className="text-xs font-medium tabular-nums text-[var(--ink)] md:text-right">
                    {t.offeredPremiumCents != null
                      ? formatMoney(t.offeredPremiumCents)
                      : "—"}
                  </span>
                  <span>
                    <StatusPill status={t.status} />
                  </span>
                  <span className="text-[11px] tabular-nums text-[var(--muted)] md:text-right">
                    {relativeAge(t.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
            {threads.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                No threads match.{" "}
                <Link href="/" className="underline">
                  Compose one in Sandbox
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
