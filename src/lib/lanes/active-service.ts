/**
 * Active Service — non-revenue servicing taxonomy.
 * Claims only identify carrier/claims contact, email that info, and close.
 */
import type { WorkItem } from "@/lib/types";

export type ActiveServiceKind =
  | "ai_wos_pnc"
  | "endorsement"
  | "name_address_change"
  | "inspection_audit"
  | "policy_documents"
  | "refund_payment_recovery"
  | "loss_runs"
  | "simple_claim"
  | "general";

export const ACTIVE_SERVICE_LABELS: Record<ActiveServiceKind, string> = {
  ai_wos_pnc: "AI / WOS / P&NC",
  endorsement: "Endorsement",
  name_address_change: "Name / Address Change",
  inspection_audit: "Inspection / Audit",
  policy_documents: "Policy Documents",
  refund_payment_recovery: "Refund / Payment Recovery",
  loss_runs: "Loss Runs",
  simple_claim: "Simple Claim",
  general: "General Service",
};

export function classifyActiveService(item: WorkItem): ActiveServiceKind {
  const hay = `${item.title} ${item.summary}`.toLowerCase();
  if (/claim/.test(hay)) return "simple_claim";
  if (/loss run/.test(hay)) return "loss_runs";
  if (/refund|payment recovery|premium return/.test(hay)) return "refund_payment_recovery";
  if (/inspect|audit/.test(hay)) return "inspection_audit";
  if (/policy (doc|pdf|copy)|dec page/.test(hay)) return "policy_documents";
  if (/name change|address change|dba/.test(hay)) return "name_address_change";
  if (/additional insured|waiver|p&nc|primary.?non/.test(hay)) return "ai_wos_pnc";
  if (/endors/.test(hay)) return "endorsement";
  return "general";
}

export function activeServiceAction(kind: ActiveServiceKind): string {
  if (kind === "simple_claim") return "Email Claims Contact — Close";
  if (kind === "ai_wos_pnc") return "Draft Certificate Path";
  if (kind === "endorsement") return "Draft Endorsement";
  return "Open Task";
}
