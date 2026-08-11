import type { WorkItem } from "@/lib/types";

export type PostSalesKind =
  | "upsell"
  | "added_coverage"
  | "premium_endorsement"
  | "remarket"
  | "handoff"
  | "other_revenue";

export function classifyPostSales(item: WorkItem): PostSalesKind {
  const hay = `${item.title} ${item.summary}`.toLowerCase();
  if (/remarket|requote|shop/.test(hay)) return "remarket";
  if (/upsell|umbrella|increase limit/.test(hay)) return "upsell";
  if (/add(ed)? coverage|new line|midterm quote/.test(hay)) return "added_coverage";
  if (/premium|endors/.test(hay)) return "premium_endorsement";
  if (/handoff|sales|producer/.test(hay)) return "handoff";
  return "other_revenue";
}

export const POST_SALES_LABELS: Record<PostSalesKind, string> = {
  upsell: "Upsell",
  added_coverage: "Added Coverage",
  premium_endorsement: "Premium Endorsement",
  remarket: "Remarket",
  handoff: "Handoff",
  other_revenue: "Revenue Work",
};
