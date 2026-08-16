"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  closeThreadAction,
  humanProceedAction,
  sendTicketDraftAction,
  simulateQuoteAction,
} from "@/lib/actions";
import { SERVICE_MAILBOX } from "@/lib/brand";
import { channelLabel } from "@/lib/channels";
import {
  EmailStatusChip,
  emailGateOpen,
  emailGateReason,
  useEmailCheck,
} from "@/components/ContactValidation";
import { docKindLabel } from "@/lib/aidesk";
import { conventionName, guessKind } from "@/lib/filenames";
import { formatBytes, formatDate, formatMoney } from "@/lib/format";
import type { TicketDraft } from "@/lib/draft";
import {
  AUTO_APPROVE_THRESHOLD_CENTS,
  LOOP_REASONS,
  loopReasonLabel,
  type LoopReasonId,
  type Message,
  type Operator,
  type ThreadDetail,
  type TicketDetail,
} from "@/lib/types";

/**
 * One tab, every word that passed between Harper and the market on this
 * ticket — across every thread it spawned. This is the "nothing is lost"
 * surface, and the place the next email goes out from.
 */
export function TicketComms({
  ticket,
  drafts,
  operator,
}: {
  ticket: TicketDetail;
  drafts: TicketDraft[];
  operator: Operator | null;
}) {
  const [policyId, setPolicyId] = useState(drafts[0]?.policy.id ?? "");
  const draft = drafts.find((d) => d.policy.id === policyId) ?? drafts[0] ?? null;

  const [body, setBody] = useState<Record<string, string>>({});
  const [acked, setAcked] = useState(false);
  const [loopReason, setLoopReason] = useState<LoopReasonId | "">("");
  const [attachments, setAttachments] = useState<{ id: string; name: string; sizeLabel: string }[]>([]);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const stream = useMemo(() => {
    const rows: { message: Message; thread: ThreadDetail }[] = [];
    for (const t of ticket.threads) {
      for (const m of t.messages) rows.push({ message: m, thread: t });
    }
    return rows.sort((a, b) =>
      a.message.createdAt.localeCompare(b.message.createdAt),
    );
  }, [ticket.threads]);

  const alreadyOut = ticket.threads.length > 0;
  const showComposer = !alreadyOut || composing;
  const key = draft?.policy.id ?? "none";
  const draftBody = body[key] ?? draft?.body ?? "";
  const edited = body[key] !== undefined && body[key] !== draft?.body;

  const needsHumanThread = ticket.threads.find((t) => t.status === "needs_human");

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const holder = ticket.holderName ?? ticket.account.name;
      setAttachments((prev) => {
        const taken = prev.map((a) => a.name);
        const added = Array.from(files).map((f) => {
          const kind = guessKind(f.name);
          const name = conventionName({
            entity: holder,
            kind: kind === "other" ? "coi" : kind,
            originalName: f.name,
            taken,
          });
          taken.push(name);
          return { id: `${f.name}-${f.size}`, name, sizeLabel: formatBytes(f.size) };
        });
        return [...prev, ...added];
      });
    },
    [ticket.holderName, ticket.account.name],
  );

  function send() {
    if (!draft) return;
    setError(null);
    const fd = new FormData();
    fd.set("ticketId", ticket.id);
    fd.set("policyId", draft.policy.id);
    fd.set("body", draftBody);
    if (acked) fd.set("ackWarnings", "1");
    if (edited) fd.set("edited", "1");
    if (loopReason) fd.set("loopReason", loopReason);
    for (const a of attachments) fd.append("attachments", a.name);

    startTransition(async () => {
      try {
        await sendTicketDraftAction(fd);
        if (draft.route?.openPortal && draft.route.portalUrl) {
          window.open(draft.route.portalUrl, "_blank", "noopener,noreferrer");
        }
        setComposing(false);
        setAttachments([]);
        setLoopReason("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed");
      }
    });
  }

  function run(action: (fd: FormData) => Promise<unknown>, threadId: string, extra?: Record<string, string>) {
    const fd = new FormData();
    fd.set("threadId", threadId);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    startTransition(async () => {
      await action(fd);
    });
  }

  const blocked = draft?.blocked ?? true;
  // Recipient hard gate: when this draft goes out by email, the address on
  // file must resolve to a domain that accepts mail. A failed or unavailable
  // check keeps the send blocked — fix the desk email, don't work around it.
  const recipientEmail = draft?.route?.sendEmail
    ? (draft.underwriter?.email ?? "")
    : "";
  const recipientCheck = useEmailCheck(recipientEmail);
  const recipientOk = !draft?.route?.sendEmail || emailGateOpen(recipientCheck, true);
  const canSend =
    Boolean(operator) &&
    Boolean(draft) &&
    !blocked &&
    recipientOk &&
    (!draft!.needsAck || acked) &&
    (!alreadyOut || Boolean(loopReason)) &&
    !pending;

  return (
    <div className="space-y-4">
      {needsHumanThread && (
        <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-5 shadow-sm">
          <p className="eyebrow text-rose-700">Needs Your Review</p>
          <p className="mt-2 text-base leading-snug text-[var(--ink)]">
            {needsHumanThread.underwriter.name} quoted{" "}
            <span className="font-semibold">
              {formatMoney(needsHumanThread.offeredPremiumCents)}
            </span>{" "}
            — over the {formatMoney(AUTO_APPROVE_THRESHOLD_CENTS)} auto-approve
            line. Relay the terms on the Certificate tab, or confirm here.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(humanProceedAction, needsHumanThread.id)}
              className="btn-primary px-5 py-2 disabled:opacity-50"
            >
              Confirm & Proceed
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(closeThreadAction, needsHumanThread.id)}
              className="btn-ghost"
            >
              Close Thread
            </button>
          </div>
        </div>
      )}

      {/* ————— Composer ————— */}
      {showComposer && draft && (
        <section className="glass rise-in rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">
                {alreadyOut ? "Going Back Out" : "Draft — Ready When You Opened This"}
              </p>
              <h3 className="mt-1 font-display text-xl text-[var(--ink)]">
                {draft.subject}
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                <span>
                  From {SERVICE_MAILBOX} ·{" "}
                  {draft.route?.sendEmail
                    ? `To ${draft.underwriter?.email ?? "—"}`
                    : draft.route
                      ? `${channelLabel(draft.route.primary)} task — logged, not emailed`
                      : "No route"}
                </span>
                {draft.route?.sendEmail && <EmailStatusChip check={recipientCheck} />}
              </p>
              {draft.route?.sendEmail && !recipientOk && (
                <p className="mt-1 text-[11px] font-medium text-rose-700">
                  {emailGateReason(recipientCheck) ??
                    "Recipient Email Missing"}{" "}
                  — update the underwriter contact before this can go out.
                </p>
              )}
            </div>
            {drafts.length > 1 && (
              <select
                value={policyId}
                onChange={(e) => setPolicyId(e.target.value)}
                className="field max-w-[220px] text-xs"
              >
                {drafts.map((d) => (
                  <option key={d.policy.id} value={d.policy.id}>
                    {d.policy.policyNumber} · {d.policy.carrier}
                  </option>
                ))}
              </select>
            )}
          </div>

          {draft.verify.issues.length > 0 && (
            <div
              className={`mt-3 rounded-xl px-4 py-3 text-sm ${
                blocked ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"
              }`}
            >
              {draft.verify.issues.map((i) => (
                <p key={i.id} className="leading-relaxed">
                  <span className="font-semibold">
                    {i.severity === "block" ? "Stop — " : "Note — "}
                  </span>
                  {i.detail}
                </p>
              ))}
              {draft.needsAck && !blocked && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={acked}
                    onChange={(e) => setAcked(e.target.checked)}
                  />
                  Reviewed — proceed with the matched underwriter
                </label>
              )}
            </div>
          )}

          <textarea
            value={draftBody}
            onChange={(e) => setBody((p) => ({ ...p, [key]: e.target.value }))}
            rows={12}
            className="field mt-3 font-mono text-[13px] leading-relaxed"
          />

          {alreadyOut && (
            <div className="mt-3 rounded-xl bg-[var(--sand)]/70 px-4 py-3">
              <p className="text-xs font-semibold text-[var(--ink)]">
                This Ticket Already Went Out — Tag Why You&apos;re Going Back
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LOOP_REASONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setLoopReason(r.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      loopReason === r.id
                        ? "bg-[var(--ink)] text-white"
                        : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)]"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="btn-ghost cursor-pointer text-xs">
              Attach Files
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
            </label>
            {ticket.docs.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() =>
                  setAttachments((prev) =>
                    prev.some((a) => a.id === d.id)
                      ? prev
                      : [
                          ...prev,
                          {
                            id: d.id,
                            name: conventionName({
                              entity: ticket.holderName ?? ticket.account.name,
                              kind: "coi",
                              originalName: d.name,
                              taken: prev.map((a) => a.name),
                            }),
                            sizeLabel: d.sizeLabel,
                          },
                        ],
                  )
                }
                className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-[var(--ink)] ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
                title={`${docKindLabel(d.kind)} · ${d.sizeLabel}`}
              >
                + {d.name}
              </button>
            ))}
          </div>

          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs shadow-sm ring-1 ring-[var(--rule)]"
                >
                  <span aria-hidden>📎</span>
                  <span className="font-medium text-[var(--ink)]">{a.name}</span>
                  <span className="text-[var(--muted)]">{a.sizeLabel}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((p) => p.filter((x) => x.id !== a.id))
                    }
                    className="text-[var(--muted)] hover:text-[var(--coral)]"
                    aria-label={`Remove ${a.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-900">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canSend}
              onClick={send}
              className="btn-primary px-6 py-2.5 disabled:opacity-40"
            >
              {pending
                ? "Sending…"
                : blocked
                  ? "Blocked — Fix The File First"
                  : !recipientOk
                    ? "Blocked — Recipient Email Unverified"
                    : !operator
                      ? "Sign In To Send"
                      : alreadyOut && !loopReason
                        ? "Tag The Reason First"
                        : draft.route?.openPortal
                          ? "Open Portal & Log"
                          : `Send To ${draft.underwriter?.name.split(" ")[0] ?? "Market"}`}
            </button>
            {alreadyOut && (
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="btn-ghost"
              >
                Cancel
              </button>
            )}
          </div>
        </section>
      )}

      {/* ————— Stream ————— */}
      {stream.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="eyebrow">
              Market Correspondence · {stream.length} Message
              {stream.length === 1 ? "" : "s"} Across {ticket.threads.length} Thread
              {ticket.threads.length === 1 ? "" : "s"}
            </p>
            {!showComposer && (
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="btn-ghost text-xs"
              >
                Go Back Out
              </button>
            )}
          </div>

          {stream.map(({ message, thread }) => (
            <MessageRow key={message.id} message={message} thread={thread} />
          ))}
        </section>
      )}

      {/* ————— Demo controls ————— */}
      {ticket.threads.length > 0 && (
        <section className="rounded-2xl border border-dashed border-[var(--rule)] px-5 py-4">
          <p className="eyebrow">Simulate A Market Reply</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { label: "$250 — Auto-Approve", dollars: "250" },
              { label: "$1,200 — Needs A Human", dollars: "1200" },
              { label: "$0 — No Charge", dollars: "0" },
            ].map((b) => (
              <button
                key={b.dollars}
                type="button"
                disabled={pending}
                onClick={() =>
                  run(simulateQuoteAction, ticket.threads[ticket.threads.length - 1].id, {
                    dollars: b.dollars,
                  })
                }
                className="btn-ghost text-xs disabled:opacity-50"
              >
                {b.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            No charge flips this ticket to Ready To Issue and lights the
            Certificate tab. Over {formatMoney(AUTO_APPROVE_THRESHOLD_CENTS)}{" "}
            relays terms to the insured with a payment link.
          </p>
        </section>
      )}
    </div>
  );
}

function MessageRow({
  message: m,
  thread,
}: {
  message: Message;
  thread: ThreadDetail;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = m.body.length > 260;
  const shown = long && !expanded ? `${m.body.slice(0, 260).trim()}…` : m.body;

  const who =
    m.direction === "inbound"
      ? thread.underwriter.name
      : m.party === "client"
        ? `To ${thread.account.name}`
        : `To ${m.toName || thread.underwriter.name}`;

  const tone =
    m.direction === "inbound"
      ? "border-amber-200/80 bg-amber-50/40"
      : m.party === "client"
        ? "border-emerald-200/80 bg-emerald-50/40"
        : m.role === "human"
          ? "border-sky-200/80 bg-sky-50/40"
          : "border-[var(--rule)] bg-white";

  return (
    <article className={`rounded-2xl border p-4 shadow-sm ${tone}`}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--ink)]">{who}</span>
        <span className="text-[10px] text-[var(--muted)]">
          {formatDate(m.createdAt)}
        </span>
      </div>
      <p className="mb-2 truncate text-[11px] text-[var(--muted)]">
        {m.subject || thread.subject}
        {m.channel && m.channel !== "email" ? ` · ${m.channel}` : ""}
        {m.loopReason ? ` · ${loopReasonLabel(m.loopReason)}` : ""}
      </p>
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--ink)]/90">
        {shown}
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-[var(--coral)] hover:underline"
        >
          {expanded ? "Show Less" : "Read Full Email"}
        </button>
      )}
      {m.premiumImpactCents != null && (
        <p className="mt-2 text-xs font-semibold text-amber-800">
          Quote {formatMoney(m.premiumImpactCents)}
        </p>
      )}
    </article>
  );
}
