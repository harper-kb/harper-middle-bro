import {
  mapAgentToolsRuns,
  normalizeAgentRunStatus,
} from "../src/lib/agent-status/adapter";
import { classifyWorkItem } from "../src/lib/agent-status/classify";
import { sampleWorkItemsForLane } from "../src/lib/adapters/bigbrother/sample";
import { discoverCapabilities } from "../src/lib/adapters/agent-tools/capabilities";
import { recommendActions } from "../src/lib/desk/recommendations";
import { projectSpineNext } from "../src/lib/desk/spine";
import { getServiceActivation } from "../src/lib/service-activation";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const original = {
  base: process.env.HARPER_AGENT_TOOLS_BASE_URL,
  token: process.env.HARPER_AGENT_TOOLS_TOKEN,
  spine: process.env.STEP_BRO_SERVICE_SPINE_ENABLED,
  agent: process.env.STEP_BRO_SERVICE_AGENT_ENABLED,
};

process.env.HARPER_AGENT_TOOLS_BASE_URL = "https://agent-tools.example";
process.env.HARPER_AGENT_TOOLS_TOKEN = "test-token";
delete process.env.STEP_BRO_SERVICE_SPINE_ENABLED;
delete process.env.STEP_BRO_SERVICE_AGENT_ENABLED;

const dormant = getServiceActivation();
check("Service Spine defaults off", dormant.spine.state === "ready_off");
check("Service Agent defaults off", dormant.agent.state === "ready_off");

const dormantCaps = discoverCapabilities({ agentToolsUp: true });
check(
  "Spine activation capability blocked while off",
  dormantCaps.find((c) => c.id === "service_spine.enabled")?.state === "blocked",
);
check(
  "Agent status capability blocked while off",
  dormantCaps.find((c) => c.id === "read.agent_status")?.state === "blocked",
);

process.env.STEP_BRO_SERVICE_SPINE_ENABLED = "true";
process.env.STEP_BRO_SERVICE_AGENT_ENABLED = "true";
const active = getServiceActivation();
check("Explicit Spine flag activates", active.spine.state === "active");
check("Explicit Agent flag activates", active.agent.state === "active");

check("Agent status normalizes needs-human", normalizeAgentRunStatus("needs human") === "waiting_human");
const mapped = mapAgentToolsRuns({
  tasks: [
    {
      task_id: "task-1",
      work_item_id: "work-1",
      state: "in_progress",
      title: "Prepare chase",
    },
  ],
});
check("Agent Tools task response maps", mapped[0]?.status === "running");

const queue = [
  ...sampleWorkItemsForLane("pending_cancels"),
  ...sampleWorkItemsForLane("coi"),
];
const spineOff = projectSpineNext(queue, "ready_off");
check("Dormant Spine never drives Desk", spineOff.drivesDesk === false);
check("Dormant Spine still projects next", spineOff.proposedNextId != null);

const item = queue[0];
const view = classifyWorkItem(item, null, { agentActive: false });
check("Dormant Agent leaves work human-driven", view.lane === "human_action");

const recommendations = recommendActions(item);
check(
  "Payment cure recommends guarded payment door",
  recommendations.some((r) => r.capabilityId === "write.payment_link"),
);
check(
  "Recommendations include reminder plumbing",
  recommendations.some((r) => r.capabilityId === "write.reminder"),
);

function restore(key: keyof typeof original, env: string) {
  const value = original[key];
  if (value == null) delete process.env[env];
  else process.env[env] = value;
}
restore("base", "HARPER_AGENT_TOOLS_BASE_URL");
restore("token", "HARPER_AGENT_TOOLS_TOKEN");
restore("spine", "STEP_BRO_SERVICE_SPINE_ENABLED");
restore("agent", "STEP_BRO_SERVICE_AGENT_ENABLED");

if (failed) process.exit(1);
console.log("\nAll agentification checks passed.");
