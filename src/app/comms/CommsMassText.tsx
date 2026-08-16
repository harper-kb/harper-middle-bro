"use client";

import { useState } from "react";

/**
 * Mass-text composer for the Quo phone desk. Honest by design: this sandbox
 * has no carrier hookup, so "queueing" renders a per-recipient preview of
 * exactly what would send — nothing persists, no fake delivery receipts.
 */

export interface MassTextRecipient {
  name: string;
  number: string;
  account: string | null;
}

export function CommsMassText({
  recipients,
}: {
  recipients: MassTextRecipient[];
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(recipients.map((r) => [r.number, true])),
  );
  const [message, setMessage] = useState("");
  const [queued, setQueued] = useState<{
    message: string;
    recipients: MassTextRecipient[];
  } | null>(null);

  const selected = recipients.filter((r) => checked[r.number]);
  const canQueue = selected.length > 0 && message.trim().length > 0;

  if (queued) {
    return (
      <div className="surface-card px-5 py-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="chip border-amber-300 text-amber-800">
            Queued — Sandbox Has No Carrier Connection
          </span>
          <button
            type="button"
            onClick={() => setQueued(null)}
            className="btn-ghost text-xs"
          >
            Compose Another
          </button>
        </div>
        <p className="mb-4 text-xs text-[var(--muted)]">
          Nothing was transmitted and nothing persists — this is the
          per-recipient render of exactly what a live connection would send.
        </p>
        <ul className="space-y-3">
          {queued.recipients.map((r) => (
            <li
              key={r.number}
              className="rounded-xl border border-[var(--rule)] bg-white px-4 py-3"
            >
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-[var(--ink)]">
                  {r.name}
                  <span className="ml-2 font-mono text-[11px] font-normal text-[var(--muted)]">
                    {r.number}
                  </span>
                </p>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                  Queued — Sandbox
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink)]/90">
                {queued.message}
              </p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="surface-card px-5 py-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="chip">Mass Text</span>
        <span className="text-[11px] text-[var(--muted)]">
          Sandbox — no carrier connection; nothing actually transmits.
        </span>
      </div>

      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        Recipients
      </p>
      <ul className="mb-4 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-[var(--rule)] bg-white px-3 py-2">
        {recipients.map((r) => (
          <li key={r.number}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--sand)]">
              <input
                type="checkbox"
                checked={Boolean(checked[r.number])}
                onChange={(e) =>
                  setChecked((prev) => ({
                    ...prev,
                    [r.number]: e.target.checked,
                  }))
                }
              />
              <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
                {r.name}
              </span>
              <span className="font-mono text-[11px] text-[var(--muted)]">
                {r.number}
              </span>
              <span className="chip">{r.account ?? "No Account Match"}</span>
            </label>
          </li>
        ))}
        {recipients.length === 0 && (
          <li className="px-2 py-3 text-xs text-[var(--muted)]">
            No phone-number senders in the intake stream yet.
          </li>
        )}
      </ul>

      <label
        className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]"
        htmlFor="mass-text-message"
      >
        Message
      </label>
      <textarea
        id="mass-text-message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="One message, every checked number…"
        className="field mb-4 min-h-28"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canQueue}
          onClick={() =>
            setQueued({ message: message.trim(), recipients: selected })
          }
          className={`btn-primary px-4 py-1.5 text-xs ${
            canQueue ? "" : "cursor-not-allowed opacity-40"
          }`}
        >
          Queue Mass Text (Sandbox)
        </button>
        <span className="text-xs text-[var(--muted)]">
          Sending To {selected.length} Recipient
          {selected.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
