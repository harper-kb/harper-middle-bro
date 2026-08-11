import { NextResponse } from "next/server";
import {
  loadAllLaneSnapshots,
  toModeReport,
} from "@/lib/adapters/bigbrother/lane-registry";
import { bigBrotherConfigured } from "@/lib/adapters/bigbrother/config";
import { agentToolsConfigured } from "@/lib/adapters/agent-tools/config";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Credential + per-lane live/sample report for operators and rollout checks.
 * Never invents live counts — reports whatever the adapters honestly return.
 */
export async function GET() {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const snapshots = await loadAllLaneSnapshots();
  const lanes = snapshots.map(toModeReport);
  const liveCount = lanes.filter((l) => l.mode === "live").length;

  return NextResponse.json({
    credentials: {
      bigbrother: bigBrotherConfigured(),
      agentTools: agentToolsConfigured(),
    },
    lanes,
    summary: {
      liveLanes: liveCount,
      sampleLanes: lanes.length - liveCount,
      allLive: liveCount === lanes.length,
    },
    provisioning: {
      requiredEnv: [
        "BIGBROTHER_BASE_URL",
        "BIGBROTHER_API_TOKEN",
        "HARPER_AGENT_TOOLS_BASE_URL",
        "HARPER_AGENT_TOOLS_TOKEN",
      ],
      optionalEnv: ["BIGBROTHER_ACTOR_MAP_JSON"],
      note: "A lane flips to live only after count reconciliation against BigBrother.",
    },
  });
}
