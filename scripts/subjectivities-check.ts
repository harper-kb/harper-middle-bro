import { subjectivityBucket, subjectivityElevated } from "../src/lib/lanes/subjectivities";
import type { WorkItem } from "../src/lib/types";
const wi = (title: string, homeLane: WorkItem["homeLane"] = "subjectivities"): WorkItem => ({
  id:"1", externalId:null, homeLane, accountId:"a", accountName:"A", title, summary:"",
  owner:{operatorId:null,displayName:null,team:null}, urgencyTier:"B", urgencyScore:0.4, isOnFire:false,
  actionRequired:true, clock:{kind:"sla",at:null,label:"2d",breached:false}, blocker:null,
  nextActionLabel:"x", priorityReasons:[], createdAt:"2026-08-01T00:00:00.000Z",
  updatedAt:"2026-08-10T00:00:00.000Z", parkedUntil:null, parkReason:null,
});
console.assert(subjectivityBucket(wi("Collect W9"))==="pre_bind");
console.assert(subjectivityBucket(wi("Post-bind loss run"))==="post_bind");
console.assert(subjectivityElevated(wi("Cancellation risk subjectivity"))===true);
console.log("PASS  subjectivities");
console.log("\nAll subjectivities checks passed.");
