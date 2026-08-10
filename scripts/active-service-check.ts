import { classifyActiveService, activeServiceAction } from "../src/lib/lanes/active-service";
import type { WorkItem } from "../src/lib/types";
const base = {
  id: "1", externalId: null, homeLane: "active_service" as const, accountId: "a",
  accountName: "A", summary: "", owner: { operatorId: null, displayName: null, team: null },
  urgencyTier: "B" as const, urgencyScore: 0.5, isOnFire: false, actionRequired: false,
  clock: { kind: "sla" as const, at: null, label: "1d", breached: false }, blocker: null,
  nextActionLabel: "Open", priorityReasons: [], createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z", parkedUntil: null, parkReason: null,
};
function wi(title: string): WorkItem { return { ...base, title }; }
let f = 0;
function check(l: string, ok: boolean) { if (ok) console.log("PASS ", l); else { f++; console.error("FAIL ", l); } }
check("claim classifies", classifyActiveService(wi("Simple claim FNOL")) === "simple_claim");
check("claim action", activeServiceAction("simple_claim").includes("Claims Contact"));
check("endorsement", classifyActiveService(wi("GL endorsement limit")) === "endorsement");
if (f) process.exit(1);
console.log("\nAll active-service checks passed.");
