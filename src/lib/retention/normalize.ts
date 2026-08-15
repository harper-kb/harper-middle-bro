/**
 * Normalizing the legacy and spine issue vocabularies.
 *
 * The two stores run twin vocabularies over the same work — about 2,525 open
 * legacy rows against 2,692 spine rows — and they disagree on spelling, casing,
 * and grain. `policy_delivery` exists in legacy as both `policy_delivery` and
 * `POLICY_DELIVERY`; DocuSign appears under eight different spellings including
 * `DocuSign` and `docusign_chase`. Any metric built on the raw values either
 * double-counts an account or scatters one lane across a dozen buckets.
 *
 * The canonical vocabulary is the spine's where the spine has a name for
 * something, because that is where the desk is going. Legacy-only concepts get
 * a canonical name rather than being flattened into `general_request`, since
 * dumping them there is what makes the largest bucket meaningless.
 *
 * Anything unrecognized maps to `unknown` and is *reported*. Silent bucketing
 * is how a vocabulary drifts without anyone noticing.
 */

import type { ServiceLaneId } from "@/lib/types";

export type CanonicalIssueType =
  | "cancellation"
  | "payment_failure"
  | "pfa"
  | "general_request"
  | "endorsement"
  | "account_change"
  | "onboarding"
  | "binding"
  | "policy_delivery"
  | "coi_request"
  | "subjectivity"
  | "docusign"
  | "inspection"
  | "underwriting"
  | "portal_access"
  | "claim"
  | "refund"
  | "document"
  | "unknown";

export const CANONICAL_ISSUE_LABELS: Record<CanonicalIssueType, string> = {
  cancellation: "Cancellation",
  payment_failure: "Payment Failure",
  pfa: "Premium Finance",
  general_request: "General Request",
  endorsement: "Endorsement",
  account_change: "Account Change",
  onboarding: "Onboarding",
  binding: "Binding",
  policy_delivery: "Policy Delivery",
  coi_request: "COI Request",
  subjectivity: "Subjectivity",
  docusign: "DocuSign",
  inspection: "Inspection",
  underwriting: "Underwriting",
  portal_access: "Portal Access",
  claim: "Claim",
  refund: "Refund",
  document: "Document",
  unknown: "Unknown",
};

/** Which lane owns the canonical type, so normalized rows reach the right pod. */
export const CANONICAL_TO_LANE: Record<CanonicalIssueType, ServiceLaneId> = {
  cancellation: "pending_cancels",
  payment_failure: "pending_cancels",
  pfa: "pending_cancels",
  general_request: "active_service",
  endorsement: "post_sales",
  account_change: "active_service",
  onboarding: "pending_orders",
  binding: "instant_binds",
  policy_delivery: "active_service",
  coi_request: "coi",
  subjectivity: "subjectivities",
  docusign: "subjectivities",
  inspection: "subjectivities",
  underwriting: "pending_orders",
  portal_access: "active_service",
  claim: "active_service",
  refund: "active_service",
  document: "active_service",
  unknown: "active_service",
};

/**
 * Exact matches first, keyed on the lowercased raw value. Every entry here was
 * observed in the live `open_issues_by_stage` pack across both stores.
 */
const EXACT: Record<string, CanonicalIssueType> = {
  // Cancellation and money
  cancellation: "cancellation",
  cancellation_alert: "cancellation",
  cancel_non_pay: "cancellation",
  endorsement_cancellation: "cancellation",
  payment_failure: "payment_failure",
  final_payment_pending: "payment_failure",
  billing_payment: "payment_failure",
  binder_invoice_pending: "payment_failure",
  payment_method_change: "account_change",
  pfa: "pfa",
  pfa_upload: "pfa",
  refund: "refund",

  // Requests
  general_service_request: "general_request",
  general_request: "general_request",
  general_inquiry: "general_request",

  // Endorsements and account changes
  endorsement: "endorsement",
  endorsement_request: "endorsement",
  certificate_holder_change: "endorsement",
  address_change: "account_change",

  // Onboarding and binding
  onboarding: "onboarding",
  application_completion: "onboarding",
  application_received: "onboarding",
  bind_policy: "binding",
  bind_request: "binding",
  iq_bind_and_issue: "binding",

  // Delivery and certificates
  policy_delivery: "policy_delivery",
  policy_docs_pending: "policy_delivery",
  coi_request: "coi_request",
  coi_send: "coi_request",
  broker_coi_send: "coi_request",
  iq_coi_send: "coi_request",
  certificate_of_insurance: "coi_request",

  // Subjectivities and signatures
  subjectivity: "subjectivity",
  misc_subjectivity: "subjectivity",
  collect_subjectivities: "subjectivity",
  subjectivity_monitoring: "subjectivity",
  subjectivity_sensitive: "subjectivity",
  subjectivity_carrier_negotiation: "subjectivity",
  docusign_and_subjectivities: "subjectivity",
  docusign: "docusign",
  docusign_build: "docusign",
  docusign_send: "docusign",
  docusign_signed: "docusign",
  docusign_voided: "docusign",
  docusign_chase: "docusign",
  docusign_completed_review: "docusign",
  insured_sign_pending: "docusign",
  producer_sign_pending: "docusign",
  inspection: "inspection",
  inspection_requirement: "inspection",

  // Market
  underwriting: "underwriting",
  push_to_uw: "underwriting",
  uw_follow_up: "underwriting",
  underwriter_follow_up: "underwriting",
  submission_follow_up: "underwriting",
  placement_follow_up: "underwriting",
  placement_uw_follow_up: "underwriting",

  // Misc
  portal_access: "portal_access",
  claim: "claim",
  claims_alert: "claim",
  documents: "document",
  document_correction: "document",
  missing_document: "document",
};

/** Fallbacks for values that have not been observed yet but read unambiguously. */
const PATTERNS: { pattern: RegExp; canonical: CanonicalIssueType }[] = [
  { pattern: /cancel/i, canonical: "cancellation" },
  { pattern: /docu.?sign|signature|e.?sign/i, canonical: "docusign" },
  { pattern: /subjectivit/i, canonical: "subjectivity" },
  { pattern: /\bcoi\b|certificate/i, canonical: "coi_request" },
  { pattern: /endorse/i, canonical: "endorsement" },
  { pattern: /payment|billing|invoice/i, canonical: "payment_failure" },
  { pattern: /financ|pfa/i, canonical: "pfa" },
  { pattern: /bind/i, canonical: "binding" },
  { pattern: /deliver/i, canonical: "policy_delivery" },
  { pattern: /inspect/i, canonical: "inspection" },
  { pattern: /underwrit|\buw\b|placement|submission/i, canonical: "underwriting" },
  { pattern: /portal/i, canonical: "portal_access" },
  { pattern: /claim/i, canonical: "claim" },
  { pattern: /refund|chargeback|dispute/i, canonical: "refund" },
  { pattern: /document|doc\b/i, canonical: "document" },
  { pattern: /onboard|application/i, canonical: "onboarding" },
];

export function normalizeIssueType(raw: string | null | undefined): CanonicalIssueType {
  if (!raw) return "unknown";
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const exact = EXACT[key];
  if (exact) return exact;
  for (const { pattern, canonical } of PATTERNS) {
    if (pattern.test(key)) return canonical;
  }
  return "unknown";
}

/** Raw values that fell through to `unknown`, so vocabulary drift is visible. */
export function unmappedIssueTypes(rawValues: string[]): string[] {
  return [
    ...new Set(
      rawValues.filter((v) => normalizeIssueType(v) === "unknown" && v?.trim()),
    ),
  ].sort();
}

export type SourceStore = "spine" | "legacy";

export interface RawIssueCount {
  sourceStore: SourceStore;
  issueType: string;
  openCount: number;
}

export interface NormalizedIssueCount {
  canonical: CanonicalIssueType;
  lane: ServiceLaneId;
  spineOpen: number;
  legacyOpen: number;
  total: number;
  /** Raw values that folded into this row, for anyone auditing the mapping. */
  rawTypes: string[];
}

export function normalizeIssueCounts(rows: RawIssueCount[]): NormalizedIssueCount[] {
  const map = new Map<CanonicalIssueType, NormalizedIssueCount>();
  for (const row of rows) {
    const canonical = normalizeIssueType(row.issueType);
    const entry =
      map.get(canonical) ??
      ({
        canonical,
        lane: CANONICAL_TO_LANE[canonical],
        spineOpen: 0,
        legacyOpen: 0,
        total: 0,
        rawTypes: [],
      } satisfies NormalizedIssueCount);
    if (row.sourceStore === "spine") entry.spineOpen += row.openCount;
    else entry.legacyOpen += row.openCount;
    entry.total += row.openCount;
    if (!entry.rawTypes.includes(row.issueType)) entry.rawTypes.push(row.issueType);
    map.set(canonical, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ——— Twin suppression ———

export interface IssueRef {
  id: string;
  sourceStore: SourceStore;
  companyId: string;
  issueType: string;
  openedAt: string;
}

/**
 * How close in time two rows must be to be the same piece of work. Migration
 * writes the spine row when the legacy row is already open, usually within a
 * few days, so the window is generous — but a cancellation this month and one
 * last quarter on the same account are two real events, not a twin.
 */
export const TWIN_WINDOW_HOURS = 72;

export interface TwinSuppression {
  kept: IssueRef[];
  /** Legacy rows suppressed as duplicates, each naming the spine row it duplicates. */
  suppressed: { issue: IssueRef; twinOf: string }[];
}

/**
 * Collapse legacy/spine twins. The spine row always wins: it is the row that
 * carries priority and `sla_due_at`, and keeping the legacy copy would count
 * the same account twice in every pod total.
 */
export function suppressTwins(
  issues: IssueRef[],
  windowHours: number = TWIN_WINDOW_HOURS,
): TwinSuppression {
  const spine = issues.filter((i) => i.sourceStore === "spine");
  const legacy = issues.filter((i) => i.sourceStore === "legacy");
  const windowMs = windowHours * 3_600_000;

  const kept: IssueRef[] = [...spine];
  const suppressed: TwinSuppression["suppressed"] = [];
  const claimed = new Set<string>();

  for (const row of legacy) {
    const canonical = normalizeIssueType(row.issueType);
    const twin = spine.find((s) => {
      if (claimed.has(s.id)) return false;
      if (s.companyId !== row.companyId) return false;
      if (normalizeIssueType(s.issueType) !== canonical) return false;
      const gap = Math.abs(Date.parse(s.openedAt) - Date.parse(row.openedAt));
      return Number.isFinite(gap) && gap <= windowMs;
    });
    if (twin) {
      claimed.add(twin.id);
      suppressed.push({ issue: row, twinOf: twin.id });
    } else {
      kept.push(row);
    }
  }

  return { kept, suppressed };
}

export interface DeduplicatedTotals {
  spineOpen: number;
  legacyOpen: number;
  /** Legacy rows suppressed as spine twins. */
  twinsSuppressed: number;
  /** The number to publish. Naive addition overstates it by `twinsSuppressed`. */
  deduplicatedOpen: number;
}

export function deduplicatedTotals(issues: IssueRef[]): DeduplicatedTotals {
  const { kept, suppressed } = suppressTwins(issues);
  return {
    spineOpen: issues.filter((i) => i.sourceStore === "spine").length,
    legacyOpen: issues.filter((i) => i.sourceStore === "legacy").length,
    twinsSuppressed: suppressed.length,
    deduplicatedOpen: kept.length,
  };
}
