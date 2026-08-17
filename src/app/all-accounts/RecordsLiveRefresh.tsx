"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export const RECORDS_LIVE_REFRESH_MS = 5 * 60_000;

/**
 * Refresh the current RSC payload without navigating, replacing the account
 * rows, total and pagination as one server result while the URL-owned filters
 * remain untouched. Hidden tabs wait until they are visible instead of issuing
 * background reads the operator cannot see.
 */
export function RecordsLiveRefresh() {
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
        Date.now() - lastRequestedAt.current >= RECORDS_LIVE_REFRESH_MS
      ) {
        refreshIfVisible();
      }
    };

    const timer = window.setInterval(
      refreshIfVisible,
      RECORDS_LIVE_REFRESH_MS,
    );
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
