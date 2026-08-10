/**
 * Agent Tools client / capability / idempotency / receipt self-check.
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/agent-tools-check.ts
 */
import {
  buildIdempotencyKey,
  discoverCapabilities,
  dispatchAction,
  getCapabilityGate,
  registerLegacyFallback,
  _resetIdempotencyForTests,
  _resetLegacyFallbacksForTests,
} from "../src/lib/adapters/agent-tools";
import type { ActionReceipt, ActionRequest } from "../src/lib/types";

let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

_resetIdempotencyForTests();
_resetLegacyFallbacksForTests();

const down = discoverCapabilities({ agentToolsUp: false });
check("Discovery returns one gate per capability", down.length >= 10);
check(
  "Write email blocked without Agent Tools",
  getCapabilityGate("write.comms.email", { agentToolsUp: false }).state === "blocked",
);
check(
  "Bind stays blocked (no safe door)",
  getCapabilityGate("write.bind", { agentToolsUp: true }).state === "blocked" &&
    !!getCapabilityGate("write.bind").blockerLabel,
);
check(
  "Local COI issue available without Agent Tools",
  getCapabilityGate("write.coi.issue", { agentToolsUp: false }).state === "available",
);

const up = discoverCapabilities({ agentToolsUp: true });
check(
  "Email available when Agent Tools up",
  up.find((g) => g.id === "write.comms.email")?.state === "available",
);

const key = buildIdempotencyKey({
  operatorId: "op-1",
  capabilityId: "write.comms.email",
  workItemId: "wi-1",
  fingerprint: "cure-v1",
});
check("Idempotency key is stable and composite", key === "op-1:write.comms.email:wi-1:cure-v1");

async function main() {
  const unconfirmed: ActionRequest = {
    capabilityId: "write.comms.email",
    operatorId: "op-1",
    idempotencyKey: key,
    workItemId: "wi-1",
    accountId: "acct-apex",
    payload: { templateId: "cure" },
    confirmed: false,
  };
  const rejected = await dispatchAction(unconfirmed);
  check("Unconfirmed one_click action is rejected", rejected.status === "rejected");

  registerLegacyFallback({
    capabilityId: "write.comms.email",
    description: "Local mock send for tests",
    async execute(request): Promise<ActionReceipt> {
      return {
        id: "rcpt_legacy_test",
        capabilityId: request.capabilityId,
        idempotencyKey: request.idempotencyKey,
        status: "confirmed",
        operatorId: request.operatorId,
        workItemId: request.workItemId,
        accountId: request.accountId,
        summary: "Legacy mock send",
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        verified: true,
        details: { provider: "legacy" },
      };
    },
  });

  _resetIdempotencyForTests();
  const confirmed: ActionRequest = {
    ...unconfirmed,
    confirmed: true,
    idempotencyKey: `${key}:legacy`,
  };
  const legacyReceipt = await dispatchAction(confirmed, { allowLegacyFallback: true });
  check(
    "Legacy fallback executes when Agent Tools blocked",
    legacyReceipt.status === "confirmed" && legacyReceipt.summary.includes("Legacy"),
  );

  const replay = await dispatchAction(confirmed, { allowLegacyFallback: true });
  check("Second call with same key is idempotent_replay", replay.status === "idempotent_replay");

  if (failed) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Agent Tools checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
