"use client";

import { useTransition } from "react";
import Link from "next/link";
import {
  closeThreadAction,
  humanProceedAction,
  simulateQuoteAction,
} from "@/lib/actions";
import { getRequestType } from "@/lib/catalog";
import { formatDate, formatMoney } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";
import { UwCard } from "@/components/UwCard";
import { AUTO_APPROVE_THRESHOLD_CENTS, type ThreadDetail } from "@/lib/types";

export function ThreadDesk({ thread }: { thread: ThreadDetail }) {
  const [pending, startTransition] = useTransition();
  const req = getRequestType(thread.requestType);

  function run(action: (fd: FormData) => Promise<unknown>, dollars?: number) {
    const fd = new FormData();
    fd.set("threadId", thread.id);
    if (dollars != null) fd.set("dollars", String(dollars));
    startTransition(async () => {
      await action(fd);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.85fr]">
      <div className="space-y-4">
        <div className="glass rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{req.label}</p>
              <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
                {thread.subject}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {thread.account.name} · {thread.policy.policyNumber} ·{" "}
                {thread.policy.carrier}
              </p>
            </div>
            <StatusPill status={thread.status} />
          </div>
          {thread.offeredPremiumCents != null && (
            <p className="mt-4 text-sm text-[var(--ink)]">
              Offered Premium:{" "}
              <strong>{formatMoney(thread.offeredPremiumCents)}</strong>
              {thread.autoApproved || thread.status === "auto_approved"
                ? " · auto-approved"
                : thread.status === "needs_human"
                  ? ` · over ${formatMoney(AUTO_APPROVE_THRESHOLD_CENTS)} — needs human`
                  : null}
            </p>
          )}
        </div>

        <div className="glass rounded-2xl p-5">
          <p className="eyebrow mb-4">Conversation</p>
          <ol className="space-y-4">
            {thread.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-xl px-4 py-3 ring-1 ring-[var(--rule)] ${
                  m.role === "underwriter"
                    ? "bg-amber-50/60"
                    : m.role === "agent"
                      ? "bg-emerald-50/50"
                      : m.role === "human"
                        ? "bg-sky-50/60"
                        : "bg-white"
                }`}
              >
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {m.role}
                    {m.premiumImpactCents != null
                      ? ` · ${formatMoney(m.premiumImpactCents)}`
                      : ""}
                  </span>
                  <span className="text-[11px] text-[var(--muted)]">
                    {formatDate(m.createdAt)}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--ink)]">
                  {m.body}
                </pre>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <UwCard uw={thread.underwriter} role="Thread UW" />

        <div className="surface-card p-5">
          <p className="eyebrow mb-3">Demo Controls</p>
          <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
            Simulate an underwriter quote. ≤{" "}
            {formatMoney(AUTO_APPROVE_THRESHOLD_CENTS)} → agent proceeds
            automatically. Over that → needs human.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={pending || thread.status === "closed"}
              onClick={() => run(simulateQuoteAction, 250)}
              className="btn-primary disabled:opacity-40"
            >
              Simulate UW quote $250
            </button>
            <button
              type="button"
              disabled={pending || thread.status === "closed"}
              onClick={() => run(simulateQuoteAction, 1200)}
              className="btn-ghost disabled:opacity-40"
            >
              Simulate UW quote $1,200
            </button>
            <button
              type="button"
              disabled={pending || thread.status === "closed"}
              onClick={() => run(simulateQuoteAction, 0)}
              className="btn-ghost disabled:opacity-40"
            >
              Simulate No Additional Premium
            </button>
            {thread.status === "needs_human" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(humanProceedAction)}
                className="btn-primary disabled:opacity-40"
              >
                Human: proceed anyway
              </button>
            )}
            {thread.status !== "closed" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(closeThreadAction)}
                className="btn-ghost disabled:opacity-40"
              >
                Close Thread
              </button>
            )}
          </div>
        </div>

        {thread.ticketId && (
          <Link
            href={`/tickets/${thread.ticketId}`}
            className="block text-xs text-[var(--muted)] underline"
          >
            Open Parent Ticket →
          </Link>
        )}
      </aside>
    </div>
  );
}
