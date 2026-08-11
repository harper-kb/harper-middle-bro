import "server-only";

import type { LaneReadAdapter, LaneSnapshot, ServiceLaneId, WorkItem } from "@/lib/types";
import { BIGBROTHER_SOURCE, bigBrotherConfigured } from "./config";
import {
  BigBrotherClientError,
  fetchLaneCount,
  fetchSwimLanes,
  type BigBrotherLaneId,
} from "./client";
import { mapCompanyToWorkItem, SERVICE_TO_BB_LANE } from "./map";
import { sampleLaneSnapshot } from "./sample";

export type ReconcileResult = {
  reconciled: boolean;
  stepBroCount: number;
  sourceCount: number | null;
  reason: string | null;
};

/**
 * Count reconciliation gate: a lane may flip to live only when Step Bro's
 * listed item count matches BigBrother's reported total.
 */
export function reconcileCounts(
  stepBroCount: number,
  sourceCount: number | null,
): ReconcileResult {
  if (sourceCount == null) {
    return {
      reconciled: false,
      stepBroCount,
      sourceCount,
      reason: "BigBrother source count unavailable",
    };
  }
  if (stepBroCount !== sourceCount) {
    return {
      reconciled: false,
      stepBroCount,
      sourceCount,
      reason: `Count mismatch: Step Bro ${stepBroCount} vs BigBrother ${sourceCount}`,
    };
  }
  return {
    reconciled: true,
    stepBroCount,
    sourceCount,
    reason: null,
  };
}

async function loadLiveLane(lane: ServiceLaneId): Promise<LaneSnapshot> {
  const bbLane = SERVICE_TO_BB_LANE[lane];
  if (!bbLane) {
    return sampleLaneSnapshot(
      lane,
      `Lane ${lane} has no BigBrother swim-lane mapping yet`,
    );
  }

  try {
    const payload = await fetchSwimLanes({ lane: bbLane, limit: 500 });
    const section = payload.lanes?.[bbLane];
    const companies = section?.companies ?? [];
    const items = companies.map(mapCompanyToWorkItem);
    const sourceCount =
      typeof section?.total === "number"
        ? section.total
        : typeof payload.totals?.[bbLane] === "number"
          ? payload.totals[bbLane]!
          : companies.length;
    const gate = reconcileCounts(items.length, sourceCount);

    if (!gate.reconciled) {
      // Keep live-mapped items for debugging but force labeled sample mode.
      return {
        lane,
        mode: "sample",
        modeReason: gate.reason,
        items,
        count: items.length,
        sourceCount,
        reconciled: false,
        fetchedAt: new Date().toISOString(),
        sourceApi: BIGBROTHER_SOURCE.swimLanes,
      };
    }

    return {
      lane,
      mode: "live",
      modeReason: null,
      items,
      count: items.length,
      sourceCount,
      reconciled: true,
      fetchedAt: new Date().toISOString(),
      sourceApi: BIGBROTHER_SOURCE.swimLanes,
    };
  } catch (err) {
    const message =
      err instanceof BigBrotherClientError
        ? err.message
        : err instanceof Error
          ? err.message
          : "BigBrother read failed";
    return sampleLaneSnapshot(lane, message);
  }
}

export function createBigBrotherLaneAdapter(lane: ServiceLaneId): LaneReadAdapter {
  return {
    lane,
    sourceApi: BIGBROTHER_SOURCE.swimLanes,
    async list(): Promise<LaneSnapshot> {
      if (!bigBrotherConfigured()) {
        return sampleLaneSnapshot(
          lane,
          "BigBrother credentials not provisioned (set BIGBROTHER_BASE_URL + BIGBROTHER_API_TOKEN)",
        );
      }
      return loadLiveLane(lane);
    },
    async get(workItemId: string): Promise<WorkItem | null> {
      const snapshot = await this.list();
      return snapshot.items.find((i) => i.id === workItemId) ?? null;
    },
  };
}

/** Probe BigBrother count only (for reconciliation dashboards). */
export async function probeBigBrotherLaneCount(
  lane: BigBrotherLaneId,
): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  if (!bigBrotherConfigured()) {
    return { ok: false, reason: "BigBrother credentials not provisioned" };
  }
  try {
    const { count } = await fetchLaneCount(lane);
    return { ok: true, count };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "probe failed",
    };
  }
}
