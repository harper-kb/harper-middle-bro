/**
 * Service Scorecard harness — run with:
 *   npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/scorecard-check.tsx
 *
 * Covers the two things that decide whether this board is trusted: every cell
 * carries an honest source label, and the shadow-period gate cannot be talked
 * out of holding money back.
 */

import { renderToStaticMarkup } from "react-dom/server";
import {
  PersonScorecardTable,
  PersonalScorecard,
  PodScorecardTable,
  ShadowBanner,
} from "../src/components/ServiceScorecard";
import {
  buildPersonScorecards,
  buildPodScorecards,
  formatCents,
  formatMetric,
  SCORECARD_METRIC_LABELS,
  type ScorecardInput,
  type ScorecardMetricKey,
} from "../src/lib/retention/scorecard";
import {
  attachPay,
  assertPayable,
  currentPeriod,
  payoutFor,
  periodReadiness,
  ShadowPeriodError,
  type ScorecardDispute,
} from "../src/lib/retention/period";
import { projectSaves } from "../src/lib/retention/saves";
import { computePodSlaAttainment } from "../src/lib/retention/sla";
import {
  buildScorecardPackColumns,
  escalationAgingByPod,
  repeatContactByPod,
  slaAttainmentByPod,
} from "../src/lib/retention/packs";
import {
  ESCALATION_FEED_SNAPSHOT,
  REPEAT_CONTACT_SNAPSHOT,
  SLA_BREACHES_SNAPSHOT,
  SNAPSHOT_FEED_LIMIT,
  SNAPSHOT_OPEN_COUNTS,
  snapshotSource,
} from "../src/lib/retention/pack-snapshot";
import {
  SAMPLE_AT_RISK_WINDOWS,
  SAMPLE_DEFECTS,
  SAMPLE_INTERNAL_AGENTS,
  SAMPLE_OWNER_ASSIGNMENTS,
  SAMPLE_RETENTION_EVENTS,
  SAMPLE_SLA_ISSUES,
} from "../src/lib/retention/sample";
import { SERVICE_PODS } from "../src/lib/retention/pods";
import {
  disputeSubjects,
  ShadowPeriodPanel,
} from "../src/components/ShadowPeriodPanel";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

const NOW = new Date("2026-08-15T07:00:00.000Z");

// ——— Build the board off the sample ledger and the captured packs ———

const sla = slaAttainmentByPod(
  SLA_BREACHES_SNAPSHOT.rows,
  SNAPSHOT_OPEN_COUNTS,
  snapshotSource(SLA_BREACHES_SNAPSHOT.pack_id),
);
const repeat = repeatContactByPod(
  REPEAT_CONTACT_SNAPSHOT.rows,
  SNAPSHOT_OPEN_COUNTS,
  snapshotSource(REPEAT_CONTACT_SNAPSHOT.pack_id),
  { requestedLimit: SNAPSHOT_FEED_LIMIT },
);
const escalations = escalationAgingByPod(
  ESCALATION_FEED_SNAPSHOT.rows,
  snapshotSource(ESCALATION_FEED_SNAPSHOT.pack_id),
);
const packColumns = buildScorecardPackColumns({ sla, repeat, escalations });

const projection = projectSaves({
  windows: SAMPLE_AT_RISK_WINDOWS,
  events: SAMPLE_RETENTION_EVENTS,
  assignments: SAMPLE_OWNER_ASSIGNMENTS,
  directory: SAMPLE_INTERNAL_AGENTS,
});

const input: ScorecardInput = {
  windows: SAMPLE_AT_RISK_WINDOWS,
  events: SAMPLE_RETENTION_EVENTS,
  projection,
  assignments: SAMPLE_OWNER_ASSIGNMENTS,
  directory: SAMPLE_INTERNAL_AGENTS,
  defects: SAMPLE_DEFECTS,
  deskSla: computePodSlaAttainment(SAMPLE_SLA_ISSUES, SAMPLE_DEFECTS, NOW),
  packColumns,
  ledgerSource: "sample",
};

const pods = buildPodScorecards(input);
const people = buildPersonScorecards(input);

// ——— Pod board ———

check("one row per pod", pods.length === SERVICE_PODS.length);
check(
  "every pod carries all eight measures",
  pods.every((p) => p.metrics.length === 8),
  pods.map((p) => [p.podId, p.metrics.length]),
);
check(
  "a sample ledger never labels a ledger metric live",
  pods.every((p) =>
    p.metrics
      .filter((m) => m.key !== "repeat_contact_rate" && m.key !== "book_sla_attainment")
      .every((m) => m.source === "sample"),
  ),
);
check(
  "pack-backed measures keep the pack's own label, not the ledger's",
  pods.every((p) =>
    p.metrics
      .filter((m) => m.key === "repeat_contact_rate" || m.key === "book_sla_attainment")
      .every((m) => m.source === "snapshot"),
  ),
);

const cancels = pods.find((p) => p.podId === "cancellations_payments")!;
check(
  "the cancellations pod books the retained commission from its two saves",
  metric(cancels, "retained_commission") === 693_000 + 277_500,
  metric(cancels, "retained_commission"),
);
check(
  "save rate divides by closed windows, not by every window",
  metric(cancels, "save_rate") === 2 / 3,
  metric(cancels, "save_rate"),
);
check(
  "the expired Tallgrass window is reported as an at-risk window that was lost",
  cancels.atRiskWindows === 3 && cancels.saves === 2,
  { windows: cancels.atRiskWindows, saves: cancels.saves },
);

const endorsements = pods.find((p) => p.podId === "endorsements")!;
check(
  "defects absorbed lands on the pod that ate the rework",
  metric(endorsements, "defects_absorbed") === 0 &&
    metric(pods.find((p) => p.podId === "subjectivities_docusign")!, "defects_absorbed") === 1,
  {
    endorsements: metric(endorsements, "defects_absorbed"),
    subjectivities: metric(
      pods.find((p) => p.podId === "subjectivities_docusign")!,
      "defects_absorbed",
    ),
  },
);

// Record completeness must fall when a decisive action carries no evidence.
const noEvidence: ScorecardInput = {
  ...input,
  events: SAMPLE_RETENTION_EVENTS.map((e) =>
    e.id === "iss-3001-c" ? { ...e, evidenceRef: null } : e,
  ),
};
const degraded = buildPodScorecards(noEvidence).find(
  (p) => p.podId === "cancellations_payments",
)!;
check(
  "stripping an evidence reference lowers record completeness",
  (metric(degraded, "record_completeness") ?? 1) <
    (metric(cancels, "record_completeness") ?? 0),
  {
    before: metric(cancels, "record_completeness"),
    after: metric(degraded, "record_completeness"),
  },
);

// ——— Person board ———

check("people with no footprint are omitted, not shown as dashes", people.length > 0);
check(
  "nobody on the board is a bot",
  people.every((p) => p.agentId !== "spine-agent-prod"),
  people.map((p) => p.agentId),
);
const kai = people.find((p) => p.agentId === "svc-kai")!;
check(
  "the owner of record takes a share even when someone else executed",
  kai.retainedCommissionCents > 0 && kai.savesContributed >= 1,
  kai,
);
const tess = people.find((p) => p.agentId === "svc-tess")!;
check(
  "a non-owner who did the decisive work is paid for it",
  tess.retainedCommissionCents > 0,
  tess,
);
check(
  "shares across one save never exceed the save",
  projection.credits.every(
    (c) => Math.abs(c.attributions.reduce((n, a) => n + a.share, 0) - 1) < 1e-9,
  ),
);
check(
  "every person row carries an email or explicitly carries none",
  people.every((p) => p.email === null || p.email.includes("@")),
);

// ——— Shadow period ———

const period = currentPeriod(5_000_000, NOW);
check("a new period opens in shadow", period.state === "shadow");

const payout = payoutFor(period, "cancellations_payments");
check(
  "shadow shows what would be earned and pays none of it",
  payout.modeledCents === 2_000_000 && payout.payableCents === 0,
  payout,
);

let threw = false;
try {
  assertPayable(period);
} catch (err) {
  threw = err instanceof ShadowPeriodError;
}
check("anything that would move money is refused in shadow", threw);

const metricSources = pods.flatMap((p) =>
  p.metrics.map((m) => ({ key: m.key as string, source: m.source })),
);
const disputes: ScorecardDispute[] = [
  {
    id: "dsp-1",
    periodId: period.id,
    subject: "window",
    subjectId: SAMPLE_AT_RISK_WINDOWS[3].id,
    raisedBy: "svc-kai",
    raisedAt: "2026-08-10T00:00:00.000Z",
    claim: "Tallgrass expired only because the cancellation was never routed to a pod",
    state: "open",
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    correctionApplied: false,
  },
];

const midPeriod = periodReadiness(period, disputes, metricSources, NOW);
check(
  "an unfinished, unpublished period with an open dispute and sample metrics names every blocker",
  !midPeriod.ready &&
    midPeriod.blockers.length === 4 &&
    midPeriod.blockers.some((b) => b.includes("full period")) &&
    midPeriod.blockers.some((b) => b.includes("never published")) &&
    midPeriod.blockers.some((b) => b.includes("dispute")) &&
    midPeriod.blockers.some((b) => b.includes("sample-labeled")),
  midPeriod.blockers,
);

const settled: ScorecardDispute[] = disputes.map((d) => ({
  ...d,
  state: "upheld",
  resolvedAt: "2026-08-12T00:00:00.000Z",
  resolvedBy: "mgr-1",
  resolutionNote: "Window re-owned and recomputed",
  correctionApplied: true,
}));
const afterPeriod = new Date("2026-09-02T00:00:00.000Z");
const published = { ...period, publishedAt: "2026-09-01T00:00:00.000Z" };

const stillSample = periodReadiness(published, settled, metricSources, afterPeriod);
check(
  "a settled, published, finished period still blocks while a metric reads sample",
  !stillSample.ready &&
    stillSample.blockers.length === 1 &&
    stillSample.blockers[0].includes("sample-labeled"),
  stillSample.blockers,
);

const liveSources = metricSources.map((m) => ({ ...m, source: "live" as const }));
const ready = periodReadiness(published, settled, liveSources, afterPeriod);
check(
  "live metrics, settled disputes, and a finished period clear the gate",
  ready.ready && ready.disputesUpheld === 1 && ready.correctionsApplied === 1,
  ready,
);
const attached = attachPay(published, ready);
check(
  "pay attaches only through the gate, and then money is payable",
  attached.state === "attached" &&
    payoutFor(attached, "cancellations_payments").payableCents === 2_000_000,
);

let refused = false;
try {
  attachPay(published, stillSample);
} catch {
  refused = true;
}
check("attaching pay against a failed readiness check throws", refused);

// ——— Render ———

const podMarkup = renderToStaticMarkup(<PodScorecardTable pods={pods} />);
check(
  "the pod table prints every column header",
  (Object.keys(SCORECARD_METRIC_LABELS) as ScorecardMetricKey[]).every((k) =>
    podMarkup.includes(SCORECARD_METRIC_LABELS[k]),
  ),
);
check(
  "sample cells render a Sample chip rather than a bare number",
  podMarkup.includes("Sample") && podMarkup.includes("Snapshot"),
);
check(
  "the retained commission cell prints as money",
  podMarkup.includes(formatCents(693_000 + 277_500)),
  formatCents(693_000 + 277_500),
);
check(
  "each pod names the verb it is paid on",
  podMarkup.includes("Money Kept") && podMarkup.includes("Automation Target"),
);

const peopleMarkup = renderToStaticMarkup(<PersonScorecardTable people={people} />);
check("the person table names seats", peopleMarkup.includes("Kai Bloom"));

const bannerMarkup = renderToStaticMarkup(
  <ShadowBanner period={period} ledgerNote="sample ledger" packNote="captured packs" />,
);
check(
  "the banner says plainly that nothing pays anyone",
  bannerMarkup.includes("Nothing here pays anyone") &&
    bannerMarkup.includes("Shadow"),
);

const personalMarkup = renderToStaticMarkup(
  <PersonalScorecard person={kai} period={period} ledgerNote="sample ledger" />,
);
check(
  "the personal view shows the seat's own money and its label",
  personalMarkup.includes(formatCents(kai.retainedCommissionCents)) &&
    personalMarkup.includes("Sample"),
);

const emptyMarkup = renderToStaticMarkup(
  <PersonalScorecard
    person={null}
    period={{ ...period, publishedAt: "2026-09-01T00:00:00.000Z" }}
    ledgerNote="sample ledger"
  />,
);
check(
  "a seat with no attribution is told why, not shown zeros",
  emptyMarkup.includes("personal inbox"),
);
check(
  "a seat missing from the board entirely can still say so",
  emptyMarkup.includes("Raise Dispute") &&
    emptyMarkup.includes("My Seat Is Missing From The Board"),
);

// ——— The ritual, as a surface ———

const subjects = disputeSubjects(pods, people);
check(
  "a dispute can name a metric, a pod, or a seat",
  subjects.some((s) => s.value === "metric:retained_commission") &&
    subjects.some((s) => s.value === "pod:cancellations_payments") &&
    subjects.some((s) => s.value === "person:svc-kai"),
  subjects.slice(0, 3),
);

const unpublishedPanel = renderToStaticMarkup(
  <ShadowPeriodPanel
    period={period}
    readiness={midPeriod}
    disputes={[]}
    subjects={subjects}
    canManage
  />,
);
check(
  "an unpublished board offers nothing to dispute and says why",
  unpublishedPanel.includes("nothing to raise one against") &&
    !unpublishedPanel.includes("Raise Dispute"),
);
check(
  "the panel prints every reason pay is still detached",
  midPeriod.blockers.every((b) => unpublishedPanel.includes(escapeHtml(b))),
  midPeriod.blockers,
);

const managerPanel = renderToStaticMarkup(
  <ShadowPeriodPanel
    period={published}
    readiness={periodReadiness(published, disputes, metricSources, afterPeriod)}
    disputes={disputes}
    subjects={subjects}
    canManage
    seatNames={{ "svc-kai": "Kai Bloom" }}
  />,
);
check(
  "an open dispute is shown with its claim and its raiser by name",
  managerPanel.includes(escapeHtml(disputes[0].claim)) &&
    managerPanel.includes("Kai Bloom"),
);
check(
  "a manager can settle it, and cannot settle it silently",
  managerPanel.includes("Settle Dispute") && managerPanel.includes("resolutionNote"),
);
check(
  "attach pay is offered but disabled while the board is blocked",
  managerPanel.includes("Attach Pay") && managerPanel.includes("disabled"),
);
check(
  "republishing over a live dispute is refused in the button, not in a stack trace",
  managerPanel.includes("Settle the disputes first"),
);

const undisputedPanel = renderToStaticMarkup(
  <ShadowPeriodPanel
    period={published}
    readiness={periodReadiness(published, [], metricSources, afterPeriod)}
    disputes={[]}
    subjects={subjects}
    canManage
  />,
);
check(
  "republishing stays open while the board is still moving",
  undisputedPanel.includes("Republish Numbers") &&
    !undisputedPanel.includes("Settle the disputes first"),
);

const seatPanel = renderToStaticMarkup(
  <ShadowPeriodPanel
    period={published}
    readiness={periodReadiness(published, disputes, metricSources, afterPeriod)}
    disputes={disputes}
    subjects={subjects}
    canManage={false}
  />,
);
check(
  "a non-manager can raise a dispute but not settle one or attach pay",
  seatPanel.includes("Raise Dispute") &&
    !seatPanel.includes("Settle Dispute") &&
    !seatPanel.includes("Attach Pay"),
);

const paidPanel = renderToStaticMarkup(
  <ShadowPeriodPanel
    period={attached}
    readiness={ready}
    disputes={settled}
    subjects={subjects}
    canManage
  />,
);
check(
  "once pay is attached the panel stops listing blockers",
  paidPanel.includes("Pay Attached") && !paidPanel.includes("Pay Stays Detached"),
);

const seatDisputeMarkup = renderToStaticMarkup(
  <PersonalScorecard
    person={kai}
    period={published}
    ledgerNote="sample ledger"
    disputes={settled}
  />,
);
check(
  "a seat sees what it argued and what it was told back",
  seatDisputeMarkup.includes(escapeHtml("Window re-owned and recomputed")) &&
    seatDisputeMarkup.includes("Raise Dispute"),
);

// ——— Report ———

console.log("\n— Pod board —");
for (const pod of pods) {
  const cells = pod.metrics
    .map((m) => `${SCORECARD_METRIC_LABELS[m.key]} ${formatMetric(m)}`)
    .join("  ·  ");
  console.log(`${pod.label}\n    ${cells}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll scorecard checks passed.");

function metric(
  row: { metrics: { key: string; value: number | null }[] },
  key: ScorecardMetricKey,
): number | null {
  return row.metrics.find((m) => m.key === key)?.value ?? null;
}

/** Compare against rendered markup, where quotes and dashes arrive escaped. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
