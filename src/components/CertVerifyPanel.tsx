"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  parseCertificateText,
  verifyAgainstRecord,
  type FieldVerdict,
  type VerifyReport,
} from "@/lib/cert-verify";
import {
  verifyCertificateUploadAction,
  type CertUploadResult,
} from "@/lib/cert-upload-actions";
import type { PolicyFormSet } from "@/lib/forms";
import type { Account, Policy } from "@/lib/types";

/**
 * Verify A Client Certificate — a sample cert arrives, and every claim on it
 * is checked against the schedule of record. Deterministic: parse, compare,
 * verdict — no guessing.
 *
 * Two ways in, and the difference is stated on screen because it decides how
 * much to trust the reading: a PDF's embedded text layer is extracted
 * server-side, and anything else is pasted. A scan carries no text layer and
 * is refused outright rather than verified as an empty certificate.
 *
 * The upload never becomes a source of coverage facts. What it produces is a
 * comparison and a recreation resolved from OUR record — the presend
 * registry refuses to issue off a prior certificate for the same reason.
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
  const [upload, setUpload] = useState<CertUploadResult | null>(null);
  const [reading, startReading] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const pastedReport = useMemo(() => {
    if (!submitted?.trim()) return null;
    const extracted = parseCertificateText(submitted);
    return verifyAgainstRecord(extracted, { account, policies, formSets });
  }, [submitted, account, policies, formSets]);

  // One result panel, whichever door the certificate came through.
  const report: VerifyReport | null = upload?.ok ? upload.report : pastedReport;

  function readFile(file: File) {
    setSubmitted(null);
    const body = new FormData();
    body.set("accountId", account.id);
    body.set("file", file);
    startReading(async () => {
      setUpload(await verifyCertificateUploadAction(body));
    });
  }

  function clearAll() {
    setText("");
    setSubmitted(null);
    setUpload(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <section className="surface-card overflow-hidden">
      <header className="border-b border-[var(--rule)] px-5 py-4">
        <p className="eyebrow">Verify A Client Certificate</p>
        <h3 className="mt-0.5 font-display text-lg text-[var(--ink)]">
          Check A Sample Cert Against The Record
        </h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
          Upload the certificate or paste its text. Every readable claim is
          checked against the schedule of record; anything the record
          can&apos;t confirm reports as Not On File — never a guess. The
          upload is evidence of what&apos;s being asked for, never a source of
          coverage facts.
        </p>
      </header>

      <div className="space-y-3 px-5 py-4">
        {/* --rule is 8% ink — invisible as a dashed edge on --paper. The
            drop zone has to read as one. */}
        <div className="rounded-xl border border-dashed border-[var(--gold)]/50 bg-[var(--paper)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--ink)]">
                Upload The Certificate
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">
                PDF with a text layer, or a .txt export. A scanned or
                photographed cert has no text to read and is refused rather
                than guessed at.
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,text/plain,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
              }}
              className="max-w-full text-[11px] text-[var(--muted)] file:mr-3 file:rounded-lg file:border file:border-[var(--rule)] file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[var(--ink)]"
            />
          </div>
          {reading && (
            <p className="mt-2 text-[11px] font-semibold text-[var(--muted)]">
              Reading The Certificate…
            </p>
          )}
          {upload && !upload.ok && (
            <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">
              {upload.error}
            </p>
          )}
          {upload?.ok && (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Read <span className="font-semibold text-[var(--ink)]">{upload.fileName}</span>{" "}
              {upload.source === "pdf-text-layer"
                ? "from the PDF's embedded text layer"
                : "as plain text"}
              {upload.documentId ? " · filed to the account documents" : ""}.
            </p>
          )}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="…or paste the certificate text here"
          className="field w-full font-mono !text-[11px] leading-relaxed"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setUpload(null);
              setSubmitted(text);
            }}
            disabled={!text.trim()}
            className="btn-primary disabled:opacity-45"
          >
            Verify Against Record
          </button>
          {(submitted || upload) && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-lg border border-[var(--rule)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              Clear
            </button>
          )}
        </div>

        {upload?.ok && <RecreatedFromRecord upload={upload} policies={policies} />}

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

/**
 * The recreation: the same policies the uploaded cert names, stated the way
 * our schedule of record states them. Deliberately one-directional — the
 * upload's numbers are in the comparison table above and nowhere near this
 * block, because a prior certificate is not a source of coverage facts.
 */
function RecreatedFromRecord({
  upload,
  policies,
}: {
  upload: CertUploadResult;
  policies: Policy[];
}) {
  const matched = policies.filter((p) => upload.matchedPolicyIds.includes(p.id));
  const bySection = new Map<string, typeof upload.recreated>();
  for (const line of upload.recreated) {
    const rows = bySection.get(line.section) ?? [];
    rows.push(line);
    bySection.set(line.section, rows);
  }

  return (
    <div className="rounded-xl border border-[var(--rule)] bg-white px-4 py-3">
      <p className="text-xs font-semibold text-[var(--ink)]">
        What Our Certificate Would Say
      </p>
      {matched.length === 0 ? (
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
          No policy number on this certificate matches a policy on this
          account
          {upload.unmatchedPolicyNumbers.length > 0 && (
            <>
              {" "}
              (
              {upload.unmatchedPolicyNumbers.map((n, i) => (
                <span key={n}>
                  {i > 0 && ", "}
                  <span className="font-mono">{n}</span>
                </span>
              ))}
              )
            </>
          )}
          , so there is nothing to recreate. Certifying coverage we can&apos;t
          tie to a policy on file is exactly what this refuses to do.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
            Resolved from the schedule of record for{" "}
            {matched.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <span className="font-mono text-[var(--ink)]">
                  {p.policyNumber}
                </span>{" "}
                ({p.carrier})
              </span>
            ))}
            . These are the values our sheet prints — the uploaded cert&apos;s
            numbers are compared above, never adopted.
            {upload.unmatchedPolicyNumbers.length > 0 && (
              <>
                {" "}
                The cert also names{" "}
                {upload.unmatchedPolicyNumbers.map((n, i) => (
                  <span key={n}>
                    {i > 0 && ", "}
                    <span className="font-mono">{n}</span>
                  </span>
                ))}
                , which matches nothing on this account.
              </>
            )}
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {Array.from(bySection.entries()).map(([section, rows]) => (
              <div key={section}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  {section}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {rows.map((r, i) => (
                    <li
                      key={i}
                      className="flex items-baseline justify-between gap-3 text-[11px]"
                    >
                      <span className="text-[var(--muted)]">{r.label}</span>
                      <span className="font-mono font-semibold text-[var(--ink)]">
                        {r.onRecord}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
