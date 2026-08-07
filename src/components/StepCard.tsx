"use client";

import { useState } from "react";
import {
  VERDICT_DOTS,
  type ModelStepDetail,
  type StepVerdict,
  type TraceStep,
} from "@/lib/trace";

const VERDICT_LABELS: Record<StepVerdict, string> = {
  ok: "Passed",
  warn: "Flagged",
  block: "Blocked",
  info: "Noted",
};

/** One step opened as editorial evidence — not a nested card. */
export function StepCard({ step, index }: { step: TraceStep; index: number }) {
  const isModel = step.source === "model";

  return (
    <article className="trace-step">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="font-display text-4xl leading-none tracking-tight text-[var(--ink)]/15">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${VERDICT_DOTS[step.verdict]}`}
              />
              <h3 className="font-display text-xl leading-tight text-[var(--ink)]">
                {step.label}
              </h3>
              {isModel && (
                <span className="font-mono text-[10px] tracking-wide text-[var(--gold)]">
                  MODEL
                </span>
              )}
            </div>
            <p className="mt-1.5 max-w-2xl text-sm italic leading-relaxed text-[var(--muted)]">
              {step.rule}
            </p>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
          {VERDICT_LABELS[step.verdict]}
        </span>
      </header>

      <dl className="mt-6 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
        {step.inputs.map((input, i) => (
          <div
            key={`${step.id}-${i}`}
            className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-6"
          >
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {input.label}
            </dt>
            <dd className="text-sm leading-relaxed text-[var(--ink)]">
              {input.value}
            </dd>
          </div>
        ))}
      </dl>

      {step.model && <ModelPanel detail={step.model} />}

      <p className="mt-5 flex items-start gap-3 text-base font-medium leading-snug text-[var(--ink)]">
        <span className="mt-0.5 font-display text-lg text-[var(--coral)]" aria-hidden>
          →
        </span>
        {step.outcome}
      </p>
    </article>
  );
}

function ModelPanel({ detail }: { detail: ModelStepDetail }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-5 overflow-hidden rounded-xl bg-[var(--ink)] text-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="font-mono text-[10px] tracking-[0.14em] text-white/55">
          GENERATED · {detail.model}
        </span>
        {!detail.accepted && (
          <span className="font-mono text-[10px] tracking-wide text-amber-200/90">
            DID NOT SHIP
          </span>
        )}
        <span className="ml-auto text-[11px] text-white/45">
          {open ? "Hide" : "Prompt & Response"}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-white/10 px-4 pb-4 pt-3">
          {detail.system && <Field label="System">{detail.system}</Field>}
          <Field label="Prompt">{detail.prompt}</Field>
          <Field label="Response">{detail.response}</Field>
          {detail.overrideNote && (
            <Field label="Why It Was Replaced">{detail.overrideNote}</Field>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
        {label}
      </p>
      <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/85">
        {children}
      </pre>
    </div>
  );
}
