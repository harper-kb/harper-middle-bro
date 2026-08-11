import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import { sampleWorkItemsForLane } from "@/lib/adapters/bigbrother/sample";
import { SERVICE_LANE_IDS } from "@/lib/types";
import {
  buildAgentDrilldowns,
  buildBlockedReasonAnalytics,
  reconcileSectionCounts,
} from "@/lib/manager/qa";
import { assumeManagerRoleAction } from "@/lib/desk-actions";
import { getSessionOperator } from "@/lib/session";
import type { ReactNode } from "react";
import type { Operator } from "@/lib/types";

export const dynamic = "force-dynamic";

function Shell({
  operator,
  children,
}: {
  operator: Operator | null;
  children: ReactNode;
}) {
  return (
    <div>
      <Nav active="/manager" operator={operator} />
      <main className="px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}

export default async function ManagerQaPage() {
  const operator = await getSessionOperator();

  if (!operator) {
    return (
      <Shell operator={operator}>
        <section className="surface-card max-w-xl space-y-4 p-6">
          <p className="eyebrow">Sign In Required</p>
          <h2 className="font-display text-2xl text-[var(--ink)]">
            Sign In For Manager QA
          </h2>
          <SignInButton mode="modal">
            <button type="button" className="btn-primary px-5 py-2">
              Sign In
            </button>
          </SignInButton>
        </section>
      </Shell>
    );
  }

  if (operator.role !== "manager") {
    return (
      <Shell operator={operator}>
        <section className="surface-card max-w-xl space-y-4 p-6">
          <p className="eyebrow">Role-Scoped Desk</p>
          <h2 className="font-display text-2xl text-[var(--ink)]">
            Manager Access Only
          </h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            QA & agent drilldowns are scoped to the manager role. Your seat (
            {operator.displayName}) is signed in as an operator.
          </p>
          <form action={assumeManagerRoleAction}>
            <button type="submit" className="btn-primary px-5 py-2">
              Assume Manager Seat (Sandbox)
            </button>
          </form>
        </section>
      </Shell>
    );
  }

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
    <Shell operator={operator}>
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
    </Shell>
  );
}
