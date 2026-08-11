import type { WorkItem } from "@/lib/types";

export type InstantBindBucket = "no_signature" | "signature_needed";

export type InstantBindFacet =
  | "payment"
  | "subjectivities"
  | "re_rate"
  | "referral"
  | "carrier_access"
  | "none";

export function instantBindBucket(item: WorkItem): InstantBindBucket {
  const hay = `${item.title} ${item.summary} ${item.blocker?.label ?? ""}`.toLowerCase();
  if (/no signature|signature not needed|iq bind/.test(hay)) return "no_signature";
  if (/signature|docusign|sign needed/.test(hay)) return "signature_needed";
  // Default: signature path is the safer assumption until live facets land.
  return "signature_needed";
}

export function instantBindFacet(item: WorkItem): InstantBindFacet {
  const hay = `${item.title} ${item.summary} ${item.blocker?.label ?? ""}`.toLowerCase();
  if (/payment|pfa|financ/.test(hay)) return "payment";
  if (/subjectiv/.test(hay)) return "subjectivities";
  if (/re-?rate|repric/.test(hay)) return "re_rate";
  if (/referral|refer to uw/.test(hay)) return "referral";
  if (/portal|carrier access|rt connector|blitz/.test(hay)) return "carrier_access";
  return "none";
}

export const FACET_LABELS: Record<InstantBindFacet, string> = {
  payment: "Payment",
  subjectivities: "Subjectivities",
  re_rate: "Re-Rate",
  referral: "Referral",
  carrier_access: "Carrier Access",
  none: "Clear",
};

export function instantBindAction(item: WorkItem): string {
  const facet = instantBindFacet(item);
  if (facet === "carrier_access") return "Confirm Portal Bind";
  if (facet === "payment") return "Send Payment Chase";
  if (instantBindBucket(item) === "signature_needed") return "Chase Signature";
  return "Daily Customer Chase";
}
