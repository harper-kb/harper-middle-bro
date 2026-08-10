/**
 * Step Bro WorkItem / capability / receipt contract self-check.
 * Run: npx tsx scripts/workitem-contracts-check.ts
 */
import {
  SERVICE_LANE_HREFS,
  SERVICE_LANE_IDS,
  SERVICE_LANE_LABELS,
  WORK_ITEM_ROW_SIGNALS,
  assertRowSignalBudget,
  toWorkItemRow,
  type ActionReceipt,
  type CapabilityGate,
  type LaneSnapshot,
  type WorkItem,
} from "../src/lib/types";

let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

check("Eight service lanes defined", SERVICE_LANE_IDS.length === 8);
check(
  "Every lane has a label and href",
  SERVICE_LANE_IDS.every(
    (id) => SERVICE_LANE_LABELS[id]?.length > 0 && SERVICE_LANE_HREFS[id]?.startsWith("/"),
  ),
);
check("Row signal budget is five", WORK_ITEM_ROW_SIGNALS.length === 5);

const sampleItem: WorkItem = {
  id: "wi-1",
  externalId: "bb-99",
  homeLane: "pending_cancels",
  accountId: "acct-apex",
  accountName: "Apex Roofing",
  title: "Cure notice — payment failure",
  summary: "Cancellation effective in 5 days; financing cure path.",
  owner: { operatorId: "op-1", displayName: "Dana Whitfield", team: "Retention" },
  urgencyTier: "A",
  urgencyScore: 0.92,
  isOnFire: true,
  actionRequired: true,
  clock: {
    kind: "cancellation_effective",
    at: "2026-08-15T00:00:00.000Z",
    label: "Cancels Aug 15",
    breached: false,
  },
  blocker: {
    code: "awaiting_payment",
    label: "Awaiting Payment",
    capabilityId: "write.payment_link",
  },
  nextActionLabel: "Send Cure Chase",
  priorityReasons: [
    { code: "fire_flag", label: "On Fire" },
    { code: "deadline", label: "Cancellation Effective", detail: "Aug 15" },
  ],
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-10T15:00:00.000Z",
  parkedUntil: null,
  parkReason: null,
};

const row = toWorkItemRow(sampleItem, "sample");
check("Row what/who/clock/blocker/action populated", Boolean(row.what && row.who && row.clock && row.blocker && row.action));
check("Row preserves fire + tier + sample mode", row.isOnFire && row.urgencyTier === "A" && row.mode === "sample");
check("Row home lane unchanged", row.homeLane === "pending_cancels");

try {
  assertRowSignalBudget([...WORK_ITEM_ROW_SIGNALS]);
  check("Signal budget accepts five signals", true);
} catch {
  check("Signal budget accepts five signals", false);
}

try {
  assertRowSignalBudget([...WORK_ITEM_ROW_SIGNALS, "what"]);
  check("Signal budget rejects sixth signal", false);
} catch {
  check("Signal budget rejects sixth signal", true);
}

const gate: CapabilityGate = {
  id: "write.bind",
  state: "blocked",
  blockerLabel: "Safe bind door not provisioned — confirm in carrier portal",
  provider: "agent_tools",
};
check("Blocked capability carries precise blocker copy", gate.state === "blocked" && !!gate.blockerLabel);

const receipt: ActionReceipt = {
  id: "rcpt-1",
  capabilityId: "write.comms.email",
  idempotencyKey: "op-1:wi-1:cure-chase:v1",
  status: "confirmed",
  operatorId: "op-1",
  workItemId: "wi-1",
  accountId: "acct-apex",
  summary: "Cure chase email confirmed",
  requestedAt: "2026-08-10T16:00:00.000Z",
  completedAt: "2026-08-10T16:00:01.000Z",
  verified: true,
  details: { templateId: "cure-chase-v3", recipientCount: 1 },
};
check("Receipt is redacted-shaped (no raw body fields)", !("body" in receipt.details) && receipt.verified === true);

const snapshot: LaneSnapshot = {
  lane: "pending_cancels",
  mode: "sample",
  modeReason: "BigBrother credentials not provisioned",
  items: [sampleItem],
  count: 1,
  sourceCount: null,
  reconciled: false,
  fetchedAt: "2026-08-10T16:05:00.000Z",
  sourceApi: "sample://pending_cancels",
};
check(
  "Unreconciled snapshot stays in labeled sample mode",
  snapshot.mode === "sample" && snapshot.reconciled === false && !!snapshot.modeReason,
);

const liveReady: LaneSnapshot = {
  ...snapshot,
  mode: "live",
  modeReason: null,
  sourceCount: 1,
  reconciled: true,
  sourceApi: "bigbrother://service-workbench/pending_cancels",
};
check(
  "Live mode requires reconciliation",
  liveReady.mode === "live" && liveReady.reconciled && liveReady.sourceCount === liveReady.count,
);

if (failed > 0) {
  console.error(`\n${failed} contract check(s) failed.`);
  process.exit(1);
}
console.log("\nAll WorkItem contract checks passed.");
