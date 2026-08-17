"use client";

import { useEffect, useRef, useState } from "react";

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection-based browser fallback.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied =
      typeof document.execCommand === "function" &&
      document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }
  return copied;
}

export function CopyButton({
  value,
  label,
  successMessage = "Copied",
}: {
  value: string;
  label: string;
  successMessage?: string;
}) {
  const [feedback, setFeedback] = useState<{
    kind: "success" | "failure";
    message: string;
  } | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    const copied = await copyText(value);
    setFeedback({
      kind: copied ? "success" : "failure",
      message: copied ? successMessage : "Copy failed",
    });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setFeedback(null), 1_800);
  }

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={label}
        title={label}
        data-copy-state={feedback?.kind ?? "idle"}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--muted)] transition-colors hover:border-[var(--rule)] hover:bg-[var(--sand)]/70 hover:text-[var(--ink)] focus-visible:border-[var(--rule)] focus-visible:bg-[var(--sand)]/70 focus-visible:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {feedback?.kind === "success" ? (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="h-3.5 w-3.5 text-[var(--success)]"
          >
            <path
              d="m3.25 8.25 3 3 6.5-6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : feedback?.kind === "failure" ? (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="h-3.5 w-3.5 text-[var(--danger)]"
          >
            <path
              d="m4 4 8 8m0-8-8 8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="h-3.5 w-3.5"
          >
            <rect
              x="5.25"
              y="5.25"
              width="7"
              height="7"
              rx="1.25"
              stroke="currentColor"
              strokeWidth="1.25"
            />
            <path
              d="M10.25 5.25v-1.5A1.25 1.25 0 0 0 9 2.5H3.75A1.25 1.25 0 0 0 2.5 3.75V9A1.25 1.25 0 0 0 3.75 10.25h1.5"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
        )}
      </button>
      {feedback ? (
        <span
          role="status"
          className="absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border border-[var(--rule)] bg-[var(--surface-raised)] px-2 py-1 text-[11px] font-medium text-[var(--ink)] shadow-sm"
        >
          {feedback.message}
        </span>
      ) : null}
    </span>
  );
}
