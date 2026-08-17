"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CompanySummaryCard } from "./CompanySummaryCard";
import {
  formatCustomerLocalTime,
  millisecondsUntilNextMinute,
  timeZoneForUsState,
} from "@/lib/company-time-zone";
import type {
  CompanyLocation,
  CompanyTimeZone,
} from "@/lib/company-detail-types";

const subscribeHydration = () => () => {};

function locationLabel(location: CompanyLocation): string | null {
  const region = location.stateCode ?? location.state;
  return [location.city, region].filter(Boolean).join(", ") || null;
}

export function CustomerLocalTime({
  companyId,
  location,
  timeZone,
}: {
  companyId: number;
  location: CompanyLocation;
  timeZone: CompanyTimeZone;
}) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let interval: number | null = null;
    const timeout = window.setTimeout(() => {
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 60_000);
    }, millisecondsUntilNextMinute(Date.now()));
    return () => {
      window.clearTimeout(timeout);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [companyId]);

  const resolvedTimeZone =
    timeZone.id ??
    timeZoneForUsState(location.stateCode ?? location.state);
  const local = resolvedTimeZone
    ? formatCustomerLocalTime(now, resolvedTimeZone)
    : null;
  const place = locationLabel(location);
  const exactTitle =
    resolvedTimeZone && hydrated && local
      ? `Current time at the customer's location: ${local.exact}. IANA time zone: ${resolvedTimeZone}.`
      : resolvedTimeZone
        ? `Current time at the customer's location. IANA time zone: ${resolvedTimeZone}.`
        : "Current time at the customer's location is unavailable because its state is missing or unrecognized.";

  return (
    <CompanySummaryCard
      tone="time"
      label="Customer local time"
      help="Current time from the company's saved time zone or state."
    >
      <div title={exactTitle}>
        {!resolvedTimeZone ? (
          <>
            <p className="company-card-empty">Local time unavailable</p>
            <p className="company-card-supporting">
              State is missing or unrecognized for this company.
            </p>
          </>
        ) : !hydrated || !local ? (
          <div aria-label="Loading customer local time" aria-busy="true">
            <span
              aria-hidden="true"
              className="block h-7 w-24 animate-pulse rounded bg-[var(--surface-subtle)] motion-reduce:animate-none"
            />
            <span
              aria-hidden="true"
              className="mt-2 block h-3 w-40 animate-pulse rounded bg-[var(--surface-subtle)] motion-reduce:animate-none"
            />
          </div>
        ) : (
          <div className="company-local-time-row">
            <time
              dateTime={new Date(now).toISOString()}
              className="company-local-time-value"
            >
              {local.time}
            </time>
            <span className="company-local-time-details">
              <span
                className="company-card-supporting block truncate"
                title={`${local.zoneLabel}${place ? ` · ${place}` : ""}`}
              >
                {local.zoneLabel}
                {place ? ` · ${place}` : ""}
              </span>
              <span className="company-card-meta block">
                Today · {local.date}
              </span>
            </span>
          </div>
        )}
      </div>
    </CompanySummaryCard>
  );
}
