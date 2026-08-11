/**
 * Per-lane live/sample gate self-check (no network).
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/lane-mode-check.ts
 */
import { reconcileCounts } from "../src/lib/adapters/bigbrother/lane-adapter";
import { toModeReport } from "../src/lib/adapters/bigbrother/lane-registry";
import { sampleLaneSnapshot } from "../src/lib/adapters/bigbrother/sample";
import type { LaneSnapshot } from "../src/lib/types";

let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const sample = sampleLaneSnapshot(
  "coi",
  "BigBrother credentials not provisioned",
);
const report = toModeReport(sample);
check("Sample report mode is sample", report.mode === "sample" && !report.reconciled);
check("Sample report keeps reason", !!report.modeReason);

const live: LaneSnapshot = {
  lane: "coi",
  mode: "live",
  modeReason: null,
  items: sample.items,
  count: sample.items.length,
  sourceCount: sample.items.length,
  reconciled: true,
  fetchedAt: new Date().toISOString(),
  sourceApi: "bigbrother://api/service-workbench/swim-lanes",
};
check("Live report only when reconciled", toModeReport(live).mode === "live");

const gate = reconcileCounts(2, 2);
check("Matching counts reconcile", gate.reconciled);
check("Mismatch blocks live", !reconcileCounts(2, 9).reconciled);

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll lane mode checks passed.");
