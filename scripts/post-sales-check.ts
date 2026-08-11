import { classifyPostSales } from "../src/lib/lanes/post-sales";
import type { WorkItem } from "../src/lib/types";
const wi = (title: string): WorkItem => ({
  id:"1", externalId:null, homeLane:"post_sales", accountId:"a", accountName:"A", title, summary:"",
  owner:{operatorId:null,displayName:null,team:null}, urgencyTier:"B", urgencyScore:0.5, isOnFire:false,
  actionRequired:true, clock:{kind:"follow_up",at:null,label:"today",breached:false}, blocker:null,
  nextActionLabel:"Open", priorityReasons:[], createdAt:"2026-08-01T00:00:00.000Z",
  updatedAt:"2026-08-10T00:00:00.000Z", parkedUntil:null, parkReason:null,
});
console.assert(classifyPostSales(wi("Umbrella upsell"))==="upsell");
console.assert(classifyPostSales(wi("Remarket GL"))==="remarket");
console.log("PASS  post-sales classifiers");
console.log("\nAll post-sales checks passed.");
