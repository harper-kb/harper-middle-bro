import type { SpineSyncStatus } from "@/lib/service-spine/domain";
import {
  SpineRefreshButton,
  SpineUpdatedTime,
} from "./SpineLiveRefresh";

export function ServiceSpineHeader({ sync }: { sync: SpineSyncStatus }) {
  return (
    <header className="spine-page-header">
      <div className="min-w-0">
        <p className="eyebrow">Service Operations</p>
        <h1 className="page-title mt-0.5 text-[clamp(1.9rem,3vw,2.6rem)] leading-none text-[var(--ink)]">
          Service Spine
        </h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          Live service issues across the book.
        </p>
      </div>

      <div
        className="spine-freshness"
        aria-label="Service Spine database freshness"
      >
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
            Updated
          </span>
          <span className="ml-1.5 whitespace-nowrap text-xs font-semibold tabular-nums text-[var(--ink)]">
            {sync.lastSyncAt ? (
              <SpineUpdatedTime value={sync.lastSyncAt} />
            ) : (
              "Awaiting first sync"
            )}
          </span>
        </div>
        <span
          aria-hidden="true"
          className="hidden h-4 w-px bg-[var(--rule)] sm:block"
        />
        <SpineRefreshButton />
      </div>
    </header>
  );
}
