"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DailyStatsSnapshotDialog } from "@/components/daily-stats-snapshot/DailyStatsSnapshotDialog";
import {
  createDailyStatsSnapshotModel,
  type DailyStatsSnapshot,
} from "@/lib/daily-stats-snapshot";
import {
  createDailyStatsSnapshotRenderJob,
  type DailyStatsSnapshotRenderJob,
} from "@/lib/daily-stats-snapshot-image";
import type { DailyOperationsStats } from "@/lib/operations-stats";

const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';
export const DAILY_STATS_SNAPSHOT_OPEN_ATTRIBUTE =
  "data-daily-stats-snapshot-open";

type SnapshotSession = {
  snapshot: DailyStatsSnapshot;
  job: DailyStatsSnapshotRenderJob;
};

function modalLayerBusy(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(MODAL_SELECTOR) !== null
  );
}

function useModalLayerBusy(): boolean {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => setBusy(modalLayerBusy());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "aria-modal"],
    });
    return () => observer.disconnect();
  }, []);
  return busy;
}

function SnapshotIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <rect x="2.75" y="4.25" width="14.5" height="11.5" rx="2.5" />
      <circle cx="10" cy="10" r="2.75" />
      <path d="M6.25 4.25 7.5 2.75h5l1.25 1.5" />
      <path d="M15 7h.01" />
    </svg>
  );
}

export function DailyStatsSnapshotButton({
  stats,
  disabled = false,
}: {
  stats: DailyOperationsStats | null;
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingRef = useRef(false);
  const otherModalOpen = useModalLayerBusy();
  const [session, setSession] = useState<SnapshotSession | null>(null);

  const releaseGlobalLock = useCallback(() => {
    document.documentElement.removeAttribute(
      DAILY_STATS_SNAPSHOT_OPEN_ATTRIBUTE,
    );
    openingRef.current = false;
  }, []);

  const close = useCallback(() => {
    setSession(null);
    releaseGlobalLock();
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [releaseGlobalLock]);

  useEffect(
    () => () => {
      if (session) releaseGlobalLock();
    },
    [releaseGlobalLock, session],
  );

  const open = () => {
    if (
      !stats ||
      disabled ||
      session ||
      openingRef.current ||
      modalLayerBusy() ||
      document.documentElement.hasAttribute(
        DAILY_STATS_SNAPSHOT_OPEN_ATTRIBUTE,
      )
    ) {
      return;
    }
    openingRef.current = true;
    document.documentElement.setAttribute(
      DAILY_STATS_SNAPSHOT_OPEN_ATTRIBUTE,
      "",
    );
    try {
      // These values are copied synchronously in the user gesture. Later stats
      // polls replace the navbar object but cannot mutate this frozen model.
      const snapshot = createDailyStatsSnapshotModel(stats);
      const job = createDailyStatsSnapshotRenderJob(snapshot);
      setSession({ snapshot, job });
    } catch {
      releaseGlobalLock();
    }
  };

  const unavailable =
    disabled || stats === null || otherModalOpen || session !== null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Create daily stats snapshot"
        title="Daily snapshot"
        disabled={unavailable}
        onClick={open}
        className="group flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-2 text-[11px] font-semibold text-[var(--muted)] transition-[border-color,background-color,color,transform] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:translate-y-px disabled:pointer-events-none disabled:opacity-40"
      >
        <SnapshotIcon />
        <span className="hidden whitespace-nowrap min-[1500px]:inline">
          Snapshot
        </span>
      </button>
      {session ? (
        <DailyStatsSnapshotDialog
          snapshot={session.snapshot}
          initialJob={session.job}
          onClose={close}
        />
      ) : null}
    </>
  );
}
