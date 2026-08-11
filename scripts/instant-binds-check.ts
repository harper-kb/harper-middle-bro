import { instantBindBucket, instantBindFacet, instantBindAction } from "../src/lib/lanes/instant-binds";
import type { WorkItem } from "../src/lib/types";
const wi = (title: string): WorkItem => ({
  id:"1", externalId:null, homeLane:"instant_binds", accountId:"a", accountName:"A", title, summary:"",
  owner:{operatorId:null,displayName:null,team:null}, urgencyTier:"A", urgencyScore:0.8, isOnFire:false,
  actionRequired:true, clock:{kind:"bind_deadline",at:null,label:"today",breached:false},
  blocker:null, nextActionLabel:"x", priorityReasons:[], createdAt:"2026-08-10T00:00:00.000Z",
  updatedAt:"2026-08-10T00:00:00.000Z", parkedUntil:null, parkReason:null,
});
console.assert(instantBindBucket(wi("IQ bind no signature needed"))==="no_signature");
console.assert(instantBindFacet(wi("Waiting on RT Connector portal"))==="carrier_access");
console.assert(instantBindAction(wi("RT Connector")).includes("Portal Bind"));
console.log("PASS  instant-binds");
console.log("\nAll instant-binds checks passed.");
