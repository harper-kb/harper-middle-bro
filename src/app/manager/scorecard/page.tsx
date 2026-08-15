import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { DeskSection } from "@/components/DeskSection";
import { Nav } from "@/components/Nav";
import {
  PersonScorecardTable,
  PodScorecardTable,
  ShadowBanner,
} from "@/components/ServiceScorecard";
import { assumeManagerRoleAction } from "@/lib/desk-actions";
import { SAVE_GATE_LABELS } from "@/lib/retention/saves";
import { loadScorecard } from "@/lib/retention/scorecard.server";
import { formatCents } from "@/lib/retention/scorecard";
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
      <main className="mx-auto max-w-[1400px] px-4 py-8 lg:px-8">{children}</main>
    </div>
  );
}

export default async function ServiceScorecardPage() {
  const operator = await getSessionOperator();

  if (!operator) {
    return (
      <Shell operator={operator}>
        <section className="surface-card max-w-xl space-y-4 p-6">
          <p className="eyebrow">Sign In Required</p>
          <h2 className="font-display text-2xl text-[var(--ink)]">
            Sign In For The Service Scorecard
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
            The pod board is scoped to the manager role. Your own numbers are on{" "}
            <Link href="/me" className="underline">
              your desk
            </Link>
            .
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

  const view = await loadScorecard();
  const totalRetained = view.pods.reduce(
    (n, p) =>
      n + (p.metrics.find((m) => m.key === "retained_commission")?.value ?? 0),
    0,
  );
  const skipped = view.projection.skipped.filter((s) => s.reason !== "not_saved");

  return (
    <Shell operator={operator}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Manager</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            Service Scorecard
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
            Pods are paid on retained commission — the account is still here.
            Each lane carries a different economic verb, because keeping money,
            completing money, and issuing a certificate fast are not the same
            job.
          </p>
        </div>
        <Link href="/manager" className="btn-ghost text-sm">
          Back To Manager Desk
        </Link>
      </div>

      <div className="mb-5">
        <ShadowBanner
          period={view.period}
          ledgerNote={view.ledgerNote}
          packNote={view.packNote}
        />
      </div>

      <DeskSection
        title="Pod Board"
        summary={`${formatCents(totalRetained)} Retained`}
        defaultOpen
        flush
      >
        <PodScorecardTable pods={view.pods} />
      </DeskSection>

      <div className="mt-5">
        <DeskSection
          title="Per Person"
          summary={`${view.people.length} Seats`}
          defaultOpen
          flush
        >
          <PersonScorecardTable people={view.people} />
        </DeskSection>
      </div>

      <div className="mt-5">
        <DeskSection
          title="Uncredited And Gated"
          summary={`${skipped.length} Windows`}
        >
          <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
            Saves that paid nobody, and why. This list is the point of the
            program as much as the paid column is — a save with no decisive
            action in the record is work that either automation did or that
            happened somewhere the ledger cannot see.
          </p>
          {skipped.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
              Every Closed Window Was Credited.
            </p>
          ) : (
            <ul className="space-y-2">
              {skipped.map((s) => (
                <li
                  key={s.windowId}
                  className="surface-card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">
                      {s.accountId}
                    </p>
                    <p className="truncate text-[11px] text-[var(--muted)]">
                      {s.detail}
                    </p>
                  </div>
                  <span className="chip shrink-0 text-[11px]">
                    {s.reason === "unvalued"
                      ? "Unvalued Window"
                      : (SAVE_GATE_LABELS[
                          s.reason as keyof typeof SAVE_GATE_LABELS
                        ] ?? s.reason)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DeskSection>
      </div>
    </Shell>
  );
}
