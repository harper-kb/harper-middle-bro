"use client";

import { useState } from "react";
import {
  endorsementKindLabel,
  getPolicyFormSet,
  type EndorsementKind,
} from "@/lib/forms";
import type { Policy } from "@/lib/types";

const KIND_STYLE: Record<EndorsementKind, string> = {
  ai: "bg-[var(--warning-soft)] text-[var(--warning)] ring-[var(--warning)]/30",
  wos: "bg-sky-50 text-sky-800 ring-sky-200",
  pnc: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  exclusion: "bg-rose-50 text-rose-800 ring-rose-200",
  other: "bg-[var(--sand)] text-[var(--ink)]/70 ring-[var(--rule)]",
};

function Caret({ open }: { open: boolean }) {
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--sand)]/80 transition-all duration-300 ${
        open ? "rotate-90 bg-[var(--gold)]/20" : ""
      }`}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden
        className="translate-x-[0.5px]"
      >
        <path
          d="M3 1.5 L7 5 L3 8.5"
          stroke={open ? "var(--gold)" : "var(--muted)"}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function CopyForm({ form, edition }: { form: string; edition: string }) {
  const [copied, setCopied] = useState(false);
  const text = edition ? `${form} ${edition}` : form;

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // clipboard may be blocked — ignore
        }
      }}
      title="Copy form number"
      className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] tracking-tight transition-colors ${
        copied
          ? "bg-emerald-50 text-emerald-700"
          : "text-[var(--ink)]/70 hover:bg-[var(--sand)]"
      }`}
    >
      {copied ? "Copied" : text}
    </button>
  );
}

function PolicyDisclosure({
  policy,
  defaultOpen,
}: {
  policy: Policy;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const set = getPolicyFormSet(policy);

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-[var(--rule)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[var(--sand)]/40"
      >
        <Caret open={open} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-[var(--ink)]">
            {policy.policyNumber}
          </span>
          <span className="block text-[10px] text-[var(--muted)]">
            {policy.carrier} · {set.endorsements.length} endorsement
            {set.endorsements.length === 1 ? "" : "s"}
          </span>
        </span>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 border-t border-[var(--rule)] px-3.5 py-3">
            <div>
              <p className="eyebrow mb-1.5">Coverage Parts</p>
              <ul className="space-y-1">
                {set.coverages.map((c) => (
                  <li
                    key={c.code + c.form}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--ink)]">
                      {c.label}
                    </span>
                    <CopyForm form={c.form} edition={c.edition} />
                  </li>
                ))}
              </ul>
            </div>

            {set.endorsements.length > 0 && (
              <div>
                <p className="eyebrow mb-1.5">Endorsements</p>
                <ul className="space-y-2">
                  {set.endorsements.map((e) => (
                    <li
                      key={e.form}
                      className={`rounded-lg py-1.5 pl-2.5 pr-1 ${
                        e.kind === "ai"
                          ? "border-l-2 border-[var(--gold)] bg-[var(--gold)]/5"
                          : "border-l-2 border-transparent"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span
                            className={`mr-1.5 inline-block rounded px-1 py-px align-middle text-[9px] font-bold uppercase tracking-wide ring-1 ${KIND_STYLE[e.kind]}`}
                          >
                            {endorsementKindLabel(e.kind)}
                          </span>
                          <span className="align-middle text-xs leading-snug text-[var(--ink)]">
                            {e.title}
                          </span>
                          {e.note && (
                            <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--muted)]">
                              {e.note}
                            </p>
                          )}
                        </div>
                        <CopyForm form={e.form} edition={e.edition} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FormsPanel({
  policies,
  focusPolicyId,
}: {
  policies: Policy[];
  focusPolicyId: string | null;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="eyebrow">Coverage &amp; Forms</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
        What&apos;s on the paper, per policy — form numbers included. Tap a
        number to copy it.
      </p>
      <div className="mt-3 space-y-2">
        {policies.map((p) => (
          <PolicyDisclosure
            key={p.id}
            policy={p}
            defaultOpen={p.id === focusPolicyId}
          />
        ))}
      </div>
    </div>
  );
}
