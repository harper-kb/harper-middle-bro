"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  useTransition,
} from "react";

export const SPINE_LIVE_REFRESH_MS = 5 * 60_000;

/**
 * Refresh the current RSC payload without navigating, replacing the board,
 * table, counts and sync time as one server result while the URL-owned
 * filters remain untouched (Records pattern). Hidden tabs wait until they are
 * visible instead of issuing background reads the operator cannot see.
 */
export function SpineLiveRefresh() {
  const router = useRouter();
  const lastRequestedAt = useRef(0);

  useEffect(() => {
    lastRequestedAt.current = Date.now();
    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") return;
      lastRequestedAt.current = Date.now();
      router.refresh();
    };
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRequestedAt.current >= SPINE_LIVE_REFRESH_MS
      ) {
        refreshIfVisible();
      }
    };

    const timer = window.setInterval(refreshIfVisible, SPINE_LIVE_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}

const subscribe = () => () => {};

/** Hydration-safe local time for the compact freshness cluster. The exact
 * timestamp remains available in the tooltip. */
export function SpineUpdatedTime({ value }: { value: string }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span>Unavailable</span>;
  const visible = hydrated
    ? new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(date)
    : date.toISOString().slice(11, 16) + " UTC";
  const exact = hydrated
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeStyle: "long",
      }).format(date)
    : date.toISOString();
  return (
    <time dateTime={date.toISOString()} title={exact}>
      {visible}
    </time>
  );
}

/**
 * Manual refresh: re-reads the spine mirror through a fresh server render.
 * Per house rule it does not trigger a Supabase pull — the refresher owns
 * that cadence.
 */
export function SpineRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn-ghost min-h-10 min-w-[6.25rem] gap-1.5 px-3"
      aria-label="Refresh Service Spine from the local mirror"
      aria-live="polite"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className={`h-3.5 w-3.5 ${isPending ? "motion-safe:animate-spin" : ""}`}
      >
        <path d="M12.5 5.5V2.8l-1.2 1.1A5 5 0 1 0 13 9" />
        <path d="m12.5 2.8-2.6-.1" />
      </svg>
      <span>{isPending ? "Refreshing" : "Refresh"}</span>
    </button>
  );
}
