import type { DailyOperationsStats } from "@/lib/operations-stats";

export type DailyStatsSnapshot = Readonly<{
  selectedDate: string;
  selectedDateLabel: string;
  isCurrentBusinessDate: boolean;
  reportingTimeZone: string;
  bindSentTimeZone: string;
  reportingWindow: Readonly<{ startsAt: string; endsAt: string }>;
  bindSentWindow: Readonly<{ startsAt: string; endsAt: string }>;
  capturedAt: string;
  capturedTimeZone: string;
  capturedTimeZoneLabel: string;
  dataUpdatedAt: string | null;
  metricsCalculatedAt: string;
  metrics: Readonly<{
    bindSent: Readonly<{
      total: number;
      sameDay: number;
      backlog: number;
    }>;
    newOrders: number;
    bound: number;
    coisSent: number;
  }>;
}>;

const COMMON_TIME_ZONE_LABELS: Readonly<Record<string, string>> = {
  "America/Los_Angeles": "Pacific Time",
  "America/Denver": "Mountain Time",
  "America/Chicago": "Central Time",
  "America/New_York": "Eastern Time",
  "Etc/UTC": "Coordinated Universal Time",
  UTC: "Coordinated Universal Time",
};

function validTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return "Etc/UTC";
  }
}

export function currentUserTimeZone(): string {
  return validTimeZone(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
  );
}

export function friendlyTimeZoneLabel(
  timeZone: string,
  at: Date | string = new Date(),
): string {
  const resolved = validTimeZone(timeZone);
  const instant = at instanceof Date ? at : new Date(at);
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: resolved,
      timeZoneName: "longGeneric",
    })
      .formatToParts(instant)
      .find((candidate) => candidate.type === "timeZoneName")?.value;
    if (part && !part.includes("/")) return part;
  } catch {
    // Fall through to the stable product labels below.
  }
  return (
    COMMON_TIME_ZONE_LABELS[resolved] ??
    resolved.split("/").at(-1)?.replaceAll("_", " ") ??
    "Local time"
  );
}

function shortTimeZoneLabel(timeZone: string, at: string): string {
  const resolved = validTimeZone(timeZone);
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: resolved,
      timeZoneName: "shortGeneric",
    })
      .formatToParts(new Date(at))
      .find((candidate) => candidate.type === "timeZoneName")?.value;
    if (part) return part.replace(/\s+/g, "");
  } catch {
    // Use a short stable fallback.
  }
  const common = COMMON_TIME_ZONE_LABELS[resolved];
  return common
    ? common
        .split(/\s+/)
        .map((word) => word[0])
        .join("")
        .toUpperCase()
    : "LT";
}

export function formatBusinessDate(businessDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${businessDate}T00:00:00Z`));
}

export function formatSelectedStatsDate(
  businessDate: string,
  isCurrentBusinessDate: boolean,
): string {
  const formatted = formatBusinessDate(businessDate);
  return isCurrentBusinessDate ? `Today · ${formatted}` : formatted;
}

export function formatSnapshotTime(
  iso: string,
  timeZone: string,
  includeSeconds = false,
): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    timeZone: validTimeZone(timeZone),
  }).format(new Date(iso));
}

export function formatSnapshotDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: validTimeZone(timeZone),
  }).format(new Date(iso));
}

export function formatCapturedMetadata(
  snapshot: DailyStatsSnapshot,
): string {
  return `${formatSnapshotDate(snapshot.capturedAt, snapshot.capturedTimeZone)} · ${formatSnapshotTime(snapshot.capturedAt, snapshot.capturedTimeZone, true)} · ${snapshot.capturedTimeZoneLabel}`;
}

export function createDailyStatsSnapshotModel(
  stats: DailyOperationsStats,
  options: { capturedAt?: Date; capturedTimeZone?: string } = {},
): DailyStatsSnapshot {
  const capturedAt = options.capturedAt ?? new Date();
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new Error("Cannot create a daily stats snapshot with an invalid time.");
  }
  const capturedTimeZone = validTimeZone(
    options.capturedTimeZone ?? currentUserTimeZone(),
  );
  const capturedIso = capturedAt.toISOString();
  const bindSent = Object.freeze({ ...stats.metrics.bindSent });
  const metrics = Object.freeze({
    bindSent,
    newOrders: stats.metrics.newOrders,
    bound: stats.metrics.bound,
    coisSent: stats.metrics.coisSent,
  });

  return Object.freeze({
    selectedDate: stats.selectedBusinessDate,
    selectedDateLabel: formatSelectedStatsDate(
      stats.selectedBusinessDate,
      stats.isCurrentBusinessDate,
    ),
    isCurrentBusinessDate: stats.isCurrentBusinessDate,
    reportingTimeZone: stats.businessTimezone,
    bindSentTimeZone: stats.bindSentTimezone,
    reportingWindow: Object.freeze({ ...stats.businessWindow }),
    bindSentWindow: Object.freeze({ ...stats.bindSentWindow }),
    capturedAt: capturedIso,
    capturedTimeZone,
    capturedTimeZoneLabel: friendlyTimeZoneLabel(
      capturedTimeZone,
      capturedIso,
    ),
    dataUpdatedAt: stats.dataRevision.lastSuccessfulSyncAt,
    metricsCalculatedAt: stats.dataRevision.metricsCalculatedAt,
    metrics,
  });
}

export function dailyStatsSnapshotFilename(
  snapshot: DailyStatsSnapshot,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: validTimeZone(snapshot.capturedTimeZone),
  }).formatToParts(new Date(snapshot.capturedAt));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const zone = shortTimeZoneLabel(
    snapshot.capturedTimeZone,
    snapshot.capturedAt,
  )
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 8);
  return `step-bro-daily-stats-${snapshot.selectedDate}-${hour}${minute}-${zone || "local"}.png`;
}

export function dailyStatsSnapshotAltText(
  snapshot: DailyStatsSnapshot,
): string {
  const { metrics } = snapshot;
  return [
    `Daily Operations for ${snapshot.selectedDateLabel}.`,
    `Bind Sent ${metrics.bindSent.total}, including ${metrics.bindSent.sameDay} same-day and ${metrics.bindSent.backlog} backlog.`,
    `New Orders ${metrics.newOrders}.`,
    `Bound ${metrics.bound}.`,
    `COIs Sent ${metrics.coisSent}.`,
    `Snapshot taken ${formatCapturedMetadata(snapshot)}.`,
  ].join(" ");
}
