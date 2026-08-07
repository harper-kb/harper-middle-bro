"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addressPasses,
  emailPasses,
  formatStandardized,
  type AddressVerdict,
  type EmailVerdict,
} from "@/lib/validate-contact";

/**
 * Client side of the contact hard gates. A field is one of:
 *   idle (empty) → checking (typing / in flight) → done (verdict) → …
 *
 * Gates only open on a positive verdict. While a check is in flight, after
 * a negative verdict, or when the validator itself is unreachable, the gate
 * stays CLOSED — the unreachable case renders "Validation Unavailable —
 * Retry" and never waves anything through.
 */

export type CheckPhase = "idle" | "checking" | "done";

export interface Check<V> {
  /** The trimmed value this state describes */
  value: string;
  phase: CheckPhase;
  verdict: V | null;
  retry: () => void;
}

const DEBOUNCE_MS = 650;

function useDebouncedCheck<V>(
  endpoint: string,
  key: "email" | "address",
  raw: string,
  unavailable: (detail: string) => V,
): Check<V> {
  const value = raw.trim();
  const [nonce, setNonce] = useState(0);
  // The only stored state is the last completed answer, tagged with the
  // exact input (and retry nonce) it answered. Phase is derived: a value
  // with no matching answer is simply still "checking".
  const [result, setResult] = useState<{
    forValue: string;
    forNonce: number;
    verdict: V;
  } | null>(null);

  useEffect(() => {
    if (!value) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const verdict = (await res.json()) as V;
        setResult({ forValue: value, forNonce: nonce, verdict });
      } catch (e) {
        if (controller.signal.aborted) return;
        setResult({
          forValue: value,
          forNonce: nonce,
          verdict: unavailable(e instanceof Error ? e.message : "network error"),
        });
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, nonce, endpoint, key]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const done =
    result !== null && result.forValue === value && result.forNonce === nonce;
  const phase: CheckPhase = !value ? "idle" : done ? "done" : "checking";
  return { value, phase, verdict: done ? result.verdict : null, retry };
}

export function useEmailCheck(raw: string): Check<EmailVerdict> {
  return useDebouncedCheck<EmailVerdict>(
    "/api/validate/email",
    "email",
    raw,
    (detail) => ({
      status: "unavailable",
      reason: `Validation Unavailable — ${detail}`,
    }),
  );
}

export function useAddressCheck(raw: string): Check<AddressVerdict> {
  return useDebouncedCheck<AddressVerdict>(
    "/api/validate/address",
    "address",
    raw,
    (detail) => ({
      status: "unavailable",
      provider: "unreachable",
      reason: `Validation Unavailable — ${detail}`,
    }),
  );
}

/**
 * Is this field allowed through the gate right now?
 * Empty + optional = open (blank beats wrong). Anything typed must carry a
 * finished positive verdict.
 */
export function emailGateOpen(check: Check<EmailVerdict>, required = false): boolean {
  if (!check.value) return !required;
  return check.phase === "done" && emailPasses(check.verdict);
}

export function addressGateOpen(check: Check<AddressVerdict>, required = false): boolean {
  if (!check.value) return !required;
  return check.phase === "done" && addressPasses(check.verdict);
}

/** Human reason for why a gate is closed (null when it is open). */
export function emailGateReason(check: Check<EmailVerdict>): string | null {
  if (!check.value) return null;
  if (check.phase !== "done") return "Verifying Email…";
  if (emailPasses(check.verdict)) return null;
  return check.verdict?.reason ?? "Email Unverified";
}

export function addressGateReason(check: Check<AddressVerdict>): string | null {
  if (!check.value) return null;
  if (check.phase !== "done") return "Verifying Address…";
  if (addressPasses(check.verdict)) return null;
  return check.verdict?.reason ?? "Address Unverified";
}

/* ————————————————————————— Chips ————————————————————————— */

const CHIP =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ring-1";
const OK = `${CHIP} bg-emerald-50 text-emerald-800 ring-emerald-200`;
const BAD = `${CHIP} bg-rose-50 text-rose-900 ring-rose-200`;
const WAIT = `${CHIP} bg-[var(--paper)] text-[var(--muted)] ring-[var(--rule)]`;
const FIX = `${CHIP} bg-amber-50 text-amber-900 ring-amber-300`;

function RetryChip({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <span className={BAD} title={reason}>
      ✗ Validation Unavailable
      <button type="button" onClick={onRetry} className="underline">
        Retry
      </button>
    </span>
  );
}

/**
 * Inline email status. Renders nothing for an empty field; otherwise always
 * shows exactly where the value stands. `onApplySuggestion` powers the
 * one-click "Use …" typo fix.
 */
export function EmailStatusChip({
  check,
  onApplySuggestion,
}: {
  check: Check<EmailVerdict>;
  onApplySuggestion?: (fixed: string) => void;
}) {
  if (!check.value) return null;
  if (check.phase !== "done") {
    return <span className={WAIT}>Verifying…</span>;
  }
  const v = check.verdict!;
  const suggest =
    v.suggestion && onApplySuggestion ? (
      <button
        type="button"
        onClick={() => onApplySuggestion(v.suggestion!)}
        className={FIX}
        title="Apply the suggested fix"
      >
        Use Suggested: {v.suggestion}
      </button>
    ) : null;

  switch (v.status) {
    case "deliverable_domain":
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className={OK} title={v.reason}>
            ✓ Domain Accepts Mail
          </span>
          {suggest}
        </span>
      );
    case "no_mx":
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className={BAD} title={v.reason}>
            ✗ No Mail Domain
          </span>
          {suggest}
        </span>
      );
    case "bad_syntax":
      return <span className={BAD}>✗ Invalid Email Format</span>;
    case "disposable":
      return <span className={BAD}>✗ Disposable Domain Blocked</span>;
    case "unavailable":
      return <RetryChip reason={v.reason} onRetry={check.retry} />;
  }
}

/**
 * Inline address status with the one-click "Use Standardized Address"
 * apply when the validator returned a corrected variant.
 */
export function AddressStatusChip({
  check,
  onApplyStandardized,
}: {
  check: Check<AddressVerdict>;
  onApplyStandardized?: (standardized: string) => void;
}) {
  if (!check.value) return null;
  if (check.phase !== "done") {
    return <span className={WAIT}>Verifying…</span>;
  }
  const v = check.verdict!;
  switch (v.status) {
    case "verified":
      return (
        <span className={OK} title={v.matchedAddress ?? v.reason}>
          ✓ Address Verified
        </span>
      );
    case "corrected":
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className={OK} title={v.reason}>
            ✓ Matched
          </span>
          {v.standardized && onApplyStandardized && (
            <button
              type="button"
              onClick={() => onApplyStandardized(formatStandardized(v.standardized!))}
              className={FIX}
              title={v.matchedAddress ?? "Apply the standardized address"}
            >
              Use Standardized Address
            </button>
          )}
        </span>
      );
    case "unverifiable":
      return (
        <span className={BAD} title={v.reason}>
          ✗ Address Not Found
        </span>
      );
    case "unavailable":
      return <RetryChip reason={v.reason} onRetry={check.retry} />;
  }
}
