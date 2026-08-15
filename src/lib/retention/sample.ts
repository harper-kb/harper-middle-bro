/**
 * Labeled sample data for the retention system.
 *
 * Everything here exists so the scorecard, the disclosure scan, and the defect
 * ledger can be read and argued with before the live packs are wired. It is
 * shaped after the desk's real texture — the cancellation lane dominating, one
 * account contacting forty-five times in three days, a producer who never
 * raises subjectivities — but every number is invented.
 *
 * Nothing in this file may be surfaced without a `sample` label. The whole
 * program depends on people trusting the numbers, and the fastest way to lose
 * that is to ship a modeled figure that reads as measured.
 */

import type { InternalAgent } from "./agents";
import type { OriginationDefect } from "./defects";
import type { OwnerAssignment } from "./ownership";
import type { SlaIssue } from "./sla";
import type { TranscriptRecord } from "./disclosure";
import type { AtRiskWindow, RetentionEvent } from "./types";

export const SAMPLE_INTERNAL_AGENTS: InternalAgent[] = [
  { id: "svc-kai", displayName: "Kai Bloom", email: "kai@harperinsure.com", kind: "human", podId: "cancellations_payments" },
  { id: "svc-dana", displayName: "Dana Reyes", email: "dana@harperinsure.com", kind: "human", podId: "cancellations_payments" },
  { id: "svc-priya", displayName: "Priya Nair", email: "priya@harperinsure.com", kind: "human", podId: "coi" },
  { id: "svc-marco", displayName: "Marco Silva", email: "marco@harperinsure.com", kind: "human", podId: "onboarding_binding" },
  { id: "svc-tess", displayName: "Tess Okonkwo", email: "tess@harperinsure.com", kind: "human", podId: "subjectivities_docusign" },
  { id: "sales-reed", displayName: "Reed Vance", email: "reed@harperinsure.com", kind: "human", podId: null },
  { id: "sales-june", displayName: "June Park", email: "june@harperinsure.com", kind: "human", podId: null },
  { id: "sales-omar", displayName: "Omar Haddad", email: "omar@harperinsure.com", kind: "human", podId: null },
  { id: "spine-agent-prod", displayName: "Spine Agent", email: null, kind: "agent", podId: null },
];

export const SAMPLE_OWNER_ASSIGNMENTS: OwnerAssignment[] = [
  {
    id: "own-meridian",
    accountId: "acct-meridian",
    ownerAgentId: "svc-kai",
    ownerDisplayName: "Kai Bloom",
    assignedAt: "2026-02-01T00:00:00.000Z",
    endedAt: null,
    reason: "initial_assignment",
    assignedBy: "mgr-1",
    note: null,
  },
  {
    id: "own-arbor",
    accountId: "acct-arbor",
    ownerAgentId: "svc-dana",
    ownerDisplayName: "Dana Reyes",
    assignedAt: "2026-03-15T00:00:00.000Z",
    endedAt: null,
    reason: "pod_rebalance",
    assignedBy: "mgr-1",
    note: null,
  },
  {
    id: "own-caldwell",
    accountId: "acct-caldwell",
    ownerAgentId: "svc-priya",
    ownerDisplayName: "Priya Nair",
    assignedAt: "2026-04-02T00:00:00.000Z",
    endedAt: null,
    reason: "initial_assignment",
    assignedBy: "mgr-1",
    note: null,
  },
  // The loudest account on the book has no owner. This is the shape of the
  // real problem, not a placeholder: a producer is cleanly assigned and
  // service ownership resolves to nobody.
  {
    id: "own-tallgrass",
    accountId: "acct-tallgrass",
    ownerAgentId: null,
    ownerDisplayName: null,
    assignedAt: "2026-06-10T00:00:00.000Z",
    endedAt: null,
    reason: "initial_assignment",
    assignedBy: "backfill:service_owner",
    note: "service_owner was null at backfill — recorded orphan",
  },
];

export const SAMPLE_AT_RISK_WINDOWS: AtRiskWindow[] = [
  {
    id: "arw:acct-meridian:pol-m1:cancellation_notice:2026-07-02",
    accountId: "acct-meridian",
    policyId: "pol-m1",
    issueId: "iss-3001",
    lane: "pending_cancels",
    trigger: "cancellation_notice",
    reason: "non_pay",
    billMode: "agency_bill",
    openedAt: "2026-07-02T15:00:00.000Z",
    effectiveAt: "2026-07-22T00:00:00.000Z",
    closedAt: "2026-07-09T18:30:00.000Z",
    outcome: "saved",
    outcomeNote: "Cure paid, carrier reinstated",
    premiumCents: 4_200_000,
    commissionRateBps: 1650,
    commissionAtRiskCents: 693_000,
    replacementCommissionCents: null,
    difficultyTier: "hard",
    ownerAgentId: "svc-kai",
    sourceKind: "lifecycle_signal",
    sourceRef: "sig-m-1",
  },
  {
    id: "arw:acct-arbor:pol-a1:payment_failure:2026-07-06",
    accountId: "acct-arbor",
    policyId: "pol-a1",
    issueId: "iss-3044",
    lane: "pending_cancels",
    trigger: "payment_failure",
    reason: "financing",
    billMode: "financed",
    openedAt: "2026-07-06T09:00:00.000Z",
    effectiveAt: "2026-07-26T00:00:00.000Z",
    closedAt: "2026-07-08T11:00:00.000Z",
    outcome: "saved",
    outcomeNote: "PFA default cured after finance company call",
    premiumCents: 1_850_000,
    commissionRateBps: 1500,
    commissionAtRiskCents: 277_500,
    replacementCommissionCents: null,
    difficultyTier: "standard",
    ownerAgentId: "svc-dana",
    sourceKind: "lifecycle_signal",
    sourceRef: "sig-a-1",
  },
  {
    id: "arw:acct-caldwell:pol-c1:bor_threat:2026-07-11",
    accountId: "acct-caldwell",
    policyId: "pol-c1",
    issueId: "iss-3102",
    lane: "post_sales",
    trigger: "bor_threat",
    reason: "insured_request",
    billMode: "direct_bill",
    openedAt: "2026-07-11T14:00:00.000Z",
    effectiveAt: null,
    closedAt: "2026-07-25T10:00:00.000Z",
    outcome: "saved",
    outcomeNote: "BOR withdrawn after service review",
    premiumCents: 9_600_000,
    commissionRateBps: 1650,
    commissionAtRiskCents: 1_584_000,
    replacementCommissionCents: null,
    difficultyTier: "long_shot",
    ownerAgentId: "svc-priya",
    sourceKind: "spine_issue",
    sourceRef: "iss-3102",
  },
  {
    id: "arw:acct-tallgrass:pol-t1:cancellation_notice:2026-07-14",
    accountId: "acct-tallgrass",
    policyId: "pol-t1",
    issueId: "iss-3150",
    lane: "pending_cancels",
    trigger: "cancellation_notice",
    reason: "non_pay",
    billMode: "agency_bill",
    openedAt: "2026-07-14T08:00:00.000Z",
    effectiveAt: "2026-08-03T00:00:00.000Z",
    closedAt: "2026-08-06T00:00:00.000Z",
    outcome: "expired",
    outcomeNote: "No close signal 3 days past carrier effective date",
    premiumCents: 2_100_000,
    commissionRateBps: 1650,
    commissionAtRiskCents: 346_500,
    replacementCommissionCents: null,
    difficultyTier: "long_shot",
    ownerAgentId: null,
    sourceKind: "carrier_notice",
    sourceRef: "notice-t-1",
  },
  {
    id: "arw:acct-brightline:pol-b1:non_renewal:2026-07-18",
    accountId: "acct-brightline",
    policyId: "pol-b1",
    issueId: "iss-3199",
    lane: "post_sales",
    trigger: "non_renewal",
    reason: "rewrite",
    billMode: "direct_bill",
    openedAt: "2026-07-18T12:00:00.000Z",
    effectiveAt: "2026-09-01T00:00:00.000Z",
    closedAt: "2026-07-30T16:00:00.000Z",
    outcome: "rewritten",
    outcomeNote: "Remarketed and bound on replacement paper",
    premiumCents: 3_400_000,
    commissionRateBps: 1650,
    commissionAtRiskCents: 561_000,
    replacementCommissionCents: 442_000,
    difficultyTier: "standard",
    ownerAgentId: "svc-marco",
    sourceKind: "carrier_notice",
    sourceRef: "notice-b-1",
  },
];

export const SAMPLE_RETENTION_EVENTS: RetentionEvent[] = [
  ev("iss-3001-a", "arw:acct-meridian:pol-m1:cancellation_notice:2026-07-02", "outbound_contact_answered", "2026-07-03T10:00:00.000Z", "svc-kai", "kai@harperinsure.com", "Reached AP, confirmed cure amount", "msg-8801"),
  ev("iss-3001-b", "arw:acct-meridian:pol-m1:cancellation_notice:2026-07-02", "comment", "2026-07-04T09:00:00.000Z", "svc-dana", "dana@harperinsure.com", "Noted carrier portal is down", null),
  ev("iss-3001-c", "arw:acct-meridian:pol-m1:cancellation_notice:2026-07-02", "payment_link_paid", "2026-07-08T16:20:00.000Z", "svc-dana", "dana@harperinsure.com", "Cure payment cleared", "pay-4410"),
  ev("iss-3001-d", "arw:acct-meridian:pol-m1:cancellation_notice:2026-07-02", "reinstatement_confirmed", "2026-07-09T18:30:00.000Z", null, "spine-agent-prod", "Carrier confirmed reinstatement", "sig-m-2"),

  ev("iss-3044-a", "arw:acct-arbor:pol-a1:payment_failure:2026-07-06", "carrier_escalation_state_change", "2026-07-07T13:00:00.000Z", "svc-dana", "dana@harperinsure.com", "Finance company reversed the default", "esc-221"),
  ev("iss-3044-b", "arw:acct-arbor:pol-a1:payment_failure:2026-07-06", "status_change", "2026-07-07T13:05:00.000Z", "svc-dana", "dana@harperinsure.com", "Moved to pending confirmation", null),

  ev("iss-3102-a", "arw:acct-caldwell:pol-c1:bor_threat:2026-07-11", "outbound_contact_answered", "2026-07-13T15:00:00.000Z", "svc-priya", "priya@harperinsure.com", "Retention call with the principal", "msg-9120"),
  ev("iss-3102-b", "arw:acct-caldwell:pol-c1:bor_threat:2026-07-11", "outbound_contact_answered", "2026-07-19T11:00:00.000Z", "svc-tess", "tess@harperinsure.com", "Walked through the COI backlog fix", "msg-9204"),
  ev("iss-3102-c", "arw:acct-caldwell:pol-c1:bor_threat:2026-07-11", "bor_returned", "2026-07-25T10:00:00.000Z", "svc-tess", "tess@harperinsure.com", "BOR withdrawn in writing", "doc-3311"),

  ev("iss-3199-a", "arw:acct-brightline:pol-b1:non_renewal:2026-07-18", "rewrite_bound", "2026-07-30T16:00:00.000Z", "svc-marco", "marco@harperinsure.com", "Replacement policy bound", "pol-b2"),
];

function ev(
  id: string,
  windowId: string,
  kind: RetentionEvent["kind"],
  occurredAt: string,
  actorAgentId: string | null,
  actor: string,
  detail: string,
  evidenceRef: string | null,
): RetentionEvent {
  return {
    id,
    windowId,
    kind,
    occurredAt,
    actor,
    actorKind: actorAgentId ? "human" : "agent",
    actorAgentId,
    detail,
    evidenceRef,
  };
}

export const SAMPLE_DEFECTS: OriginationDefect[] = [
  {
    id: "def-1",
    issueId: "iss-3150",
    accountId: "acct-tallgrass",
    policyId: "pol-t1",
    kind: "payment_structure_undisclosed",
    severity: "material",
    state: "confirmed",
    producerAgentId: "sales-reed",
    producerName: "Reed Vance",
    absorbingPodId: "cancellations_payments",
    absorbingAgentId: "svc-kai",
    boundAt: "2026-06-05T00:00:00.000Z",
    issueOpenedAt: "2026-07-14T08:00:00.000Z",
    raisedAt: "2026-07-16T09:00:00.000Z",
    raisedBy: "svc-kai",
    adjudicatedAt: "2026-07-20T12:00:00.000Z",
    adjudicatedBy: "mgr-sales",
    adjudicationNote: "Transcript confirms financing was never mentioned",
    evidenceRefs: ["transcript-5521", "quote-8890"],
    slaPausedHours: 96,
    detail: "Insured believed the card on file paid the carrier; first notice of cancellation was the surprise.",
  },
  {
    id: "def-2",
    issueId: "iss-3210",
    accountId: "acct-caldwell",
    policyId: "pol-c1",
    kind: "undisclosed_subjectivity",
    severity: "severe",
    state: "confirmed",
    producerAgentId: "sales-reed",
    producerName: "Reed Vance",
    absorbingPodId: "subjectivities_docusign",
    absorbingAgentId: "svc-tess",
    boundAt: "2026-06-20T00:00:00.000Z",
    issueOpenedAt: "2026-07-05T10:00:00.000Z",
    raisedAt: "2026-07-06T10:00:00.000Z",
    raisedBy: "svc-tess",
    adjudicatedAt: "2026-07-09T10:00:00.000Z",
    adjudicatedBy: "mgr-sales",
    adjudicationNote: "Inspection requirement never read to the insured",
    evidenceRefs: ["transcript-5610"],
    slaPausedHours: 72,
    detail: "Inspection subjectivity surfaced two weeks after bind; insured had never heard of it.",
  },
  {
    id: "def-3",
    issueId: "iss-3288",
    accountId: "acct-arbor",
    policyId: "pol-a1",
    kind: "promised_free_endorsement",
    severity: "material",
    state: "disputed",
    producerAgentId: "sales-june",
    producerName: "June Park",
    absorbingPodId: "endorsements",
    absorbingAgentId: "svc-dana",
    boundAt: "2026-06-28T00:00:00.000Z",
    issueOpenedAt: "2026-07-21T14:00:00.000Z",
    raisedAt: "2026-07-22T09:00:00.000Z",
    raisedBy: "svc-dana",
    adjudicatedAt: null,
    adjudicatedBy: null,
    adjudicationNote: null,
    evidenceRefs: ["email-7712"],
    slaPausedHours: 0,
    detail: "Insured was told the additional insured endorsement carried no cost; carrier charged for it.",
  },
  {
    id: "def-4",
    issueId: "iss-3301",
    accountId: "acct-brightline",
    policyId: "pol-b1",
    kind: "coverage_limit_mismatch",
    severity: "severe",
    state: "raised",
    producerAgentId: "sales-omar",
    producerName: "Omar Haddad",
    absorbingPodId: "endorsements",
    absorbingAgentId: "svc-marco",
    boundAt: "2026-07-01T00:00:00.000Z",
    issueOpenedAt: "2026-07-24T08:00:00.000Z",
    raisedAt: "2026-07-25T08:00:00.000Z",
    raisedBy: "svc-marco",
    adjudicatedAt: null,
    adjudicatedBy: null,
    adjudicationNote: null,
    evidenceRefs: ["quote-9001"],
    slaPausedHours: 0,
    detail: "Insured is disputing a $250K limit against a $50K policy with no written record of the quote.",
  },
];

export const SAMPLE_BOUND_DEALS_BY_PRODUCER: Record<string, number> = {
  "sales-reed": 14,
  "sales-june": 22,
  "sales-omar": 9,
};

export const SAMPLE_SLA_ISSUES: SlaIssue[] = [
  sla("iss-3001", "acct-meridian", "pending_cancels", "P1", "2026-07-02T15:00:00.000Z", "2026-07-09T18:30:00.000Z"),
  sla("iss-3044", "acct-arbor", "pending_cancels", "P1", "2026-07-06T09:00:00.000Z", "2026-07-08T11:00:00.000Z"),
  sla("iss-3150", "acct-tallgrass", "pending_cancels", "P0", "2026-07-14T08:00:00.000Z", "2026-07-28T00:00:00.000Z"),
  // Late against the original clock, on time against the clock that restarts
  // when the defect was confirmed — the case the pause exists for.
  sla("iss-3210", "acct-caldwell", "subjectivities", "P2", "2026-07-05T10:00:00.000Z", "2026-07-10T12:00:00.000Z"),
  sla("iss-3288", "acct-arbor", "post_sales", "P2", "2026-07-21T14:00:00.000Z", "2026-07-23T09:00:00.000Z"),
  sla("iss-3301", "acct-brightline", "post_sales", "P1", "2026-07-24T08:00:00.000Z", null),
  sla("iss-3355", "acct-caldwell", "coi", "P1", "2026-07-26T09:00:00.000Z", "2026-07-26T10:30:00.000Z"),
  sla("iss-3356", "acct-meridian", "coi", "P2", "2026-07-27T09:00:00.000Z", "2026-07-27T09:45:00.000Z"),
  sla("iss-3360", "acct-brightline", "pending_orders", "P1", "2026-07-28T09:00:00.000Z", null),
];

function sla(
  issueId: string,
  accountId: string,
  lane: SlaIssue["lane"],
  priority: SlaIssue["priority"],
  openedAt: string,
  resolvedAt: string | null,
): SlaIssue {
  return { issueId, accountId, lane, priority, openedAt, slaDueAt: null, resolvedAt };
}

/**
 * Sample transcript corpus. Generated rather than hand-written so each rep
 * clears the minimum denominator the rate gate requires, with three distinct
 * disclosure profiles: one rep who covers everything, one who covers payment
 * structure only, and one who raises nothing at all.
 */
export function buildSampleTranscripts(): TranscriptRecord[] {
  const profiles: {
    rep: string;
    agentId: string;
    perTwelve: Partial<Record<"subjectivity" | "contract" | "ai" | "payment", number>>;
  }[] = [
    {
      rep: "June Park",
      agentId: "sales-june",
      perTwelve: { subjectivity: 9, contract: 8, ai: 10, payment: 11 },
    },
    {
      rep: "Omar Haddad",
      agentId: "sales-omar",
      perTwelve: { subjectivity: 3, contract: 5, ai: 4, payment: 9 },
    },
    {
      rep: "Reed Vance",
      agentId: "sales-reed",
      perTwelve: { subjectivity: 0, contract: 1, ai: 2, payment: 1 },
    },
  ];

  const lines = {
    subjectivity: "Before the carrier can bind we'll need the signed application and loss runs — that's a subjectivity on this quote.",
    contract: "What does your contract require for limits? Let's make sure the required limits line up.",
    ai: "Do you need anyone named as an additional insured, or a waiver of subrogation?",
    payment: "This one is premium financed, so there's a down payment and then monthly installments — you won't be paying the carrier directly.",
  };

  const out: TranscriptRecord[] = [];
  const perRep = 24;
  for (const profile of profiles) {
    for (let i = 0; i < perRep; i += 1) {
      const parts = ["Thanks for the time today — let me walk you through the quote."];
      for (const [topic, per12] of Object.entries(profile.perTwelve)) {
        // Deterministic spacing: the first `per12` slots of every twelve get
        // the line, so the resulting rate is exactly per12/12.
        if (i % 12 < (per12 ?? 0)) {
          parts.push(lines[topic as keyof typeof lines]);
        }
      }
      out.push({
        id: `${profile.agentId}-t${i}`,
        repCanonicalName: profile.rep,
        repAgentId: profile.agentId,
        occurredAt: new Date(Date.UTC(2026, 6, 1 + (i % 28), 15)).toISOString(),
        text: parts.join(" "),
        companyId: null,
      });
    }
  }
  return out;
}
