import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import { ManagerKpiBoard } from "@/components/ManagerKpiBoard";
import {
  sampleHeadlineKpis,
  sampleQueueHealth,
  type KpiRange,
} from "@/lib/manager/kpis";
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

export default async function ManagerKpisPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const operator = await getSessionOperator();
  const params = await searchParams;
  const range = (
    ["today", "trailing_7", "mtd", "custom"].includes(params.range ?? "")
      ? params.range
      : "today"
  ) as KpiRange;

  if (!operator) {
    return (
      <Shell operator={operator}>
        <section className="surface-card max-w-xl space-y-4 p-6">
          <p className="eyebrow">Sign In Required</p>
          <h2 className="font-display text-2xl text-[var(--ink)]">
            Sign In For Manager KPIs
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
            KPI Command Center is scoped to the manager role. Your seat (
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

  const headline = sampleHeadlineKpis(range);
  const queue = sampleQueueHealth();

  return (
    <Shell operator={operator}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Manager</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            KPI Command Center
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Today, trailing 7 days, month-to-date, and custom ranges.
            Incoming-call KPI intentionally omitted.
          </p>
        </div>
        <Link href="/manager" className="btn-ghost text-sm">
          Back To Manager Desk
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["today", "Today"],
            ["trailing_7", "Trailing 7"],
            ["mtd", "MTD"],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={`/manager/kpis?range=${id}`}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              range === id
                ? "bg-[var(--sand)] text-[var(--ink)]"
                : "text-[var(--muted)] hover:bg-[var(--sand)]/60"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      <ManagerKpiBoard headline={headline} queue={queue} />
    </Shell>
  );
}
