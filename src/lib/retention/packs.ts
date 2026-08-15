/**
 * The three service packs that are real today.
 *
 * `sla_breaches`, `repeat_contact_score`, and `escalation_feed` are live reads
 * against the spine and need no schema change, which makes them the two
 * scorecard columns that can be published before the retention ledger has
 * accumulated a single window. Everything here is pure: the packs arrive as
 * rows, and this module turns rows into per-pod columns.
 *
 * Two honesty rules run through it.
 *
 * Numbers arrive as strings. `avg_overdue_hours` is `"70.2"`, `age_hours` is
 * `"2031.9"`, and `company_id` is `"903347"`. Coercing quietly with `Number()`
 * turns a malformed row into `NaN` and then into a plausible-looking average,
 * so parsing is explicit and unparseable values are dropped and counted.
 *
 * Coverage is stated, never assumed. `sla_breaches` counts spine rows only —
 * legacy has no first-class `sla_due_at` — and `repeat_contact_score` returns
 * the worst N issues rather than the whole book. A rate computed off a
 * truncated feed is a floor, and it says so.
 */

import type { ServiceLaneId } from "@/lib/types";
import {
  CANONICAL_TO_LANE,
  normalizeIssueType,
  type CanonicalIssueType,
} from "./normalize";
import { podForLane, SERVICE_PODS, type ServicePodId } from "./pods";

export type PackSourceMode = "live" | "snapshot" | "sample";

export interface PackSource {
  packId: string;
  mode: PackSourceMode;
  /** When the rows were read, not when the column was rendered. */
  fetchedAt: string;
  /** Why this mode and not a better one. Always populated off live. */
  note: string;
}

// ——— Wire rows ———

export interface SlaBreachRow {
  issue_type: string;
  priority: string;
  breached_issues: number | string;
  oldest_due_at: string | null;
  avg_overdue_hours: number | string | null;
  max_overdue_hours: number | string | null;
}

export interface RepeatContactRow {
  issue_id: string | number;
  company_id: string | number;
  company_name: string | null;
  issue_type: string;
  status: string | null;
  priority: string | null;
  repeat_contact_score: number | string;
  email_count: number | string;
  sms_count: number | string;
  phone_count: number | string;
  unknown_channel_count: number | string;
  known_channel_count: number | string;
  first_contact_at: string | null;
  latest_contact_at: string | null;
}

export interface EscalationRow {
  source_store: string;
  work_item_id: string | number;
  company_id: string | number;
  company_name: string | null;
  issue_type: string;
  priority: string | null;
  status: string | null;
  opened_at: string | null;
  last_escalated_at: string | null;
  last_activity_at: string | null;
  age_hours: number | string | null;
  goal: string | null;
}

export interface PackPayload<Row> {
  pack_id: string;
  captured_at?: string;
  pool?: string;
  row_count?: number;
  rows: Row[];
}

/** Coerce a pack numeric. Returns null rather than NaN so callers must decide. */
export function packNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function podFor(issueType: string): { canonical: CanonicalIssueType; lane: ServiceLaneId; pod: ServicePodId | null } {
  const canonical = normalizeIssueType(issueType);
  const lane = CANONICAL_TO_LANE[canonical];
  return { canonical, lane, pod: podForLane(lane) };
}

function emptyPodMap<T>(make: (pod: ServicePodId) => T): Map<ServicePodId, T> {
  return new Map(SERVICE_PODS.map((p) => [p.id, make(p.id)] as const));
}

// ——— SLA Attainment ———

/**
 * Open spine issues per canonical type. The breach pack is a numerator with no
 * denominator of its own, so attainment needs the open counts alongside it.
 */
export type OpenCountsByCanonical = Partial<Record<CanonicalIssueType, number>>;

export interface PodSlaAttainment {
  pod: ServicePodId;
  breached: number;
  open: number;
  /** 1 − breached/open, clamped. Null when the pod has no open work to judge. */
  attainment: number | null;
  /** Volume-weighted mean of the pack's per-bucket averages. */
  avgOverdueHours: number | null;
  maxOverdueHours: number | null;
  /** The single (type, priority) bucket doing the most damage. */
  worstBucket: {
    canonical: CanonicalIssueType;
    priority: string;
    breached: number;
    avgOverdueHours: number | null;
  } | null;
  breachesByPriority: Record<string, number>;
  /**
   * Set when breached exceeds open, which means the two reads disagree — the
   * packs are captured at different instants. Attainment is floored at 0 and
   * the disagreement is reported rather than smoothed away.
   */
  reconciliationNote: string | null;
}

export interface SlaAttainmentResult {
  pods: PodSlaAttainment[];
  totalBreached: number;
  /** Breached rows whose issue type reached no pod (communications, unknown). */
  unpodded: number;
  droppedRows: number;
  source: PackSource;
  coverageNote: string;
}

export const SLA_COVERAGE_NOTE =
  "Spine issues only — legacy rows carry no first-class sla_due_at, so attainment describes the spine book.";

export function slaAttainmentByPod(
  rows: SlaBreachRow[],
  openCounts: OpenCountsByCanonical,
  source: PackSource,
): SlaAttainmentResult {
  type Acc = {
    breached: number;
    overdueWeighted: number;
    overdueWeight: number;
    max: number | null;
    worst: PodSlaAttainment["worstBucket"];
    byPriority: Record<string, number>;
    canonicals: Set<CanonicalIssueType>;
  };
  const acc = emptyPodMap<Acc>(() => ({
    breached: 0,
    overdueWeighted: 0,
    overdueWeight: 0,
    max: null,
    worst: null,
    byPriority: {},
    canonicals: new Set(),
  }));

  let totalBreached = 0;
  let unpodded = 0;
  let droppedRows = 0;

  for (const row of rows) {
    const breached = packNumber(row.breached_issues);
    if (breached == null) {
      droppedRows++;
      continue;
    }
    totalBreached += breached;
    const { canonical, pod } = podFor(row.issue_type);
    if (!pod) {
      unpodded += breached;
      continue;
    }
    const entry = acc.get(pod)!;
    entry.breached += breached;
    entry.canonicals.add(canonical);
    const priority = row.priority?.trim() || "unknown";
    entry.byPriority[priority] = (entry.byPriority[priority] ?? 0) + breached;

    const avg = packNumber(row.avg_overdue_hours);
    if (avg != null) {
      entry.overdueWeighted += avg * breached;
      entry.overdueWeight += breached;
    }
    const max = packNumber(row.max_overdue_hours);
    if (max != null && (entry.max == null || max > entry.max)) entry.max = max;

    if (!entry.worst || breached > entry.worst.breached) {
      entry.worst = { canonical, priority, breached, avgOverdueHours: avg };
    }
  }

  const pods: PodSlaAttainment[] = SERVICE_PODS.map((pod) => {
    const entry = acc.get(pod.id)!;
    const open = openForPod(pod.id, openCounts);
    let attainment: number | null = null;
    let reconciliationNote: string | null = null;
    if (open > 0) {
      if (entry.breached > open) {
        reconciliationNote = `${entry.breached} breached against ${open} open — the breach and open reads disagree; attainment floored at 0`;
        attainment = 0;
      } else {
        attainment = 1 - entry.breached / open;
      }
    } else if (entry.breached > 0) {
      reconciliationNote = `${entry.breached} breached with no open count for this pod`;
    }
    return {
      pod: pod.id,
      breached: entry.breached,
      open,
      attainment,
      avgOverdueHours:
        entry.overdueWeight > 0
          ? round1(entry.overdueWeighted / entry.overdueWeight)
          : null,
      maxOverdueHours: entry.max,
      worstBucket: entry.worst,
      breachesByPriority: entry.byPriority,
      reconciliationNote,
    };
  });

  return {
    pods,
    totalBreached,
    unpodded,
    droppedRows,
    source,
    coverageNote: SLA_COVERAGE_NOTE,
  };
}

function openForPod(pod: ServicePodId, openCounts: OpenCountsByCanonical): number {
  let total = 0;
  for (const [canonical, count] of Object.entries(openCounts) as [
    CanonicalIssueType,
    number | undefined,
  ][]) {
    if (!count) continue;
    if (podForLane(CANONICAL_TO_LANE[canonical]) === pod) total += count;
  }
  return total;
}

// ——— Repeat Contact Rate ———

/**
 * Three inbound contacts on one issue is the point where the customer has
 * stopped trusting the first answer. Every row the pack returns already clears
 * it; the threshold exists so the column keeps its meaning if the pack widens.
 */
export const REPEAT_CONTACT_THRESHOLD = 3;

/** Where the customer is not just repeating themselves but escalating. */
export const HIGH_FRUSTRATION_THRESHOLD = 10;

/**
 * Above this share of contacts with no channel, the email/sms/phone mix is
 * decoration. Measured at 45% across the captured feed, so the count of
 * contacts is usable and the breakdown of how they arrived is not.
 */
export const CHANNEL_MIX_UNUSABLE_SHARE = 0.4;

export interface PodRepeatContact {
  pod: ServicePodId;
  /** Issues in the feed at or above the repeat threshold. */
  repeatIssues: number;
  highFrustrationIssues: number;
  openIssues: number;
  /** repeatIssues / openIssues. A floor while the feed is truncated. */
  repeatContactRate: number | null;
  totalContacts: number;
  maxScore: number;
  /** Loudest account in the pod, by score. */
  worstAccount: { companyId: string; companyName: string | null; score: number } | null;
  /** Distinct accounts behind the pod's repeat issues. */
  accounts: number;
  /**
   * Share of contacts the pack could not attribute to a channel. High values
   * mean the mix (email/sms/phone) is unusable even though the count is not.
   */
  unknownChannelShare: number | null;
}

export interface RepeatContactResult {
  pods: PodRepeatContact[];
  issuesScored: number;
  unpodded: number;
  droppedRows: number;
  /** True when the pack returned exactly its cap, so the tail is unseen. */
  truncated: boolean;
  unknownChannelShare: number | null;
  source: PackSource;
  coverageNote: string;
}

export function repeatContactByPod(
  rows: RepeatContactRow[],
  openCounts: OpenCountsByCanonical,
  source: PackSource,
  opts: { requestedLimit?: number; threshold?: number } = {},
): RepeatContactResult {
  const threshold = opts.threshold ?? REPEAT_CONTACT_THRESHOLD;
  type Acc = {
    repeatIssues: number;
    high: number;
    contacts: number;
    unknown: number;
    maxScore: number;
    worst: PodRepeatContact["worstAccount"];
    accounts: Set<string>;
  };
  const acc = emptyPodMap<Acc>(() => ({
    repeatIssues: 0,
    high: 0,
    contacts: 0,
    unknown: 0,
    maxScore: 0,
    worst: null,
    accounts: new Set(),
  }));

  let issuesScored = 0;
  let unpodded = 0;
  let droppedRows = 0;
  let totalContacts = 0;
  let totalUnknown = 0;

  for (const row of rows) {
    const score = packNumber(row.repeat_contact_score);
    if (score == null) {
      droppedRows++;
      continue;
    }
    if (score < threshold) continue;
    issuesScored++;
    totalContacts += score;
    const unknown = packNumber(row.unknown_channel_count) ?? 0;
    totalUnknown += unknown;

    const { pod } = podFor(row.issue_type);
    if (!pod) {
      unpodded++;
      continue;
    }
    const entry = acc.get(pod)!;
    entry.repeatIssues++;
    if (score >= HIGH_FRUSTRATION_THRESHOLD) entry.high++;
    entry.contacts += score;
    entry.unknown += unknown;
    entry.accounts.add(String(row.company_id));
    if (score > entry.maxScore) {
      entry.maxScore = score;
      entry.worst = {
        companyId: String(row.company_id),
        companyName: row.company_name,
        score,
      };
    }
  }

  const pods: PodRepeatContact[] = SERVICE_PODS.map((pod) => {
    const entry = acc.get(pod.id)!;
    const openIssues = openForPod(pod.id, openCounts);
    return {
      pod: pod.id,
      repeatIssues: entry.repeatIssues,
      highFrustrationIssues: entry.high,
      openIssues,
      repeatContactRate: openIssues > 0 ? entry.repeatIssues / openIssues : null,
      totalContacts: entry.contacts,
      maxScore: entry.maxScore,
      worstAccount: entry.worst,
      accounts: entry.accounts.size,
      unknownChannelShare: entry.contacts > 0 ? entry.unknown / entry.contacts : null,
    };
  });

  const truncated =
    opts.requestedLimit != null && rows.length >= opts.requestedLimit;

  return {
    pods,
    issuesScored,
    unpodded,
    droppedRows,
    truncated,
    unknownChannelShare: totalContacts > 0 ? totalUnknown / totalContacts : null,
    source,
    coverageNote: truncated
      ? `Pack returns the worst ${rows.length} issues by contact count, so every rate here is a floor.`
      : "Full feed — no truncation reported.",
  };
}

// ——— Escalation aging ———

export interface PodEscalationAging {
  pod: ServicePodId;
  escalations: number;
  medianAgeHours: number | null;
  oldestAgeHours: number | null;
  overOneWeek: number;
  /** Escalated and then never touched again — the queue's dead letters. */
  untouchedSinceOpen: number;
  legacyRows: number;
}

export interface EscalationAgingResult {
  pods: PodEscalationAging[];
  escalations: number;
  unpodded: number;
  droppedRows: number;
  medianAgeHours: number | null;
  source: PackSource;
}

const ONE_WEEK_HOURS = 168;

export function escalationAgingByPod(
  rows: EscalationRow[],
  source: PackSource,
): EscalationAgingResult {
  type Acc = {
    ages: number[];
    overWeek: number;
    untouched: number;
    legacy: number;
    count: number;
  };
  const acc = emptyPodMap<Acc>(() => ({
    ages: [],
    overWeek: 0,
    untouched: 0,
    legacy: 0,
    count: 0,
  }));

  const allAges: number[] = [];
  let escalations = 0;
  let unpodded = 0;
  let droppedRows = 0;

  for (const row of rows) {
    const age = packNumber(row.age_hours);
    if (age == null) {
      droppedRows++;
      continue;
    }
    escalations++;
    allAges.push(age);
    const { pod } = podFor(row.issue_type);
    if (!pod) {
      unpodded++;
      continue;
    }
    const entry = acc.get(pod)!;
    entry.count++;
    entry.ages.push(age);
    if (age > ONE_WEEK_HOURS) entry.overWeek++;
    if (row.source_store === "legacy") entry.legacy++;
    if (
      row.opened_at &&
      row.last_activity_at &&
      Date.parse(row.opened_at) === Date.parse(row.last_activity_at)
    ) {
      entry.untouched++;
    }
  }

  const pods: PodEscalationAging[] = SERVICE_PODS.map((pod) => {
    const entry = acc.get(pod.id)!;
    return {
      pod: pod.id,
      escalations: entry.count,
      medianAgeHours: median(entry.ages),
      oldestAgeHours: entry.ages.length ? Math.max(...entry.ages) : null,
      overOneWeek: entry.overWeek,
      untouchedSinceOpen: entry.untouched,
      legacyRows: entry.legacy,
    };
  });

  return {
    pods,
    escalations,
    unpodded,
    droppedRows,
    medianAgeHours: median(allAges),
    source,
  };
}

// ——— The two scorecard columns ———

export interface ScorecardPackColumns {
  pod: ServicePodId;
  slaAttainment: number | null;
  slaBreached: number;
  slaAvgOverdueHours: number | null;
  repeatContactRate: number | null;
  repeatContactIsFloor: boolean;
  repeatIssues: number;
  escalationMedianAgeHours: number | null;
  escalationsOverOneWeek: number;
  /** Worst read across the three packs, so the column carries its own caveat. */
  mode: PackSourceMode;
  notes: string[];
}

const MODE_RANK: Record<PackSourceMode, number> = { live: 2, snapshot: 1, sample: 0 };

export function worstMode(modes: PackSourceMode[]): PackSourceMode {
  return modes.reduce<PackSourceMode>(
    (worst, m) => (MODE_RANK[m] < MODE_RANK[worst] ? m : worst),
    "live",
  );
}

export function buildScorecardPackColumns(input: {
  sla: SlaAttainmentResult;
  repeat: RepeatContactResult;
  escalations: EscalationAgingResult;
}): ScorecardPackColumns[] {
  const mode = worstMode([
    input.sla.source.mode,
    input.repeat.source.mode,
    input.escalations.source.mode,
  ]);
  const slaByPod = new Map(input.sla.pods.map((p) => [p.pod, p]));
  const repeatByPod = new Map(input.repeat.pods.map((p) => [p.pod, p]));
  const escByPod = new Map(input.escalations.pods.map((p) => [p.pod, p]));

  return SERVICE_PODS.map((pod) => {
    const sla = slaByPod.get(pod.id)!;
    const repeat = repeatByPod.get(pod.id)!;
    const esc = escByPod.get(pod.id)!;
    const notes: string[] = [];
    if (sla.reconciliationNote) notes.push(sla.reconciliationNote);
    if (input.repeat.truncated) notes.push(input.repeat.coverageNote);
    if (
      repeat.unknownChannelShare != null &&
      repeat.unknownChannelShare > CHANNEL_MIX_UNUSABLE_SHARE
    ) {
      notes.push(
        `${Math.round(repeat.unknownChannelShare * 100)}% of contacts carry no channel — count is usable, mix is not.`,
      );
    }
    return {
      pod: pod.id,
      slaAttainment: sla.attainment,
      slaBreached: sla.breached,
      slaAvgOverdueHours: sla.avgOverdueHours,
      repeatContactRate: repeat.repeatContactRate,
      repeatContactIsFloor: input.repeat.truncated,
      repeatIssues: repeat.repeatIssues,
      escalationMedianAgeHours: esc.medianAgeHours,
      escalationsOverOneWeek: esc.overOneWeek,
      mode,
      notes,
    };
  });
}

// ——— helpers ———

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : round1((sorted[mid - 1] + sorted[mid]) / 2);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
