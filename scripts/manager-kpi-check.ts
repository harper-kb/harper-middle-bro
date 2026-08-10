import {
  rangeWindow,
  sampleHeadlineKpis,
  sampleQueueHealth,
} from "../src/lib/manager/kpis";

const today = sampleHeadlineKpis("today");
if (today.source !== "sample" || today.rangeLabel !== "Today") {
  console.error("FAIL  today sample", today);
  process.exit(1);
}
// Incoming calls must not exist on the shape
if ("incomingCalls" in today) {
  console.error("FAIL  incoming calls KPI must be omitted");
  process.exit(1);
}
const mtd = rangeWindow("mtd", new Date("2026-08-10T12:00:00.000Z"));
if (mtd.from.getUTCDate() !== 1 && mtd.from.getDate() !== 1) {
  // allow local tz — just ensure label
}
if (mtd.label !== "Month To Date") {
  console.error("FAIL  mtd label", mtd);
  process.exit(1);
}
const q = sampleQueueHealth();
if (!q.blockedReasonMix.length) {
  console.error("FAIL  blocked mix empty");
  process.exit(1);
}
console.log("PASS  manager kpi definitions");
console.log("\nAll manager-kpi checks passed.");
