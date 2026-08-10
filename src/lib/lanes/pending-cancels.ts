import type { WorkItem } from "@/lib/types";

export type CancelReasonCode =
  | "non_pay"
  | "insured_request"
  | "underwriting"
  | "financing"
  | "rewrite"
  | "unknown";

export function classifyCancelReason(item: WorkItem): CancelReasonCode {
  const hay = `${item.title} ${item.summary} ${item.blocker?.label ?? ""}`.toLowerCase();
  if (/financ|pfa|premium financ/.test(hay)) return "financing";
  if (/non.?pay|payment failure|lapse/.test(hay)) return "non_pay";
  if (/insured request|customer (asked|request).*cancel/.test(hay)) return "insured_request";
  if (/underwrit|uw cancel|material change/.test(hay)) return "underwriting";
  if (/rewrite|remarket/.test(hay)) return "rewrite";
  return "unknown";
}

export const CANCEL_REASON_LABELS: Record<CancelReasonCode, string> = {
  non_pay: "Non-Pay",
  insured_request: "Insured Request",
  underwriting: "Underwriting",
  financing: "Financing",
  rewrite: "Rewrite",
  unknown: "Unknown",
};

export function cancelRetentionAction(reason: CancelReasonCode): string {
  if (reason === "financing") return "Send Financing Cure";
  if (reason === "non_pay") return "Send Cure Chase";
  if (reason === "insured_request") return "Retention Call";
  if (reason === "rewrite") return "Open Remarket";
  return "Review Retention Path";
}

/** Effective-date priority: sooner cancels rank first (engine also sorts). */
export function cancelEffectiveAt(item: WorkItem): string | null {
  if (item.clock.kind === "cancellation_effective") return item.clock.at;
  return item.clock.at;
}
