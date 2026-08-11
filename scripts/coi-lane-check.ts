import { classifyCoiPath, coiNextAction } from "../src/lib/lanes/coi";
import type { WorkItem } from "../src/lib/types";
const wi = (title: string): WorkItem => ({
  id:"1", externalId:null, homeLane:"coi", accountId:"a", accountName:"A", title, summary:"",
  owner:{operatorId:null,displayName:null,team:null}, urgencyTier:"A", urgencyScore:0.7, isOnFire:false,
  actionRequired:true, clock:{kind:"sla",at:null,label:"2h",breached:false}, blocker:null,
  nextActionLabel:"x", priorityReasons:[], createdAt:"2026-08-10T00:00:00.000Z",
  updatedAt:"2026-08-10T00:00:00.000Z", parkedUntil:null, parkReason:null,
});
console.assert(classifyCoiPath(wi("Blanket AI holder"))==="blanket_fast");
console.assert(coiNextAction("binder_to_coi").includes("Binder"));
console.log("PASS  coi lane");
console.log("\nAll coi-lane checks passed.");
