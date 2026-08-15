/**
 * Captured pack reads, taken from prod on 2026-08-15.
 *
 * These exist so the scorecard renders something true when the service-query
 * door is not provisioned. They are labeled `snapshot`, never `live`: a number
 * from a fixture and a number from the spine must never look alike on a board
 * that will eventually decide pay.
 *
 * `sla_breaches` came back complete at 45 buckets. The other two are capped
 * feeds — the worst 200 issues by contact count, the 200 oldest escalations —
 * so anything derived from them is a floor, and `repeatContactByPod` is told
 * the cap so it can say so.
 */

import escalationFeed from "./snapshots/escalation_feed.json";
import repeatContactScore from "./snapshots/repeat_contact_score.json";
import slaBreaches from "./snapshots/sla_breaches.json";
import type { CanonicalIssueType } from "./normalize";
import { normalizeIssueType } from "./normalize";
import type {
  EscalationRow,
  OpenCountsByCanonical,
  PackPayload,
  PackSource,
  RepeatContactRow,
  SlaBreachRow,
} from "./packs";
import { OBSERVED_ISSUE_VOCABULARY } from "./vocabulary-snapshot";

export const SNAPSHOT_CAPTURED_AT = "2026-08-15T07:00:00.000Z";

/** The cap each feed was requested with, which is what makes a rate a floor. */
export const SNAPSHOT_FEED_LIMIT = 200;

export const SLA_BREACHES_SNAPSHOT = slaBreaches as PackPayload<SlaBreachRow>;
export const REPEAT_CONTACT_SNAPSHOT =
  repeatContactScore as PackPayload<RepeatContactRow>;
export const ESCALATION_FEED_SNAPSHOT =
  escalationFeed as PackPayload<EscalationRow>;

export function snapshotSource(packId: string): PackSource {
  return {
    packId,
    mode: "snapshot",
    fetchedAt: SNAPSHOT_CAPTURED_AT,
    note: "Captured prod read — service-query door not provisioned",
  };
}

/**
 * Open spine issues per canonical type, the denominator for both rates.
 *
 * Spine only, on purpose: `sla_breaches` excludes legacy rows because they
 * carry no `sla_due_at`, so adding legacy to the denominator would flatter
 * every pod's attainment with work the numerator never looked at.
 */
export const SNAPSHOT_OPEN_COUNTS: OpenCountsByCanonical =
  OBSERVED_ISSUE_VOCABULARY.reduce<OpenCountsByCanonical>((acc, row) => {
    if (row.sourceStore !== "spine") return acc;
    const canonical: CanonicalIssueType = normalizeIssueType(row.issueType);
    acc[canonical] = (acc[canonical] ?? 0) + row.openCount;
    return acc;
  }, {});
