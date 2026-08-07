"use client";

import { useMemo, useState, useTransition } from "react";
import { markPaymentClearedAction, sendClientTermsAction } from "@/lib/actions";
import { buildClientTermsEmail, findQuoteMessage } from "@/lib/clientmail";
import { formatMoney } from "@/lib/format";
import { getRequestType } from "@/lib/catalog";
import { createPaymentLink } from "@/lib/payments";
import { summarizeRequest } from "@/lib/request-summary";
import type { Operator, ThreadDetail } from "@/lib/types";

/**
 * Over the auto-approve line, so the client decides. Three blocks only:
 * what they asked for, what the carrier said, and how to pay.
 */
export function ClientTermsPanel({
  thread,
  operator,
}: {
  thread: ThreadDetail;
  operator: Operator | null;
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<string | null>(null);
  const [includeCarrierWords, setIncludeCarrierWords] = useState(true);
  const [copied, setCopied] = useState(false);

  const premium = thread.offeredPremiumCents ?? 0;
  const req = getRequestType(thread.requestType);
  const request = useMemo(() => summarizeRequest(thread), [thread]);
  const uwMessage = useMemo(() => findQuoteMessage(thread), [thread]);

  const payment = useMemo(
    () =>
      createPaymentLink({
        threadId: thread.id,
        accountName: thread.account.name,
        policyNumber: thread.policy.policyNumber,
        amountCents: premium,
        memo: `${req.label} — ${thread.policy.policyNumber}`,
        issuedAt: thread.updatedAt,
      }),
    [thread, premium, req.label],
  );

  const generated = useMemo(
    () =>
      buildClientTermsEmail({
        thread,
        request,
        payment,
        operator,
        termsText: includeCarrierWords ? undefined : "",
      }),
    [thread, request, payment, operator, includeCarrierWords],
  );

  const body = draft ?? generated.body;
  const edited = draft !== null && draft !== generated.body;
  const alreadySent = thread.messages.some((m) => m.role === "client");
  const paid = thread.messages.some((m) => m.channel === "payment");

  function markPaid() {
    const fd = new FormData();
    fd.set("threadId", thread.id);
    startTransition(async () => {
      await markPaymentClearedAction(fd);
    });
  }

  function copyLink() {
    void navigator.clipboard.writeText(payment.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  function send() {
    const fd = new FormData();
    fd.set("threadId", thread.id);
    fd.set("body", body);
    fd.set("paymentReference", payment.reference);
    startTransition(async () => {
      await sendClientTermsAction(fd);
      setDraft(null);
      window.dispatchEvent(new Event("uw-desk-inbox-refresh"));
    });
  }

  return (
    <section className="surface-card overflow-hidden rise-in">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rule)] px-5 py-4">
        <div>
          <p className="eyebrow">Terms To Client</p>
          <h2 className="mt-0.5 font-display text-xl text-[var(--ink)]">
            {formatMoney(premium)} Needs Their Approval
          </h2>
        </div>
        <span className="chip">
          {alreadySent ? "Relayed" : "Over $500"}
        </span>
      </header>

      <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4">
          <p className="eyebrow">What They Requested</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <Row label="Request" value={req.label} />
            {request.holderName && <Row label="Holder" value={request.holderName} />}
            {request.holderAddress && (
              <Row label="Address" value={request.holderAddress} />
            )}
            <Row
              label="Policy"
              value={`${thread.policy.policyNumber} · ${thread.policy.carrier}`}
            />
          </dl>
          {request.wording && (
            <p className="mt-3 border-t border-[var(--rule)] pt-2 text-xs leading-relaxed text-[var(--muted)]">
              {request.wording}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4">
          <p className="eyebrow">Terms Offered</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <Row label="Premium" value={formatMoney(premium)} strong />
            <Row label="Underwriter" value={thread.underwriter.name} />
            <Row label="Carrier" value={thread.policy.carrier} />
          </dl>
          {uwMessage ? (
            <blockquote className="mt-3 border-l-2 border-[var(--gold)] pl-3 text-xs leading-relaxed text-[var(--ink)]/80">
              {uwMessage.body}
            </blockquote>
          ) : (
            <p className="mt-3 text-xs text-[var(--muted)]">
              No carrier message on this thread yet.
            </p>
          )}
        </div>
      </div>

      <div className="px-5 pb-4">
        <div className="pay-card rounded-2xl p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow text-white/50">Payment Link</p>
              <p className="mt-1 font-display text-2xl">{formatMoney(premium)}</p>
              <p className="mt-0.5 text-xs text-white/55">{payment.memo}</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                paid ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/70"
              }`}
            >
              {paid ? "Paid" : "Unpaid"}
            </span>
          </div>
          <p className="pay-link mt-3 rounded-lg bg-white/8 px-3 py-2 text-xs text-white/85">
            {payment.url}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-white/55">
            <span>Reference {payment.reference}</span>
            <span>·</span>
            <span>Good Through {new Date(payment.expiresAt).toLocaleDateString()}</span>
            <button
              type="button"
              onClick={copyLink}
              className="ml-auto rounded-full border border-white/20 px-3 py-1 text-[11px] font-semibold text-white/90 hover:bg-white/10"
            >
              {copied ? "Copied" : "Copy Link"}
            </button>
          </div>
        </div>

        {alreadySent && !paid && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--sand)]/70 px-4 py-3">
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              Payment is what advances this ticket — not the insured saying yes
              on the phone.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={markPaid}
              className="btn-primary shrink-0 px-4 py-2 text-xs disabled:opacity-45"
            >
              Payment Cleared
            </button>
          </div>
        )}

        {paid && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
            Paid and cleared — this ticket moved to Ready To Issue. Head to the
            Certificate tab.
          </p>
        )}
      </div>

      <div className="px-5 pb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Draft To {thread.account.name}</p>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={includeCarrierWords}
                onChange={(e) => {
                  setIncludeCarrierWords(e.target.checked);
                  setDraft(null);
                }}
                className="accent-[var(--ink)]"
              />
              Quote The Carrier Verbatim
            </label>
            {edited && (
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-[11px] font-semibold text-[var(--coral)] hover:underline"
              >
                Reset Draft
              </button>
            )}
          </div>
        </div>
        <p className="mb-2 text-[11px] text-[var(--muted)]">
          Subject: {generated.subject}
        </p>
        <textarea
          value={body}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          className="field font-mono text-[12.5px] leading-relaxed"
          spellCheck={false}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending || !operator}
            onClick={send}
            className="btn-primary disabled:opacity-45"
          >
            {!operator
              ? "Sign In To Send"
              : alreadySent
                ? "Resend Terms"
                : "Send Terms & Payment Link"}
          </button>
          {edited && <span className="chip">Edited</span>}
          {!operator && (
            <span className="text-xs text-[var(--muted)]">
              Your signature stamps the draft — sign in on Profile.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-[var(--muted)]">{label}</dt>
      <dd className={`text-right ${strong ? "font-semibold" : "font-medium"}`}>
        {value}
      </dd>
    </div>
  );
}
