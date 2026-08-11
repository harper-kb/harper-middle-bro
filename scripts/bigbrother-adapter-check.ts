/**
 * BigBrother adapter + identity mapping self-check (no network).
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/bigbrother-adapter-check.ts
 */
import { mapCompanyToWorkItem, resolveUrgencyTier } from "../src/lib/adapters/bigbrother/map";
import { mapOperatorToIdentity, parseActorMap } from "../src/lib/adapters/bigbrother/identity";
import { reconcileCounts } from "../src/lib/adapters/bigbrother/lane-adapter";
import { sampleLaneSnapshot } from "../src/lib/adapters/bigbrother/sample";
import type { BigBrotherLaneCompany } from "../src/lib/adapters/bigbrother/client";
import type { Operator } from "../src/lib/types";

let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const row: BigBrotherLaneCompany = {
  company_id: "42",
  company_name: "Apex Roofing",
  service_owner: "Dana",
  lane: "pending_cancellation",
  open_ticket_count: 2,
  days_stuck: 5,
  stage_summary: "Payment Failure",
  gate_label: "Awaiting Payment",
  headline_stage: "PAYMENT_FAILURE",
  primary_service_log_id: "sl-9",
  is_on_fire: true,
  urgency: { tier: "B", score: 0.7, status: "completed" },
  urgency_override: { tier: "A" },
  dominant_action_state: "action_required",
};

check("Override tier wins over AI tier", resolveUrgencyTier(row) === "A");
const item = mapCompanyToWorkItem(row);
check("Maps to pending_cancels home lane", item.homeLane === "pending_cancels");
check("Preserves fire flag", item.isOnFire === true);
check("External id prefers service log", item.externalId === "sl-9");
check(
  "Priority reasons include fire + override",
  item.priorityReasons.some((r) => r.code === "fire_flag") &&
    item.priorityReasons.some((r) => r.code === "operator_override"),
);

const match = reconcileCounts(3, 3);
check("Equal counts reconcile", match.reconciled && match.reason == null);
const mismatch = reconcileCounts(3, 5);
check("Mismatched counts block live", !mismatch.reconciled && !!mismatch.reason);
const missing = reconcileCounts(3, null);
check("Missing source count blocks live", !missing.reconciled);

const sample = sampleLaneSnapshot(
  "pending_orders",
  "BigBrother credentials not provisioned",
);
check("Sample snapshot is labeled sample", sample.mode === "sample" && !sample.reconciled);
check("Sample modeReason present", !!sample.modeReason);

const actorMap = parseActorMap(
  JSON.stringify({ user_abc: "agent-7", "op-1": "agent-9" }),
);
check(
  "Actor map parses clerk + operator keys",
  actorMap.user_abc === "agent-7" && actorMap["op-1"] === "agent-9",
);
check("Bad actor map JSON yields empty", Object.keys(parseActorMap("{nope")).length === 0);

const operator: Operator = {
  id: "op-1",
  clerkUserId: "user_abc",
  displayName: "Dana Whitfield",
  email: "dana@harperinsure.com",
  title: "Service",
  phone: null,
  role: "operator",
  team: "Retention",
  signature: "Dana",
  defaultTemplate: "standard",
};
const identity = mapOperatorToIdentity(operator, actorMap);
check("Identity prefers clerk mapping", identity.externalActorId === "agent-7");
check(
  "Identity carries operator fields",
  identity.operatorId === "op-1" && identity.role === "operator",
);

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll BigBrother adapter checks passed.");
