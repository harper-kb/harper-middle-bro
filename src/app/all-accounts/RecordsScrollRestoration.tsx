"use client";

import { useEffect } from "react";
import {
  recordsFilterHref,
  type RecordsFilterState,
} from "./records-filter-state";

const MAX_AGE_MS = 30 * 60_000;

function storageKey(state: RecordsFilterState): string {
  const href = recordsFilterHref(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < href.length; i += 1) {
    hash ^= href.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `records-scroll:${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Store only a number under a state hash — never the URL, query text, account
 * name or another user's data. This is navigation history, not a second filter
 * store, and an expired entry is ignored.
 */
export function rememberRecordsScroll(state: RecordsFilterState): void {
  try {
    window.sessionStorage.setItem(
      storageKey(state),
      JSON.stringify({ y: window.scrollY, at: Date.now() }),
    );
  } catch {
    // Private browsing / storage pressure: URL restoration still works.
  }
}

export function RecordsScrollRestoration({
  state,
}: {
  state: RecordsFilterState;
}) {
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(storageKey(state));
      window.sessionStorage.removeItem(storageKey(state));
    } catch {
      return;
    }
    if (!raw) return;

    let value: { y?: unknown; at?: unknown };
    try {
      value = JSON.parse(raw) as { y?: unknown; at?: unknown };
    } catch {
      return;
    }
    if (
      typeof value.y !== "number" ||
      !Number.isFinite(value.y) ||
      value.y < 0 ||
      typeof value.at !== "number" ||
      Date.now() - value.at > MAX_AGE_MS
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const max = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      window.scrollTo({ top: Math.min(value.y as number, max) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state]);

  return null;
}
