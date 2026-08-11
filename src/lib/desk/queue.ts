import "server-only";

import { discoverCapabilities } from "@/lib/adapters/agent-tools";
import { sampleWorkItemsForLane } from "@/lib/adapters/bigbrother/sample";
import {
  classifyWorkItem,
  loadAgentStatus,
  summarizeDeskLanes,
} from "@/lib/agent-status";
import { explainWhyNext, pickNextWorkItem, sortWorkItems } from "@/lib/priority";
import { getServiceActivation } from "@/lib/service-activation";
import { SERVICE_LANE_IDS, type WorkItem } from "@/lib/types";
import { listTickets } from "@/lib/db";
import { isOpenTicket } from "@/lib/tickets";
import { attachGates, recommendActions } from "./recommendations";
import { projectSpineNext } from "./spine";
import type { DeskBundle, PersonalStrip } from "./types";

export type { DeskBundle, PersonalStrip } from "./types";

function allSampleWorkItems(): WorkItem[] {
  return SERVICE_LANE_IDS.flatMap((lane) => sampleWorkItemsForLane(lane));
}

/**
 * Build the unified Desk bundle. Uses sample lane fixtures until live
 * adapters reconcile; personal strip also projects open tickets for the
 * signed-in operator when available.
 */
export async function buildDeskBundle(opts: {
  operatorId: string | null;
  excludeIds?: string[];
}): Promise<DeskBundle> {
  const queue = sortWorkItems(allSampleWorkItems());
  const exclude = new Set(opts.excludeIds ?? []);
  const next = pickNextWorkItem(queue, { excludeIds: exclude });
  const activation = getServiceActivation();
  const agent = await loadAgentStatus({ operatorId: opts.operatorId });
  const capabilities = discoverCapabilities();
  const agentViews = Object.fromEntries(
    queue.map((item) => [
      item.id,
      classifyWorkItem(item, agent.byWorkItem[item.id], {
        agentActive: activation.agent.enabled,
      }),
    ]),
  );
  const deskLaneCounts = summarizeDeskLanes(Object.values(agentViews));
  const recommendations = Object.fromEntries(
    queue.map((item) => [
      item.id,
      attachGates(recommendActions(item), capabilities),
    ]),
  );
  const spine = projectSpineNext(queue, activation.spine.state);

  const parked = queue.filter((i) => i.parkedUntil);
  const assigned = queue.filter(
    (i) =>
      !i.parkedUntil &&
      (opts.operatorId
        ? i.owner.operatorId === opts.operatorId
        : i.owner.operatorId != null),
  );
  const followUps = queue.filter(
    (i) => i.clock.kind === "follow_up" && !i.parkedUntil,
  );
  const handoffs = queue.filter(
    (i) => i.owner.operatorId == null && i.actionRequired,
  );

  // Done today — project from local tickets when we have an operator.
  let doneToday: PersonalStrip["doneToday"] = [];
  if (opts.operatorId) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    doneToday = listTickets({})
      .filter(
        (t) =>
          t.operatorId === opts.operatorId &&
          !isOpenTicket(t.status) &&
          Date.parse(t.updatedAt) >= start.getTime(),
      )
      .slice(0, 12)
      .map((t) => ({
        id: t.id,
        title: t.title || t.subject,
        accountName: t.account.name,
        completedAt: t.updatedAt,
      }));
  }

  return {
    queue,
    next,
    whyNext: next ? explainWhyNext(next) : [],
    strip: {
      assigned,
      parked,
      followUps,
      handoffs,
      doneToday,
    },
    mode: "sample",
    modeReason:
      "Desk queue from labeled sample work items until BigBrother lanes reconcile",
    activation,
    spine,
    agent,
    agentViews,
    deskLaneCounts,
    recommendations,
  };
}
