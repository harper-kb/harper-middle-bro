import "server-only";

/**
 * Load the three live packs, or say plainly that they are not live.
 *
 * The fallback chain is deliberate and never silent: a live read wins, a
 * captured snapshot is second and carries the reason the live read did not
 * happen, and there is no third rung — this module refuses to invent rows.
 * The scorecard renders the mode next to every number that came out of here.
 */

import {
  runServicePack,
  SERVICE_QUERY_SOURCE,
  serviceQueryConfigured,
  ServiceQueryError,
  type ServicePackId,
} from "@/lib/adapters/harper/service-query";
import {
  ESCALATION_FEED_SNAPSHOT,
  REPEAT_CONTACT_SNAPSHOT,
  SLA_BREACHES_SNAPSHOT,
  SNAPSHOT_FEED_LIMIT,
  SNAPSHOT_OPEN_COUNTS,
  snapshotSource,
} from "./pack-snapshot";
import {
  buildScorecardPackColumns,
  escalationAgingByPod,
  repeatContactByPod,
  slaAttainmentByPod,
  type EscalationAgingResult,
  type EscalationRow,
  type OpenCountsByCanonical,
  type PackPayload,
  type PackSource,
  type RepeatContactResult,
  type RepeatContactRow,
  type ScorecardPackColumns,
  type SlaAttainmentResult,
  type SlaBreachRow,
} from "./packs";
import { normalizeIssueType, type CanonicalIssueType } from "./normalize";

const FEED_LIMIT = 200;

type Loaded<Row> = {
  rows: Row[];
  source: PackSource;
};

async function loadPack<Row>(
  pack: ServicePackId,
  fallback: PackPayload<Row>,
  limit?: number,
): Promise<Loaded<Row>> {
  if (!serviceQueryConfigured()) {
    return {
      rows: fallback.rows,
      source: snapshotSource(fallback.pack_id),
    };
  }
  try {
    const result = await runServicePack<Row>(pack, { limit });
    return {
      rows: result.rows,
      source: {
        packId: result.packId,
        mode: "live",
        fetchedAt: result.fetchedAt,
        note: SERVICE_QUERY_SOURCE,
      },
    };
  } catch (err) {
    const reason =
      err instanceof ServiceQueryError
        ? err.message
        : err instanceof Error
          ? err.message
          : "service query read failed";
    return {
      rows: fallback.rows,
      source: {
        ...snapshotSource(fallback.pack_id),
        note: `Captured prod read — live pack unavailable: ${reason}`,
      },
    };
  }
}

/**
 * Open spine issues per canonical type, the denominator both rates divide by.
 * Live when `open_issues_by_stage` answers, snapshot otherwise — and the mode
 * is carried through, because a live numerator over a stale denominator is
 * exactly the kind of blended number this board is not allowed to print.
 */
type OpenIssueRow = {
  source_store?: string;
  issue_type?: string;
  open_issues?: number | string;
  issue_count?: number | string;
};

async function loadOpenCounts(): Promise<{
  counts: OpenCountsByCanonical;
  mode: PackSource["mode"];
}> {
  if (!serviceQueryConfigured()) {
    return { counts: SNAPSHOT_OPEN_COUNTS, mode: "snapshot" };
  }
  try {
    const result = await runServicePack<OpenIssueRow>("open_issues_by_stage", {
      limit: 200,
    });
    const counts: OpenCountsByCanonical = {};
    let usable = 0;
    for (const row of result.rows) {
      if (row.source_store && row.source_store !== "spine") continue;
      const raw = row.open_issues ?? row.issue_count;
      const count = typeof raw === "number" ? raw : Number(raw);
      if (!row.issue_type || !Number.isFinite(count)) continue;
      const canonical: CanonicalIssueType = normalizeIssueType(row.issue_type);
      counts[canonical] = (counts[canonical] ?? 0) + count;
      usable++;
    }
    if (!usable) return { counts: SNAPSHOT_OPEN_COUNTS, mode: "snapshot" };
    return { counts, mode: "live" };
  } catch {
    return { counts: SNAPSHOT_OPEN_COUNTS, mode: "snapshot" };
  }
}

export interface LivePackColumns {
  sla: SlaAttainmentResult;
  repeat: RepeatContactResult;
  escalations: EscalationAgingResult;
  columns: ScorecardPackColumns[];
  /** Mode of the denominator, which can differ from the numerators' mode. */
  openCountsMode: PackSource["mode"];
}

export async function loadPackColumns(): Promise<LivePackColumns> {
  const [slaLoad, repeatLoad, escalationLoad, open] = await Promise.all([
    loadPack<SlaBreachRow>("sla_breaches", SLA_BREACHES_SNAPSHOT),
    loadPack<RepeatContactRow>("repeat_contact_score", REPEAT_CONTACT_SNAPSHOT, FEED_LIMIT),
    loadPack<EscalationRow>("escalation_feed", ESCALATION_FEED_SNAPSHOT, FEED_LIMIT),
    loadOpenCounts(),
  ]);

  const sla = slaAttainmentByPod(slaLoad.rows, open.counts, slaLoad.source);
  const repeat = repeatContactByPod(repeatLoad.rows, open.counts, repeatLoad.source, {
    requestedLimit:
      repeatLoad.source.mode === "snapshot" ? SNAPSHOT_FEED_LIMIT : FEED_LIMIT,
  });
  const escalations = escalationAgingByPod(escalationLoad.rows, escalationLoad.source);

  return {
    sla,
    repeat,
    escalations,
    columns: buildScorecardPackColumns({ sla, repeat, escalations }),
    openCountsMode: open.mode,
  };
}
