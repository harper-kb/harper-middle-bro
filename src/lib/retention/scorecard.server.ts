import "server-only";

/**
 * Assemble the scorecard from whatever is actually there.
 *
 * The ledger is read first. If it is empty — which it will be until windows
 * start accumulating — the board falls back to the labeled sample set rather
 * than rendering six pods of dashes, because a board of dashes teaches nobody
 * what the plan pays for. The fallback is what sets `ledgerSource` to `sample`,
 * and that label is what the shadow-period readiness check refuses to attach
 * pay on top of.
 */

import {
  listAccountOwnerHistory,
  listOriginationDefects,
  listRetentionWindowEvents,
  listRetentionWindows,
} from "@/lib/db";
import { loadPackColumns } from "./packs.server";
import { currentPeriod, type ScorecardPeriod } from "./period";
import { projectSaves, type SavesProjection } from "./saves";
import {
  buildPersonScorecards,
  buildPodScorecards,
  type MetricSource,
  type PersonScorecard,
  type PodScorecard,
} from "./scorecard";
import { computePodSlaAttainment, type PodSlaAttainment } from "./sla";
import {
  SAMPLE_AT_RISK_WINDOWS,
  SAMPLE_DEFECTS,
  SAMPLE_INTERNAL_AGENTS,
  SAMPLE_OWNER_ASSIGNMENTS,
  SAMPLE_RETENTION_EVENTS,
  SAMPLE_SLA_ISSUES,
} from "./sample";
import type { ScorecardPackColumns } from "./packs";
import type { OriginationDefect } from "./defects";
import type { OwnerAssignment } from "./ownership";
import type { AtRiskWindow, RetentionEvent } from "./types";
import type { InternalAgent } from "./agents";
import type { SlaIssue } from "./sla";

/** One period's variable pool, in cents. Shadow mode pays none of it. */
export const DEFAULT_PERIOD_POOL_CENTS = 5_000_000;

export interface ScorecardView {
  period: ScorecardPeriod;
  pods: PodScorecard[];
  people: PersonScorecard[];
  projection: SavesProjection;
  packColumns: ScorecardPackColumns[];
  ledgerSource: MetricSource;
  /** Why the ledger reads the way it does — shown, not buried. */
  ledgerNote: string;
  packNote: string;
}

type Ledger = {
  windows: AtRiskWindow[];
  events: RetentionEvent[];
  assignments: OwnerAssignment[];
  defects: OriginationDefect[];
  directory: InternalAgent[];
  slaIssues: SlaIssue[];
  source: MetricSource;
  note: string;
};

function readLedger(): Ledger {
  let windows: AtRiskWindow[] = [];
  let events: RetentionEvent[] = [];
  let assignments: OwnerAssignment[] = [];
  let defects: OriginationDefect[] = [];
  let readFailed: string | null = null;

  try {
    windows = listRetentionWindows();
    events = listRetentionWindowEvents();
    assignments = listAccountOwnerHistory();
    defects = listOriginationDefects();
  } catch (err) {
    readFailed = err instanceof Error ? err.message : "retention ledger read failed";
  }

  if (readFailed || windows.length === 0) {
    return {
      windows: SAMPLE_AT_RISK_WINDOWS,
      events: SAMPLE_RETENTION_EVENTS,
      assignments: SAMPLE_OWNER_ASSIGNMENTS,
      defects: SAMPLE_DEFECTS,
      directory: SAMPLE_INTERNAL_AGENTS,
      slaIssues: SAMPLE_SLA_ISSUES,
      source: "sample",
      note:
        readFailed ??
        "No at-risk windows recorded yet — showing the labeled sample ledger so the shape of the plan is readable",
    };
  }

  // The internal-agent directory is upstream of this desk. Until it is synced,
  // names come from whoever the ledger already recorded acting.
  const directory = directoryFromLedger(events, assignments);
  return {
    windows,
    events,
    assignments,
    defects,
    directory,
    slaIssues: [],
    source: "live",
    note: `${windows.length} at-risk window(s) in the ledger`,
  };
}

function directoryFromLedger(
  events: RetentionEvent[],
  assignments: OwnerAssignment[],
): InternalAgent[] {
  const byId = new Map<string, InternalAgent>();
  for (const e of events) {
    if (!e.actorAgentId) continue;
    if (byId.has(e.actorAgentId)) continue;
    byId.set(e.actorAgentId, {
      id: e.actorAgentId,
      displayName: e.actorAgentId,
      email: e.actor.includes("@") ? e.actor : null,
      kind: e.actorKind === "agent" ? "agent" : "human",
      podId: null,
    });
  }
  for (const a of assignments) {
    if (!a.ownerAgentId) continue;
    const existing = byId.get(a.ownerAgentId);
    if (existing) {
      if (a.ownerDisplayName) existing.displayName = a.ownerDisplayName;
      continue;
    }
    byId.set(a.ownerAgentId, {
      id: a.ownerAgentId,
      displayName: a.ownerDisplayName ?? a.ownerAgentId,
      email: null,
      kind: "human",
      podId: null,
    });
  }
  return [...byId.values()];
}

export async function loadScorecard(
  opts: { now?: Date; poolCents?: number } = {},
): Promise<ScorecardView> {
  const now = opts.now ?? new Date();
  const ledger = readLedger();
  const packs = await loadPackColumns();

  const projection = projectSaves({
    windows: ledger.windows,
    events: ledger.events,
    assignments: ledger.assignments,
    directory: ledger.directory,
  });

  const deskSla: PodSlaAttainment[] = computePodSlaAttainment(
    ledger.slaIssues,
    ledger.defects,
    now,
  );

  const input = {
    windows: ledger.windows,
    events: ledger.events,
    projection,
    assignments: ledger.assignments,
    directory: ledger.directory,
    defects: ledger.defects,
    deskSla,
    packColumns: packs.columns,
    ledgerSource: ledger.source,
  };

  return {
    period: currentPeriod(opts.poolCents ?? DEFAULT_PERIOD_POOL_CENTS, now),
    pods: buildPodScorecards(input),
    people: buildPersonScorecards(input),
    projection,
    packColumns: packs.columns,
    ledgerSource: ledger.source,
    ledgerNote: ledger.note,
    packNote:
      packs.sla.source.mode === "live"
        ? `Live spine packs, read ${packs.sla.source.fetchedAt}`
        : `${packs.sla.source.note} (captured ${packs.sla.source.fetchedAt})`,
  };
}
