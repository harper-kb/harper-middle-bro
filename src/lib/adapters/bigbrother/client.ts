import "server-only";

import {
  BIGBROTHER_SOURCE,
  readBigBrotherCredentials,
  type BigBrotherCredentials,
} from "./config";

export type BigBrotherLaneId =
  | "pending_orders"
  | "active_service"
  | "pending_cancellation";

/** Minimal wire shape from `/api/service-workbench/swim-lanes` company rows. */
export type BigBrotherLaneCompany = {
  company_id: string;
  company_name: string;
  service_owner: string | null;
  lane: BigBrotherLaneId;
  open_ticket_count: number;
  days_stuck: number;
  stage_summary: string | null;
  gate_label: string | null;
  headline_stage: string | null;
  primary_service_log_id: string | null;
  is_on_fire?: boolean | null;
  urgency?: {
    tier?: string | null;
    score?: number | null;
    status?: string | null;
  } | null;
  urgency_override?: { tier?: string | null } | null;
  dominant_action_state?: string | null;
  assigned_agent_ids?: number[];
};

export type BigBrotherSwimLanesPayload = {
  lanes?: Partial<Record<BigBrotherLaneId, { companies?: BigBrotherLaneCompany[]; total?: number }>>;
  /** Some payloads expose totals at the top level */
  totals?: Partial<Record<BigBrotherLaneId, number>>;
};

export class BigBrotherClientError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly sourceApi: string,
  ) {
    super(message);
    this.name = "BigBrotherClientError";
  }
}

async function bbFetch<T>(
  creds: BigBrotherCredentials,
  path: string,
  sourceApi: string,
): Promise<T> {
  const url = `${creds.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    throw new BigBrotherClientError(
      `BigBrother unreachable: ${err instanceof Error ? err.message : "network error"}`,
      null,
      sourceApi,
    );
  }
  if (!res.ok) {
    throw new BigBrotherClientError(
      `BigBrother ${res.status} on ${path}`,
      res.status,
      sourceApi,
    );
  }
  return (await res.json()) as T;
}

/**
 * Live swim-lane list. Callers must treat failures as sample-mode triggers.
 */
export async function fetchSwimLanes(opts?: {
  lane?: BigBrotherLaneId;
  limit?: number;
}): Promise<BigBrotherSwimLanesPayload> {
  const creds = readBigBrotherCredentials();
  if (!creds) {
    throw new BigBrotherClientError(
      "BigBrother credentials not provisioned",
      null,
      BIGBROTHER_SOURCE.swimLanes,
    );
  }
  const params = new URLSearchParams();
  if (opts?.lane) params.set("lane", opts.lane);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return bbFetch<BigBrotherSwimLanesPayload>(
    creds,
    `/api/service-workbench/swim-lanes${qs ? `?${qs}` : ""}`,
    BIGBROTHER_SOURCE.swimLanes,
  );
}

export async function fetchLaneCount(
  lane: BigBrotherLaneId,
): Promise<{ count: number; sourceApi: string }> {
  const payload = await fetchSwimLanes({ lane, limit: 1 });
  const section = payload.lanes?.[lane];
  const fromSection = section?.total;
  const fromTotals = payload.totals?.[lane];
  const count =
    typeof fromSection === "number"
      ? fromSection
      : typeof fromTotals === "number"
        ? fromTotals
        : (section?.companies?.length ?? 0);
  return { count, sourceApi: BIGBROTHER_SOURCE.swimLanes };
}
