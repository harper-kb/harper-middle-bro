import type { AccountDoc } from "./types";

/**
 * Additional Insured mastery desk.
 *
 * One request type, specified to death, deliberately paced: only a few
 * tickets are "in play" at once so every confirm or edit becomes a labeled
 * learning signal before we raise throughput.
 *
 * The queue itself is no longer a hardcoded array — it reads Additional
 * Insured tickets, so the desk and the rest of Service share one record.
 */

export const IN_PLAY_LIMIT = 3;

/** Consecutive clean sends — no edits, no overrides — that earn auto-send. */
export const AUTO_SEND_UNLOCK_AT = 10;

export type AiQueueStatus = "in_play" | "paced" | "confirmed" | "returned";

export const EDIT_REASONS = [
  { id: "wrong_policy", label: "Wrong Policy Picked" },
  { id: "holder_vs_ai", label: "Holder ≠ AI Entity" },
  { id: "missing_address", label: "Missing / Bad Address" },
  { id: "wording", label: "Endorsement Wording" },
  { id: "tone", label: "Tone / Formatting" },
  { id: "other", label: "Other" },
] as const;

export type EditReasonId = (typeof EDIT_REASONS)[number]["id"];

export function docKindLabel(kind: AccountDoc["kind"]): string {
  switch (kind) {
    case "quote":
      return "Quote";
    case "policy":
      return "Policy";
    case "endorsement":
      return "Endorsement";
    case "customer_upload":
      return "Customer Upload";
  }
}

export type { AccountDoc };
