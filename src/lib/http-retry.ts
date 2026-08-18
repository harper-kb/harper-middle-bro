export const MAX_RETRY_AFTER_MS = 120_000;

/** Parse Retry-After seconds or an HTTP date into one bounded client delay. */
export function parseRetryAfterMs(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  const rawMs = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - now;
  if (!Number.isFinite(rawMs) || rawMs < 0) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(1_000, Math.ceil(rawMs)));
}
