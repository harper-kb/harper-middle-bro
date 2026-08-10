import "server-only";

export {
  BIGBROTHER_SOURCE,
  bigBrotherConfigured,
  readBigBrotherCredentials,
} from "./config";
export {
  BigBrotherClientError,
  fetchLaneCount,
  fetchSwimLanes,
  type BigBrotherLaneCompany,
  type BigBrotherLaneId,
  type BigBrotherSwimLanesPayload,
} from "./client";
export {
  BB_LANE_TO_SERVICE,
  SERVICE_TO_BB_LANE,
  mapCompanyToWorkItem,
  resolveUrgencyTier,
} from "./map";
export {
  getSessionIdentity,
  mapOperatorToIdentity,
  parseActorMap,
} from "./identity";
export { sampleLaneSnapshot, sampleWorkItemsForLane } from "./sample";
export {
  createBigBrotherLaneAdapter,
  probeBigBrotherLaneCount,
  reconcileCounts,
} from "./lane-adapter";
export {
  getLaneAdapter,
  loadAllLaneSnapshots,
  loadLaneSnapshot,
  toModeReport,
  type LaneModeReport,
} from "./lane-registry";
