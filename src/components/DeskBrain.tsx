"use client";

import Link from "next/link";
import { useState } from "react";
import {
  askDeskBrain,
  type DeskBrainBundle,
  type DeskBrainResult,
} from "@/lib/desk-brain";

/**
 * Desk Brain panel — deterministic Q&A over one account's record. No model:
 * the question runs through fixed intent matching in desk-brain.ts against
 * the serializable bundle the server passed down. Out-of-scope questions get
 * the one refusal line, verbatim.
 */

const BASE_SUGGESTIONS = [
  "Blanket Additional Insured?",
  "Blanket Waiver?",
  "General Liability Limits",
  "Endorsements On File",
  "Price History For A Waiver",
  "Premium Of Each Policy",
  "Account Status",
];

const TICKET_SUGGESTIONS = [
  "Thread Summary",
  "Ticket Status",
  "Fast Path?",
  "Holder Info",
];

export function DeskBrain({ bundle }: { bundle: DeskBrainBundle }) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<DeskBrainResult | null>(null);

  const suggestions = bundle.ticket
    ? [...TICKET_SUGGESTIONS, ...BASE_SUGGESTIONS]
    : BASE_SUGGESTIONS;

  function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setAsked(trimmed);
    setResult(askDeskBrain(trimmed, bundle));
  }

  return (
    <section className="surface-card px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl text-[var(--ink)]">Desk Brain</h2>
      </div>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        Scoped To {bundle.account.name} — Answers Come From The Record Only
      </p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <input
          className="field"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask About This Account…"
          aria-label="Ask Desk Brain"
        />
        <button type="submit" className="btn-primary shrink-0">
          Ask
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="chip transition hover:border-[var(--gold)]/60 hover:bg-[var(--sand)]"
            onClick={() => {
              setQuestion(s);
              ask(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {result && asked && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 ${
            result.kind === "refusal"
              ? "border-[var(--coral)]/30 bg-[var(--coral)]/5"
              : "border-[var(--rule)] bg-white"
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            You Asked — {asked}
          </p>
          <p
            className={`mt-1.5 text-sm leading-relaxed ${
              result.kind === "refusal"
                ? "font-medium text-[var(--coral)]"
                : "text-[var(--ink)]"
            }`}
          >
            {result.answer}
          </p>
          {result.kind === "answer" && result.citations.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {result.citations.map((c) =>
                c.href ? (
                  <Link
                    key={`${c.label}-${c.href}`}
                    href={c.href}
                    className="chip transition hover:border-[var(--gold)]/60 hover:bg-[var(--sand)]"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span key={c.label} className="chip">
                    {c.label}
                  </span>
                ),
              )}
            </div>
          )}
          {result.kind === "refusal" && (
            <p className="mt-1.5 text-[11px] text-[var(--muted)]">
              This desk answers only what this account&apos;s record can back —
              limits, forms, threads, premiums, quote history, status.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
