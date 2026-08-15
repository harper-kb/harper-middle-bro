/**
 * Retention ledger harness: signal derivation, difficulty pricing, commission
 * valuation, owner-of-record invariants, and the SQLite round trip.
 * Run: npx tsx scripts/retention-ledger-check.ts
 */
import Database from "better-sqlite3";
import {
  deriveLedger,
  windowKey,
  type CarrierNotice,
  type LifecycleSignal,
} from "../src/lib/retention/signals";
import { assessDifficulty } from "../src/lib/retention/difficulty";
import {
  BLENDED_COMMISSION_BPS,
  commissionRateFor,
  retainedCommissionForRewrite,
  valueAtRisk,
} from "../src/lib/retention/commission";
import {
  checkOwnershipInvariants,
  ownerAt,
  orphanSeverity,
  sortOrphans,
  type OwnerAssignment,
  type OwnerOrphan,
} from "../src/lib/retention/ownership";
import {
  assignOwner,
  auditOwnership,
  getCurrentOwner,
  listOwnerHistory,
} from "../src/lib/retention/ownership-store";
import {
  listAtRiskWindows,
  listRetentionEvents,
  migrateRetentionTables,
  setWindowValuation,
  syncDerivedLedger,
} from "../src/lib/retention/store";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

// ——— Derivation ———

const signals: LifecycleSignal[] = [
  {
    id: "sig-1",
    kind: "cancellation.notice",
    companyId: "acct-meridian",
    policyId: "pol-1",
    occurredAt: "2026-07-01T12:00:00.000Z",
    detail: "non-payment of premium",
    effectiveAt: "2026-07-21T00:00:00.000Z",
    billMode: "agency_bill",
  },
  {
    id: "sig-2",
    kind: "relay.insurance.cancellation.received",
    companyId: "acct-meridian",
    policyId: "pol-1",
    occurredAt: "2026-07-01T12:00:00.000Z",
    detail: "non-payment of premium",
  },
  {
    id: "sig-3",
    kind: "policy.reinstated",
    companyId: "acct-meridian",
    policyId: "pol-1",
    occurredAt: "2026-07-09T09:00:00.000Z",
  },
  {
    id: "sig-4",
    kind: "billing.payment.failed",
    companyId: "acct-orphan",
    policyId: "pol-9",
    occurredAt: "2026-07-02T08:00:00.000Z",
    detail: "card declined",
    effectiveAt: "2026-07-05T00:00:00.000Z",
    billMode: "direct_bill",
  },
  {
    id: "sig-5",
    kind: "policy.reinstated",
    companyId: "acct-never-at-risk",
    policyId: "pol-x",
    occurredAt: "2026-07-03T08:00:00.000Z",
  },
];

const notices: CarrierNotice[] = [
  {
    id: "notice-1",
    companyId: "acct-bor",
    policyId: "pol-3",
    kind: "non_renewal",
    noticeAt: "2026-07-04T10:00:00.000Z",
    effectiveAt: "2026-09-01T00:00:00.000Z",
    reasonText: "underwriting appetite change",
  },
];

const derived = deriveLedger({
  signals,
  notices,
  now: new Date("2026-08-01T00:00:00.000Z"),
});

check(
  "cancellation notice and its relay collapse into one window",
  derived.windows.filter((w) => w.accountId === "acct-meridian").length === 1,
  derived.windows.map((w) => w.id),
);

const meridian = derived.windows.find((w) => w.accountId === "acct-meridian")!;
check("reinstatement closes the window saved", meridian.outcome === "saved", meridian);
check(
  "cancel reason classified from signal text",
  meridian.reason === "non_pay",
  meridian.reason,
);
check(
  "window lands in the pending cancels lane",
  meridian.lane === "pending_cancels",
  meridian.lane,
);

const orphanWindow = derived.windows.find((w) => w.accountId === "acct-orphan")!;
check(
  "window past carrier effective date with no close expires",
  orphanWindow.outcome === "expired",
  orphanWindow,
);
check(
  "non-renewal notice opens a post-sales window",
  derived.windows.find((w) => w.accountId === "acct-bor")?.lane === "post_sales",
);
check(
  "close with no matching open window is reported, not swallowed",
  derived.unmatchedCloses.length === 1 &&
    derived.unmatchedCloses[0]!.companyId === "acct-never-at-risk",
  derived.unmatchedCloses,
);

const rederived = deriveLedger({
  signals,
  notices,
  now: new Date("2026-08-01T00:00:00.000Z"),
});
check(
  "derivation is stable across runs",
  JSON.stringify(rederived.windows) === JSON.stringify(derived.windows),
);
check(
  "window key is derived from account, policy, trigger and day",
  windowKey("a", "p", "cancellation_notice", "2026-07-01T12:00:00.000Z") ===
    "arw:a:p:cancellation_notice:2026-07-01",
);

// ——— Difficulty ———

const easy = assessDifficulty({
  reason: "non_pay",
  billMode: "direct_bill",
  daysElapsed: 1,
});
const brutal = assessDifficulty({
  reason: "non_pay",
  billMode: "agency_bill",
  daysElapsed: 22,
});
check(
  "day-one direct bill cure prices as routine",
  easy.tier === "routine" && easy.multiplier === 1,
  easy,
);
check(
  "day-twenty agency bill recovery prices as a long shot",
  brutal.tier === "long_shot" && brutal.multiplier === 4,
  brutal,
);
check(
  "direct bill recovers about half the time when caught early",
  Math.abs(easy.recoveryOdds - 0.5) < 0.02,
  easy.recoveryOdds,
);
check(
  "difficulty is repriced at close, not left at open",
  meridian.difficultyTier === "standard",
  meridian.difficultyTier,
);

// ——— Commission ———

const full = valueAtRisk({
  premiumCents: 1_000_000,
  carrier: null,
  openedAt: "2026-07-01T00:00:00.000Z",
});
check(
  "unknown carrier values at the blended book rate",
  full?.commissionAtRiskCents === 165_000 &&
    full.rateSource === "blended" &&
    full.commissionRateBps === BLENDED_COMMISSION_BPS,
  full,
);
check(
  "confirmed carrier rate beats the blended default",
  commissionRateFor("Coterie").bps === 1500 &&
    commissionRateFor("Coterie").source === "carrier",
);

const prorated = valueAtRisk({
  premiumCents: 1_000_000,
  carrier: "Coterie",
  effectiveDate: "2026-01-01T00:00:00.000Z",
  expirationDate: "2027-01-01T00:00:00.000Z",
  openedAt: "2026-10-01T00:00:00.000Z",
});
check(
  "value prorates to the unearned share of the term",
  prorated != null && Math.abs(prorated.remainingShare - 0.252) < 0.01,
  prorated,
);
check(
  "a rewrite onto worse paper pays on the delta, not the full save",
  retainedCommissionForRewrite(200_000, 120_000) === 120_000 &&
    retainedCommissionForRewrite(200_000, 0) === 0,
);
check(
  "a window with no premium cannot be valued",
  valueAtRisk({ premiumCents: null, carrier: null, openedAt: "2026-07-01T00:00:00.000Z" }) ===
    null,
);

// ——— Ownership ———

const assignments: OwnerAssignment[] = [
  {
    id: "own-1",
    accountId: "acct-meridian",
    ownerAgentId: "agent-dana",
    ownerDisplayName: "Dana Reyes",
    assignedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-06-01T00:00:00.000Z",
    reason: "initial_assignment",
    assignedBy: null,
    note: null,
  },
  {
    id: "own-2",
    accountId: "acct-meridian",
    ownerAgentId: "agent-kai",
    ownerDisplayName: "Kai Bloom",
    assignedAt: "2026-06-01T00:00:00.000Z",
    endedAt: null,
    reason: "pod_rebalance",
    assignedBy: "mgr-1",
    note: null,
  },
  {
    id: "own-3",
    accountId: "acct-orphan",
    ownerAgentId: null,
    ownerDisplayName: null,
    assignedAt: "2026-02-01T00:00:00.000Z",
    endedAt: null,
    reason: "initial_assignment",
    assignedBy: "backfill:service_owner",
    note: "service_owner was null at backfill — recorded orphan",
  },
];

const violations = checkOwnershipInvariants(assignments);
check(
  "an account with a null owner is reported as orphaned",
  violations.some((v) => v.accountId === "acct-orphan" && v.code === "orphaned"),
  violations,
);
check(
  "clean history raises no violation",
  !violations.some((v) => v.accountId === "acct-meridian"),
  violations,
);
check(
  "owner as of a date reads history, not current state",
  ownerAt(assignments, "acct-meridian", "2026-03-01T00:00:00.000Z")?.ownerAgentId ===
    "agent-dana" &&
    ownerAt(assignments, "acct-meridian", "2026-07-01T00:00:00.000Z")?.ownerAgentId ===
      "agent-kai",
);

const overlapping = checkOwnershipInvariants([
  { ...assignments[0]!, endedAt: "2026-07-01T00:00:00.000Z" },
  assignments[1]!,
]);
check(
  "overlapping assignments are caught",
  overlapping.some((v) => v.code === "overlapping_history"),
  overlapping,
);

const orphans: OwnerOrphan[] = [
  {
    accountId: "quiet",
    accountName: "Quiet Co",
    openAtRiskWindows: 0,
    repeatContacts: 1,
    producerAgentId: "agent-sales",
    reason: "never_assigned",
  },
  {
    accountId: "burning",
    accountName: "Burning Co",
    openAtRiskWindows: 2,
    repeatContacts: 38,
    producerAgentId: "agent-sales",
    reason: "never_assigned",
  },
  {
    accountId: "loud",
    accountName: "Loud Co",
    openAtRiskWindows: 0,
    repeatContacts: 12,
    producerAgentId: null,
    reason: "owner_departed",
  },
];
check(
  "orphan repair queue leads with live risk, then frustration",
  sortOrphans(orphans).map((o) => o.accountId).join(",") === "burning,loud,quiet",
  sortOrphans(orphans).map((o) => o.accountId),
);
check(
  "an orphan with an open at-risk window is critical",
  orphanSeverity(orphans[1]!) === "critical" && orphanSeverity(orphans[0]!) === "normal",
);

// ——— Store round trip ———

const db = new Database(":memory:");
migrateRetentionTables(db);
const first = syncDerivedLedger(db, derived);
const second = syncDerivedLedger(db, derived);
check(
  "re-syncing the same ledger does not duplicate windows",
  listAtRiskWindows(db).length === derived.windows.length &&
    first.windowsWritten === second.windowsWritten,
  { stored: listAtRiskWindows(db).length, derived: derived.windows.length },
);
check(
  "re-syncing the same ledger does not duplicate events",
  listRetentionEvents(db).length === derived.events.length,
  { stored: listRetentionEvents(db).length, derived: derived.events.length },
);

setWindowValuation(db, meridian.id, {
  premiumCents: 1_000_000,
  commissionRateBps: 1650,
  commissionAtRiskCents: 165_000,
});
const stored = listAtRiskWindows(db, { accountId: "acct-meridian" })[0]!;
check(
  "valuation survives a re-sync of the derived ledger",
  (syncDerivedLedger(db, derived),
  listAtRiskWindows(db, { accountId: "acct-meridian" })[0]!.commissionAtRiskCents ===
    165_000),
  stored,
);
check(
  "saved outcome is not reverted to open by a later derivation",
  listAtRiskWindows(db, { accountId: "acct-meridian" })[0]!.outcome === "saved",
);
check(
  "filtering by outcome works",
  listAtRiskWindows(db, { outcome: "saved" }).every((w) => w.outcome === "saved"),
);

assignOwner(db, {
  accountId: "acct-meridian",
  ownerAgentId: "agent-dana",
  ownerDisplayName: "Dana Reyes",
  reason: "initial_assignment",
  at: "2026-01-01T00:00:00.000Z",
});
assignOwner(db, {
  accountId: "acct-meridian",
  ownerAgentId: "agent-kai",
  ownerDisplayName: "Kai Bloom",
  reason: "pod_rebalance",
  assignedBy: "mgr-1",
  at: "2026-06-01T00:00:00.000Z",
});
check(
  "reassignment closes the prior row and opens exactly one current row",
  getCurrentOwner(db, "acct-meridian")?.ownerAgentId === "agent-kai" &&
    listOwnerHistory(db, "acct-meridian").filter((a) => a.endedAt == null).length === 1,
  listOwnerHistory(db, "acct-meridian"),
);
check(
  "reassignment history is preserved, not overwritten",
  listOwnerHistory(db, "acct-meridian").length === 2,
);
check("stored ownership passes the invariant audit", auditOwnership(db).length === 0, auditOwnership(db));

assignOwner(db, {
  accountId: "acct-meridian",
  ownerAgentId: null,
  ownerDisplayName: null,
  reason: "departure",
  at: "2026-07-01T00:00:00.000Z",
});
check(
  "an owner departing leaves a recorded orphan the audit can see",
  auditOwnership(db).some(
    (v) => v.accountId === "acct-meridian" && v.code === "orphaned",
  ),
  auditOwnership(db),
);
db.close();

console.log("---");
if (failures > 0) {
  console.error(`${failures} retention-ledger check(s) FAILED.`);
  process.exit(1);
}
console.log("All retention-ledger checks passed.");
