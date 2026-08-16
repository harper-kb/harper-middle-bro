"use client";

import { useState } from "react";
import type { CoverageSummaryPolicy } from "@/lib/coverage-summary";

/**
 * The floating coverage rail. A fixed dock in the bottom-left that follows
 * the operator down the account page, so the schedule of record stays in
 * view while working the certificate or a thread far below the policy
 * table. Values come off the same resolver as the sheet — display only,
 * nothing here is editable.
 */
export function CoverageFloat({
  policies,
}: {
  policies: CoverageSummaryPolicy[];
}) {
  const [open, setOpen] = useState(false);
  if (policies.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Coverages On File — Follows You Down The Page"
        className="no-print fixed bottom-5 left-5 z-40 flex h-11 items-center gap-2 rounded-full border border-[var(--rule)] bg-[var(--paper)] px-4 shadow-xl transition hover:scale-105"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink)]">
          Coverages On File
        </span>
        <span className="rounded-full bg-[var(--gold)]/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--ink)]">
          {policies.length}
        </span>
      </button>
    );
  }

  return (
    <div className="no-print fixed bottom-5 left-5 z-40 flex max-h-[65vh] w-[min(100vw-2rem,340px)] flex-col overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--paper)] shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--rule)] bg-white px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
          Coverages On File · Schedule Of Record
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Collapse"
          className="rounded px-1 text-sm leading-none text-[var(--muted)] hover:text-[var(--ink)]"
        >
          ✕
        </button>
      </div>
      <div className="space-y-3 overflow-y-auto px-3 py-2.5">
        {policies.map((p) => (
          <div
            key={p.policyId}
            className="rounded-xl border border-[var(--rule)] bg-white p-2.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-[var(--ink)]">
                  {p.carrier}
                </p>
                <p className="font-mono text-[9.5px] text-[var(--muted)]">
                  {p.policyNumber} · {p.effectiveDate} → {p.expirationDate}
                </p>
              </div>
              {p.letter && (
                <span
                  className="shrink-0 rounded border border-[var(--rule)] bg-[var(--paper)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--ink)]"
                  title="Insurer letter on the certificate"
                >
                  {p.letter}
                </span>
              )}
            </div>
            {p.blocks.map((block) => (
              <div key={block.name} className="mt-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                  {block.name}
                  {block.overflow ? " · Description Line" : ""}
                </p>
                {block.lines.length === 0 ? (
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                    Named on the certificate; no limit schedule prints.
                  </p>
                ) : (
                  <ul className="mt-0.5 space-y-px">
                    {block.lines.map((line) => (
                      <li
                        key={line.label}
                        className="flex items-baseline justify-between gap-2 text-[10.5px]"
                      >
                        <span className="min-w-0 truncate text-[var(--muted)]">
                          {line.label}
                        </span>
                        <span
                          className={`shrink-0 font-mono tabular-nums ${
                            line.value === "Excluded"
                              ? "text-[var(--muted)] opacity-70"
                              : line.value === "Included"
                                ? "italic text-[var(--ink)]"
                                : "font-semibold text-[var(--ink)]"
                          }`}
                        >
                          {line.value === "Included" || line.value === "Excluded"
                            ? line.value
                            : `$ ${line.value}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
