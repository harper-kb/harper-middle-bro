"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "uw_desk_tour_v1";

const STEPS = [
  {
    title: "Welcome To The Desk",
    body: "This portal drafts underwriter requests for commercial lines. Look up the account, add each item the insured needs to one request stack, and send. Threads proceed automatically when quoted premium is ≤ $500.",
    target: "tour-welcome",
  },
  {
    title: "Find The Account",
    body: "Search by company name, DBA, or industry. The primary underwriter on file appears on the right with email, portal, and channel notes.",
    target: "tour-account",
  },
  {
    title: "Build A Request Stack",
    body: "Include every request in one stack — Additional Insured (AI), Waiver Of Subrogation (WOS), 30-Day Notice Of Cancellation, business changes — rather than submitting them separately. Additional Insured requests are the most common starting point; the catalog covers the rest.",
    target: "tour-stack",
  },
  {
    title: "Watch Premium Cues",
    body: "Each line shows whether it usually moves premium. Limit changes, business changes, blanket packages, and 30-Day Notice Of Cancellation endorsements almost always quote (the 30-day notice is commonly a flat charge near $100); certificate wording such as Primary & Non-Contributory (P&NC) rarely does.",
    target: "tour-premium",
  },
  {
    title: "Send And Track",
    body: "Paste or dictate details, preview the email, then send. You will land on the thread where quotes, automatic approvals, and human review appear.",
    target: "tour-send",
  },
] as const;

function subscribeTourStorage(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function readTourDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "done";
  } catch {
    return false;
  }
}

export function DeskTour({
  signedIn,
  forceOpen,
  onClose,
}: {
  signedIn: boolean;
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const tourDone = useSyncExternalStore(
    subscribeTourStorage,
    readTourDone,
    () => true,
  );
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [forceEpoch, setForceEpoch] = useState(forceOpen);

  // forceOpen turning on (Replay Walkthrough) reopens from step 0.
  if (forceOpen !== forceEpoch) {
    setForceEpoch(forceOpen);
    if (forceOpen) {
      setDismissed(false);
      setStep(0);
    }
  }

  const open =
    !dismissed && (Boolean(forceOpen) || (signedIn && !tourDone));

  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "done");
    } catch {
      /* ignore */
    }
    setDismissed(true);
    onClose?.();
  }, [onClose]);

  const skip = finish;

  useEffect(() => {
    if (!open) return;
    const id = STEPS[step]?.target;
    if (!id) return;
    const el = document.querySelector(`[data-tour="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [open, step]);

  if (!open) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Dismiss tour"
        className="absolute inset-0 bg-[var(--ink)]/45 backdrop-blur-[2px]"
        onClick={skip}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="desk-tour-title"
        className="desk-tour-panel relative z-[81] w-full max-w-md rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-6 shadow-[0_24px_80px_rgba(26,44,54,0.28)]"
      >
        <p className="eyebrow">
          Walkthrough · {step + 1} of {STEPS.length}
        </p>
        <h2
          id="desk-tour-title"
          className="mt-2 font-display text-2xl text-[var(--ink)]"
        >
          {current.title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          {current.body}
        </p>
        <div className="mt-5 flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition ${
                i <= step ? "bg-[var(--coral)]" : "bg-[var(--sand)]"
              }`}
            />
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={skip}
            className="text-xs text-[var(--muted)] underline"
          >
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="rounded-full px-4 py-2 text-xs font-medium ring-1 ring-[var(--rule)]"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? finish() : setStep((s) => s + 1))}
              className="btn-primary px-5 py-2 text-xs"
            >
              {last ? "Start Composing" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function restartDeskTour() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
