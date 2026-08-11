import {
  buildAgentDrilldowns,
  buildBlockedReasonAnalytics,
  reconcileSectionCounts,
} from "../src/lib/manager/qa";
import type { WorkItem } from "../src/lib/types";

const items: WorkItem[] = [
  {
    id: "1",
    externalId: null,
    homeLane: "pending_cancels",
    accountId: "a",
    accountName: "A",
    title: "Cure",
    summary: "",
    owner: { operatorId: "op-1", displayName: "Dana", team: null },
    urgencyTier: "A",
    urgencyScore: 1,
    isOnFire: true,
    actionRequired: true,
    clock: {
      kind: "cancellation_effective",
      at: null,
      label: "1d",
      breached: false,
    },
    blocker: { code: "p", label: "Awaiting Payment", capabilityId: null },
    nextActionLabel: "Chase",
    priorityReasons: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    parkedUntil: null,
    parkReason: null,
  },
  {
    id: "2",
    externalId: null,
    homeLane: "coi",
    accountId: "b",
    accountName: "B",
    title: "COI",
    summary: "",
    owner: { operatorId: "op-1", displayName: "Dana", team: null },
    urgencyTier: "B",
    urgencyScore: 0.5,
    isOnFire: false,
    actionRequired: false,
    clock: { kind: "sla", at: null, label: "2h", breached: false },
    blocker: null,
    nextActionLabel: "Issue",
    priorityReasons: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    parkedUntil: null,
    parkReason: null,
  },
];

const mix = buildBlockedReasonAnalytics(items);
if (mix[0]?.reason !== "Awaiting Payment") {
  console.error("FAIL  blocked mix", mix);
  process.exit(1);
}
const agents = buildAgentDrilldowns(items);
if (agents[0]?.displayName !== "Dana" || agents[0].openCount !== 2) {
  console.error("FAIL  agent drilldown", agents);
  process.exit(1);
}
const ok = reconcileSectionCounts({ pending_cancels: 1, coi: 1 }, 2);
if (!ok.ok) {
  console.error("FAIL  reconcile", ok);
  process.exit(1);
}
const bad = reconcileSectionCounts({ pending_cancels: 1 }, 2);
if (bad.ok) {
  console.error("FAIL  should mismatch");
  process.exit(1);
}
console.log("PASS  manager qa analytics");
console.log("\nAll manager-qa checks passed.");
