import type { WorkItem } from "@/lib/types";

export type InstantBindBucket = "no_signature" | "signature_needed";

export const SIGNATURE_REQUIRED_IQ_CARRIERS = [
  "rt_connector",
  "blitz",
  "pathpoint",
  "thimble",
  "isc_wc",
] as const;

const SIGNATURE_CARRIER_MATCHERS: Record<
  (typeof SIGNATURE_REQUIRED_IQ_CARRIERS)[number],
  (text: string) => boolean
> = {
  rt_connector: (text) => text.includes("rt connector") || text.includes("rtconnector"),
  blitz: (text) => text.includes("blitz"),
  pathpoint: (text) => text.includes("pathpoint") || text.includes("path point"),
  thimble: (text) => text.includes("thimble"),
  isc_wc: (text) =>
    (text.includes("isc") || text.includes("insurance services center")) &&
    (text.includes("workers comp") ||
      text.includes("workers compensation") ||
      text.split(" ").includes("wc")),
};

export type InstantBindFacet =
  | "payment"
  | "subjectivities"
  | "re_rate"
  | "referral"
  | "carrier_access"
  | "none";

export function instantBindBucket(item: WorkItem): InstantBindBucket {
  const hay = normalizeCarrierText(
    `${item.title} ${item.summary} ${item.blocker?.label ?? ""}`,
  );
  const signatureRequired = SIGNATURE_REQUIRED_IQ_CARRIERS.some((carrier) =>
    SIGNATURE_CARRIER_MATCHERS[carrier](hay),
  );
  return signatureRequired ? "signature_needed" : "no_signature";
}

export function sortInstantBindsOldestFirst(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    const ageOrder = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return ageOrder || a.id.localeCompare(b.id);
  });
}

export function instantBindFacet(item: WorkItem): InstantBindFacet {
  const hay = `${item.title} ${item.summary} ${item.blocker?.label ?? ""}`.toLowerCase();
  if (/payment|pfa|financ/.test(hay)) return "payment";
  if (/subjectiv/.test(hay)) return "subjectivities";
  if (/re-?rate|repric/.test(hay)) return "re_rate";
  if (/referral|refer to uw/.test(hay)) return "referral";
  if (/portal|carrier access|rt connector|blitz|pathpoint|path point|thimble|isc/.test(hay)) return "carrier_access";
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

function normalizeCarrierText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[_/–—-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
