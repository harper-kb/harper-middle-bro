import Link from "next/link";
import { Nav } from "@/components/Nav";
import { sampleWorkItemsForLane } from "@/lib/adapters/bigbrother/sample";
import { SERVICE_LANE_IDS } from "@/lib/types";
import {
  buildAgentDrilldowns,
  buildBlockedReasonAnalytics,
  reconcileSectionCounts,
} from "@/lib/manager/qa";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ManagerQaPage() {
  const operator = await getSessionOperator();
  const items = SERVICE_LANE_IDS.flatMap((lane) => sampleWorkItemsForLane(lane));
  const mix = buildBlockedReasonAnalytics(items);
  const agents = buildAgentDrilldowns(items);
  const sectionCounts = Object.fromEntries(
    SERVICE_LANE_IDS.map((lane) => [
      lane,
      sampleWorkItemsForLane(lane).length,
    ]),
  );
  const parity = reconcileSectionCounts(sectionCounts, items.length);

  return (
    <div>
      <Nav active="/manager" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Manager</p>
            <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
              QA & Agent Drilldowns
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              Handoffs, blocked-reason analytics, and per-agent open work.
              Counts must reconcile to section views.
            </p>
          </div>
          <Link href="/manager/kpis" className="btn-ghost text-sm">
            KPI Command Center
          </Link>
        </div>

        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            parity.ok
              ? "border-emerald-500/30 bg-emerald-500/5 text-[var(--ink)]"
              : "border-rose-500/40 bg-rose-500/10 text-[var(--ink)]"
          }`}
        >
          <span className="font-semibold">
            {parity.ok ? "Parity OK" : "Parity Break"}
          </span>
          {" — "}
          {parity.detail} (sample fixtures)
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="surface-card p-4">
            <h2 className="font-display text-xl text-[var(--ink)]">
              Blocked Reasons
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {mix.map((row) => (
                <li key={row.reason} className="flex justify-between gap-3">
                  <span>{row.reason}</span>
                  <span className="font-semibold">{row.count}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="surface-card p-4">
            <h2 className="font-display text-xl text-[var(--ink)]">
              Per-Agent Drilldown
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              {agents.map((a) => (
                <li
                  key={`${a.operatorId ?? a.displayName}`}
                  className="rounded-lg border border-[var(--rule)] px-3 py-2"
                >
                  <p className="font-semibold text-[var(--ink)]">
                    {a.displayName}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {a.openCount} open · {a.onFireCount} fire · {a.blockedCount}{" "}
                    blocked · oldest {a.oldestAgeHours}h
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
