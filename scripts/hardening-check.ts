/**
 * Production hardening invariants (auth surfaces, capability gates, parity).
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/hardening-check.ts
 */
import { discoverCapabilities } from "../src/lib/adapters/agent-tools/capabilities";
import { reconcileCounts } from "../src/lib/adapters/bigbrother/lane-adapter";
import { SERVICE_LANE_IDS } from "../src/lib/types";
import { ACCOUNT_TABS } from "../src/app/accounts/[id]/AccountWorkspace";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

check("Eight service lanes", SERVICE_LANE_IDS.length === 8);
check("Eight account tabs", ACCOUNT_TABS.length === 8);
check("Count mismatch blocks live", !reconcileCounts(1, 2).reconciled);
check("Count match allows reconcile", reconcileCounts(4, 4).reconciled);

const caps = discoverCapabilities({ agentToolsUp: false });
check(
  "Bind blocked without safe door",
  caps.find((c) => c.id === "write.bind")?.state === "blocked",
);
check(
  "Email blocked without Agent Tools (precise blocker)",
  !!caps.find((c) => c.id === "write.comms.email")?.blockerLabel,
);

if (failed) process.exit(1);
console.log("\nAll hardening checks passed.");
