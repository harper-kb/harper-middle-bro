"use client";

import { useMemo, useState } from "react";
import { attachIscScheduleAction } from "@/lib/isc-actions";
import { endorsementKindLabel, LIMIT_SLOT_LABELS } from "@/lib/forms";
import {
  ISC_SAMPLE_DEC,
  iscParseAttachable,
  parseIscDec,
  type IscParsedLimit,
} from "@/lib/isc-intake";
import type { Policy } from "@/lib/types";

/**
 * ISC Portal Intake — paste the dec page / schedule of forms downloaded from
 * the Instant Specialty portal, preview exactly what the parser read, and
 * attach it once as the policy's schedule of record. The preview is
 * advisory; the server re-parses the same text before anything persists.
 */

function limitStatement(l: IscParsedLimit): string {
  if (l.mode === "included") return "Included";
  if (l.mode === "excluded") return "Excluded";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((l.amountCents ?? 0) / 100);
}

export function IscIntakePanel({
  accountId,
  policies,
}: {
  accountId: string;
  policies: Policy[];
}) {
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const [text, setText] = useState("");

  const policy = policies.find((p) => p.id === policyId) ?? null;
  const parsed = useMemo(
    () => (text.trim() ? parseIscDec(text) : null),
    [text],
  );
  const gate =
    parsed && policy ? iscParseAttachable(parsed, policy.policyNumber) : null;

  if (policies.length === 0) return null;

  return (
    <section className="surface-card overflow-hidden">
      <header className="border-b border-[var(--rule)] px-5 py-4">
        <p className="eyebrow">ISC Portal Intake</p>
        <h3 className="mt-0.5 font-display text-lg text-[var(--ink)]">
          Extract The Schedule Of Record Once
        </h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
          The desk binds most ISC (Instant Specialty) policies itself. Download
          the declarations and schedule of forms from the portal, paste the
          text here, and attach it once — coverages, limits, and the
          endorsement list become the record that certificates and the fast
          path read from. ISC is the Managing General Agent (MGA); the dec
          page names the writing company (Hadron Specialty, Sutton National,
          SiriusPoint America, or Third Coast), and that is what prints on the
          INSURER line with its verified NAIC code.
        </p>
      </header>

      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="isc-intake-policy"
            className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]"
          >
            ISC Policy
          </label>
          <select
            id="isc-intake-policy"
            value={policyId}
            onChange={(e) => setPolicyId(e.target.value)}
            className="rounded-lg border border-[var(--rule)] bg-white px-2.5 py-1.5 text-xs text-[var(--ink)]"
          >
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.policyNumber}
                {p.issuingCarrier ? ` — ${p.issuingCarrier}` : " — Writer Not Recorded"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setText(ISC_SAMPLE_DEC)}
            className="rounded-lg border border-[var(--rule)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            Insert Sample Portal Text
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Paste the ISC portal declarations / schedule of forms text here."
          className="w-full rounded-xl border border-[var(--rule)] bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--muted)]"
        />

        {parsed && policy && (
          <div className="space-y-3 rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Writing Company
              </span>
              {parsed.writer ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-600/25">
                  {parsed.writer} — NAIC {parsed.writerNaic}
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-600/25">
                  Not Found
                </span>
              )}
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Policy Number
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
                  parsed.policyNumber === policy.policyNumber
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-600/25"
                    : "bg-rose-50 text-rose-800 ring-rose-600/25"
                }`}
              >
                {parsed.policyNumber ?? "Not Found"}
              </span>
            </div>

            {parsed.coverages.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Coverage Parts ({parsed.coverages.length})
                </p>
                <table className="mt-1 w-full text-xs">
                  <tbody>
                    {parsed.coverages.map((c) => (
                      <tr key={c.form} className="border-t border-[var(--rule)]">
                        <td className="py-1 pr-3 font-mono text-[11px]">
                          {c.form} {c.edition}
                        </td>
                        <td className="py-1 text-[var(--ink)]">{c.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {parsed.limits.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Stated Limits ({parsed.limits.length})
                </p>
                <table className="mt-1 w-full text-xs">
                  <tbody>
                    {parsed.limits.map((l) => (
                      <tr key={l.slot} className="border-t border-[var(--rule)]">
                        <td className="py-1 pr-3 text-[var(--ink)]">
                          {LIMIT_SLOT_LABELS[l.slot]}
                        </td>
                        <td className="py-1 text-right font-mono text-[11px]">
                          {limitStatement(l)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {parsed.endorsements.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Endorsement Schedule ({parsed.endorsements.length})
                </p>
                <table className="mt-1 w-full text-xs">
                  <tbody>
                    {parsed.endorsements.map((e) => (
                      <tr key={e.form} className="border-t border-[var(--rule)]">
                        <td className="py-1 pr-3 font-mono text-[11px] whitespace-nowrap">
                          {e.form} {e.edition}
                        </td>
                        <td className="py-1 pr-3 text-[var(--ink)]">{e.title}</td>
                        <td className="py-1 pr-2 text-right">
                          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-700">
                            {endorsementKindLabel(e.kind)}
                          </span>
                        </td>
                        <td className="py-1 text-right text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                          {e.scope ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(parsed.warnings.length > 0 || parsed.ignoredLines > 0) && (
              <ul className="space-y-1 text-[11px] text-amber-800">
                {parsed.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {parsed.ignoredLines > 0 && (
                  <li className="text-[var(--muted)]">
                    {parsed.ignoredLines} line
                    {parsed.ignoredLines === 1 ? "" : "s"} not recognized —
                    reported, never guessed at.
                  </li>
                )}
              </ul>
            )}

            <form action={attachIscScheduleAction} className="flex items-center gap-3">
              <input type="hidden" name="accountId" value={accountId} />
              <input type="hidden" name="policyId" value={policy.id} />
              <input type="hidden" name="text" value={text} />
              <button
                type="submit"
                disabled={!gate?.ok}
                className="rounded-lg bg-[var(--ink)] px-3.5 py-1.5 text-xs font-semibold text-white transition enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Attach As Schedule Of Record
              </button>
              {gate && !gate.ok && (
                <span className="text-[11px] text-rose-700">{gate.reason}</span>
              )}
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
