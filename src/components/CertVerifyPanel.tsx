"use client";

import { useMemo, useState } from "react";
import {
  parseCertificateText,
  verifyAgainstRecord,
  type FieldVerdict,
  type VerifyReport,
} from "@/lib/cert-verify";
import type { PolicyFormSet } from "@/lib/forms";
import type { Account, Policy } from "@/lib/types";

/**
 * Verify A Client Certificate — the client sends over a sample cert, the
 * desk pastes its text here, and every claim on it is checked against the
 * schedule of record. Deterministic: parse, compare, verdict — no guessing.
 * Paste-only by design: no OCR/ingestion path exists in the cert pipeline,
 * and inventing one would mean trusting text nothing extracted.
 */

const VERDICT_STYLES: Record<FieldVerdict, string> = {
  Match: "bg-emerald-50 text-emerald-800 ring-emerald-600/25",
  Mismatch: "bg-rose-50 text-rose-800 ring-rose-600/25",
  "Not On File": "bg-amber-50 text-amber-800 ring-amber-600/25",
  "Could Not Read": "bg-stone-100 text-stone-600 ring-stone-400/25",
};

const RECOMMENDATION_STYLES: Record<VerifyReport["recommendation"], string> = {
  Approve: "border-emerald-300 bg-emerald-50 text-emerald-900",
  "Approve With Notes": "border-amber-300 bg-amber-50 text-amber-900",
  Deny: "border-rose-300 bg-rose-50 text-rose-900",
};

export function CertVerifyPanel({
  account,
  policies,
  formSets,
}: {
  account: Account;
  policies: Policy[];
  formSets: Record<string, PolicyFormSet>;
}) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const report = useMemo(() => {
    if (!submitted?.trim()) return null;
    const extracted = parseCertificateText(submitted);
    return verifyAgainstRecord(extracted, { account, policies, formSets });
  }, [submitted, account, policies, formSets]);

  return (
    <section className="surface-card overflow-hidden">
      <header className="border-b border-[var(--rule)] px-5 py-4">
        <p className="eyebrow">Verify A Client Certificate</p>
        <h3 className="mt-0.5 font-display text-lg text-[var(--ink)]">
          Check A Sample Cert Against The Record
        </h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
          Paste the certificate text below (paste-only — no file ingestion
          path exists for certs). Every readable claim is checked against the
          schedule of record; anything the record can&apos;t confirm reports as
          Not On File — never a guess.
        </p>
      </header>

      <div className="space-y-3 px-5 py-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Paste the client's certificate text here…"
          className="field w-full font-mono !text-[11px] leading-relaxed"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubmitted(text)}
            disabled={!text.trim()}
            className="btn-primary disabled:opacity-45"
          >
            Verify Against Record
          </button>
          {submitted && (
            <button
              type="button"
              onClick={() => {
                setText("");
                setSubmitted(null);
              }}
              className="rounded-lg border border-[var(--rule)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              Clear
            </button>
          )}
        </div>

        {report && (
          <>
            <div
              className={`rounded-xl border px-4 py-3 ${RECOMMENDATION_STYLES[report.recommendation]}`}
            >
              <p className="text-sm font-bold uppercase tracking-wide">
                {report.recommendation}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed">
                {report.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[var(--rule)]">
              <table className="w-full text-left text-[11px]">
                <thead className="border-b border-[var(--rule)] bg-[var(--paper)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Field</th>
                    <th className="px-3 py-2 font-semibold">On The Cert</th>
                    <th className="px-3 py-2 font-semibold">On File</th>
                    <th className="px-3 py-2 font-semibold">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, i) => (
                    <tr key={i} className="border-b border-[var(--rule)]/50">
                      <td className="px-3 py-1.5 font-semibold text-[var(--ink)]">
                        {row.field}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--ink)]">{row.onCert}</td>
                      <td className="px-3 py-1.5 text-[var(--muted)]">{row.onFile}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${VERDICT_STYLES[row.verdict]}`}
                          title={row.note}
                        >
                          {row.verdict}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
