/**
 * Shadow-period harness: publish, dispute, settle, reconcile, attach.
 * Runs the whole ritual against a throwaway SQLite database.
 * Run: npx tsx scripts/shadow-period-check.ts
 */
import Database from "better-sqlite3";
import {
  getPublishedBoard,
  listDisputes,
  migratePeriodTables,
  publishPeriod,
  raiseDispute,
  reconcilePeriod,
  markPeriodAttached,
  settleDispute,
  upsertPeriod,
} from "../src/lib/retention/period-store";
import { currentPeriod, payoutFor } from "../src/lib/retention/period";
import type { PersonScorecard, PodScorecard } from "../src/lib/retention/scorecard";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

function expectThrow(label: string, fn: () => unknown, match?: string) {
  try {
    fn();
    check(label, false, "did not throw");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, match ? message.includes(match) : true, message);
  }
}

const db = new Database(":memory:");
migratePeriodTables(db);

const NOW = new Date("2026-08-15T07:00:00.000Z");
const AFTER = new Date("2026-09-02T00:00:00.000Z");
const period = currentPeriod(5_000_000, NOW);

function board(source: "sample" | "live"): {
  pods: PodScorecard[];
  people: PersonScorecard[];
} {
  const pods: PodScorecard[] = [
    {
      podId: "cancellations_payments",
      label: "Cancellations And Payments",
      verbLabel: "Money Kept",
      headlineMetric: "Retained Commission",
      atRiskWindows: 3,
      saves: 2,
      uncreditedSaves: 0,
      poolWeight: 0.4,
      metrics: [
        {
          key: "retained_commission",
          label: "Retained Commission",
          value: 970_500,
          unit: "cents",
          source,
          lowerIsBetter: false,
          note: null,
        },
      ],
    },
  ];
  const people: PersonScorecard[] = [
    {
      agentId: "svc-kai",
      displayName: "Kai Bloom",
      email: "kai@harperinsure.com",
      podId: "cancellations_payments",
      podLabel: "Cancellations And Payments",
      metrics: [],
      ownedAccounts: 1,
      decisiveActions: 1,
      savesContributed: 1,
      ownerFloorOnly: 0,
      retainedCommissionCents: 400_000,
    },
  ];
  return { pods, people };
}

// ——— Nothing to dispute before anything is published ———

upsertPeriod(db, period);
expectThrow(
  "a dispute cannot be raised against an unpublished period",
  () =>
    raiseDispute(db, {
      periodId: period.id,
      subject: "pod",
      subjectId: "cancellations_payments",
      raisedBy: "svc-kai",
      claim: "Too early",
    }),
  "has not been published",
);

const preReconcile = reconcilePeriod(db, period.id, NOW);
check(
  "an unpublished period is not ready and says so",
  !preReconcile.readiness.ready &&
    preReconcile.readiness.blockers.some((b) => b.includes("never published")),
  preReconcile.readiness.blockers,
);

// ——— Publish freezes the board ———

const published = publishPeriod(db, period, board("sample"), "2026-09-01T00:00:00.000Z");
check("publishing stamps the period", published.publishedAt === "2026-09-01T00:00:00.000Z");

const frozen = getPublishedBoard(db, period.id);
check(
  "the published board is stored, not recomputed",
  frozen?.pods[0]?.metrics[0]?.value === 970_500 && frozen.people[0]?.displayName === "Kai Bloom",
  frozen?.pods[0]?.metrics[0],
);

// Republishing before anyone objects is fine — the board is still moving.
const republished = publishPeriod(db, period, board("sample"), "2026-09-01T06:00:00.000Z");
check(
  "republishing is allowed while nothing has been disputed",
  republished.publishedAt === "2026-09-01T06:00:00.000Z",
);

// ——— Dispute ———

const dispute = raiseDispute(db, {
  periodId: period.id,
  subject: "metric",
  subjectId: "retained_commission",
  raisedBy: "svc-dana",
  claim: "The Arbor cure was mine, not Kai's — the payment link event names me",
  raisedAt: "2026-09-01T12:00:00.000Z",
});
check("a dispute opens open", dispute.state === "open");

expectThrow(
  "republishing over a live dispute is refused",
  () => publishPeriod(db, period, board("live"), "2026-09-01T18:00:00.000Z"),
  "settle them rather than republishing",
);

const withOpen = reconcilePeriod(db, period.id, AFTER);
check(
  "an open dispute blocks pay",
  !withOpen.readiness.ready &&
    withOpen.unsettled.length === 1 &&
    withOpen.readiness.blockers.some((b) => b.includes("dispute")),
  withOpen.readiness.blockers,
);

expectThrow(
  "a dispute cannot be closed without a reason",
  () =>
    settleDispute(db, {
      disputeId: dispute.id,
      state: "rejected",
      resolvedBy: "mgr-1",
      resolutionNote: "   ",
    }),
  "without a resolution note",
);

const settled = settleDispute(db, {
  disputeId: dispute.id,
  state: "upheld",
  resolvedBy: "mgr-1",
  resolutionNote: "Timeline confirms Dana executed the cure; attribution recomputed",
  correctionApplied: true,
  resolvedAt: "2026-09-02T09:00:00.000Z",
});
check("settling records who, when, and why", settled.state === "upheld" && settled.correctionApplied);

expectThrow(
  "a settled dispute cannot be re-settled",
  () =>
    settleDispute(db, {
      disputeId: dispute.id,
      state: "rejected",
      resolvedBy: "mgr-2",
      resolutionNote: "Changed my mind",
    }),
  "already upheld",
);

// ——— Sample data still blocks pay ———

const stillSample = reconcilePeriod(db, period.id, AFTER);
check(
  "settled disputes are not enough while the board reads sample",
  !stillSample.readiness.ready &&
    stillSample.readiness.blockers.some((b) => b.includes("sample-labeled")) &&
    stillSample.readiness.disputesUpheld === 1 &&
    stillSample.readiness.correctionsApplied === 1,
  stillSample.readiness,
);

expectThrow(
  "attaching pay against a blocked period is refused",
  () => {
    const r = reconcilePeriod(db, period.id, AFTER);
    if (!r.readiness.ready) throw new Error(`Cannot attach pay: ${r.readiness.blockers[0]}`);
    markPeriodAttached(db, period.id, "mgr-1");
  },
  "Cannot attach pay",
);

// ——— A live board, settled disputes, and a finished period ———

const liveDb = new Database(":memory:");
migratePeriodTables(liveDb);
upsertPeriod(liveDb, period);
publishPeriod(liveDb, period, board("live"), "2026-09-01T00:00:00.000Z");
const ready = reconcilePeriod(liveDb, period.id, AFTER);
check("a live, published, undisputed, finished period is ready", ready.readiness.ready, ready.readiness.blockers);

markPeriodAttached(liveDb, period.id, "mgr-1");
const attached = reconcilePeriod(liveDb, period.id, AFTER);
check("attaching flips the period state", attached.period.state === "attached");
check(
  "money becomes payable only after the flip",
  payoutFor(attached.period, "cancellations_payments").payableCents === 2_000_000 &&
    payoutFor(period, "cancellations_payments").payableCents === 0,
);

check(
  "the dispute log survives as the record of what was argued",
  listDisputes(db, period.id).length === 1 &&
    listDisputes(db, period.id, "open").length === 0,
);

db.close();
liveDb.close();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll shadow-period checks passed.");
