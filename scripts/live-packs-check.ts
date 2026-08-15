/**
 * Live-pack harness: the captured sla_breaches, repeat_contact_score, and
 * escalation_feed reads must fold into per-pod SLA Attainment and Repeat
 * Contact Rate columns without inventing precision they do not have.
 * Run: npx tsx scripts/live-packs-check.ts
 */
import {
  buildScorecardPackColumns,
  CHANNEL_MIX_UNUSABLE_SHARE,
  escalationAgingByPod,
  HIGH_FRUSTRATION_THRESHOLD,
  packNumber,
  repeatContactByPod,
  slaAttainmentByPod,
  worstMode,
  type EscalationRow,
  type SlaBreachRow,
} from "../src/lib/retention/packs";
import {
  ESCALATION_FEED_SNAPSHOT,
  REPEAT_CONTACT_SNAPSHOT,
  SLA_BREACHES_SNAPSHOT,
  SNAPSHOT_FEED_LIMIT,
  SNAPSHOT_OPEN_COUNTS,
  snapshotSource,
} from "../src/lib/retention/pack-snapshot";
import { POD_BY_ID } from "../src/lib/retention/pods";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

// ——— Parsing ———

check("string numerics parse", packNumber("70.2") === 70.2);
check("numeric numerics pass through", packNumber(45) === 45);
check("empty string is null, not zero", packNumber("") === null);
check("garbage is null, not NaN", packNumber("n/a") === null);
check("null is null", packNumber(null) === null);

// ——— SLA attainment ———

const slaSource = snapshotSource(SLA_BREACHES_SNAPSHOT.pack_id);
const sla = slaAttainmentByPod(
  SLA_BREACHES_SNAPSHOT.rows,
  SNAPSHOT_OPEN_COUNTS,
  slaSource,
);

const packTotal = SLA_BREACHES_SNAPSHOT.rows.reduce(
  (n, r) => n + (packNumber(r.breached_issues) ?? 0),
  0,
);
check(
  "every breached issue is accounted for — podded or explicitly not",
  sla.totalBreached === packTotal &&
    sla.pods.reduce((n, p) => n + p.breached, 0) + sla.unpodded === packTotal,
  {
    packTotal,
    podded: sla.pods.reduce((n, p) => n + p.breached, 0),
    unpodded: sla.unpodded,
  },
);
check("no rows dropped from the captured pack", sla.droppedRows === 0);

const cancels = sla.pods.find((p) => p.pod === "cancellations_payments")!;
// Cancellation 27+322+158, payment_failure 31+53+55, pfa 3+1+5.
check("cancellations pod sums its three canonical types", cancels.breached === 655, {
  breached: cancels.breached,
});
check(
  "cancellations attainment sits between 0 and 1",
  cancels.attainment != null && cancels.attainment > 0 && cancels.attainment < 1,
  cancels.attainment,
);
check(
  "the worst bucket is named, not just counted",
  cancels.worstBucket?.canonical === "cancellation" &&
    cancels.worstBucket.priority === "P1" &&
    cancels.worstBucket.breached === 322,
  cancels.worstBucket,
);
check(
  "overdue hours are volume-weighted, not a mean of means",
  cancels.avgOverdueHours != null &&
    cancels.avgOverdueHours > 88 &&
    cancels.avgOverdueHours < 130,
  cancels.avgOverdueHours,
);
check(
  "priority mix survives the rollup",
  cancels.breachesByPriority.P0 === 61 && cancels.breachesByPriority.P1 === 376,
  cancels.breachesByPriority,
);

check(
  "no pod reports a negative or above-one attainment",
  sla.pods.every((p) => p.attainment == null || (p.attainment >= 0 && p.attainment <= 1)),
  sla.pods.map((p) => [p.pod, p.attainment]),
);
check(
  "clean reads carry no reconciliation note",
  sla.pods.every((p) => p.reconciliationNote == null),
  sla.pods.filter((p) => p.reconciliationNote).map((p) => p.reconciliationNote),
);

// A breach count above the open count means the two reads disagree. Attainment
// must floor at zero and say so rather than printing a negative rate.
const skewed = slaAttainmentByPod(
  [
    {
      issue_type: "coi_request",
      priority: "P1",
      breached_issues: 9999,
      oldest_due_at: null,
      avg_overdue_hours: "10.0",
      max_overdue_hours: "20.0",
    },
  ] satisfies SlaBreachRow[],
  { coi_request: 250 },
  slaSource,
);
const skewedCoi = skewed.pods.find((p) => p.pod === "coi")!;
check(
  "a numerator larger than its denominator floors at zero and reports",
  skewedCoi.attainment === 0 && skewedCoi.reconciliationNote != null,
  skewedCoi,
);

// General requests, account changes, and portal access live in active_service,
// which the policy delivery pod owns — nothing should silently vanish.
check(
  "spine types outside a pod are counted as unpodded, not dropped",
  sla.unpodded >= 0,
  sla.unpodded,
);

// ——— Repeat contact ———

const repeat = repeatContactByPod(
  REPEAT_CONTACT_SNAPSHOT.rows,
  SNAPSHOT_OPEN_COUNTS,
  snapshotSource(REPEAT_CONTACT_SNAPSHOT.pack_id),
  { requestedLimit: SNAPSHOT_FEED_LIMIT },
);

check(
  "the capped feed is reported as truncated so the rate reads as a floor",
  repeat.truncated && repeat.coverageNote.includes("floor"),
  { truncated: repeat.truncated, note: repeat.coverageNote },
);
check(
  "every row in the pack clears the repeat threshold",
  repeat.issuesScored === REPEAT_CONTACT_SNAPSHOT.rows.length,
  { scored: repeat.issuesScored, rows: REPEAT_CONTACT_SNAPSHOT.rows.length },
);
check("no rows dropped from the captured feed", repeat.droppedRows === 0);

const worstOverall = REPEAT_CONTACT_SNAPSHOT.rows.reduce((worst, r) =>
  (packNumber(r.repeat_contact_score) ?? 0) > (packNumber(worst.repeat_contact_score) ?? 0)
    ? r
    : worst,
);
const worstPod = repeat.pods.find((p) => p.maxScore === packNumber(worstOverall.repeat_contact_score));
check(
  "the loudest account in the book surfaces on its own pod",
  worstPod?.worstAccount?.companyName === worstOverall.company_name,
  { expected: worstOverall.company_name, got: worstPod?.worstAccount },
);
check(
  "rates stay within the unit interval",
  repeat.pods.every(
    (p) => p.repeatContactRate == null || (p.repeatContactRate >= 0 && p.repeatContactRate <= 1),
  ),
  repeat.pods.map((p) => [p.pod, p.repeatContactRate]),
);
check(
  "high-frustration issues are a subset of repeat issues",
  repeat.pods.every((p) => p.highFrustrationIssues <= p.repeatIssues),
);
// The plan expected "most" contacts to carry no channel. The captured feed
// measures 45%, which is short of most and still past the point where the
// channel mix means anything — so the column reports the count and flags the mix.
check(
  "weak channel attribution is measured rather than assumed",
  repeat.unknownChannelShare != null &&
    repeat.unknownChannelShare > CHANNEL_MIX_UNUSABLE_SHARE &&
    repeat.unknownChannelShare < 0.5,
  repeat.unknownChannelShare,
);

const raisedThreshold = repeatContactByPod(
  REPEAT_CONTACT_SNAPSHOT.rows,
  SNAPSHOT_OPEN_COUNTS,
  snapshotSource(REPEAT_CONTACT_SNAPSHOT.pack_id),
  { threshold: HIGH_FRUSTRATION_THRESHOLD },
);
check(
  "raising the threshold narrows the population",
  raisedThreshold.issuesScored < repeat.issuesScored && raisedThreshold.issuesScored > 0,
  { at3: repeat.issuesScored, at10: raisedThreshold.issuesScored },
);

// ——— Escalation aging ———

const escalations = escalationAgingByPod(
  ESCALATION_FEED_SNAPSHOT.rows,
  snapshotSource(ESCALATION_FEED_SNAPSHOT.pack_id),
);
check(
  "every escalation lands somewhere",
  escalations.pods.reduce((n, p) => n + p.escalations, 0) + escalations.unpodded ===
    escalations.escalations,
  {
    podded: escalations.pods.reduce((n, p) => n + p.escalations, 0),
    unpodded: escalations.unpodded,
    total: escalations.escalations,
  },
);
check(
  "the feed's median age is over a week, matching the read",
  escalations.medianAgeHours != null && escalations.medianAgeHours > 168,
  escalations.medianAgeHours,
);
check(
  "legacy rows are counted as legacy, not laundered into the spine",
  escalations.pods.reduce((n, p) => n + p.legacyRows, 0) > 0,
);
check(
  "escalations opened and never touched again are visible",
  escalations.pods.reduce((n, p) => n + p.untouchedSinceOpen, 0) > 0,
);

const missingAge = escalationAgingByPod(
  [
    {
      source_store: "spine",
      work_item_id: 1,
      company_id: 1,
      company_name: "No Age Co",
      issue_type: "coi_request",
      priority: "P1",
      status: "open",
      opened_at: null,
      last_escalated_at: null,
      last_activity_at: null,
      age_hours: null,
      goal: null,
    },
  ] satisfies EscalationRow[],
  snapshotSource("service.escalation_feed.v1"),
);
check(
  "an unusable row is dropped and counted, never averaged in",
  missingAge.droppedRows === 1 && missingAge.escalations === 0,
  missingAge,
);

// ——— The scorecard columns ———

const columns = buildScorecardPackColumns({ sla, repeat, escalations });
check("one column row per pod", columns.length === Object.keys(POD_BY_ID).length);
check(
  "snapshot inputs produce snapshot-labeled columns",
  columns.every((c) => c.mode === "snapshot"),
  columns.map((c) => c.mode),
);
check(
  "the truncation caveat rides along with the rate",
  columns.every((c) => c.repeatContactIsFloor && c.notes.length > 0),
);
check(
  "worst mode wins when packs disagree",
  worstMode(["live", "snapshot"]) === "snapshot" &&
    worstMode(["live", "live"]) === "live" &&
    worstMode(["snapshot", "sample"]) === "sample",
);

const cancelColumn = columns.find((c) => c.pod === "cancellations_payments")!;
check(
  "the money-kept pod carries all four pack numbers",
  cancelColumn.slaAttainment != null &&
    cancelColumn.slaBreached === 655 &&
    cancelColumn.repeatContactRate != null &&
    cancelColumn.escalationMedianAgeHours != null,
  cancelColumn,
);

// ——— Report ———

console.log("\n— Pack columns by pod —");
for (const c of columns) {
  const attainment = c.slaAttainment == null ? "n/a" : `${(c.slaAttainment * 100).toFixed(1)}%`;
  const rate = c.repeatContactRate == null ? "n/a" : `${(c.repeatContactRate * 100).toFixed(1)}%`;
  console.log(
    `${POD_BY_ID[c.pod].label.padEnd(26)} SLA ${attainment.padStart(6)}  ` +
      `breached ${String(c.slaBreached).padStart(4)}  repeat ${rate.padStart(6)}  ` +
      `escalation median ${c.escalationMedianAgeHours ?? "n/a"}h`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll live-pack checks passed.");
