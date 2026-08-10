import "server-only";

import type { LaneSnapshot, ServiceLaneId } from "@/lib/types";
import { createBigBrotherLaneAdapter } from "./lane-adapter";
import { SERVICE_LANE_IDS } from "@/lib/types";

const adapters = new Map(
  SERVICE_LANE_IDS.map((lane) => [lane, createBigBrotherLaneAdapter(lane)]),
);

export function getLaneAdapter(lane: ServiceLaneId) {
  const adapter = adapters.get(lane);
  if (!adapter) throw new Error(`No adapter for lane ${lane}`);
  return adapter;
}

/** Load one lane with live/sample honesty already applied by the adapter. */
export async function loadLaneSnapshot(lane: ServiceLaneId): Promise<LaneSnapshot> {
  return getLaneAdapter(lane).list();
}

/** Probe every lane — used by manager parity + credential status. */
export async function loadAllLaneSnapshots(): Promise<LaneSnapshot[]> {
  return Promise.all(SERVICE_LANE_IDS.map((lane) => loadLaneSnapshot(lane)));
}

export type LaneModeReport = {
  lane: ServiceLaneId;
  mode: LaneSnapshot["mode"];
  reconciled: boolean;
  count: number;
  sourceCount: number | null;
  modeReason: string | null;
  sourceApi: string;
};

export function toModeReport(snapshot: LaneSnapshot): LaneModeReport {
  return {
    lane: snapshot.lane,
    mode: snapshot.mode,
    reconciled: snapshot.reconciled,
    count: snapshot.count,
    sourceCount: snapshot.sourceCount,
    modeReason: snapshot.modeReason,
    sourceApi: snapshot.sourceApi,
  };
}
