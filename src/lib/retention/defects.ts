/**
 * The Origination Defect Ledger.
 *
 * Everything in the save mechanism pays service for cleaning up. It does
 * nothing about the supply of mess, and the mess is measurable: roughly four in
 * ten quotes carry wrong coverage or wrong limits, subjectivity disclosure at
 * point of sale runs at or near zero, and premium finance forms have gone out
 * with fees miscalculated by five figures. Service takes all of those calls.
 *
 * This classifies a post-bind service issue as either normal lifecycle work or
 * an origination defect — a ticket that exists because of how the deal was
 * sold. Two consequences follow, deliberately asymmetric: the service pod is
 * credited and its SLA clock pauses, and the producer loses the renewal rather
 * than having a paid commission clawed back.
 *
 * Classification here only ever *proposes*. A defect becomes real when a human
 * adjudicates it against evidence, because the whole point is that this is
 * settled on transcripts rather than on service's word against sales'.
 */

import type { ServicePodId } from "./pods";

export type OriginationDefectKind =
  | "undisclosed_subjectivity"
  | "coverage_limit_mismatch"
  | "payment_structure_undisclosed"
  | "impossible_turnaround"
  | "promised_free_endorsement"
  | "missing_producer_notes"
  | "wrong_entity_dba_address";

export const DEFECT_KIND_LABELS: Record<OriginationDefectKind, string> = {
  undisclosed_subjectivity: "Undisclosed Subjectivity",
  coverage_limit_mismatch: "Coverage Or Limit Mismatch",
  payment_structure_undisclosed: "Payment Structure Never Explained",
  impossible_turnaround: "Promised Turnaround Never Achievable",
  promised_free_endorsement: "Promised Free Endorsement That Is Not Free",
  missing_producer_notes: "Missing Producer Notes At Bind",
  wrong_entity_dba_address: "Wrong Entity, DBA, Or Address",
};

/**
 * How much of the resulting service load the defect explains. Drives the
 * absorbed-defect credit and how hard the renewal-transfer conversation is.
 */
export type DefectSeverity = "minor" | "material" | "severe";

export const DEFECT_SEVERITY_LABELS: Record<DefectSeverity, string> = {
  minor: "Minor",
  material: "Material",
  severe: "Severe",
};

/** Baseline severity per kind, before an adjudicator adjusts it. */
const DEFAULT_SEVERITY: Record<OriginationDefectKind, DefectSeverity> = {
  undisclosed_subjectivity: "severe",
  coverage_limit_mismatch: "severe",
  payment_structure_undisclosed: "material",
  impossible_turnaround: "material",
  promised_free_endorsement: "material",
  missing_producer_notes: "minor",
  wrong_entity_dba_address: "minor",
};

/**
 * Issues opened beyond this many days after bind are ordinary lifecycle
 * service, not origination. The window is generous because subjectivity and
 * payment-structure defects routinely surface at the first billing cycle
 * rather than at bind.
 */
export const DEFECT_ATTRIBUTION_WINDOW_DAYS = 60;

/**
 * Adjudication states. `disputed` exists because the sales lead has to be able
 * to contest a defect — a ledger with no dispute path is a blame list, and it
 * will be treated as one.
 */
export type DefectState =
  | "proposed"
  | "raised"
  | "disputed"
  | "confirmed"
  | "rejected"
  | "withdrawn";

export const DEFECT_STATE_LABELS: Record<DefectState, string> = {
  proposed: "Proposed",
  raised: "Raised",
  disputed: "Disputed",
  confirmed: "Confirmed",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const ALLOWED_TRANSITIONS: Record<DefectState, DefectState[]> = {
  proposed: ["raised", "withdrawn"],
  raised: ["confirmed", "disputed", "withdrawn"],
  disputed: ["confirmed", "rejected"],
  confirmed: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: DefectState, to: DefectState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Only a confirmed defect carries consequences. Everything else is a claim. */
export function isActionable(state: DefectState): boolean {
  return state === "confirmed";
}

export interface OriginationDefect {
  id: string;
  /** Spine or legacy issue this defect explains. */
  issueId: string;
  accountId: string;
  policyId: string | null;
  kind: OriginationDefectKind;
  severity: DefectSeverity;
  state: DefectState;
  /** Producer resolved from custody — the person who sold it. */
  producerAgentId: string | null;
  producerName: string | null;
  /** Pod that ate the rework, which is who gets the absorbed-defect credit. */
  absorbingPodId: ServicePodId | null;
  absorbingAgentId: string | null;
  boundAt: string | null;
  issueOpenedAt: string;
  raisedAt: string;
  raisedBy: string | null;
  adjudicatedAt: string | null;
  adjudicatedBy: string | null;
  adjudicationNote: string | null;
  /** Transcript, quote, DocuSign, or email references. No evidence, no defect. */
  evidenceRefs: string[];
  /** Hours of service SLA clock excluded because of this defect. */
  slaPausedHours: number;
  detail: string;
}

// ——— Classification ———

type DefectSignal = { kind: OriginationDefectKind; pattern: RegExp; cue: string };

/**
 * Text cues drawn from what the call logs and ticket titles actually say.
 * These are intentionally narrow: a false positive costs an adjudication cycle
 * and a little goodwill with sales, which is expensive in a system whose whole
 * value is being trusted by both sides.
 */
const DEFECT_SIGNALS: DefectSignal[] = [
  {
    kind: "undisclosed_subjectivity",
    pattern: /subjectivit/i,
    cue: "subjectivity referenced",
  },
  {
    kind: "undisclosed_subjectivity",
    pattern: /(never|not|wasn'?t|didn'?t).{0,30}(told|disclosed|informed|aware).{0,40}(inspection|loss run|questionnaire|signed application)/i,
    cue: "insured says a requirement was never disclosed",
  },
  {
    kind: "coverage_limit_mismatch",
    pattern: /(wrong|incorrect|mismatch(ed)?).{0,20}(coverage|limit|deductible)/i,
    cue: "coverage or limit called wrong",
  },
  {
    kind: "coverage_limit_mismatch",
    pattern: /(quoted|sold|promised).{0,40}(but|however).{0,40}(policy|binder|dec).{0,30}(shows|has|only)/i,
    cue: "quote disagrees with issued policy",
  },
  {
    kind: "coverage_limit_mismatch",
    pattern: /\$\s?\d[\d,]*\s?(k|m)?\s+(limit|coverage).{0,40}(against|versus|vs\.?|but).{0,20}\$\s?\d/i,
    cue: "two limits in conflict on one account",
  },
  {
    kind: "payment_structure_undisclosed",
    pattern: /(didn'?t|never|not).{0,30}(know|told|aware).{0,30}(financ|pfa|premium financ)/i,
    cue: "insured unaware the policy was financed",
  },
  {
    kind: "payment_structure_undisclosed",
    pattern: /(thought|assumed).{0,40}(card|autopay|auto.?charge|auto.?pay)/i,
    cue: "insured believed the card on file pays the carrier",
  },
  {
    kind: "impossible_turnaround",
    pattern: /(promised|told|expects?|expecting).{0,30}(within|in)\s?(two|2|one|1)\s?(hour|hr)/i,
    cue: "sub-two-hour turnaround promised",
  },
  {
    kind: "impossible_turnaround",
    pattern: /(gl|coverage|policy)\s+now,?\s+(coi|cert|certificate)\s+later/i,
    cue: "deal sold as coverage now, paperwork later",
  },
  {
    kind: "promised_free_endorsement",
    pattern: /(told|promised|said).{0,40}(free|no (extra |additional )?(charge|cost)|included at no)/i,
    cue: "endorsement promised free",
  },
  {
    kind: "missing_producer_notes",
    pattern: /(no|missing|zero).{0,20}(producer|sales)\s?(notes|context|handoff)/i,
    cue: "no producer context at bind",
  },
  {
    kind: "wrong_entity_dba_address",
    pattern: /(wrong|incorrect).{0,20}(entity|dba|named insured|legal name|mailing address)/i,
    cue: "entity or address wrong on the policy",
  },
];

export type DefectProposal = {
  kind: OriginationDefectKind;
  severity: DefectSeverity;
  /** Cues that matched. An adjudicator reads these, not the regexes. */
  cues: string[];
  /** 0–1. Two independent cues is meaningfully stronger than one. */
  confidence: number;
};

export type DefectClassification = {
  /** Highest-confidence proposal, or null for ordinary lifecycle service. */
  proposal: DefectProposal | null;
  /** Every kind that matched, so an adjudicator can pick a different one. */
  alternatives: DefectProposal[];
  /** Why nothing was proposed, when nothing was. */
  reason: string;
};

/**
 * Propose a classification for one post-bind issue.
 *
 * Outside the attribution window this returns nothing regardless of text: an
 * account can have a coverage argument in month nine, and that is service, not
 * origination.
 */
export function classifyIssue(input: {
  issueId: string;
  text: string;
  issueOpenedAt: string;
  boundAt: string | null;
}): DefectClassification {
  if (input.boundAt) {
    const days =
      (Date.parse(input.issueOpenedAt) - Date.parse(input.boundAt)) / 86_400_000;
    if (Number.isFinite(days) && days > DEFECT_ATTRIBUTION_WINDOW_DAYS) {
      return {
        proposal: null,
        alternatives: [],
        reason: `Opened ${Math.round(days)} days after bind — outside the ${DEFECT_ATTRIBUTION_WINDOW_DAYS}-day attribution window`,
      };
    }
  }

  const byKind = new Map<OriginationDefectKind, string[]>();
  for (const signal of DEFECT_SIGNALS) {
    if (!signal.pattern.test(input.text)) continue;
    const cues = byKind.get(signal.kind) ?? [];
    cues.push(signal.cue);
    byKind.set(signal.kind, cues);
  }

  if (byKind.size === 0) {
    return {
      proposal: null,
      alternatives: [],
      reason: "No origination cue found — treated as normal lifecycle service",
    };
  }

  const proposals: DefectProposal[] = [...byKind.entries()]
    .map(([kind, cues]) => ({
      kind,
      severity: DEFAULT_SEVERITY[kind],
      cues,
      confidence: Math.min(1, 0.5 + 0.25 * (cues.length - 1)),
    }))
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        severityRank(b.severity) - severityRank(a.severity),
    );

  return {
    proposal: proposals[0]!,
    alternatives: proposals.slice(1),
    reason: `${proposals[0]!.cues.length} cue(s) matched`,
  };
}

function severityRank(s: DefectSeverity): number {
  return s === "severe" ? 2 : s === "material" ? 1 : 0;
}

// ——— Feeding the existing coaching cadence ———

/**
 * Row shape of the `coaching operator-mistakes` feed, which already emits
 * per-rep findings for intake and drives a weekly one-on-one off them. Service
 * has no equivalent feed, which is the gap this closes.
 *
 * The field names are the feed's, not ours — `rep_slug` and `rep_canonical_name`
 * are the roster keys that cadence groups and reconciles by, and `is_confirmed`
 * is what separates a teachable finding from a claim. Emitting post-bind
 * defects in this shape means the coaching loop that already works consumes
 * them without changing.
 */
export interface CoachingFinding {
  rep_slug: string;
  rep_canonical_name: string;
  company_id: string;
  skill: OriginationDefectKind;
  severity: DefectSeverity;
  origin: "origination_defect_ledger";
  /** `new` until adjudicated, `verified` once confirmed — the feed's own vocabulary. */
  status: "new" | "verified";
  finding: string;
  is_confirmed: boolean;
  created_at: string;
  evidence_ref: string | null;
}

/** Same roster key the coaching feed groups by: slugify of the canonical name. */
export function repSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function toCoachingFinding(defect: OriginationDefect): CoachingFinding {
  const canonical =
    defect.producerName ?? defect.producerAgentId ?? "Unattributed";
  return {
    rep_slug: repSlug(canonical),
    rep_canonical_name: canonical,
    company_id: defect.accountId,
    skill: defect.kind,
    severity: defect.severity,
    origin: "origination_defect_ledger",
    status: isActionable(defect.state) ? "verified" : "new",
    finding: defect.detail || DEFECT_KIND_LABELS[defect.kind],
    is_confirmed: isActionable(defect.state),
    created_at: defect.issueOpenedAt,
    evidence_ref: defect.evidenceRefs[0] ?? null,
  };
}

// ——— Producer accountability ———

export interface ProducerDefectRate {
  producerAgentId: string;
  producerName: string;
  boundDeals: number;
  confirmedDefects: number;
  defectRate: number;
  /** Defects by kind, so coaching has somewhere to start. */
  byKind: { kind: OriginationDefectKind; count: number }[];
  acceleratorCapped: boolean;
}

/**
 * Starting threshold for the accelerator gate. Volume targets today carry no
 * quality gate at all, so any threshold is an improvement; this one is set to
 * be calibrated against the shadow period rather than defended on first
 * principles.
 */
export const DEFECT_RATE_ACCELERATOR_THRESHOLD = 0.1;

/** Minimum bound deals before a rate means anything. Small denominators lie. */
export const MIN_DEALS_FOR_GATE = 10;

/**
 * Base commission is never touched. The gate caps the accelerator only, which
 * is the difference between a quality incentive and a clawback.
 */
export function summarizeProducerDefects(
  defects: OriginationDefect[],
  boundDealsByProducer: Record<string, number>,
): ProducerDefectRate[] {
  const confirmed = defects.filter((d) => isActionable(d.state) && d.producerAgentId);
  const byProducer = new Map<string, OriginationDefect[]>();
  for (const d of confirmed) {
    const list = byProducer.get(d.producerAgentId!) ?? [];
    list.push(d);
    byProducer.set(d.producerAgentId!, list);
  }

  const producerIds = new Set([
    ...byProducer.keys(),
    ...Object.keys(boundDealsByProducer),
  ]);

  return [...producerIds]
    .map((producerAgentId) => {
      const rows = byProducer.get(producerAgentId) ?? [];
      const boundDeals = boundDealsByProducer[producerAgentId] ?? 0;
      const defectRate = boundDeals > 0 ? rows.length / boundDeals : 0;
      const kinds = new Map<OriginationDefectKind, number>();
      for (const r of rows) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
      return {
        producerAgentId,
        producerName: rows[0]?.producerName ?? producerAgentId,
        boundDeals,
        confirmedDefects: rows.length,
        defectRate: Math.round(defectRate * 1000) / 1000,
        byKind: [...kinds.entries()]
          .map(([kind, count]) => ({ kind, count }))
          .sort((a, b) => b.count - a.count),
        acceleratorCapped:
          boundDeals >= MIN_DEALS_FOR_GATE &&
          defectRate > DEFECT_RATE_ACCELERATOR_THRESHOLD,
      };
    })
    .sort((a, b) => b.defectRate - a.defectRate || b.confirmedDefects - a.confirmedDefects);
}

/** Absorbed defects are credit for the pod, not blame. */
export function defectsAbsorbedByPod(
  defects: OriginationDefect[],
): { podId: ServicePodId | null; count: number; severeCount: number }[] {
  const map = new Map<string, { podId: ServicePodId | null; count: number; severeCount: number }>();
  for (const d of defects) {
    if (!isActionable(d.state)) continue;
    const key = d.absorbingPodId ?? "unassigned";
    const row = map.get(key) ?? { podId: d.absorbingPodId, count: 0, severeCount: 0 };
    row.count += 1;
    if (d.severity === "severe") row.severeCount += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
