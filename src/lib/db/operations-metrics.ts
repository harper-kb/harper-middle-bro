import "server-only";

import fs from "fs";
import path from "path";

/**
 * Operational KPIs mirrored from the BigBrother header, precomputed for the
 * last seven business days so the stats bar can select any of them.
 *
 * Timezone rule, verified against live rows on 2026-08-15 and re-confirmed
 * when the unified stats bar briefly standardized everything on Eastern and
 * immediately diverged from BigBrother (15 bound Eastern vs 7 Pacific):
 * BigBrother resolves "Bind Sent" server-side on the Eastern business day,
 * but resolves the three activity counters (New Orders, Bound, COIs Sent)
 * against the *viewer's* local day. Reproducing its numbers therefore
 * requires precomputing every US business zone and letting the browser pick
 * its own via UTC offset. `AT TIME ZONE` window conversions keep
 * daylight-saving days (23/25 hours) correct.
 */
export const BIND_SENT_TIME_ZONE = "America/New_York" as const;

/**
 * Every distinct US business-day boundary. A viewer is matched by current UTC
 * offset rather than by name, so non-listed zones on the same offset (Phoenix
 * in summer) still resolve to identical window bounds.
 */
export const OPERATIONS_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

export type OperationsZone = (typeof OPERATIONS_ZONES)[number];

/** Today plus six prior calendar days, per the stats-bar date picker. */
export const OPERATIONS_HISTORY_DAYS = 7;

/**
 * Bind Sent history carries one extra day: every zone's calendar date is at
 * or behind Eastern's, so a zone's oldest selectable date can reach one day
 * past the Eastern seven-day window.
 */
export const BIND_HISTORY_DAYS = OPERATIONS_HISTORY_DAYS + 1;

export interface OperationsWindow {
  startsAt: string;
  endsAt: string;
}

export interface OperationsBindDay {
  /** Eastern business date this bind-sent row covers. */
  businessDate: string;
  window: OperationsWindow;
  total: number;
  sameDay: number;
  backlog: number;
}

export interface OperationsZoneDay {
  /** This zone's business date. */
  businessDate: string;
  window: OperationsWindow;
  newOrders: number;
  bound: number;
  coisSent: number;
}

export interface OperationsZoneHistory {
  timeZone: OperationsZone;
  /** Minutes this zone is currently behind UTC, matching `Date#getTimezoneOffset`. */
  utcOffsetMinutes: number;
  /** Exactly OPERATIONS_HISTORY_DAYS entries, newest business date first. */
  days: OperationsZoneDay[];
}

export interface OperationsMetricsSnapshot {
  calculatedAt: string;
  bindTimezone: typeof BIND_SENT_TIME_ZONE;
  /** Exactly BIND_HISTORY_DAYS entries, newest Eastern date first. */
  bindDays: OperationsBindDay[];
  zones: OperationsZoneHistory[];
}

export interface OperationsMetricsRow {
  calculated_at: unknown;
  bind_days: unknown;
  zones: unknown;
}

/**
 * Event definitions, verified against live Harper rows:
 * - Bind Sent — a binding-packet DocuSign envelope that acquired `sent_at`,
 *   deduped by `envelope_id`, split same-day/backlog through the envelope's
 *   stable `order_id` rather than any order on the same company.
 * - New Orders — non-deleted `orders_temp` rows by `created_at`.
 * - Bound — distinct `deals_v2.id` by `bound_at`.
 * - COIs Sent — `coi_edit_log` rows whose trigger is the email-out step;
 *   `download` and `save` are working states, not a send.
 *
 * Historical days re-derive from these authoritative event timestamps every
 * cycle, so a backfilled or corrected source row updates the day it belongs
 * to rather than freezing a stale count. Events are prefetched once for the
 * widest window and counted per zone-day, instead of re-scanning the source
 * tables for each of the 28 zone windows.
 */
export function buildOperationsMetricsSql(): string {
  const zoneList = OPERATIONS_ZONES.map((zone) => `'${zone}'`).join(", ");
  return `
WITH zone_windows AS (
  SELECT
    tz,
    ((now() AT TIME ZONE tz)::date - offs) AS business_date,
    (((now() AT TIME ZONE tz)::date - offs)::timestamp AT TIME ZONE tz) AS starts_at,
    (((now() AT TIME ZONE tz)::date - offs + 1)::timestamp AT TIME ZONE tz) AS ends_at
  FROM unnest(ARRAY[${zoneList}]) AS tz
  CROSS JOIN generate_series(0, ${OPERATIONS_HISTORY_DAYS - 1}) AS offs
),
bind_windows AS (
  SELECT
    ((now() AT TIME ZONE '${BIND_SENT_TIME_ZONE}')::date - offs) AS business_date,
    (((now() AT TIME ZONE '${BIND_SENT_TIME_ZONE}')::date - offs)::timestamp
       AT TIME ZONE '${BIND_SENT_TIME_ZONE}') AS starts_at,
    (((now() AT TIME ZONE '${BIND_SENT_TIME_ZONE}')::date - offs + 1)::timestamp
       AT TIME ZONE '${BIND_SENT_TIME_ZONE}') AS ends_at
  FROM generate_series(0, ${BIND_HISTORY_DAYS - 1}) AS offs
),
bounds AS (
  SELECT
    LEAST(
      (SELECT min(starts_at) FROM zone_windows),
      (SELECT min(starts_at) FROM bind_windows)
    ) AS starts_at,
    GREATEST(
      (SELECT max(ends_at) FROM zone_windows),
      (SELECT max(ends_at) FROM bind_windows)
    ) AS ends_at
),
sent_envelopes AS (
  SELECT DISTINCT ON (de.envelope_id)
    de.envelope_id,
    de.order_id,
    de.sent_at
  FROM public.docusign_envelopes de
  CROSS JOIN bounds b
  WHERE de.sent_at >= b.starts_at
    AND de.sent_at < b.ends_at
    AND de.subject ILIKE '%binding packet%'
  ORDER BY de.envelope_id, de.updated_at DESC
),
order_events AS (
  SELECT ot.id, ot.created_at
  FROM public.orders_temp ot
  CROSS JOIN bounds b
  WHERE NOT COALESCE(ot.is_deleted, false)
    AND ot.created_at >= b.starts_at
    AND ot.created_at < b.ends_at
),
bound_events AS (
  SELECT d.id, d.bound_at
  FROM public.deals_v2 d
  CROSS JOIN bounds b
  WHERE d.bound_at >= b.starts_at
    AND d.bound_at < b.ends_at
),
coi_events AS (
  SELECT l.created_at
  FROM public.coi_edit_log l
  CROSS JOIN bounds b
  WHERE l.trigger = 'prepare-email'
    AND l.created_at >= b.starts_at
    AND l.created_at < b.ends_at
),
bind_rows AS (
  SELECT
    w.business_date,
    w.starts_at,
    w.ends_at,
    (
      SELECT COUNT(*)
      FROM sent_envelopes se
      WHERE se.sent_at >= w.starts_at AND se.sent_at < w.ends_at
    ) AS total,
    (
      SELECT COUNT(*)
      FROM sent_envelopes se
      WHERE se.sent_at >= w.starts_at
        AND se.sent_at < w.ends_at
        AND EXISTS (
          SELECT 1
          FROM order_events oe
          WHERE oe.id = se.order_id
            AND oe.created_at >= w.starts_at
            AND oe.created_at < w.ends_at
        )
    ) AS same_day
  FROM bind_windows w
),
zone_rows AS (
  SELECT
    w.tz,
    w.business_date,
    w.starts_at,
    w.ends_at,
    (
      SELECT COUNT(*)
      FROM order_events e
      WHERE e.created_at >= w.starts_at AND e.created_at < w.ends_at
    ) AS new_orders,
    (
      SELECT COUNT(DISTINCT e.id)
      FROM bound_events e
      WHERE e.bound_at >= w.starts_at AND e.bound_at < w.ends_at
    ) AS bound,
    (
      SELECT COUNT(*)
      FROM coi_events e
      WHERE e.created_at >= w.starts_at AND e.created_at < w.ends_at
    ) AS cois_sent
  FROM zone_windows w
)
SELECT
  now() AS calculated_at,
  (
    SELECT json_agg(
      json_build_object(
        'businessDate', br.business_date::text,
        'startsAt', br.starts_at,
        'endsAt', br.ends_at,
        'total', br.total,
        'sameDay', br.same_day
      )
      ORDER BY br.business_date DESC
    )
    FROM bind_rows br
  ) AS bind_days,
  (
    SELECT json_agg(json_build_object('timeZone', z.tz, 'days', z.days) ORDER BY z.tz)
    FROM (
      SELECT
        zr.tz,
        json_agg(
          json_build_object(
            'businessDate', zr.business_date::text,
            'startsAt', zr.starts_at,
            'endsAt', zr.ends_at,
            'newOrders', zr.new_orders,
            'bound', zr.bound,
            'coisSent', zr.cois_sent
          )
          ORDER BY zr.business_date DESC
        ) AS days
      FROM zone_rows zr
      GROUP BY zr.tz
    ) z
  ) AS zones`;
}

export const OPERATIONS_METRICS_SQL = buildOperationsMetricsSql();

const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "operations-metrics.local.json",
);

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`operations metrics returned invalid ${field}`);
  }
  return new Date(value).toISOString();
}

function businessDay(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`operations metrics returned invalid ${field}`);
  }
  return value;
}

function count(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`operations metrics returned invalid ${field}`);
  }
  return parsed;
}

function window(
  day: Record<string, unknown>,
  businessDate: string,
): OperationsWindow {
  const startsAt = timestamp(day.startsAt, `${businessDate} window start`);
  const endsAt = timestamp(day.endsAt, `${businessDate} window end`);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error(
      `operations metrics returned an inverted ${businessDate} window`,
    );
  }
  return { startsAt, endsAt };
}

function assertNewestFirstContiguous(
  days: Array<{ businessDate: string; window: OperationsWindow }>,
  label: string,
): void {
  for (let i = 1; i < days.length; i += 1) {
    if (days[i].businessDate >= days[i - 1].businessDate) {
      throw new Error(`operations metrics ${label} days are not newest-first`);
    }
    if (days[i].window.endsAt !== days[i - 1].window.startsAt) {
      throw new Error(
        `operations metrics ${label} windows are not contiguous at ${days[i].businessDate}`,
      );
    }
  }
}

function parseBindDay(value: unknown, index: number): OperationsBindDay {
  if (!value || typeof value !== "object") {
    throw new Error(`operations metrics bind day ${index} is not an object`);
  }
  const day = value as Record<string, unknown>;
  const businessDate = businessDay(day.businessDate, `bind day ${index} date`);
  const total = count(day.total, `${businessDate} bind sent total`);
  const sameDay = count(day.sameDay, `${businessDate} bind sent same-day`);
  if (sameDay > total) {
    throw new Error(
      `operations metrics bind invariant failed on ${businessDate}: same-day ${sameDay} > total ${total}`,
    );
  }
  return {
    businessDate,
    window: window(day, businessDate),
    total,
    sameDay,
    backlog: total - sameDay,
  };
}

function parseZoneDay(
  value: unknown,
  zone: string,
  index: number,
): OperationsZoneDay {
  if (!value || typeof value !== "object") {
    throw new Error(`operations metrics ${zone} day ${index} is not an object`);
  }
  const day = value as Record<string, unknown>;
  const businessDate = businessDay(day.businessDate, `${zone} day ${index}`);
  return {
    businessDate,
    window: window(day, `${zone} ${businessDate}`),
    newOrders: count(day.newOrders, `${zone} ${businessDate} new orders`),
    bound: count(day.bound, `${zone} ${businessDate} bound`),
    coisSent: count(day.coisSent, `${zone} ${businessDate} COIs sent`),
  };
}

function parseZone(value: unknown, index: number): OperationsZoneHistory {
  if (!value || typeof value !== "object") {
    throw new Error(`operations metrics zone ${index} is not an object`);
  }
  const zone = value as Record<string, unknown>;
  const timeZone = zone.timeZone;
  if (
    typeof timeZone !== "string" ||
    !(OPERATIONS_ZONES as readonly string[]).includes(timeZone)
  ) {
    throw new Error(`operations metrics returned an unexpected zone ${index}`);
  }
  if (
    !Array.isArray(zone.days) ||
    zone.days.length !== OPERATIONS_HISTORY_DAYS
  ) {
    throw new Error(
      `operations metrics ${timeZone} did not return ${OPERATIONS_HISTORY_DAYS} days`,
    );
  }

  const days = zone.days.map((day, dayIndex) =>
    parseZoneDay(day, timeZone, dayIndex),
  );
  assertNewestFirstContiguous(days, timeZone);

  const newest = days[0];
  const utcOffsetMinutes =
    (Date.parse(newest.window.startsAt) -
      Date.parse(`${newest.businessDate}T00:00:00Z`)) /
    60_000;
  if (!Number.isSafeInteger(utcOffsetMinutes)) {
    throw new Error(`operations metrics returned an invalid ${timeZone} offset`);
  }

  return { timeZone: timeZone as OperationsZone, utcOffsetMinutes, days };
}

export function parseOperationsMetricsRow(
  row: OperationsMetricsRow | undefined,
): OperationsMetricsSnapshot {
  if (!row) {
    throw new Error("operations metrics query returned no row");
  }
  if (!Array.isArray(row.bind_days) || row.bind_days.length !== BIND_HISTORY_DAYS) {
    throw new Error(
      `operations metrics did not return ${BIND_HISTORY_DAYS} bind days`,
    );
  }
  if (!Array.isArray(row.zones) || row.zones.length !== OPERATIONS_ZONES.length) {
    throw new Error("operations metrics did not return every business zone");
  }

  const bindDays = row.bind_days.map(parseBindDay);
  assertNewestFirstContiguous(bindDays, "bind");

  const zones = row.zones.map(parseZone);
  const distinctZones = new Set(zones.map((zone) => zone.timeZone));
  if (distinctZones.size !== OPERATIONS_ZONES.length) {
    throw new Error("operations metrics returned duplicate business zones");
  }

  // Every selectable zone date must have a matching Eastern bind-sent day.
  for (const zone of zones) {
    for (const day of zone.days) {
      if (!bindDays.some((bind) => bind.businessDate === day.businessDate)) {
        throw new Error(
          `operations metrics has no bind-sent row for ${zone.timeZone} ${day.businessDate}`,
        );
      }
    }
  }

  return {
    calculatedAt: timestamp(row.calculated_at, "calculation timestamp"),
    bindTimezone: BIND_SENT_TIME_ZONE,
    bindDays,
    zones,
  };
}

function isSnapshot(value: unknown): value is OperationsMetricsSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as OperationsMetricsSnapshot;
  if (candidate.bindTimezone !== BIND_SENT_TIME_ZONE) return false;
  try {
    const parsed = parseOperationsMetricsRow({
      calculated_at: candidate.calculatedAt,
      bind_days: Array.isArray(candidate.bindDays)
        ? candidate.bindDays.map((day) => ({
            businessDate: day?.businessDate,
            startsAt: day?.window?.startsAt,
            endsAt: day?.window?.endsAt,
            total: day?.total,
            sameDay: day?.sameDay,
          }))
        : candidate.bindDays,
      zones: Array.isArray(candidate.zones)
        ? candidate.zones.map((zone) => ({
            timeZone: zone?.timeZone,
            days: Array.isArray(zone?.days)
              ? zone.days.map((day) => ({
                  businessDate: day?.businessDate,
                  startsAt: day?.window?.startsAt,
                  endsAt: day?.window?.endsAt,
                  newOrders: day?.newOrders,
                  bound: day?.bound,
                  coisSent: day?.coisSent,
                }))
              : zone?.days,
          }))
        : candidate.zones,
    });
    return JSON.stringify(parsed) === JSON.stringify(candidate);
  } catch {
    return false;
  }
}

export function readOperationsMetricsSnapshot(): OperationsMetricsSnapshot | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as unknown;
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeOperationsMetricsSnapshot(
  snapshot: OperationsMetricsSnapshot,
): void {
  if (!isSnapshot(snapshot)) {
    throw new Error("refusing to write an invalid operations metrics snapshot");
  }
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  const tempPath = `${SNAPSHOT_PATH}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(snapshot)}\n`);
  fs.renameSync(tempPath, SNAPSHOT_PATH);
}
