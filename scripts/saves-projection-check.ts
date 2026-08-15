/**
 * Saves projection harness: decisive-action filtering, weighted attribution,
 * the owner floor, the anti-gaming gates, and pool allocation.
 * Run: npx tsx scripts/saves-projection-check.ts
 */
import {
  allocatePool,
  projectSaves,
  PER_ACCOUNT_POOL_CAP_SHARE,
  SELF_INFLICTED_PENALTY,
  type SavesProjectionInput,
} from "../src/lib/retention/saves";
import { resolveActor, type InternalAgent } from "../src/lib/retention/agents";
import {
  assertPoolWeightsSumToOne,
  podForLane,
  poolCentsForPod,
} from "../src/lib/retention/pods";
import { OWNER_FLOOR_SHARE, type AtRiskWindow, type RetentionEvent } from "../src/lib/retention/types";
import type { OwnerAssignment } from "../src/lib/retention/ownership";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

const directory: InternalAgent[] = [
  { id: "agent-kai", displayName: "Kai Bloom", email: "kai@harperinsure.com", kind: "human", podId: "cancellations_payments" },
  { id: "agent-dana", displayName: "Dana Reyes", email: "dana@harperinsure.com", kind: "human", podId: "cancellations_payments" },
  { id: "agent-sam", displayName: "Sam Ortiz", email: "sam@harperinsure.com", kind: "human", podId: "coi" },
  { id: "spine-agent-prod", displayName: "Spine Agent", email: null, kind: "agent", podId: null },
];

function windowFixture(over: Partial<AtRiskWindow> = {}): AtRiskWindow {
  return {
    id: "w-1",
    accountId: "acct-1",
    policyId: "pol-1",
    issueId: "iss-1",
    lane: "pending_cancels",
    trigger: "cancellation_notice",
    reason: "non_pay",
    billMode: "agency_bill",
    openedAt: "2026-07-01T00:00:00.000Z",
    effectiveAt: "2026-07-21T00:00:00.000Z",
    closedAt: "2026-07-06T00:00:00.000Z",
    outcome: "saved",
    outcomeNote: null,
    premiumCents: 1_000_000,
    commissionRateBps: 1650,
    commissionAtRiskCents: 165_000,
    replacementCommissionCents: null,
    difficultyTier: "standard",
    ownerAgentId: "agent-kai",
    sourceKind: "lifecycle_signal",
    sourceRef: "sig-1",
    ...over,
  };
}

function event(over: Partial<RetentionEvent> & { id: string }): RetentionEvent {
  return {
    windowId: "w-1",
    kind: "outbound_contact_answered",
    occurredAt: "2026-07-02T00:00:00.000Z",
    actor: "kai@harperinsure.com",
    actorKind: "human",
    actorAgentId: "agent-kai",
    detail: "",
    evidenceRef: "msg-1",
    ...over,
  };
}

const baseInput = (over: Partial<SavesProjectionInput> = {}): SavesProjectionInput => ({
  windows: [windowFixture()],
  events: [],
  assignments: [],
  directory,
  ...over,
});

// ——— Actor resolution ———

check(
  "spine automation resolves as an agent, never a payable human",
  resolveActor("spine-agent-prod", directory).kind === "agent" &&
    resolveActor("spine-agent-prod", directory).agentId === null,
);
check(
  "a known human resolves through the directory by email",
  resolveActor("kai@harperinsure.com", directory).agentId === "agent-kai",
);
check(
  "an unrecognized actor is not credited to a guessed person",
  resolveActor("someone@nowhere.test", directory).agentId === null,
);

// ——— Decisive-action filtering ———

const commentsOnly = projectSaves(
  baseInput({
    events: [
      event({ id: "e1", kind: "comment" }),
      event({ id: "e2", kind: "status_change" }),
      event({ id: "e3", kind: "assignment_change" }),
      event({ id: "e4", kind: "outbound_contact_no_reply" }),
    ],
  }),
);
check(
  "comments, status flips and unanswered outbounds earn nothing",
  commentsOnly.credits.length === 0 &&
    commentsOnly.skipped[0]!.reason === "no_decisive_action",
  commentsOnly.skipped,
);

const automationOnly = projectSaves(
  baseInput({
    events: [
      event({
        id: "e1",
        kind: "payment_link_paid",
        actor: "spine-agent-prod",
        actorKind: "agent",
        actorAgentId: null,
      }),
    ],
  }),
);
check(
  "a save executed entirely by automation credits nobody but is counted",
  automationOnly.credits.length === 0 &&
    automationOnly.uncreditedSaves === 1 &&
    automationOnly.skipped[0]!.reason === "no_human_actor",
  automationOnly.skipped,
);

const noEvidence = projectSaves(
  baseInput({
    events: [event({ id: "e1", kind: "payment_link_paid", evidenceRef: null })],
  }),
);
check(
  "a decisive action with no evidence in the ledger is unpaid",
  noEvidence.credits.length === 0 && noEvidence.skipped[0]!.reason === "no_evidence",
  noEvidence.skipped,
);

// ——— Weighted split ———

const split = projectSaves(
  baseInput({
    windows: [windowFixture({ ownerAgentId: null })],
    events: [
      event({ id: "e1", kind: "payment_link_paid", actorAgentId: "agent-kai" }),
      event({
        id: "e2",
        kind: "outbound_contact_answered",
        actor: "dana@harperinsure.com",
        actorAgentId: "agent-dana",
        evidenceRef: "msg-2",
      }),
    ],
  }),
);
const splitCredit = split.credits[0]!;
check(
  "credit splits by decisive-action weight, not by touch count",
  Math.abs(splitCredit.attributions.find((a) => a.agentId === "agent-kai")!.share - 0.75) <
    0.001 &&
    Math.abs(
      splitCredit.attributions.find((a) => a.agentId === "agent-dana")!.share - 0.25,
    ) < 0.001,
  splitCredit.attributions,
);
check(
  "shares always sum to one",
  Math.abs(splitCredit.attributions.reduce((n, a) => n + a.share, 0) - 1) < 0.0001,
);
check(
  "retained commission is reported unscaled by difficulty",
  splitCredit.retainedCommissionCents === 165_000,
  splitCredit,
);
check(
  "credit units scale retained commission by the difficulty multiplier",
  splitCredit.creditUnits ===
    Math.round(165_000 * splitCredit.difficultyMultiplier),
  splitCredit,
);
check(
  "time to first decisive action is measured from window open",
  splitCredit.hoursToFirstDecisiveAction === 24,
  splitCredit.hoursToFirstDecisiveAction,
);
check(
  "the window's lane resolves to its pod",
  splitCredit.podId === "cancellations_payments" && podForLane("communications") === null,
);

// ——— Owner floor ———

const ownerActedSmall = projectSaves(
  baseInput({
    events: [
      event({
        id: "e1",
        kind: "payment_link_paid",
        actor: "dana@harperinsure.com",
        actorAgentId: "agent-dana",
        evidenceRef: "msg-2",
      }),
      event({
        id: "e2",
        kind: "bor_returned",
        actor: "dana@harperinsure.com",
        actorAgentId: "agent-dana",
        evidenceRef: "msg-3",
      }),
      event({ id: "e3", kind: "outbound_contact_answered", actorAgentId: "agent-kai" }),
    ],
  }),
);
const ownerRow = ownerActedSmall.credits[0]!.attributions.find(
  (a) => a.agentId === "agent-kai",
)!;
check(
  "the owner is lifted to the floor when their earned share is smaller",
  Math.abs(ownerRow.share - OWNER_FLOOR_SHARE) < 0.0001 && ownerRow.viaOwnerFloor,
  ownerActedSmall.credits[0]!.attributions,
);
check(
  "the executor keeps the remainder after the floor",
  Math.abs(
    ownerActedSmall.credits[0]!.attributions.find((a) => a.agentId === "agent-dana")!
      .share - 0.75,
  ) < 0.0001,
);
check(
  "an owner who already earned more than the floor is not lifted to it",
  !split.credits[0]!.attributions.some((a) => a.viaOwnerFloor),
  split.credits[0]!.attributions,
);

const ownerAbsent = projectSaves(
  baseInput({
    events: [
      event({
        id: "e1",
        kind: "payment_link_paid",
        actor: "dana@harperinsure.com",
        actorAgentId: "agent-dana",
        evidenceRef: "msg-2",
      }),
    ],
  }),
);
check(
  "an owner who neither acted nor handed off forfeits the floor",
  ownerAbsent.credits[0]!.gates.includes("owner_floor_waived") &&
    !ownerAbsent.credits[0]!.attributions.some((a) => a.agentId === "agent-kai"),
  ownerAbsent.credits[0],
);

const handoff: OwnerAssignment[] = [
  {
    id: "own-h",
    accountId: "acct-1",
    ownerAgentId: "agent-kai",
    ownerDisplayName: "Kai Bloom",
    assignedAt: "2026-07-03T00:00:00.000Z",
    endedAt: null,
    reason: "coverage_handoff",
    assignedBy: "mgr-1",
    note: "PTO cover",
  },
];
const ownerHandedOff = projectSaves(
  baseInput({
    assignments: handoff,
    events: [
      event({
        id: "e1",
        kind: "payment_link_paid",
        actor: "dana@harperinsure.com",
        actorAgentId: "agent-dana",
        evidenceRef: "msg-2",
      }),
    ],
  }),
);
check(
  "a recorded coverage handoff preserves the owner floor",
  ownerHandedOff.credits[0]!.attributions.some(
    (a) => a.agentId === "agent-kai" && Math.abs(a.share - OWNER_FLOOR_SHARE) < 0.0001,
  ),
  ownerHandedOff.credits[0]!.attributions,
);

// ——— Anti-gaming gates ———

const repeat = projectSaves(
  baseInput({
    events: [event({ id: "e1", kind: "payment_link_paid" })],
    priorSaves: [
      { accountId: "acct-1", policyId: "pol-1", savedAt: "2026-05-20T00:00:00.000Z" },
    ],
  }),
);
check(
  "the same policy cannot be saved twice inside the lockout",
  repeat.credits.length === 0 && repeat.skipped[0]!.reason === "repeat_save_lockout",
  repeat.skipped,
);

const oldSave = projectSaves(
  baseInput({
    events: [event({ id: "e1", kind: "payment_link_paid" })],
    priorSaves: [
      { accountId: "acct-1", policyId: "pol-1", savedAt: "2025-01-01T00:00:00.000Z" },
    ],
  }),
);
check("a save outside the lockout still pays", oldSave.credits.length === 1);

const clean = projectSaves(
  baseInput({ events: [event({ id: "e1", kind: "payment_link_paid" })] }),
);
const selfInflicted = projectSaves(
  baseInput({
    events: [event({ id: "e1", kind: "payment_link_paid" })],
    ownBookBreaches: [
      {
        accountId: "acct-1",
        agentId: "agent-kai",
        breachedAt: "2026-06-20T00:00:00.000Z",
      },
    ],
  }),
);
check(
  "rescuing an account you dropped halves the save",
  selfInflicted.credits[0]!.gates.includes("self_inflicted") &&
    selfInflicted.credits[0]!.difficultyMultiplier ===
      Math.round(clean.credits[0]!.difficultyMultiplier * SELF_INFLICTED_PENALTY * 100) /
        100,
  {
    clean: clean.credits[0]!.difficultyMultiplier,
    penalized: selfInflicted.credits[0]!.difficultyMultiplier,
  },
);
check(
  "a breach on someone else's book does not penalize this save",
  !projectSaves(
    baseInput({
      events: [event({ id: "e1", kind: "payment_link_paid" })],
      ownBookBreaches: [
        {
          accountId: "acct-other",
          agentId: "agent-kai",
          breachedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
    }),
  ).credits[0]!.gates.includes("self_inflicted"),
);

const rewrite = projectSaves(
  baseInput({
    windows: [
      windowFixture({ outcome: "rewritten", replacementCommissionCents: 90_000 }),
    ],
    events: [event({ id: "e1", kind: "rewrite_bound" })],
  }),
);
check(
  "a rewrite pays on retained commission delta, not the full save",
  rewrite.credits[0]!.retainedCommissionCents === 90_000 &&
    rewrite.credits[0]!.gates.includes("rewrite_delta"),
  rewrite.credits[0],
);

const unvalued = projectSaves(
  baseInput({
    windows: [windowFixture({ commissionAtRiskCents: null })],
    events: [event({ id: "e1", kind: "payment_link_paid" })],
  }),
);
check(
  "an unvalued window cannot be credited",
  unvalued.credits.length === 0 && unvalued.skipped[0]!.reason === "unvalued",
);

const lost = projectSaves(
  baseInput({
    windows: [windowFixture({ outcome: "lost" })],
    events: [event({ id: "e1", kind: "payment_link_paid" })],
  }),
);
check("a lost window is not a save", lost.credits.length === 0);

// ——— Pool allocation ———

assertPoolWeightsSumToOne();
check(
  "pod pool weights sum to one and the cancellations desk carries the largest",
  poolCentsForPod("cancellations_payments", 1_000_000) === 400_000 &&
    poolCentsForPod("policy_delivery", 1_000_000) === 30_000,
);

const manyCredits = [
  ...clean.credits,
  ...projectSaves(
    baseInput({
      windows: [
        windowFixture({
          id: "w-2",
          accountId: "acct-2",
          policyId: "pol-2",
          ownerAgentId: "agent-sam",
        }),
      ],
      events: [
        event({
          id: "e9",
          windowId: "w-2",
          kind: "payment_link_paid",
          actor: "sam@harperinsure.com",
          actorAgentId: "agent-sam",
          evidenceRef: "msg-9",
        }),
      ],
    }),
  ).credits,
];
const pool = allocatePool(manyCredits, 500_000, "cancellations_payments");
check(
  "the pool is fully allocated across contributing agents",
  Math.abs(pool.allocations.reduce((n, a) => n + a.payoutCents, 0) - 500_000) <= 2,
  pool,
);

const lopsided = allocatePool(
  [
    { ...clean.credits[0]!, creditUnits: 1_000_000 },
    { ...manyCredits[1]!, creditUnits: 1_000 },
  ],
  500_000,
);
const dominantShare =
  lopsided.allocations.find((a) => a.agentId === "agent-kai")!.payoutCents / 500_000;
check(
  "no single account can consume the pod's period pool",
  dominantShare < 0.9 && lopsided.cappedUnits > 0,
  { dominantShare, cappedUnits: lopsided.cappedUnits, cap: PER_ACCOUNT_POOL_CAP_SHARE },
);
check(
  "an empty period allocates nothing rather than dividing by zero",
  allocatePool([], 500_000).allocations.length === 0 &&
    allocatePool([], 500_000).unallocatedCents === 500_000,
);

console.log("---");
if (failures > 0) {
  console.error(`${failures} saves-projection check(s) FAILED.`);
  process.exit(1);
}
console.log("All saves-projection checks passed.");
