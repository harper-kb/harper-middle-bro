import type { PremiumBearing, RequestTypeId } from "./types";

export const COVERAGE_CATALOG: Record<string, string> = {
  GL: "General Liability",
  WC: "Workers' Compensation",
  Prop: "Property",
  PL: "Professional Liability",
  CA: "Commercial Auto",
  COMM: "Commercial Auto",
  HNOA: "Hired & Non-Owned Auto",
  BOP: "Business Owners Policy",
  Umb: "Umbrella Liability",
  EXCESS_UMB: "Umbrella/Excess Liability",
  IM: "Inland Marine",
  CL: "Cyber Liability",
  "D&O": "Directors & Officers Liability",
  EPLI: "Employment Practices Liability",
  ProdL: "Product Liability",
  Garage: "Garage Liability",
  GK: "Garagekeepers Liability",
  Liquor: "Liquor Liability",
  POLU: "Pollution Liability",
  CRIM: "Crime",
  BOND: "Surety Bond",
  TECH_EO: "Technology Errors & Omissions",
  PKG: "Package Policy",
  CP: "Commercial Property",
};

export const CARRIERS = [
  "Hiscox",
  "Coterie",
  "AmTrust",
  "NEXT Insurance",
  "Markel",
  "Kinsale",
  "Thimble",
  "USLI",
  "Progressive",
  "Geico",
  "First Insurance",
  "Symbol",
  "TMR",
  "Endurance",
  "ISC",
  "RT Specialty",
  "AMWins",
  "Byberg / ByWork",
  "RPS",
] as const;

export type RequestCategory =
  | "certificate"
  | "endorsement"
  | "exposure"
  | "admin"
  | "other";

export interface RequestTypeDef {
  id: RequestTypeId;
  label: string;
  shortLabel: string;
  description: string;
  /** Why this may or may not move premium — shown in the compose stack. */
  premiumBearing: PremiumBearing;
  premiumNote: string;
  category: RequestCategory;
  /** Placeholder when this line is focused in the stack */
  detailHint: string;
  /** Prefer this as ticket primary when present in a multi-request stack */
  stackPriority: number;
}

export const REQUEST_TYPES: RequestTypeDef[] = [
  {
    id: "additional_insured",
    label: "Additional Insured",
    shortLabel: "Additional Insured (AI)",
    description:
      "Add a person or company as an additional insured on the existing policy.",
    premiumBearing: "sometimes",
    premiumNote:
      "Often $0–$50 on general liability when a blanket additional insured form already applies; scheduled or excess requests usually quote.",
    category: "certificate",
    detailHint: "Party name, address, relationship (landlord / GC / vendor), job site…",
    stackPriority: 10,
  },
  {
    id: "waiver_of_subrogation",
    label: "Waiver Of Subrogation",
    shortLabel: "Waiver Of Subrogation (WOS)",
    description:
      "Ask the carrier to waive its right to recover from a named party after a loss.",
    premiumBearing: "sometimes",
    premiumNote:
      "Frequently a small flat charge or percentage of premium (workers' compensation waivers almost always charge); often included when a blanket waiver applies (e.g. NEXT per certificate).",
    category: "certificate",
    detailHint: "Party to waive against, contract clause, effective date…",
    stackPriority: 20,
  },
  {
    id: "primary_non_contributory",
    label: "Primary & Non-Contributory",
    shortLabel: "Primary & Non-Contributory (P&NC)",
    description:
      "Request wording so this policy pays first and does not share with other insurance.",
    premiumBearing: "rarely",
    premiumNote: "Usually wording-only when already available by endorsement form.",
    category: "certificate",
    detailHint: "Required wording / form number from contract…",
    stackPriority: 30,
  },
  {
    id: "blanket_ai_wos",
    label: "Blanket Additional Insured / Waiver Package",
    shortLabel: "Blanket Package",
    description:
      "Quote or bind blanket additional insured and waiver of subrogation for qualifying parties.",
    premiumBearing: "usually",
    premiumNote: "Often a priced endorsement or call-out (NEXT blanket is not self-serve).",
    category: "endorsement",
    detailHint: "Confirm whether blanket is already on policy; note any carve-outs…",
    stackPriority: 40,
  },
  {
    id: "limit_change",
    label: "Limit Increase / Decrease",
    shortLabel: "Limits",
    description:
      "Change liability or other coverage limits up or down and get any premium impact.",
    premiumBearing: "usually",
    premiumNote: "Almost always premium-bearing — expect a quote before bind.",
    category: "endorsement",
    detailHint: "Current vs requested limits, effective date, reason…",
    stackPriority: 50,
  },
  {
    id: "additional_named_insured",
    label: "Additional Named Insured",
    shortLabel: "Additional Named Insured (ANI)",
    description:
      "Add another legal entity as a named insured on the policy (not just a certificate holder).",
    premiumBearing: "usually",
    premiumNote: "New entity = underwriting review; often premium or subjectivities.",
    category: "endorsement",
    detailHint: "Legal name, FEIN, ownership, operations of the entity…",
    stackPriority: 45,
  },
  {
    id: "coverage_extension",
    label: "Coverage Extension",
    shortLabel: "Extension",
    description:
      "Ask underwriting to extend or add coverage for a new exposure or operation.",
    premiumBearing: "usually",
    premiumNote: "New exposure typically requires rating — treat as premium-bearing.",
    category: "exposure",
    detailHint: "What exposure, where, when it starts, estimated receipts/payroll…",
    stackPriority: 55,
  },
  {
    id: "business_change",
    label: "Business / Operations Change",
    shortLabel: "Business Change",
    description:
      "Notify the market of a material change — new location, ownership, operations, or exposure.",
    premiumBearing: "usually",
    premiumNote:
      "Material changes are underwriting events. Premium may go up or down after review.",
    category: "exposure",
    detailHint: "What changed, effective date, % of operations / locations / ownership…",
    stackPriority: 60,
  },
  {
    id: "notice_cancellation_30",
    label: "30-Day Notice Of Cancellation",
    shortLabel: "30-Day Notice Of Cancellation",
    description:
      "Request 30-day (or contract-required) notice of cancellation / non-renewal on the certificate or endorsement.",
    premiumBearing: "usually",
    premiumNote:
      "Usually a flat charge — operators commonly see around $100; endorsement wording added to the policy.",
    category: "certificate",
    detailHint: "Required notice days, party to notify, contract cite…",
    stackPriority: 25,
  },
  {
    id: "named_insured_correction",
    label: "Named Insured / Address Correction",
    shortLabel: "Correction",
    description:
      "Fix a misspelled named insured, wrong DBA, or incorrect mailing/physical address.",
    premiumBearing: "rarely",
    premiumNote: "Clerical corrections are usually $0; ownership/entity changes are not.",
    category: "admin",
    detailHint: "Exact correct legal name / address as it should appear…",
    stackPriority: 70,
  },
  {
    id: "subjectivity_response",
    label: "Subjectivity Response",
    shortLabel: "Subjectivity",
    description:
      "Reply to outstanding underwriter subjectivities with answers or supporting documents.",
    premiumBearing: "rarely",
    premiumNote: "Response only — premium was already quoted on the offer.",
    category: "admin",
    detailHint: "List each subjectivity + your answer / attachment note…",
    stackPriority: 80,
  },
  {
    id: "binder_confirmation",
    label: "Binder / Bind Confirmation",
    shortLabel: "Binder",
    description:
      "Confirm bind status or request the signed binder / policy documents back.",
    premiumBearing: "rarely",
    premiumNote: "Status / documents request — not a new premium event by itself.",
    category: "admin",
    detailHint: "What you need back (binder, documents, effective date confirmation)…",
    stackPriority: 85,
  },
  {
    id: "premium_finance",
    label: "Premium / Invoice / Finance",
    shortLabel: "Premium",
    description:
      "Ask about premium, invoices, billing method, or premium finance paperwork.",
    premiumBearing: "rarely",
    premiumNote: "Billing inquiry — not an endorsement that creates new premium.",
    category: "admin",
    detailHint: "Invoice #, billing question, finance company…",
    stackPriority: 90,
  },
  {
    id: "general_uw_question",
    label: "General Underwriting Question",
    shortLabel: "Underwriting Question",
    description:
      "Send a general underwriting question that does not fit a specific endorsement type.",
    premiumBearing: "sometimes",
    premiumNote: "Depends on the ask — flag if the answer may trigger a mid-term endorsement.",
    category: "other",
    detailHint: "Clear question + any deadline…",
    stackPriority: 95,
  },
  {
    id: "renewal_remarket",
    label: "Renewal / Remarket Question",
    shortLabel: "Renewal",
    description:
      "Discuss renewal terms, remarketing, or options before the policy expires.",
    premiumBearing: "usually",
    premiumNote: "Renewal is a pricing conversation by definition.",
    category: "other",
    detailHint: "Expiration, target terms, competing quotes…",
    stackPriority: 100,
  },
];

export function getRequestType(id: RequestTypeId): RequestTypeDef {
  const found = REQUEST_TYPES.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown request type: ${id}`);
  return found;
}

export function coverageLabel(code: string): string {
  return COVERAGE_CATALOG[code] ?? code;
}

export function coverageLabels(codes: string[]): string {
  return codes.map(coverageLabel).join(", ");
}

export function premiumBearingLabel(p: PremiumBearing): string {
  switch (p) {
    case "usually":
      return "Usually Premium";
    case "sometimes":
      return "Sometimes Premium";
    case "rarely":
      return "Rarely Premium";
  }
}

/** Pick the best single ticket/thread type when several are stacked. */
export function primaryRequestType(ids: RequestTypeId[]): RequestTypeId {
  if (ids.length === 0) return "additional_insured";
  return [...ids].sort(
    (a, b) => getRequestType(a).stackPriority - getRequestType(b).stackPriority,
  )[0];
}

export function formatRequestStackLabel(ids: RequestTypeId[]): string {
  if (ids.length === 0) return "Request";
  if (ids.length === 1) return getRequestType(ids[0]).label;
  return ids.map((id) => getRequestType(id).shortLabel).join(" + ");
}
