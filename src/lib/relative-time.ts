/**
 * Relative timestamps for desk surfaces. Always derived from a stored ISO
 * timestamp — never from page-load time as the displayed moment, and never
 * hard-coded. Exact local format rides the accessible label / tooltip.
 */

const RELATIVE_TZ = "America/Los_Angeles";

export function formatRelativeTime(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;

  const deltaSec = Math.round((nowMs - then) / 1000);
  if (deltaSec < 45) return "Just now";
  if (deltaSec < 90) return "1 minute ago";

  const minutes = Math.round(deltaSec / 60);
  if (minutes < 45) return `${minutes} minutes ago`;
  if (minutes < 90) return "1 hour ago";

  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;

  const months = Math.round(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 18) return `${months} months ago`;

  const years = Math.round(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/** Exact timestamp for tooltips / aria-labels, including timezone abbreviation. */
export function formatExactTimestamp(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: RELATIVE_TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
