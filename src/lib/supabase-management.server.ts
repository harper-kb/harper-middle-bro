import "server-only";

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
