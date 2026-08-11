// Capability gates are pure enough via discoverCapabilities without network.
import { getCapabilityGate } from "../src/lib/adapters/agent-tools/capabilities";

const bind = getCapabilityGate("write.bind", { agentToolsUp: true });
if (bind.state !== "blocked" || !bind.blockerLabel) {
  console.error("FAIL  bind should stay blocked", bind);
  process.exit(1);
}
const coi = getCapabilityGate("write.coi.issue", { agentToolsUp: false });
if (coi.state !== "available") {
  console.error("FAIL  local COI issue should be available", coi);
  process.exit(1);
}
console.log("PASS  mutation door gates");
console.log("\nAll mutation-doors checks passed.");
