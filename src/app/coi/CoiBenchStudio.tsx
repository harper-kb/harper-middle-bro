"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CheckResult, Completion, FieldVal, Source } from "@/lib/coi-engine/coi-generate";
import { checkerChipView } from "@/lib/coi-engine/coi-checker-receipt";
import { fieldsForForm, sectionsForForm } from "@/lib/coi-engine/coi-form-fields";
import { COI_FORM_ORDER, COI_FORMS, type CoiFormType } from "@/lib/coi-engine/coi-forms";
// THE CHECKBOX TICK LAW: the editor reads checked-ness through
// TRUTHY_YN_VALUE_SET only (via isTruthyCheckboxValue) — the same single
// source the PDF fill consumes, so a box ticked here is a box ticked on paper.
import { isTruthyCheckboxValue } from "@/lib/coi-engine/pdf/field-values";

export interface CoiTicket {
  id: string;
  srNumber: string;
  requestType: string;
  requestTypeLabel: string;
  title: string;
  subject: string;
  accountId: string;
  accountName: string;
  holderName: string | null;
  holderAddress: string | null;
  wording: string;
  status: string;
  requestedBy: string;
  requestedByEmail: string | null;
  source: string;
  createdAt: string;
  /** Server-computed age label ("today", "3 days"). */
  age: string;
  policies: { id: string; policyNumber: string; carrier: string; coverages: string[] }[];
}

interface PolicyChoice {
  id: string;
  policyNumber: string;
  carrier: string;
  coverages: string[];
  effectiveDate: string;
  expirationDate: string;
}

interface CertificateMeta {
  accountId: string;
  formType: CoiFormType;
  gapNote: string | null;
  certificateId: number | null;
  version: string | null;
  status: string | null;
  servedFrom: "stored-exact" | "stored-latest" | "projection";
  fieldValues: Record<string, string>;
  completion: Completion;
  checker: CheckResult;
  policyChoices: PolicyChoice[];
  holder: { name: string | null; address: string | null; source: string | null };
}

const SOURCE_LABELS: Record<Source, string> = {
  policy: "policy record",
  deal: "deal record",
  company: "account record",
  request: "request",
  document: "document",
  "prior-cert": "prior certificate",
  extraction: "schedule of record",
  expert: "standard practice",
  missing: "missing",
};

const STATUS_LABELS: Record<string, string> = {
  intake: "Intake",
  drafting: "Drafting",
  waiting_market: "Waiting Market",
  needs_you: "Needs You",
  ready_to_issue: "Ready To Issue",
  delivered: "Delivered",
  closed: "Closed",
};

const STATUS_STYLES: Record<string, string> = {
  intake: "status-info",
  drafting: "status-neutral",
  waiting_market: "status-warning",
  needs_you: "status-danger",
  ready_to_issue: "status-success",
  delivered: "status-neutral",
  closed: "status-neutral opacity-75",
};

function TicketStatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? "status-neutral"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function SourceTag({ source }: { source: Source }) {
  if (source === "missing") {
    return (
      <span className="chip border-amber-400 bg-amber-50 text-[11px] font-semibold text-amber-800">
        CONFIRM — not in policy
      </span>
    );
  }
  return (
    <span className="chip text-[11px] text-[var(--muted)]">
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

function ReviewRow({ label, value }: { label: string; value: FieldVal }) {
  const missing = value.source === "missing" || !value.value.trim();
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--line,#e5e5e5)] py-1.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
        <div className={`text-sm ${missing ? "italic text-amber-800" : "text-[var(--ink)]"}`}>
          {value.value.trim() || "CONFIRM — not in policy"}
        </div>
      </div>
      <SourceTag source={missing ? "missing" : value.source} />
    </div>
  );
}

function CheckerChip({ checker }: { checker: CheckResult }) {
  const [open, setOpen] = useState(false);
  // THE CHECKER CHIP LAW: the ONE derivation — no receipts, no chip; never
  // green without a source basis (coi-checker-receipt.ts).
  const chip = checkerChipView(checker);
  if (!chip) return null;
  const tone =
    chip.tone === "verified"
      ? "border-emerald-400 bg-emerald-50 text-emerald-800"
      : chip.tone === "confirm"
        ? "border-amber-400 bg-amber-50 text-amber-800"
        : "border-neutral-300 bg-neutral-50 text-neutral-600";
  return (
    <div>
      <button type="button" className={`chip ${tone} text-xs`} onClick={() => setOpen((v) => !v)}>
        {chip.label}
      </button>
      {open ? (
        <div className="mt-2 rounded border border-[var(--line,#e5e5e5)] bg-white p-2 text-xs">
          {chip.summary ? <p className="mb-1 text-[var(--muted)]">{chip.summary}</p> : null}
          <ul className="space-y-1">
            {chip.receipts.map((r, i) => (
              <li key={i} className={r.ok ? "text-emerald-800" : "text-amber-800"}>
                {r.ok ? "✓" : "⚑"} {r.field}: {r.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

interface LoadPick {
  policyId: string | null;
  form: CoiFormType | null;
  ticketId: string | null;
  certificate?: number | null;
}

function generateUrl(accountId: string, pick: LoadPick, meta1: boolean): string {
  const q = new URLSearchParams();
  if (meta1) q.set("meta", "1");
  if (pick.ticketId) q.set("ticket", pick.ticketId);
  if (pick.policyId) q.set("policy", pick.policyId);
  if (pick.form) q.set("form", pick.form);
  if (pick.certificate) q.set("certificate", String(pick.certificate));
  return `/api/coi/generate/${encodeURIComponent(accountId)}?${q.toString()}`;
}

// ─── The ticket queue (the bench's front door) ───────────────────────────────

function TicketRow({ ticket, onOpen }: { ticket: CoiTicket; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--line,#e5e5e5)] bg-white px-4 py-3 text-left transition-colors hover:border-[var(--ink)]"
    >
      <div className="w-24 shrink-0 font-mono text-xs text-[var(--muted)]">{ticket.srNumber || ticket.id}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--ink)]">{ticket.accountName}</span>
          <span className="chip text-[11px] text-[var(--muted)]">{ticket.requestTypeLabel}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
          {ticket.holderName ? <>Holder: {ticket.holderName}</> : <em>No holder named on the request</em>}
          {" · "}
          {ticket.requestedBy}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs text-[var(--muted)]">{ticket.age}</span>
        <TicketStatusPill status={ticket.status} />
        <span className="btn-primary pointer-events-none text-xs">Open →</span>
      </div>
    </button>
  );
}

// ─── The open ticket: request rail + certificate flow ────────────────────────

export function CoiBenchStudio({ tickets }: { tickets: CoiTicket[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ticket = useMemo(() => tickets.find((t) => t.id === openId) ?? null, [tickets, openId]);

  const [meta, setMeta] = useState<CertificateMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [policyId, setPolicyId] = useState<string | null>(null);
  const [form, setForm] = useState<CoiFormType | null>(null);
  const [certificateId, setCertificateId] = useState<number | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [descFit, setDescFit] = useState<"fits" | "overflow" | null>(null);
  const [busy, setBusy] = useState<"generate" | "save" | "download" | null>(null);
  const previewObjectUrl = useRef<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Loads are driven from event handlers (ticket open, policy/form change),
  // never from an effect, so the pick travels as explicit arguments.
  const loadMeta = useCallback(async (accountId: string, pick: LoadPick) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(generateUrl(accountId, pick, true), { cache: "no-store" });
      const body = (await res.json()) as CertificateMeta & { error?: string; detail?: string };
      if (!res.ok) {
        setMeta(null);
        setError(body.detail ?? body.error ?? `Failed to load certificate (${res.status}).`);
        return;
      }
      setMeta(body);
      setValues(body.fieldValues);
      setDirty(new Set());
      setCertificateId(body.certificateId);
      setVersion(body.version);
      setDescFit(null);
      if (previewObjectUrl.current) {
        URL.revokeObjectURL(previewObjectUrl.current);
        previewObjectUrl.current = null;
      }
      setPreviewSrc(generateUrl(accountId, { ...pick, certificate: body.certificateId }, false));
    } catch (e) {
      setMeta(null);
      setError(e instanceof Error ? e.message : "Failed to load certificate.");
    } finally {
      setLoading(false);
    }
  }, []);

  const openTicket = useCallback(
    (t: CoiTicket) => {
      setOpenId(t.id);
      setPolicyId(null);
      setForm(null);
      setMeta(null);
      setNotice(null);
      void loadMeta(t.accountId, { policyId: null, form: null, ticketId: t.id });
    },
    [loadMeta],
  );

  const closeTicket = useCallback(() => {
    setOpenId(null);
    setMeta(null);
    setError(null);
    setNotice(null);
  }, []);

  useEffect(
    () => () => {
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    },
    [],
  );

  // Debounced LIVE PREVIEW: edits POST the current field map and the right
  // pane re-renders from the engine's own fill — the same bytes a download
  // would flatten.
  const scheduleLivePreview = useCallback(
    (accountId: string, formType: CoiFormType, nextValues: Record<string, string>) => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/coi/generate/${encodeURIComponent(accountId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fieldValues: nextValues, form: formType }),
          });
          if (!res.ok) return;
          const fit = res.headers.get("x-acord-desc-fit");
          setDescFit(fit === "overflow" ? "overflow" : fit === "fits" ? "fits" : null);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
          previewObjectUrl.current = url;
          setPreviewSrc(url);
        } catch {
          /* live preview is best-effort; the review list stays authoritative */
        }
      }, 600);
    },
    [],
  );

  const editField = useCallback(
    (fieldId: string, value: string) => {
      if (!ticket || !meta) return;
      setValues((prev) => {
        const next = { ...prev, [fieldId]: value };
        scheduleLivePreview(ticket.accountId, form ?? meta.formType, next);
        return next;
      });
      setDirty((prev) => new Set(prev).add(fieldId));
    },
    [ticket, meta, form, scheduleLivePreview],
  );

  const generate = useCallback(async () => {
    if (!ticket) return;
    setBusy("generate");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/coi/regenerate/${encodeURIComponent(ticket.accountId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId, form, ticketId: ticket.id }),
      });
      const body = (await res.json()) as {
        certificateId?: number;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.certificateId) {
        setError(body.detail ?? body.error ?? "Generation failed.");
        return;
      }
      setNotice(`Generated certificate #${body.certificateId} (draft).`);
      await loadMeta(ticket.accountId, {
        policyId,
        form,
        ticketId: ticket.id,
        certificate: body.certificateId,
      });
    } finally {
      setBusy(null);
    }
  }, [ticket, policyId, form, loadMeta]);

  const save = useCallback(async () => {
    if (!ticket || !certificateId || dirty.size === 0) return;
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const edited: Record<string, string> = {};
      for (const id of dirty) edited[id] = values[id] ?? "";
      const res = await fetch(`/api/coi/save/${encodeURIComponent(ticket.accountId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificateId, expectedVersion: version, fieldValues: edited }),
      });
      const body = (await res.json()) as {
        persisted?: boolean;
        conflict?: boolean;
        noChange?: boolean;
        detail?: string;
        certRecord?: { id: number; updatedAt: string } | null;
      };
      if (body.persisted && body.certRecord) {
        setVersion(body.certRecord.updatedAt);
        setDirty(new Set());
        setNotice(body.detail ?? "Saved.");
      } else if (body.conflict) {
        setError(body.detail ?? "A newer certificate exists — reload before saving.");
      } else {
        setNotice(body.detail ?? "Nothing to save.");
      }
    } finally {
      setBusy(null);
    }
  }, [ticket, certificateId, dirty, values, version]);

  // Download always serves the FLATTENED bytes (flattenPdfBytesForSend on the
  // server) — the pdf-lib artifact is the certificate, never window.print().
  const download = useCallback(async () => {
    if (!ticket || !meta) return;
    setBusy("download");
    setError(null);
    try {
      const formType = form ?? meta.formType;
      const res = await fetch(`/api/coi/generate/${encodeURIComponent(ticket.accountId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fieldValues: values, form: formType, download: true }),
      });
      if (!res.ok) {
        setError(`Download failed (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${COI_FORMS[formType].label.replace(/\s+/g, "")}-${ticket.accountId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }, [ticket, meta, form, values]);

  const activeForm: CoiFormType = form ?? meta?.formType ?? "acord25";
  const editorFields = useMemo(() => fieldsForForm(activeForm), [activeForm]);
  const editorSections = useMemo(() => sectionsForForm(activeForm), [activeForm]);
  const completion = meta?.completion ?? null;

  // ── Queue view ──────────────────────────────────────────────────────────
  if (!ticket) {
    const readyCount = tickets.filter((t) => t.status === "ready_to_issue").length;
    const needsYou = tickets.filter((t) => t.status === "needs_you").length;
    return (
      <section>
        <div className="mb-4 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
          <span className="chip">{tickets.length} pending</span>
          {readyCount ? <span className="chip status-success">{readyCount} ready to issue</span> : null}
          {needsYou ? <span className="chip status-danger">{needsYou} needs you</span> : null}
        </div>
        {tickets.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--line,#e5e5e5)] p-8 text-center text-sm text-[var(--muted)]">
            No pending certificate requests. New tickets land here as they arrive.
          </p>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} onOpen={() => openTicket(t)} />
            ))}
          </div>
        )}
      </section>
    );
  }

  // ── Open-ticket view ────────────────────────────────────────────────────
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" className="btn-ghost text-xs" onClick={closeTicket}>
            ← All tickets
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--ink)]">{ticket.accountName}</h2>
              <span className="chip text-[11px] text-[var(--muted)]">{ticket.requestTypeLabel}</span>
              <TicketStatusPill status={ticket.status} />
            </div>
            <p className="text-xs text-[var(--muted)]">
              {ticket.srNumber || ticket.id} · requested by {ticket.requestedBy} · {ticket.age} old
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meta && meta.policyChoices.length > 1 ? (
            <select
              className="rounded border border-[var(--line,#e5e5e5)] px-2 py-1 text-xs"
              value={policyId ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setPolicyId(next);
                void loadMeta(ticket.accountId, { policyId: next, form, ticketId: ticket.id });
              }}
            >
              <option value="">Default policy (newest bound)</option>
              {meta.policyChoices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.policyNumber} — {p.carrier} ({p.coverages.join(", ")})
                </option>
              ))}
            </select>
          ) : null}
          <select
            className="rounded border border-[var(--line,#e5e5e5)] px-2 py-1 text-xs"
            value={activeForm}
            onChange={(e) => {
              const next = e.target.value as CoiFormType;
              setForm(next);
              void loadMeta(ticket.accountId, { policyId, form: next, ticketId: ticket.id });
            }}
          >
            {COI_FORM_ORDER.map((f) => (
              <option key={f} value={f} disabled={!COI_FORMS[f].templateAvailable}>
                {COI_FORMS[f].label}
                {COI_FORMS[f].templateAvailable ? "" : " — no template on file"}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary text-xs" onClick={generate} disabled={busy !== null}>
            {busy === "generate" ? "Generating…" : "Generate certificate"}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={save}
            disabled={busy !== null || !certificateId || dirty.size === 0}
            title={certificateId ? "" : "Generate first — corrections save onto a stored row."}
          >
            {busy === "save" ? "Saving…" : `Save corrections${dirty.size ? ` (${dirty.size})` : ""}`}
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={download} disabled={busy !== null || !meta}>
            {busy === "download" ? "Preparing…" : "Download PDF"}
          </button>
        </div>
      </div>

      {/* The request rail: what the ticket actually asks for. */}
      <div className="mb-3 grid gap-2 rounded-lg border border-[var(--line,#e5e5e5)] bg-white p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Certificate holder</div>
          <div className="text-[var(--ink)]">{ticket.holderName ?? <em className="text-amber-800">Not named on the request</em>}</div>
          {ticket.holderAddress ? (
            <div className="text-xs text-[var(--muted)]">{ticket.holderAddress}</div>
          ) : null}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Requested wording</div>
          <div className="text-xs text-[var(--ink)]">{ticket.wording || <em className="text-[var(--muted)]">None supplied</em>}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Request</div>
          <div className="text-xs text-[var(--ink)]">{ticket.subject || ticket.title}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Policies on ticket</div>
          {ticket.policies.length === 0 ? (
            <div className="text-xs text-[var(--muted)]">None linked</div>
          ) : (
            ticket.policies.map((p) => (
              <div key={p.id} className="text-xs text-[var(--ink)]">
                {p.policyNumber} — {p.carrier}
              </div>
            ))
          )}
        </div>
      </div>

      {meta?.gapNote ? (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">{meta.gapNote}</p>
      ) : null}
      {error ? (
        <p className="mb-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">{error}</p>
      ) : null}
      {notice ? (
        <p className="mb-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-800">{notice}</p>
      ) : null}
      {descFit === "overflow" ? (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          The description of operations no longer fits its box — it would print cut off. Trim it before sending.
        </p>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">Building the certificate…</p>
      ) : meta && completion ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="min-w-0 space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-[var(--ink)]">Field-by-field review</h4>
                <CheckerChip checker={meta.checker} />
              </div>
              <div className="rounded border border-[var(--line,#e5e5e5)] bg-white p-2">
                <ReviewRow label="Named insured" value={completion.namedInsured} />
                <ReviewRow label="Insured address" value={completion.insuredAddress} />
                <ReviewRow label="Carrier" value={completion.carrier} />
                <ReviewRow
                  label="Carrier NAIC"
                  value={{
                    value: completion.carrierNaic ?? "",
                    source: completion.carrierNaic ? "extraction" : "missing",
                  }}
                />
                <ReviewRow label="Policy number" value={completion.policyNumber} />
                <ReviewRow label="Effective date" value={completion.effectiveDate} />
                <ReviewRow label="Expiration date" value={completion.expirationDate} />
                <ReviewRow
                  label="Coverage lines"
                  value={{ value: completion.coverageLines.join(", "), source: completion.coverageSource }}
                />
                <ReviewRow label="Certificate holder" value={completion.holderName} />
                <ReviewRow label="Holder mailing address" value={completion.holderAddress} />
                <ReviewRow label="Description of operations" value={completion.descriptionOfOperations} />
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-[var(--ink)]">
                Limits ({completion.limits.length}){" "}
                <span className="ml-1 align-middle">
                  <SourceTag source={completion.limitsSource} />
                </span>
              </h4>
              <div className="rounded border border-[var(--line,#e5e5e5)] bg-white p-2 text-sm">
                {completion.limits.length === 0 ? (
                  <p className="italic text-amber-800">
                    No limits in the schedule of record — the certificate prints them blank, never guessed.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {completion.limits.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="text-[var(--muted)]">
                          {l.line ? `${l.line} — ` : ""}
                          {l.label}
                        </span>
                        <span className="font-mono text-[var(--ink)]">{l.amount}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-[var(--ink)]">Edit fields</h4>
              <div className="max-h-[420px] overflow-y-auto rounded border border-[var(--line,#e5e5e5)] bg-white p-2">
                {editorSections.map((section) => {
                  const fields = editorFields.filter((f) => f.section === section);
                  if (!fields.length) return null;
                  return (
                    <details key={section} className="mb-1">
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {section}
                      </summary>
                      <div className="mt-1 space-y-1 pl-1">
                        {fields.map((f) =>
                          f.type === "checkbox" ? (
                            <label key={f.id} className="flex items-center gap-2 text-xs text-[var(--ink)]">
                              <input
                                type="checkbox"
                                checked={isTruthyCheckboxValue(values[f.id])}
                                onChange={(e) => editField(f.id, e.target.checked ? "Y" : "")}
                              />
                              {f.label}
                            </label>
                          ) : (
                            <label key={f.id} className="block text-xs">
                              <span className="text-[var(--muted)]">{f.label}</span>
                              <input
                                type="text"
                                className="mt-0.5 w-full rounded border border-[var(--line,#e5e5e5)] px-1.5 py-1 text-xs"
                                value={values[f.id] ?? ""}
                                onChange={(e) => editField(f.id, e.target.value)}
                              />
                            </label>
                          ),
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <h4 className="mb-2 text-sm font-semibold text-[var(--ink)]">
              Preview — {COI_FORMS[activeForm].label}
              {certificateId ? (
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                  stored certificate #{certificateId} ({meta.status ?? "draft"})
                </span>
              ) : (
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                  unsaved projection — Generate to persist
                </span>
              )}
            </h4>
            {previewSrc ? (
              <iframe
                title="Certificate preview"
                src={previewSrc}
                className="h-[720px] w-full rounded border border-[var(--line,#e5e5e5)]"
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
