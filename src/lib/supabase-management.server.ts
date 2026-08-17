import "server-only";

/**
 * The quota refusing a request, carrying the window it reported. The message
 * is the same string a plain refusal always threw, so `isRateLimited` and the
 * refresh log keep reading it the same way.
 */
export class SupabaseManagementRateLimitError extends Error {
  /** Seconds until the quota resets, when the response reported it. */
  readonly resetSeconds: number | null;

  constructor(resetSeconds: number | null) {
    super("supabase_management_http_429");
    this.name = "SupabaseManagementRateLimitError";
    this.resetSeconds = resetSeconds;
  }
}

/**
 * The quota window is a minute, so a reset further out than this is a header
 * we do not understand and should not be stalled by.
 */
const MAX_RESET_SECONDS = 120;

function parseResetSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(Math.ceil(seconds), MAX_RESET_SECONDS);
}

/**
 * Read-only SQL through the same Supabase Management API connection used by
 * the two-minute live-book refresh. Keep this server-only: the access token
 * must never reach browser code.
 */
export async function runSupabaseManagementQuery<T>(
  sql: string,
  timeoutMs = 120_000,
): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    throw new Error("supabase_management_unconfigured");
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (response.status === 429) {
    throw new SupabaseManagementRateLimitError(
      parseResetSeconds(response.headers.get("x-ratelimit-reset")),
    );
  }
  if (!response.ok) {
    throw new Error(`supabase_management_http_${response.status}`);
  }
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) {
    throw new Error("supabase_management_invalid_response");
  }
  return rows as T[];
}

/**
 * Whether a failure was the shared quota refusing the request rather than
 * anything wrong with the query. Callers on a timer back off on this instead of
 * retrying straight into the same wall; a one-off caller can simply retry.
 */
export function isRateLimited(error: unknown): boolean {
  return (
    error instanceof Error && error.message === "supabase_management_http_429"
  );
}

/**
 * How long until the quota will accept us again, from its own
 * `x-ratelimit-reset`. Null when the refusal carried no usable window — a
 * caller on a timer then has to guess instead.
 */
export function rateLimitResetMs(error: unknown): number | null {
  if (!(error instanceof SupabaseManagementRateLimitError)) return null;
  return error.resetSeconds === null ? null : error.resetSeconds * 1000;
}
