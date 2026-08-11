import { classifyIntakeHygiene, classifyCommWorkItem } from "../src/lib/lanes/communications";
console.assert(classifyIntakeHygiene({ status:"pending", ackSentAt:null, channel:"email", callMissed:null, ticketId:null })==="needs_ack");
console.assert(classifyIntakeHygiene({ status:"pending", ackSentAt:"x", channel:"call", callMissed:true, ticketId:null })==="needs_ticket");
console.assert(classifyCommWorkItem({
  id:"1", externalId:null, homeLane:"communications", accountId:"a", accountName:"A",
  title:"Awaiting insured reply", summary:"", owner:{operatorId:null,displayName:null,team:null},
  urgencyTier:"B", urgencyScore:0.4, isOnFire:false, actionRequired:true,
  clock:{kind:"follow_up",at:null,label:"1d",breached:false}, blocker:null, nextActionLabel:"x",
  priorityReasons:[], createdAt:"2026-08-01T00:00:00.000Z", updatedAt:"2026-08-10T00:00:00.000Z",
  parkedUntil:null, parkReason:null,
})==="awaiting_response");
console.log("PASS  communications");
console.log("\nAll communications checks passed.");
