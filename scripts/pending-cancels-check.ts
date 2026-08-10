import { classifyCancelReason, cancelRetentionAction } from "../src/lib/lanes/pending-cancels";
import type { WorkItem } from "../src/lib/types";
const base: WorkItem = {
  id: "1", externalId: null, homeLane: "pending_cancels", accountId: "a", accountName: "A",
  title: "x", summary: "payment failure", owner: { operatorId: null, displayName: null, team: null },
  urgencyTier: "A", urgencyScore: 1, isOnFire: true, actionRequired: true,
  clock: { kind: "cancellation_effective", at: "2026-08-15T00:00:00.000Z", label: "Cancels Aug 15", breached: false },
  blocker: null, nextActionLabel: "x", priorityReasons: [], createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z", parkedUntil: null, parkReason: null,
};
let f=0; const check=(l:string,ok:boolean)=>{if(ok)console.log("PASS ",l);else{f++;console.error("FAIL ",l)}};
check("non_pay", classifyCancelReason(base)==="non_pay");
check("cure action", cancelRetentionAction("non_pay").includes("Cure"));
check("financing", classifyCancelReason({...base, summary:"premium finance notice"})==="financing");
if(f) process.exit(1);
console.log("\nAll pending-cancels checks passed.");
