export type CompanyTimeZoneSource = "stored_iana" | "state_default";

export type CompanyTimeZoneUnavailableReason =
  | "stored_timezone_missing"
  | "stored_timezone_unverified"
  | "state_missing"
  | "state_unrecognized";

export interface CompanyTimeZoneResolution {
  timeZone: string | null;
  source: CompanyTimeZoneSource | null;
  unavailableReason: CompanyTimeZoneUnavailableReason | null;
}

/**
 * One dependable default for every US state plus Washington, DC. States that
 * cross a time-zone boundary use the zone covering most residents. A stored
 * company IANA zone still wins when one is available.
 */
export const US_STATE_TIME_ZONES = [
  { code: "AL", name: "Alabama", timeZone: "America/Chicago" },
  { code: "AK", name: "Alaska", timeZone: "America/Anchorage" },
  { code: "AZ", name: "Arizona", timeZone: "America/Phoenix" },
  { code: "AR", name: "Arkansas", timeZone: "America/Chicago" },
  { code: "CA", name: "California", timeZone: "America/Los_Angeles" },
  { code: "CO", name: "Colorado", timeZone: "America/Denver" },
  { code: "CT", name: "Connecticut", timeZone: "America/New_York" },
  { code: "DC", name: "District of Columbia", timeZone: "America/New_York" },
  { code: "DE", name: "Delaware", timeZone: "America/New_York" },
  { code: "FL", name: "Florida", timeZone: "America/New_York" },
  { code: "GA", name: "Georgia", timeZone: "America/New_York" },
  { code: "HI", name: "Hawaii", timeZone: "Pacific/Honolulu" },
  { code: "ID", name: "Idaho", timeZone: "America/Denver" },
  { code: "IL", name: "Illinois", timeZone: "America/Chicago" },
  { code: "IN", name: "Indiana", timeZone: "America/New_York" },
  { code: "IA", name: "Iowa", timeZone: "America/Chicago" },
  { code: "KS", name: "Kansas", timeZone: "America/Chicago" },
  { code: "KY", name: "Kentucky", timeZone: "America/New_York" },
  { code: "LA", name: "Louisiana", timeZone: "America/Chicago" },
  { code: "ME", name: "Maine", timeZone: "America/New_York" },
  { code: "MD", name: "Maryland", timeZone: "America/New_York" },
  { code: "MA", name: "Massachusetts", timeZone: "America/New_York" },
  { code: "MI", name: "Michigan", timeZone: "America/New_York" },
  { code: "MN", name: "Minnesota", timeZone: "America/Chicago" },
  { code: "MS", name: "Mississippi", timeZone: "America/Chicago" },
  { code: "MO", name: "Missouri", timeZone: "America/Chicago" },
  { code: "MT", name: "Montana", timeZone: "America/Denver" },
  { code: "NE", name: "Nebraska", timeZone: "America/Chicago" },
  { code: "NV", name: "Nevada", timeZone: "America/Los_Angeles" },
  { code: "NH", name: "New Hampshire", timeZone: "America/New_York" },
  { code: "NJ", name: "New Jersey", timeZone: "America/New_York" },
  { code: "NM", name: "New Mexico", timeZone: "America/Denver" },
  { code: "NY", name: "New York", timeZone: "America/New_York" },
  { code: "NC", name: "North Carolina", timeZone: "America/New_York" },
  { code: "ND", name: "North Dakota", timeZone: "America/Chicago" },
  { code: "OH", name: "Ohio", timeZone: "America/New_York" },
  { code: "OK", name: "Oklahoma", timeZone: "America/Chicago" },
  { code: "OR", name: "Oregon", timeZone: "America/Los_Angeles" },
  { code: "PA", name: "Pennsylvania", timeZone: "America/New_York" },
  { code: "RI", name: "Rhode Island", timeZone: "America/New_York" },
  { code: "SC", name: "South Carolina", timeZone: "America/New_York" },
  { code: "SD", name: "South Dakota", timeZone: "America/Chicago" },
  { code: "TN", name: "Tennessee", timeZone: "America/Chicago" },
  { code: "TX", name: "Texas", timeZone: "America/Chicago" },
  { code: "UT", name: "Utah", timeZone: "America/Denver" },
  { code: "VT", name: "Vermont", timeZone: "America/New_York" },
  { code: "VA", name: "Virginia", timeZone: "America/New_York" },
  { code: "WA", name: "Washington", timeZone: "America/Los_Angeles" },
  { code: "WV", name: "West Virginia", timeZone: "America/New_York" },
  { code: "WI", name: "Wisconsin", timeZone: "America/Chicago" },
  { code: "WY", name: "Wyoming", timeZone: "America/Denver" },
] as const;

const FRIENDLY_TIME_ZONE_LABELS: Readonly<Record<string, string>> = {
  "America/New_York": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Phoenix": "Mountain Time · Arizona",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
};

const supportedZoneCache = new Map<string, boolean>();

function trimmed(value: string | null | undefined): string | null {
  const next = value?.trim() ?? "";
  return next || null;
}

const stateTimeZoneByKey = new Map<string, string>();
for (const state of US_STATE_TIME_ZONES) {
  stateTimeZoneByKey.set(state.code, state.timeZone);
  stateTimeZoneByKey.set(state.name.toUpperCase(), state.timeZone);
}

export function timeZoneForUsState(
  value: string | null | undefined,
): string | null {
  const key = trimmed(value)
    ?.replace(/\./g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
  return key ? (stateTimeZoneByKey.get(key) ?? null) : null;
}

/**
 * Accept named IANA zones, never fixed abbreviations such as EST or raw offsets.
 * Harper's current verified values are all regional names (America/* or
 * Pacific/*), which preserve DST rules through Intl.
 */
export function isSupportedIanaTimeZone(
  value: string | null | undefined,
): value is string {
  const zone = trimmed(value);
  if (!zone || !zone.includes("/") || zone.startsWith("Etc/GMT")) return false;
  const cached = supportedZoneCache.get(zone);
  if (cached !== undefined) return cached;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    supportedZoneCache.set(zone, true);
    return true;
  } catch {
    supportedZoneCache.set(zone, false);
    return false;
  }
}

export function normalizeHarperTimeZone(
  value: string | null | undefined,
): { timeZone: string; source: "stored_iana" } | null {
  const zone = trimmed(value);
  return zone && isSupportedIanaTimeZone(zone)
    ? { timeZone: zone, source: "stored_iana" }
    : null;
}

export function resolveCompanyTimeZone({
  storedTimeZone,
  state,
}: {
  storedTimeZone: string | null | undefined;
  state?: string | null | undefined;
}): CompanyTimeZoneResolution {
  const stored = normalizeHarperTimeZone(storedTimeZone);
  if (stored) {
    return {
      timeZone: stored.timeZone,
      source: stored.source,
      unavailableReason: null,
    };
  }

  const stateTimeZone = timeZoneForUsState(state);
  if (stateTimeZone) {
    return {
      timeZone: stateTimeZone,
      source: "state_default",
      unavailableReason: null,
    };
  }

  return {
    timeZone: null,
    source: null,
    unavailableReason: trimmed(state)
      ? "state_unrecognized"
      : trimmed(storedTimeZone)
        ? "stored_timezone_unverified"
        : "state_missing",
  };
}

export function friendlyCompanyTimeZoneLabel(timeZone: string): string {
  const known = FRIENDLY_TIME_ZONE_LABELS[timeZone];
  if (known) return known;
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((candidate) => candidate.type === "timeZoneName")?.value;
    return part || timeZone;
  } catch {
    return timeZone;
  }
}

export interface CustomerLocalTimeParts {
  time: string;
  date: string;
  exact: string;
  shortZoneName: string;
  zoneLabel: string;
}

export function formatCustomerLocalTime(
  value: Date | number | string,
  timeZone: string,
): CustomerLocalTimeParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()) || !isSupportedIanaTimeZone(timeZone)) {
    return null;
  }
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  const localDate = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(date);
  const exact = new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(date);
  const shortZoneName =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  return {
    time,
    date: localDate,
    exact,
    shortZoneName,
    zoneLabel: friendlyCompanyTimeZoneLabel(timeZone),
  };
}

export function millisecondsUntilNextMinute(now = Date.now()): number {
  const remainder = ((now % 60_000) + 60_000) % 60_000;
  return remainder === 0 ? 60_000 : 60_000 - remainder;
}
