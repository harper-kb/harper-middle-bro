"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { recordCoiDecisionAction } from "@/lib/actions";
import {
  FLAG_LABELS,
  buildDraftFromPolicy,
  buildDraftFromUpload,
  renderCoiSummary,
  verifyCoi,
  type CoiDraft,
  type CoiFinding,
  type CoiFlags,
} from "@/lib/coi";
import { FLAG_REQUEST_TYPE } from "@/lib/certificate";
import { conventionName, describeRename } from "@/lib/filenames";
import {
  getPolicyFormSet,
  limitMode,
  limitSlotLabel,
  limitStatement,
  type LimitSlot,
} from "@/lib/forms";
import { formatBytes, formatMoney } from "@/lib/format";
import { getGuidance, type PriceGuidance } from "@/lib/price-guidance";
import { summarizeRequest } from "@/lib/request-summary";
import type { Operator, ThreadDetail } from "@/lib/types";
import { PriceGuidanceNote } from "./PriceGuidanceNote";

interface UploadInfo {
  original: string;
  sizeLabel: string;
}

function dollars(cents: number | undefined): string {
  if (cents == null) return "";
  return String(Math.round(cents / 100));
}

function parseDollars(raw: string): number {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * No premium on the endorsement, so the deliverable is the certificate.
 * The cert gets checked box-by-box against the coverage tab — never
 * summarized — and anything the policy can't back blocks the issue.
 */
export function CoiVerifier({
  thread,
  operator,
  holder,
  guidance,
}: {
  thread: ThreadDetail;
  operator: Operator | null;
  /** Ticket-recorded holder beats anything parsed back out of the email body */
  holder?: { name: string; address: string };
  /** Desk quote history, for pricing the endorsement an unbacked box needs */
  guidance?: Record<string, PriceGuidance>;
}) {
  const [pending, startTransition] = useTransition();
  const request = useMemo(() => summarizeRequest(thread), [thread]);

  const [holderName, setHolderName] = useState(
    holder?.name || request.holderName,
  );
  const [holderAddress, setHolderAddress] = useState(
    holder?.address || request.holderAddress,
  );
  const [draft, setDraft] = useState<CoiDraft | null>(null);
  const [upload, setUpload] = useState<UploadInfo | null>(null);
  const [source, setSource] = useState<"upload" | "coverage" | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = useMemo(() => getPolicyFormSet(thread.policy), [thread.policy]);

  const fileName = useMemo(
    () =>
      conventionName({
        entity: holderName,
        kind: "coi",
        originalName: upload?.original ?? "certificate.pdf",
      }),
    [holderName, upload],
  );

  const effective: CoiDraft | null = draft
    ? { ...draft, holderName, holderAddress }
    : null;

  const verdict = useMemo(
    () =>
      effective
        ? verifyCoi(effective, { account: thread.account, policy: thread.policy })
        : null,
    [effective, thread.account, thread.policy],
  );

  const decided = thread.status === "closed";

  function load(kind: "upload" | "coverage", info?: UploadInfo) {
    const args = {
      account: thread.account,
      policy: thread.policy,
      holderName,
      holderAddress,
      projectWording: request.wording,
    };
    setDraft(kind === "upload" ? buildDraftFromUpload(args) : buildDraftFromPolicy(args));
    setSource(kind);
    setUpload(info ?? null);
  }

  function onFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    load("upload", { original: f.name, sizeLabel: formatBytes(f.size) });
  }

  function patch(next: Partial<CoiDraft>) {
    setDraft((d) => (d ? { ...d, ...next } : d));
  }

  function setLimit(slot: LimitSlot, cents: number) {
    setDraft((d) => (d ? { ...d, limits: { ...d.limits, [slot]: cents } } : d));
  }

  function dropLimit(slot: LimitSlot) {
    setDraft((d) => {
      if (!d) return d;
      const limits = { ...d.limits };
      delete limits[slot];
      return { ...d, limits };
    });
  }

  function toggleFlag(key: keyof CoiFlags) {
    setDraft((d) =>
      d ? { ...d, flags: { ...d.flags, [key]: !d.flags[key] } } : d,
    );
  }

  function removePhrase(text: string) {
    setDraft((d) => {
      if (!d) return d;
      const cleaned = d.description
        .split(text)
        .join("")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([.,;])/g, "$1")
        .replace(/([.,;])\1+/g, "$1")
        .trim();
      return { ...d, description: cleaned };
    });
  }

  function decide(decision: "issued" | "rejected") {
    if (!effective || !verdict) return;
    const fd = new FormData();
    fd.set("threadId", thread.id);
    fd.set("decision", decision);
    fd.set(
      "summary",
      [
        `File: ${fileName}`,
        upload ? `Received As: ${upload.original}` : "Built From: Coverage Tab",
        "",
        renderCoiSummary(effective, verdict),
      ].join("\n"),
    );
    startTransition(async () => {
      await recordCoiDecisionAction(fd);
      window.dispatchEvent(new Event("uw-desk-inbox-refresh"));
    });
  }

  const descFindings = (verdict?.findings ?? []).filter(
    (f) => f.field === "description" && f.match,
  );
  const slots: LimitSlot[] = Array.from(
    new Set<LimitSlot>([
      ...set.limits.map((l) => l.slot),
      ...(Object.keys(effective?.limits ?? {}) as LimitSlot[]),
    ]),
  );

  return (
    <section className="surface-card overflow-hidden rise-in">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rule)] px-5 py-4">
        <div>
          <p className="eyebrow">Certificate Desk</p>
          <h2 className="mt-0.5 font-display text-xl text-[var(--ink)]">
            No Charge — Issue The Certificate
          </h2>
        </div>
        <span className="chip">$0 Endorsement</span>
      </header>

      <div className="px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="eyebrow">Certificate Holder</span>
            <input
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="Exactly as the contract spells it"
              className="field mt-1"
            />
          </label>
          <label className="block">
            <span className="eyebrow">Holder Address</span>
            <input
              value={holderAddress}
              onChange={(e) => setHolderAddress(e.target.value)}
              placeholder="Street, City, ST ZIP"
              className="field mt-1"
            />
          </label>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          className={`dropzone mt-4 cursor-pointer rounded-2xl px-5 py-6 text-center ${
            dragOver ? "dropzone-hot" : ""
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <p className="text-sm font-medium text-[var(--ink)]">
            Drop The Holder&apos;s Certificate Here
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Every box is read into fields and checked against the policy — no
            summarizing, no guessing.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <span className="btn-ghost">Choose File</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                load("coverage");
              }}
              className="btn-ghost"
            >
              Fill From Coverage Tab
            </button>
          </div>
        </div>

        {draft && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--rule)] bg-[var(--paper)] px-3 py-2">
            <span className="text-sm font-medium text-[var(--ink)]">{fileName}</span>
            {upload && (
              <span className="text-[11px] text-[var(--muted)]">
                {describeRename(upload.original, fileName)} · {upload.sizeLabel}
              </span>
            )}
            <span className="ml-auto chip">
              {source === "upload" ? "Parsed From Upload" : "Built From Policy"}
            </span>
          </div>
        )}
      </div>

      {effective && verdict && (
        <>
          <VerdictBar verdict={verdict} />

          <div className="grid gap-4 px-5 pb-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4">
              <p className="eyebrow">Identity &amp; Term</p>
              <div className="mt-2 space-y-2">
                <Field
                  label="Named Insured"
                  value={effective.insuredName}
                  onChange={(v) => patch({ insuredName: v })}
                  bad={verdict.findings.some(
                    (f) => f.field === "insured" && f.severity === "reject",
                  )}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field
                    label="Policy Number"
                    value={effective.policyNumber}
                    onChange={(v) => patch({ policyNumber: v })}
                    bad={verdict.findings.some((f) => f.id === "policy-mismatch")}
                  />
                  <Field
                    label="Carrier"
                    value={effective.carrier}
                    onChange={(v) => patch({ carrier: v })}
                    bad={verdict.findings.some((f) => f.id === "carrier-mismatch")}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field
                    label="Effective"
                    type="date"
                    value={effective.effectiveDate}
                    onChange={(v) => patch({ effectiveDate: v })}
                    bad={verdict.findings.some((f) => f.id === "term-early")}
                  />
                  <Field
                    label="Expiration"
                    type="date"
                    value={effective.expirationDate}
                    onChange={(v) => patch({ expirationDate: v })}
                    bad={verdict.findings.some((f) => f.id === "term-late")}
                  />
                </div>
                <p className="pt-1 text-[11px] text-[var(--muted)]">
                  On File: {thread.policy.policyNumber} · {thread.policy.carrier} ·{" "}
                  {thread.policy.effectiveDate} to {thread.policy.expirationDate}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4">
              <p className="eyebrow">Endorsements Claimed</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                A box only checks if a form on the schedule backs it.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(Object.keys(FLAG_LABELS) as (keyof CoiFlags)[]).map((key) => {
                  const on = effective.flags[key];
                  const bad = verdict.findings.some((f) => f.id === `flag-${key}`);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleFlag(key)}
                      className={`flag-toggle rounded-full border px-3 py-1 text-[11px] font-semibold ${
                        !on
                          ? "border-[var(--rule)] bg-white text-[var(--muted)]"
                          : bad
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : "border-emerald-300 bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {FLAG_LABELS[key]}
                    </button>
                  );
                })}
              </div>

              <p className="eyebrow mt-4">Forms On The Schedule</p>
              <ul className="mt-1.5 space-y-1">
                {set.endorsements.length === 0 && (
                  <li className="text-xs text-[var(--muted)]">
                    No endorsements on file for this policy.
                  </li>
                )}
                {set.endorsements.map((e) => (
                  <li key={e.form} className="flex items-baseline gap-2 text-xs">
                    <span className="font-mono text-[11px] text-[var(--ink)]">
                      {e.form} {e.edition}
                    </span>
                    <span className="truncate text-[var(--muted)]">{e.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="px-5 pb-4">
            <p className="eyebrow">Limits — Policy Versus Certificate</p>
            <div className="mt-2 overflow-hidden rounded-xl border border-[var(--rule)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--sand)]/60 text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Limit</th>
                    <th className="px-3 py-2 text-right font-semibold">On The Policy</th>
                    <th className="px-3 py-2 text-right font-semibold">On The Cert</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => {
                    const carried = set.limits.find((l) => l.slot === slot);
                    const claimed = effective.limits[slot];
                    // A dollar claim only compares to a dollar schedule; an
                    // Included/Excluded line can't back any dollar amount.
                    const carriedAmount =
                      carried && limitMode(carried) === "amount"
                        ? (carried.amountCents ?? 0)
                        : null;
                    const over =
                      carried != null &&
                      claimed != null &&
                      (carriedAmount == null || claimed > carriedAmount);
                    const absent = carried == null && claimed != null;
                    return (
                      <tr
                        key={slot}
                        className={`border-t border-[var(--rule)] ${
                          over || absent ? "bg-rose-50/40" : "bg-white"
                        }`}
                      >
                        <td className="px-3 py-2">{limitSlotLabel(slot)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                          {carried ? limitStatement(carried) : "Not Carried"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[var(--muted)]">$</span>
                            <input
                              value={dollars(claimed)}
                              onChange={(e) => setLimit(slot, parseDollars(e.target.value))}
                              placeholder="—"
                              inputMode="numeric"
                              className={`w-28 rounded-lg border px-2 py-1 text-right text-sm tabular-nums outline-none ${
                                over || absent
                                  ? "border-rose-300 bg-white"
                                  : "border-[var(--rule)] bg-white"
                              }`}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {claimed != null && (
                            <button
                              type="button"
                              onClick={() => dropLimit(slot)}
                              className="text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--coral)]"
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="px-5 pb-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="eyebrow">Description Of Operations</p>
              <span className="text-[11px] text-[var(--muted)]">
                Wording that grants coverage gets flagged as you type.
              </span>
            </div>
            <textarea
              value={effective.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={5}
              className={`field text-[13px] leading-relaxed ${
                descFindings.some((f) => f.severity === "reject") ? "field-bad" : ""
              }`}
            />
            {effective.description && (
              <div className="mt-2 rounded-xl border border-[var(--rule)] bg-white p-3 text-[13px] leading-relaxed">
                <Highlighted text={effective.description} findings={descFindings} />
              </div>
            )}
            {descFindings.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {descFindings.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => removePhrase(f.match!.text)}
                    title={f.detail}
                    className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Remove “{f.match!.text}”
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="px-5 pb-4">
            <p className="eyebrow mb-2">Check Results</p>
            {verdict.findings.length === 0 ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Clean — every box on this certificate is backed by the policy.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {verdict.findings.map((f) => (
                  <FindingRow
                    key={f.id}
                    finding={f}
                    guidance={guidance}
                    carrier={thread.policy.carrier}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--rule)] px-5 py-4">
            <button
              type="button"
              disabled={pending || !verdict.okToIssue || !operator || decided}
              onClick={() => decide("issued")}
              className="btn-primary disabled:opacity-45"
            >
              {!operator
                ? "Sign In To Issue"
                : verdict.okToIssue
                  ? "Issue Certificate"
                  : `Blocked — ${verdict.rejects.length} To Fix`}
            </button>
            <button
              type="button"
              disabled={pending || !operator || decided}
              onClick={() => decide("rejected")}
              className="btn-ghost disabled:opacity-45"
            >
              Reject &amp; Explain
            </button>
            <span className="ml-auto text-[11px] text-[var(--muted)]">
              Saves as {fileName}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function VerdictBar({ verdict }: { verdict: { rejects: CoiFinding[]; warns: CoiFinding[]; okToIssue: boolean } }) {
  return (
    <div
      className={`mx-5 mb-4 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5 stamp ${
        verdict.okToIssue
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
          : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
      }`}
    >
      <span className="text-sm font-semibold">
        {verdict.okToIssue ? "Ready To Issue" : "Cannot Issue As Written"}
      </span>
      <span className="text-xs">
        {verdict.rejects.length} Reject{verdict.rejects.length === 1 ? "" : "s"} ·{" "}
        {verdict.warns.length} Warning{verdict.warns.length === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function FindingRow({
  finding: f,
  guidance,
  carrier,
}: {
  finding: CoiFinding;
  guidance?: Record<string, PriceGuidance>;
  carrier?: string;
}) {
  const reject = f.severity === "reject";
  const flagKey = f.id.startsWith("flag-")
    ? (f.id.slice(5) as keyof CoiFlags)
    : null;
  const askType = flagKey ? FLAG_REQUEST_TYPE[flagKey] : null;
  return (
    <li
      className={`rounded-xl border px-3 py-2 text-xs ${
        reject
          ? "border-rose-200 bg-rose-50/70 text-rose-900"
          : "border-amber-200 bg-amber-50/60 text-amber-900"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em]">
          {reject ? "Reject" : "Warn"}
        </span>
        <span className="font-semibold">{f.title}</span>
      </div>
      <p className="mt-0.5 leading-relaxed opacity-90">{f.detail}</p>
      {f.fix && <p className="mt-0.5 italic opacity-75">{f.fix}</p>}
      {askType && guidance && carrier && (
        <PriceGuidanceNote
          guidance={getGuidance(guidance, carrier, askType)}
          carrier={carrier}
          requestType={askType}
        />
      )}
    </li>
  );
}

function Highlighted({
  text,
  findings,
}: {
  text: string;
  findings: CoiFinding[];
}) {
  const marks = findings
    .map((f) => ({ ...f.match!, severity: f.severity }))
    .sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  marks.forEach((m, i) => {
    if (m.start < cursor) return;
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(
      <mark
        key={`${m.start}-${i}`}
        className={m.severity === "reject" ? "mark-reject" : "mark-warn"}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <p className="text-[var(--ink)]/85">{parts}</p>;
}

function Field({
  label,
  value,
  onChange,
  bad,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  bad?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`field mt-1 py-2 ${bad ? "field-bad" : ""}`}
      />
    </label>
  );
}
