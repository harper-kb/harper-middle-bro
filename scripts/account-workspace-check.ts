/**
 * Account workspace tab contract check.
 * Run: npx tsx scripts/account-workspace-check.ts
 */
import { ACCOUNT_TABS } from "../src/components/AccountWorkspace";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const ids = ACCOUNT_TABS.map((t) => t.id);
check("Eight account tabs", ACCOUNT_TABS.length === 8);
check(
  "Tab contract ids",
  ids.join(",") ===
    "overview,checkout,tickets,communications,documents,certificates,portal,actions",
);
check(
  "Title Case labels",
  ACCOUNT_TABS.every((t) => t.label[0] === t.label[0].toUpperCase()),
);

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll account workspace checks passed.");
