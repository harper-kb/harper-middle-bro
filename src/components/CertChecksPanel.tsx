"use client";

import type { CertCheckResult } from "@/lib/cert-checks";

/**
 * Presend check results — the canonical registry, rendered. Every attempt
 * shows the full named list: what passed, what blocked, what was overridden
 * and by whom. Overridable failures expose a reason field; the override is
 * an attributed record on the next attempt, never a way around the gate.
 */
export function CertChecksPanel({
  results,
  overrides,
  onOverrideChange,
  disabled,
}: {
  results: CertCheckResult[];
  overrides: Record<string, string>;
  onOverrideChange: (checkId: string, reason: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {results.map((r) => {
        const blocked = r.status === "fail" && r.severity === "blocking";
        const advisory = r.status === "fail" && r.severity === "advisory";
        return (
          <div
            key={r.id}
            className={`rounded-xl border px-3 py-2 text-xs ${
              blocked
                ? "border-rose-200 bg-rose-50/70 text-rose-900"
                : advisory
                  ? "border-amber-200 bg-amber-50/60 text-amber-900"
                  : r.status === "overridden"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-emerald-200 bg-emerald-50/50 text-emerald-900"
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em]">
                {r.status === "pass"
                  ? "Pass"
                  : r.status === "overridden"
                    ? "Overridden"
                    : blocked
                      ? "Blocked"
                      : "Advisory"}
              </span>
              <span className="font-semibold">{r.name}</span>
              {!r.overridable && (
                <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] opacity-70">
                  Non-Overridable
                </span>
              )}
            </div>
            <p className="mt-0.5 leading-relaxed opacity-90">{r.detail}</p>
            {r.status === "overridden" && (
              <p className="mt-0.5 italic opacity-80">
                Overridden By {r.overriddenBy} — “{r.overrideReason}”
              </p>
            )}
            {blocked && r.overridable && (
              <label className="mt-1.5 block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] opacity-75">
                  Override Reason (Logged &amp; Attributed)
                </span>
                <input
                  value={overrides[r.id] ?? ""}
                  onChange={(e) => onOverrideChange(r.id, e.target.value)}
                  disabled={disabled}
                  placeholder="Why this check may clear — goes on the record with your name"
                  className="field mt-1 py-1.5 text-xs"
                />
              </label>
            )}
            {blocked && !r.overridable && (
              <p className="mt-0.5 italic opacity-75">
                This check fails closed for everyone. Fix the underlying record.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
