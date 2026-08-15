import "server-only";

/**
 * Read door onto the Harper service spine's curated query packs.
 *
 * Read-only by construction: the upstream surface accepts no caller SQL and
 * has no write path, so this client exposes `run_pack` and nothing else.
 *
 * Env:
 *   HARPER_SERVICE_QUERY_URL   — full endpoint, or
 *   HARPER_AGENT_TOOLS_BASE_URL — gateway origin, /service_query is appended
 *   HARPER_SERVICE_QUERY_TOKEN — bearer token, falling back to
 *   HARPER_AGENT_TOOLS_TOKEN
 *
 * Unconfigured is a normal state, not an error: callers fall back to the
 * captured snapshot and label the column accordingly.
 */

export type ServicePackId =
  | "sla_breaches"
  | "repeat_contact_score"
  | "escalation_feed"
  | "open_issues_by_stage"
  | "onboarding_funnel_timing";

export type ServiceQueryCredentials = {
  url: string;
  token: string;
};

export function readServiceQueryCredentials(): ServiceQueryCredentials | null {
  const explicit = process.env.HARPER_SERVICE_QUERY_URL?.trim().replace(/\/+$/, "");
  const gateway = process.env.HARPER_AGENT_TOOLS_BASE_URL?.trim().replace(/\/+$/, "");
  const url = explicit || (gateway ? `${gateway}/service_query` : "");
  const token =
    process.env.HARPER_SERVICE_QUERY_TOKEN?.trim() ||
    process.env.HARPER_AGENT_TOOLS_TOKEN?.trim() ||
    "";
  if (!url || !token) return null;
  return { url, token };
}

export function serviceQueryConfigured(): boolean {
  return readServiceQueryCredentials() != null;
}

export const SERVICE_QUERY_SOURCE = "harper-service-query://run_pack" as const;

export class ServiceQueryError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ServiceQueryError";
  }
}

export type ServicePackResult<Row> = {
  packId: string;
  rows: Row[];
  rowCount: number;
  fetchedAt: string;
};

export async function runServicePack<Row>(
  pack: ServicePackId,
  opts: { limit?: number; params?: Record<string, unknown> } = {},
): Promise<ServicePackResult<Row>> {
  const creds = readServiceQueryCredentials();
  if (!creds) {
    throw new ServiceQueryError("Service query credentials not provisioned", null);
  }

  let res: Response;
  try {
    res = await fetch(creds.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action: "run_pack",
        pack,
        pack_params: opts.params ?? {},
        ...(opts.limit ? { limit: opts.limit } : {}),
      }),
      cache: "no-store",
    });
  } catch (err) {
    throw new ServiceQueryError(
      `Service query unreachable: ${err instanceof Error ? err.message : "network error"}`,
      null,
    );
  }

  if (!res.ok) {
    throw new ServiceQueryError(`Service query HTTP ${res.status} on ${pack}`, res.status);
  }

  let body: { pack_id?: string; rows?: Row[]; row_count?: number };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new ServiceQueryError(`Service query returned non-JSON for ${pack}`, res.status);
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!body.rows) {
    throw new ServiceQueryError(`Service query returned no rows array for ${pack}`, res.status);
  }

  return {
    packId: body.pack_id ?? `service.${pack}`,
    rows,
    rowCount: typeof body.row_count === "number" ? body.row_count : rows.length,
    fetchedAt: new Date().toISOString(),
  };
}
