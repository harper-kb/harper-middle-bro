import type { LaneDataMode } from "@/lib/types";

/** Live-data honesty: never show unlabeled sample numbers. */
export function LaneModeBanner({
  mode,
  reason,
  count,
  sourceCount,
}: {
  mode: LaneDataMode;
  reason: string | null;
  count: number;
  sourceCount: number | null;
}) {
  if (mode === "live") {
    return (
      <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-[var(--ink)]">
        <span className="font-semibold">Live</span>
        {" · "}
        {count} item{count === 1 ? "" : "s"}
        {sourceCount != null ? ` · BigBrother ${sourceCount}` : null}
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-[var(--ink)]">
      <span className="font-semibold">Sample Mode</span>
      {" — "}
      {reason ?? "Live credentials not reconciled for this lane."}
      {" · "}
      Showing {count} labeled sample item{count === 1 ? "" : "s"}
      {sourceCount != null ? ` · BigBrother reported ${sourceCount}` : null}.
    </div>
  );
}
