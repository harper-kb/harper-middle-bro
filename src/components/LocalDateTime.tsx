"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function LocalDateTime({
  value,
  dateOnly = false,
}: {
  value: string;
  dateOnly?: boolean;
}) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span>Unavailable</span>;

  const compact = hydrated
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        ...(dateOnly ? {} : { timeStyle: "short" }),
      }).format(date)
    : dateOnly
      ? date.toISOString().slice(0, 10)
      : date.toISOString().replace("T", " ").replace(".000Z", " UTC");
  const exact = hydrated
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeStyle: "long",
      }).format(date)
    : date.toISOString();

  return (
    <time dateTime={date.toISOString()} title={exact}>
      {compact}
    </time>
  );
}
