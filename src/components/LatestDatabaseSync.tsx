"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

interface RefreshStatus {
  lastSuccessfulAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: "success" | "failed" | null;
}

interface ObservedRefreshStatus {
  value: RefreshStatus;
  observedAt: number;
}

const POLL_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = 10 * 60_000;
const LOCATION_STORAGE_KEY = "step-bro-current-city";
const LOCATION_EVENT = "step-bro-current-city-change";

interface CachedLocation {
  city: string | null;
  state: "resolved" | "denied" | "unavailable";
}

function readLocationSnapshot(): string {
  try {
    return localStorage.getItem(LOCATION_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribeLocation(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LOCATION_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(LOCATION_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LOCATION_EVENT, onChange);
  };
}

function parseCachedLocation(raw: string): CachedLocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedLocation>;
    if (
      (parsed.state === "resolved" ||
        parsed.state === "denied" ||
        parsed.state === "unavailable") &&
      (typeof parsed.city === "string" || parsed.city === null)
    ) {
      return { city: parsed.city, state: parsed.state };
    }
  } catch {
    // Ignore corrupt local state and offer location setup again.
  }
  return null;
}

function cacheLocation(value: CachedLocation): void {
  try {
    // City and outcome only — precise coordinates are never persisted.
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage failure should not prevent the current lookup from completing.
  }
  window.dispatchEvent(new Event(LOCATION_EVENT));
}

function friendlyTimeZone(timeZone: string): string {
  for (const style of ["longGeneric", "long"] as const) {
    try {
      const name = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: style,
      })
        .formatToParts(new Date(0))
        .find((part) => part.type === "timeZoneName")?.value;
      if (name && name !== timeZone && !name.includes("/")) return name;
    } catch {
      // Try the next supported Intl timezone style.
    }
  }
  return "Local Time";
}

export function LatestDatabaseSync() {
  const [observed, setObserved] = useState<ObservedRefreshStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const [locating, setLocating] = useState(false);
  const locationSnapshot = useSyncExternalStore(
    subscribeLocation,
    readLocationSnapshot,
    () => "",
  );
  const cachedLocation = parseCachedLocation(locationSnapshot);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/book-refresh-status", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const value = (await response.json()) as RefreshStatus;
        if (active) {
          setObserved({ value, observedAt: Date.now() });
          setUnavailable(false);
        }
      } catch {
        // Keep the last successful value visible through transient failures.
        if (active) setUnavailable(true);
      }
    };

    void load();
    const timer = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  const timeZoneName = friendlyTimeZone(timeZone);
  const successfulAt = observed?.value.lastSuccessfulAt ?? null;
  const failed =
    observed?.value.lastAttemptStatus === "failed" &&
    observed.value.lastAttemptAt != null &&
    (!successfulAt ||
      Date.parse(observed.value.lastAttemptAt) > Date.parse(successfulAt));
  const stale =
    successfulAt != null &&
    observed != null &&
    observed.observedAt - Date.parse(successfulAt) > STALE_AFTER_MS;

  const state = unavailable
    ? { label: "Status unavailable", tone: "bg-[var(--muted)]" }
    : failed
      ? { label: "Refresh issue", tone: "bg-[var(--warning)]" }
      : !successfulAt
        ? { label: "Awaiting sync", tone: "bg-[var(--muted)]" }
        : stale
          ? { label: "Stale", tone: "bg-[var(--muted)]" }
          : { label: "Up to date", tone: "bg-[var(--success)]" };

  const formatted = successfulAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(successfulAt))
    : observed
      ? "Not synced yet"
      : "Checking…";

  const cityLabel =
    cachedLocation?.state === "resolved" && cachedLocation.city
      ? cachedLocation.city
      : cachedLocation
        ? "Location unavailable"
        : "Add city";

  const requestLocation = () => {
    setShowLocationPrompt(false);
    if (!navigator.geolocation) {
      cacheLocation({ city: null, state: "unavailable" });
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const response = await fetch("/api/location/city", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: coords.latitude,
              longitude: coords.longitude,
            }),
          });
          if (!response.ok) throw new Error(`status ${response.status}`);
          const result = (await response.json()) as { city?: unknown };
          if (typeof result.city !== "string" || !result.city.trim()) {
            throw new Error("No locality returned");
          }
          cacheLocation({ city: result.city.trim(), state: "resolved" });
        } catch {
          cacheLocation({ city: null, state: "unavailable" });
        } finally {
          setLocating(false);
        }
      },
      (error) => {
        cacheLocation({
          city: null,
          state:
            error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        });
        setLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 5 * 60_000,
      },
    );
  };

  const openLocationPrompt = () => {
    if (cachedLocation?.state === "resolved") {
      requestLocation();
    } else {
      setShowLocationPrompt(true);
    }
  };

  return (
    <div className="min-w-0" title={`Database sync: ${state.label}.`}>
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${state.tone}`}
        />
        <span className="sr-only">{state.label}.</span>
        Latest database sync
      </div>
      <p className="mt-1 truncate text-[12px] font-semibold tabular-nums text-[var(--ink)]">
        {formatted}
      </p>
      <button
        type="button"
        onClick={openLocationPrompt}
        disabled={locating}
        className="mt-0.5 flex max-w-full items-center gap-1 text-left text-[9px] text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        title={
          cachedLocation?.state === "resolved"
            ? "Refresh current city"
            : "Use location to show current city"
        }
        aria-label={
          cachedLocation?.state === "resolved"
            ? "Refresh current city"
            : "Add current city"
        }
      >
        <span className="truncate">
          {timeZoneName} - {locating ? "Locating…" : cityLabel}
        </span>
        <LocationIcon
          refreshing={locating}
          refreshable={cachedLocation?.state === "resolved"}
        />
      </button>

      {showLocationPrompt && (
        <div className="mt-2 rounded-lg border border-[var(--rule)] bg-[var(--surface-subtle)] p-2 text-left">
          <p className="text-[9px] leading-4 text-[var(--muted)]">
            Location is used only to show your current city.
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={requestLocation}
              className="rounded-md bg-[var(--accent)] px-2 py-1 text-[9px] font-semibold text-[var(--accent-contrast)]"
            >
              Use location
            </button>
            <button
              type="button"
              onClick={() => setShowLocationPrompt(false)}
              className="rounded-md px-2 py-1 text-[9px] font-semibold text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LocationIcon({
  refreshing,
  refreshable,
}: {
  refreshing: boolean;
  refreshable: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className={`h-3 w-3 shrink-0 ${refreshing ? "animate-spin" : ""}`}
    >
      {refreshing ? (
        <path d="M13 8a5 5 0 1 1-1.5-3.5" />
      ) : refreshable ? (
        <>
          <path d="M12.5 5.5V2.8l-1.2 1.1A5 5 0 1 0 13 9" />
          <path d="m12.5 2.8-2.6-.1" />
        </>
      ) : (
        <>
          <path d="M8 14s4-3.7 4-7a4 4 0 1 0-8 0c0 3.3 4 7 4 7Z" />
          <circle cx="8" cy="7" r="1.3" />
        </>
      )}
    </svg>
  );
}
