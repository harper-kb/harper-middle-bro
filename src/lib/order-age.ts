/**
 * Deal age for the order previews, in complete Harper-business-timezone
 * calendar days.
 *
 * Authoritative timestamp: `orders_temp.created_at`. Verified against the live
 * ops database — populated on 12,045/12,045 non-deleted orders and bounded to
 * the real trading window, while `orders_temp.ordered_date` is producer-entered
 * and carries data-entry outliers (one 1904 value, two dated past 2050) that
 * would render as ages in the tens of thousands of days. `ordered_date` still
 * drives the reporting windows and KPI ranges; nothing here changes that.
 *
 * The boundary is a calendar-day difference in America/Los_Angeles, not an
 * elapsed-hours division: an order created at 11pm PT is "1 Day" old the next
 * morning. Both instants are reduced to their PT civil date first and then
 * subtracted as UTC midnights, which keeps the arithmetic exact across DST
 * transitions (a PT day is 23 or 25 hours long twice a year).
 *
 * Shared by the server (which resolves "today") and the client previews so
 * every account view applies one boundary rule.
 */

/** The reporting timezone already established by `BookReportingWindows`. */
export const HARPER_TIME_ZONE = "America/Los_Angeles";

/** Above this many days an order preview escalates to the attention state. */
export const DEAL_AGE_ATTENTION_AFTER_DAYS = 5;

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: HARPER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const STAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: HARPER_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** `YYYY-MM-DD` civil date in the Harper business timezone. */
export function harperCalendarDay(value: Date | string): string | null {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const parts = DAY_FORMAT.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function civilMidnightUtc(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

const MS_PER_DAY = 86_400_000;

/**
 * Complete PT calendar days between the order's creation and `todayDay`.
 * Null when the timestamp is missing or unparseable — never a fabricated 0.
 * A creation day ahead of `todayDay` (only reachable through clock skew, since
 * the database generates the value) reads as 0 rather than going negative.
 */
export function dealAgeDays(
  createdAt: string | null | undefined,
  todayDay: string,
): number | null {
  if (!createdAt) return null;
  const createdDay = harperCalendarDay(createdAt);
  if (!createdDay) return null;
  const from = civilMidnightUtc(createdDay);
  const to = civilMidnightUtc(todayDay);
  if (from === null || to === null) return null;
  return Math.max(0, Math.round((to - from) / MS_PER_DAY));
}

/** `0 Day`, `1 Day`, `2 Days` — singular through one day, plural after. */
export function dealAgeLabel(days: number): string {
  return `${days.toLocaleString()} ${days <= 1 ? "Day" : "Days"}`;
}

export function dealAgeNeedsAttention(days: number): boolean {
  return days > DEAL_AGE_ATTENTION_AFTER_DAYS;
}

/** Exact creation moment with date, time and timezone, for the tooltip. */
export function harperTimestampLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return STAMP_FORMAT.format(date);
}
