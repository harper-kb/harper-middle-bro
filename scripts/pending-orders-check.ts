/**
 * Pending Orders G1–G6 self-check.
 * Run: npx tsx scripts/pending-orders-check.ts
 */
import {
  GATE_ORDER,
  buildPendingOrderProgress,
  inferGateFromWorkItem,
  pendingOrderRowSignals,
} from "../src/lib/lanes/pending-orders";
import type { WorkItem } from "../src/lib/types";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

function wi(title: string): WorkItem {
  return {
    id: "1",
    externalId: null,
    homeLane: "pending_orders",
    accountId: "a",
    accountName: "Acme",
    title,
    summary: "",
    owner: { operatorId: null, displayName: "Dana", team: null },
    urgencyTier: "A",
    urgencyScore: 0.9,
    isOnFire: false,
    actionRequired: true,
    clock: { kind: "bind_deadline", at: null, label: "2d", breached: false },
    blocker: { code: "x", label: "Awaiting Insured Signature", capabilityId: "write.docusign" },
    nextActionLabel: "Chase",
    priorityReasons: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    parkedUntil: null,
    parkReason: null,
  };
}

check("Six gates", GATE_ORDER.length === 6);
check("Infers G4 from title", inferGateFromWorkItem(wi("G4 — Insured Sign Pending")) === "G4");
const progress = buildPendingOrderProgress(wi("G3 — Harper Sign"));
check("Current gate G3", progress.currentGate === "G3");
check("Prior gates done", progress.gates.G1 === "done" && progress.gates.G2 === "done");
check("Current blocked when blocker present", progress.gates.G3 === "blocked");
const signals = pendingOrderRowSignals(wi("G2 Send DocuSign"));
check("Five row signals present", Boolean(signals.what && signals.who && signals.clock && signals.blocker && signals.action));

if (failed) process.exit(1);
console.log("\nAll pending-orders checks passed.");
